// Canal de mensajería en tiempo real (MQTT sobre WebSocket, servidores públicos gratuitos).
// Todo lo que viaja va cifrado con la clave derivada del código de sesión.
import mqtt from 'mqtt';
import { encryptJson, decryptJson } from './crypto.js';
import { randomId } from './store.js';
import { log } from './log.js';

// Servidores públicos gratuitos. El último usa el puerto 443 (el de la web normal),
// que casi ninguna red bloquea.
const DEFAULT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://public:public@public.cloud.shiftr.io:443',
];

function parseBroker(u) {
  const m = String(u).match(/^(wss?:\/\/)(?:([^:@/]+):([^@/]+)@)?(.*)$/);
  if (!m) return { url: u };
  return { url: m[1] + m[4], username: m[2], password: m[3] };
}

export function brokerHost(i) {
  try { return new URL(parseBroker(brokers()[i]).url).host; } catch { return String(i); }
}

export function brokers() {
  return (typeof window !== 'undefined' && window.__PARLA_BROKERS__) || DEFAULT_BROKERS;
}

export const ROOT = 'parla1';

export class Channel {
  constructor({ brokerIndex, key, topic, willSub }) {
    const b = parseBroker(brokers()[brokerIndex % brokers().length]);
    this.url = b.url;
    this.auth = b.username ? { username: b.username, password: b.password } : null;
    this.key = key;
    this.base = `${ROOT}/${topic}`;
    this.willSub = willSub;
    this.client = null;
    this.handlers = [];
    this.statusListeners = new Set();
    this.status = 'idle';
    this.queue = Promise.resolve();
  }

  onStatus(fn) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    for (const l of this.statusListeners) {
      try { l(s); } catch (e) { log('status listener', e); }
    }
  }

  connect(timeoutMs = 9000) {
    return new Promise((resolve, reject) => {
      const opts = {
        clientId: `parla_${randomId(6)}`,
        clean: true,
        keepalive: 30,
        reconnectPeriod: 2500,
        connectTimeout: timeoutMs,
        protocolVersion: 4,
        resubscribe: true,
      };
      if (this.auth) Object.assign(opts, this.auth);
      if (this.willSub) {
        opts.will = { topic: `${this.base}/${this.willSub}`, payload: '', retain: true, qos: 1 };
      }
      let settled = false;
      const client = mqtt.connect(this.url, opts);
      this.client = client;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { client.end(true); } catch { /* */ }
        reject(new Error('connect timeout'));
      }, timeoutMs + 500);

      client.on('connect', () => {
        this.setStatus('connected');
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        } else if (this.onReconnect) {
          this.onReconnect();
        }
      });
      client.on('reconnect', () => this.setStatus('reconnecting'));
      client.on('offline', () => this.setStatus('offline'));
      client.on('close', () => { if (this.status === 'connected') this.setStatus('reconnecting'); });
      client.on('error', (e) => {
        log('mqtt error', e && e.message);
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          try { client.end(true); } catch { /* */ }
          reject(e);
        }
      });
      client.on('message', (topic, payload, packet) => {
        if (!topic.startsWith(`${this.base}/`)) return;
        const sub = topic.slice(this.base.length + 1);
        const bytes = payload ? new Uint8Array(payload) : new Uint8Array(0);
        // Mantener el orden de llegada aunque descifrar sea asíncrono
        this.queue = this.queue.then(async () => {
          let obj = null;
          if (bytes.length > 0) {
            obj = await decryptJson(this.key, bytes);
            if (!obj) return; // no es nuestro o está dañado
          }
          for (const h of this.handlers) {
            try { h(sub, obj, packet); } catch (e) { log('handler error', e); }
          }
        }).catch((e) => log('queue error', e));
      });
    });
  }

  onMessage(fn) {
    this.handlers.push(fn);
  }

  subscribe(subs) {
    const topics = subs.map((s) => `${this.base}/${s}`);
    return new Promise((resolve) => {
      if (!this.client) return resolve();
      // Nunca esperar indefinidamente la confirmación del servidor
      const timer = setTimeout(() => { log('subscribe slow', subs.join(',')); resolve(); }, 6000);
      this.client.subscribe(topics, { qos: 1 }, (err) => {
        clearTimeout(timer);
        if (err) log('subscribe error', err.message);
        resolve();
      });
    });
  }

  unsubscribe(subs) {
    if (!this.client) return;
    this.client.unsubscribe(subs.map((s) => `${this.base}/${s}`));
  }

  async publish(sub, obj, { retain = false, qos = 1 } = {}) {
    if (!this.client) return;
    const payload = await encryptJson(this.key, obj);
    return new Promise((resolve) => {
      if (!this.client) { resolve(false); return; }
      // Si el servidor tarda en confirmar, seguimos: el mensaje se reenvía solo al reconectar
      const timer = setTimeout(() => { log('publish slow', sub); resolve(true); }, 6000);
      this.client.publish(`${this.base}/${sub}`, payload, { retain, qos }, (err) => {
        clearTimeout(timer);
        if (err) log('publish error', sub, err.message);
        resolve(!err);
      });
    });
  }

  clear(sub) {
    if (!this.client) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      this.client.publish(`${this.base}/${sub}`, '', { retain: true, qos: 1 }, () => { clearTimeout(timer); resolve(); });
    });
  }

  end() {
    const c = this.client;
    this.client = null;
    this.handlers = [];
    this.setStatus('closed');
    if (c) {
      return new Promise((resolve) => {
        try { c.end(false, {}, () => resolve()); } catch { resolve(); }
        setTimeout(resolve, 1500);
      });
    }
    return Promise.resolve();
  }
}

/**
 * Conecta a todos los servidores a la vez y se queda con el primero que responde.
 * makeChannel(i) devuelve { ch, ...extra } (puede ser asíncrono).
 */
export function connectFastest(makeChannel, timeoutMs = 9000) {
  const list = brokers();
  return new Promise((resolve, reject) => {
    let settled = false;
    let failed = 0;
    const errors = [];
    list.forEach(async (_, idx) => {
      let made = null;
      try {
        made = await makeChannel(idx);
        await made.ch.connect(timeoutMs);
        if (settled) { made.ch.end(); return; }
        settled = true;
        log('broker chosen', brokerHost(idx));
        resolve({ ...made, idx });
      } catch (e) {
        errors.push(`${brokerHost(idx)}: ${e && e.message}`);
        log('broker failed', brokerHost(idx), e && e.message);
        if (made && made.ch) { try { made.ch.end(); } catch { /* */ } }
        failed++;
        if (failed === list.length && !settled) {
          settled = true;
          const err = new Error(errors.join(' · '));
          reject(err);
        }
      }
    });
  });
}
