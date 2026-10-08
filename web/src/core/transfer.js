// Pasar el perfil y el historial a otro móvil sin crear cuenta (cifrado con el código).
import { Channel, brokers, connectFastest } from './transport.js';
import { deriveSession, randomCode, brokerOf, normalizeCode } from './crypto.js';
import { log } from './log.js';

const CHUNK = 24000;

export async function startSending(getData, onStatus) {
  const n = brokers().length;
  const won = await connectFastest(async (k) => {
    const c = randomCode(k, n);
    const d = await deriveSession(c, 'transfer');
    return { ch: new Channel({ brokerIndex: k, key: d.key, topic: d.topic }), code: c };
  });
  const { ch, code } = won;
  let sending = false;
  ch.onMessage(async (sub, obj) => {
    if (sub !== 'r' || !obj) return;
    if (obj.t === 'ready' && !sending) {
      sending = true;
      onStatus('sending', 0);
      const json = JSON.stringify(getData());
      const n = Math.max(1, Math.ceil(json.length / CHUNK));
      for (let i = 0; i < n; i++) {
        await ch.publish('d', { t: 'chunk', i, n, data: json.slice(i * CHUNK, (i + 1) * CHUNK) });
        onStatus('sending', (i + 1) / n);
      }
      await ch.publish('d', { t: 'end', n });
    }
    if (obj.t === 'done') {
      onStatus('done', 1);
      setTimeout(() => ch.end(), 500);
    }
  });
  await ch.subscribe(['r']);
  onStatus('waiting', 0);
  return { code, cancel: () => ch.end() };
}

export async function receiveFrom(codeInput, onProgress) {
  const code = normalizeCode(codeInput);
  if (!code) throw new Error('badcode');
  const d = await deriveSession(code, 'transfer');
  const ch = new Channel({ brokerIndex: brokerOf(code, brokers().length), key: d.key, topic: d.topic });
  await ch.connect(9000);
  const parts = [];
  let total = 0;
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { reject(new Error('timeout')); ch.end(); }, 60000);
    ch.onMessage(async (sub, obj) => {
      if (sub !== 'd' || !obj) return;
      if (obj.t === 'chunk') {
        parts[obj.i] = obj.data;
        total = obj.n;
        onProgress && onProgress(parts.filter(Boolean).length / obj.n);
      }
      if (obj.t === 'end') {
        const got = parts.filter((p) => typeof p === 'string').length;
        if (got !== (total || obj.n)) { reject(new Error('incomplete')); return; }
        clearTimeout(timeout);
        try {
          const data = JSON.parse(parts.join(''));
          await ch.publish('r', { t: 'done' });
          setTimeout(() => ch.end(), 400);
          resolve(data);
        } catch (e) {
          reject(e);
        }
      }
    });
  });
  await ch.subscribe(['d']);
  await ch.publish('r', { t: 'ready' });
  return result;
}
