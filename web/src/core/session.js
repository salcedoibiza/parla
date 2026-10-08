// Sesiones compartidas entre móviles: modo conversación (hasta 6) y modo guía (uno habla, muchos escuchan).
import { Channel, brokers, connectFastest } from './transport.js';
import { deriveSession, randomCode, brokerOf, normalizeCode } from './crypto.js';
import { translate, cachedTranslation, warmUp } from './translate.js';
import { trCode } from './langs.js';
import { upsertHistory, flushHistory } from './history.js';
import { randomId } from './store.js';
import { log } from './log.js';
import { ColorBook } from './colors.js';

export const MAX_CONV = 6;
export const MAX_TALK = 200;
const FLOOR_STALE_CONV = 25000;
const FLOOR_STALE_TALK = 90000;
const LIVE_TTL = 8000;
// Cada cuánto se envía el texto en directo y cada cuánto se traduce mientras se habla
const LIVE_MS = { conv: 220, talk: 350 };
const LIVE_TR_MS = { conv: 450, talk: 600 };
// Cuánto se espera a las traducciones antes de enviar el mensaje final (el resto llega después)
const FINAL_WAIT_MS = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SessionError extends Error {
  constructor(code, msg) {
    super(msg || code);
    this.code = code;
  }
}

class Emitter {
  constructor() { this._ev = new Map(); }
  on(ev, fn) {
    if (!this._ev.has(ev)) this._ev.set(ev, new Set());
    this._ev.get(ev).add(fn);
    return () => this._ev.get(ev).delete(fn);
  }
  emit(ev, data) {
    const s = this._ev.get(ev);
    if (!s) return;
    for (const fn of s) {
      try { fn(data); } catch (e) { log('emitter', ev, e); }
    }
  }
}

let current = null;
export function currentSession() { return current; }

export class Session extends Emitter {
  constructor(profile) {
    super();
    this.me = {
      uid: profile.uid,
      name: profile.name,
      lang: profile.lang,
      photo: profile.photoSmall || '',
    };
    this.myTr = trCode(profile.lang);
    this.code = '';
    this.mode = 'conv';
    this.isHost = false;
    this.state = null;
    this.participants = new Map();
    this.messages = [];
    this.msgIds = new Set();
    this.live = new Map();
    this.hands = [];
    this.handPending = false;
    this.status = 'connecting';
    this.endReason = null;
    this.lastActivity = new Map();
    this.joinedAt = Date.now();
    this.timers = [];
    this.lastLiveSent = 0;
    this.liveTimer = null;
    this.changeQueued = false;
    this.colors = new ColorBook();
  }

  /** Color propio de cada persona en esta sesión. */
  colorOf(uid) {
    if (!uid) return null;
    // En el discurso el que lo da siempre es naranja
    const pref = this.state && this.mode === 'talk' && uid === this.state.host ? 0 : null;
    return this.colors.of(uid, pref);
  }

  // ---------- utilidades ----------

  changed() {
    if (this.changeQueued) return;
    this.changeQueued = true;
    Promise.resolve().then(() => {
      this.changeQueued = false;
      this.emit('change', this);
    });
  }

  presenceOf(uid) { return this.participants.get(uid) || null; }

  get floor() { return this.state ? this.state.floor : null; }

  get hostUid() { return this.state ? this.state.host : null; }

  get listenerCount() {
    let n = 0;
    for (const uid of this.participants.keys()) if (uid !== this.hostUid) n++;
    return n;
  }

  canSpeak() {
    if (!this.state || this.status === 'ended') return false;
    return this.state.floor === this.me.uid;
  }

  floorTakenByOther() {
    const f = this.state && this.state.floor;
    if (!f || f === this.me.uid) return false;
    if (this.mode === 'conv' && !this.participants.has(f)) return false;
    return true;
  }

  myPresence() {
    const p = {
      uid: this.me.uid,
      name: this.me.name,
      lang: this.me.lang,
      role: this.isHost ? 'host' : 'guest',
      joined: this.joinedAt,
      v: 1,
    };
    // En el modo guía los oyentes no envían foto para ahorrar datos
    if (this.mode === 'conv' || this.isHost) p.photo = this.me.photo;
    return p;
  }

  // ---------- crear / unirse ----------

  static async create(profile, { mode, place = 'inperson', title = '' }) {
    const s = new Session(profile);
    s.mode = mode;
    s.isHost = true;
    const n = brokers().length;
    try {
      const won = await connectFastest(async (k) => {
        const code = randomCode(k, n);
        const d = await deriveSession(code);
        return { ch: new Channel({ brokerIndex: k, key: d.key, topic: d.topic, willSub: `p/${s.me.uid}` }), code, topic: d.topic };
      });
      s.ch = won.ch;
      s.code = won.code;
      s.topic = won.topic;
    } catch (e) {
      throw new SessionError('connect', e && e.message);
    }

    s.wire();
    await s.ch.subscribe(['s', 'm', 'l', 'h', 'p/+', `d/${s.me.uid}`]);
    s.state = {
      v: 1,
      mode,
      place,
      title: (title || '').trim().slice(0, 80),
      host: s.me.uid,
      hostName: s.me.name,
      hostLang: s.me.lang,
      floor: mode === 'talk' ? s.me.uid : null,
      floorAt: Date.now(),
      langs: [s.myTr],
      created: Date.now(),
      ended: false,
    };
    s.participants.set(s.me.uid, s.myPresence());
    await s.ch.publish(`p/${s.me.uid}`, s.myPresence(), { retain: true });
    await s.publishState();
    s.status = 'live';
    s.startTimers();
    s.initRecord();
    warmUp();
    current = s;
    s.changed();
    return s;
  }

  static async join(profile, codeInput) {
    const code = normalizeCode(codeInput);
    if (!code) throw new SessionError('badcode');
    const s = new Session(profile);
    s.code = code;
    s.isHost = false;
    const idx = brokerOf(code, brokers().length);
    const d = await deriveSession(code);
    s.topic = d.topic;
    const ch = new Channel({ brokerIndex: idx, key: d.key, topic: d.topic, willSub: `p/${s.me.uid}` });
    try {
      await ch.connect(9000);
    } catch (e) {
      try { await ch.end(); } catch { /* */ }
      throw new SessionError('connect', e && e.message);
    }
    s.ch = ch;
    const gotState = new Promise((resolve) => { s._stateWaiter = resolve; });
    s.wire();
    await ch.subscribe(['s']);
    const st = await Promise.race([gotState, new Promise((r) => setTimeout(() => r(null), 7000))]);
    s._stateWaiter = null;
    if (!st) {
      await ch.end();
      throw new SessionError('notfound');
    }
    if (st.ended) {
      await ch.end();
      throw new SessionError('ended');
    }
    s.mode = st.mode;
    if (s.mode === 'conv') {
      await ch.subscribe(['m', 'l', 'h', 'p/+', `d/${s.me.uid}`]);
      await new Promise((r) => setTimeout(r, 900));
      const others = [...s.participants.keys()].filter((u) => u !== s.me.uid);
      if (others.length >= MAX_CONV) {
        await ch.end();
        throw new SessionError('full');
      }
    } else {
      await ch.subscribe(['m', 'l', `d/${s.me.uid}`, `p/${st.host}`]);
      s.subscribedHost = st.host;
    }
    s.participants.set(s.me.uid, s.myPresence());
    await ch.publish(`p/${s.me.uid}`, s.myPresence(), { retain: true });
    s.status = 'live';
    s.startTimers();
    s.initRecord();
    warmUp();
    current = s;
    s.changed();
    return s;
  }

  wire() {
    this.ch.onMessage((sub, obj) => this.onChannel(sub, obj));
    this.ch.onStatus((st) => {
      if (this.status === 'ended') return;
      this.status = st === 'connected' ? 'live' : 'reconnecting';
      this.changed();
    });
    this.ch.onReconnect = () => {
      if (this.status === 'ended') return;
      this.ch.publish(`p/${this.me.uid}`, this.myPresence(), { retain: true });
      if (this.isHost) this.publishState();
    };
  }

  startTimers() {
    this.timers.push(setInterval(() => this.tick(), 2000));
    if (this.isHost) {
      // Por si el servidor pierde el estado guardado
      this.timers.push(setInterval(() => { if (this.isHost) this.publishState(); }, 60000));
    }
  }

  tick() {
    const now = Date.now();
    let dirty = false;
    for (const [uid, l] of this.live) {
      if (now - l.ts > LIVE_TTL) { this.live.delete(uid); dirty = true; }
    }
    if (this.isHost && this.state) {
      const f = this.state.floor;
      if (this.mode === 'conv' && f) {
        const last = this.lastActivity.get(f) || this.state.floorAt || 0;
        if (!this.participants.has(f) || now - last > FLOOR_STALE_CONV) this.setFloor(null);
      }
      if (this.mode === 'talk' && f && f !== this.me.uid) {
        const last = this.lastActivity.get(f) || this.state.floorAt || 0;
        if (!this.participants.has(f) || now - last > FLOOR_STALE_TALK) this.setFloor(this.me.uid);
      }
      const before = this.hands.length;
      this.hands = this.hands.filter((h) => this.participants.has(h.uid));
      if (this.hands.length !== before) dirty = true;
    }
    if (dirty) this.changed();
  }

  // ---------- mensajes entrantes ----------

  onChannel(sub, obj) {
    if (this.status === 'ended' && sub !== 's') return;
    if (sub === 's') { if (obj) this.onState(obj); return; }
    if (sub === 'm') { if (obj) this.onMessage(obj); return; }
    if (sub === 'l') { if (obj) this.onLive(obj); return; }
    if (sub === 'h') { if (obj && this.isHost) this.onHostRequest(obj); return; }
    if (sub.startsWith('p/')) {
      const uid = sub.slice(2);
      if (obj) this.addPresence(obj); else this.removePresence(uid);
      return;
    }
    if (sub.startsWith('d/')) {
      if (obj && sub.slice(2) === this.me.uid) this.onDirect(obj);
    }
  }

  onState(st) {
    if (this._stateWaiter) this._stateWaiter(st);
    const prev = this.state;
    if (prev && st.v < prev.v && st.host === prev.host) return; // estado antiguo
    if (this.mode === 'conv' && prev && this.isHost && st.host !== this.me.uid && prev.host === this.me.uid) {
      // Otro móvil se ha proclamado anfitrión a la vez: gana el de versión mayor o, si empatan, el uid menor
      const theirsWins = st.v > prev.v || (st.v === prev.v && st.host < this.me.uid);
      if (!theirsWins) {
        this.publishState();
        return;
      }
      this.isHost = false;
    }
    this.state = st;
    if (this.mode === 'conv' && st.host === this.me.uid && !this.isHost) {
      this.isHost = true;
      this.emit('host', true);
    }
    if (this.mode === 'talk' && !this.isHost && st.host !== this.subscribedHost && this.ch) {
      if (this.subscribedHost) this.ch.unsubscribe([`p/${this.subscribedHost}`]);
      this.ch.subscribe([`p/${st.host}`]);
      this.subscribedHost = st.host;
    }
    if (prev && prev.floor !== st.floor) {
      if (prev.floor) this.live.delete(prev.floor);
      this.emit('floor', { from: prev.floor, to: st.floor });
    }
    if (st.ended && !this.isHost && this.status !== 'ended') {
      this.finish('ended');
      return;
    }
    if (this.record) {
      this.record.title = st.title || this.record.title;
    }
    this.changed();
  }

  addPresence(p) {
    if (!p || !p.uid) return;
    const isNew = !this.participants.has(p.uid);
    this.participants.set(p.uid, p);
    if (this.record) {
      this.record.participants[p.uid] = { name: p.name, lang: p.lang };
      this.saveRecord();
    }
    if (isNew && p.uid !== this.me.uid) this.emit('joined', p);
    if (this.mode === 'talk' && !this.isHost && this.state && p.uid === this.state.host) this.emit('hostback', true);
    if (this.isHost) {
      this.enforceMax();
      this.recomputeLangs();
    }
    this.changed();
  }

  removePresence(uid) {
    const p = this.participants.get(uid);
    if (!p) return;
    this.participants.delete(uid);
    this.live.delete(uid);
    if (uid !== this.me.uid) this.emit('left', p);
    if (this.isHost) {
      this.hands = this.hands.filter((h) => h.uid !== uid);
      if (this.state && this.state.floor === uid) this.setFloor(this.mode === 'talk' ? this.me.uid : null);
      this.recomputeLangs();
    } else if (this.mode === 'conv' && this.state && uid === this.state.host) {
      clearTimeout(this.electionTimer);
      this.electionTimer = setTimeout(() => this.maybeElect(), 3000);
    } else if (this.mode === 'talk' && this.state && uid === this.state.host) {
      this.emit('hostgone', true);
    }
    this.changed();
  }

  enforceMax() {
    const max = this.mode === 'conv' ? MAX_CONV : MAX_TALK + 1; // +1: el que habla
    if (this.participants.size <= max) return;
    const list = [...this.participants.values()].sort((a, b) => (a.joined - b.joined) || (a.uid < b.uid ? -1 : 1));
    for (const p of list.slice(max)) {
      if (p.uid === this.me.uid) continue;
      this.ch.publish(`d/${p.uid}`, { t: 'full' });
      this.ch.clear(`p/${p.uid}`);
    }
  }

  recomputeLangs() {
    if (!this.state) return;
    const langs = new Set([this.myTr]);
    for (const p of this.participants.values()) langs.add(trCode(p.lang));
    const arr = [...langs].sort();
    if (arr.join(',') !== (this.state.langs || []).slice().sort().join(',')) {
      this.state = { ...this.state, langs: arr };
      this.publishState(400); // agrupa cambios si entran muchos oyentes a la vez
    }
  }

  maybeElect() {
    if (this.status === 'ended' || !this.state) return;
    if (this.participants.has(this.state.host)) return;
    const list = [...this.participants.values()].sort((a, b) => (a.joined - b.joined) || (a.uid < b.uid ? -1 : 1));
    if (!list.length || list[0].uid !== this.me.uid) return;
    log('elected as host');
    this.isHost = true;
    const floor = this.state.floor && this.participants.has(this.state.floor) ? this.state.floor : null;
    this.state = { ...this.state, host: this.me.uid, hostName: this.me.name, hostLang: this.me.lang, floor };
    this.recomputeLangs();
    this.publishState();
    this.emit('host', true);
    this.changed();
  }

  onHostRequest(r) {
    const uid = r.uid;
    if (!uid) return;
    this.lastActivity.set(uid, Date.now());
    const st = this.state;
    switch (r.t) {
      case 'floor-req':
        if (this.mode === 'conv') {
          const f = st.floor;
          const stale = f && (!this.participants.has(f) || Date.now() - (this.lastActivity.get(f) || st.floorAt || 0) > FLOOR_STALE_CONV);
          if (!f || f === uid || stale) this.setFloor(uid);
          else this.ch.publish(`d/${uid}`, { t: 'busy', floor: f });
        }
        break;
      case 'floor-rel':
        if (st.floor === uid) this.setFloor(this.mode === 'talk' ? this.me.uid : null);
        break;
      case 'hand':
        if (this.mode === 'talk' && st.floor !== uid && !this.hands.find((h) => h.uid === uid)) {
          this.hands = [...this.hands, { uid, name: r.name || '?', lang: r.lang, ts: Date.now() }];
          this.emit('hand', r);
          this.changed();
        }
        break;
      case 'hand-cancel':
        this.hands = this.hands.filter((h) => h.uid !== uid);
        this.changed();
        break;
      default:
        break;
    }
  }

  onDirect(d) {
    switch (d.t) {
      case 'granted':
        this.handPending = false;
        this.emit('granted', true);
        break;
      case 'denied':
        this.handPending = false;
        this.emit('denied', true);
        break;
      case 'revoked':
        this.emit('revoked', true);
        break;
      case 'busy':
        this.emit('busy', d.floor);
        break;
      case 'full':
        this.finish('full');
        break;
      case 'kick':
        this.finish('kicked');
        break;
      default:
        break;
    }
    this.changed();
  }

  onLive(l) {
    if (!l.uid || l.uid === this.me.uid) return;
    // Ignorar avisos "está hablando" que lleguen después de su mensaje
    if (this.lastMsgTs && l.ts && l.ts <= (this.lastMsgTs.get(l.uid) || 0)) return;
    if (this.isHost) this.lastActivity.set(l.uid, Date.now());
    const prev = this.live.get(l.uid);
    if (prev && l.seq && prev.seq && l.seq < prev.seq) return; // llegó desordenado
    if (!l.text && !l.kind) this.live.delete(l.uid);
    else if (l.kind === 'stop') this.live.delete(l.uid);
    else {
      const same = trCode(l.lang || '') === this.myTr;
      let tr = same ? (l.text || '') : ((l.tr && l.tr[this.myTr]) || '');
      // Si aún no llegó traducción de este trozo, se mantiene la anterior para que no parpadee
      if (!tr && prev && prev.tr && !same) tr = prev.tr;
      this.live.set(l.uid, {
        uid: l.uid, name: l.name, text: l.text || '', tr, kind: l.kind || 'speech', lang: l.lang, seq: l.seq || 0, ts: Date.now(),
      });
    }
    this.changed();
  }

  onMessage(m) {
    if (m.t === 'trfix') { this.onTrFix(m); return; }
    if (!m.id || this.msgIds.has(m.id)) return;
    this.msgIds.add(m.id);
    const live = this.live.get(m.uid);
    if (this.isHost) this.lastActivity.set(m.uid, Date.now());
    if (!this.lastMsgTs) this.lastMsgTs = new Map();
    this.lastMsgTs.set(m.uid, Math.max(this.lastMsgTs.get(m.uid) || 0, m.ts || 0));
    this.live.delete(m.uid);
    const item = {
      id: m.id,
      uid: m.uid,
      name: m.name,
      lang: m.lang,
      text: m.text,
      ts: m.ts || Date.now(),
      own: m.uid === this.me.uid,
      mine: null,
      // Mientras llega la traducción definitiva se muestra la que se vio en directo
      provisional: live && live.tr ? live.tr : null,
      status: 'translating',
    };
    this.messages.push(item);
    let finished = false;
    const done = (txt, failed = false) => {
      if (finished) return;
      finished = true;
      item.mine = txt;
      item.provisional = null;
      item.status = failed ? 'untranslated' : 'ok';
      this.saveRecord();
      this.changed();
      this.emit('message', item);
    };
    item.done = done;
    const selfTranslate = () => {
      if (finished) return;
      translate(m.text, trCode(m.lang), this.myTr)
        .then((txt) => done(txt))
        .catch(() => done(m.text, true));
    };
    if (item.own || trCode(m.lang) === this.myTr) done(m.text);
    else if (m.tr && m.tr[this.myTr]) done(m.tr[this.myTr]);
    else if (Array.isArray(m.pending) && m.pending.includes(this.myTr)) {
      // El que habla enviará la traducción enseguida; si no llega, se traduce aquí
      setTimeout(selfTranslate, 2500);
    } else selfTranslate();
    this.changed();
  }

  onTrFix(m) {
    const item = this.messages.find((x) => x.id === m.id);
    if (!item || item.status !== 'translating' || !m.tr || !m.tr[this.myTr]) return;
    if (item.done) item.done(m.tr[this.myTr]);
  }

  // ---------- acciones ----------

  async publishState(delay = 0) {
    if (!this.ch || !this.state) return;
    if (delay > 0) {
      if (this.stateTimer) return;
      this.stateTimer = setTimeout(() => {
        this.stateTimer = null;
        this.publishState(0);
      }, delay);
      return;
    }
    clearTimeout(this.stateTimer);
    this.stateTimer = null;
    this.state = { ...this.state, v: (this.state.v || 0) + 1 };
    const snapshot = this.state;
    this.changed();
    await this.ch.publish('s', snapshot, { retain: true });
  }

  setFloor(uid) {
    if (!this.state) return;
    if (this.state.floor === uid) return;
    const prev = this.state.floor;
    this.state = { ...this.state, floor: uid, floorAt: Date.now() };
    if (uid) this.lastActivity.set(uid, Date.now());
    if (prev && prev !== uid) this.live.delete(prev);
    this.emit('floor', { from: prev, to: uid });
    this.publishState();
  }

  /** Pedir la palabra (modo conversación, o el guía). Devuelve true si se concede. */
  async requestFloor() {
    if (!this.state || this.status === 'ended') return false;
    if (this.state.floor === this.me.uid) return true;
    if (this.mode === 'talk') {
      if (!this.isHost) return false;
      if (this.state.floor && this.state.floor !== this.me.uid) return false;
      this.setFloor(this.me.uid);
      return true;
    }
    if (this.floorTakenByOther()) return false;
    if (this.isHost) {
      this.setFloor(this.me.uid);
      return true;
    }
    this.ch.publish('h', { t: 'floor-req', uid: this.me.uid });
    return new Promise((resolve) => {
      let off1 = null;
      let off2 = null;
      const timer = setTimeout(() => { cleanup(); resolve(this.state && this.state.floor === this.me.uid); }, 3500);
      const cleanup = () => { clearTimeout(timer); if (off1) off1(); if (off2) off2(); };
      off1 = this.on('change', () => {
        if (this.state && this.state.floor === this.me.uid) { cleanup(); resolve(true); } else if (this.floorTakenByOther()) { cleanup(); resolve(false); }
      });
      off2 = this.on('busy', () => { cleanup(); resolve(false); });
    });
  }

  releaseFloor() {
    if (!this.state || this.state.floor !== this.me.uid) return;
    if (this.mode === 'talk' && this.isHost) return; // el guía conserva la palabra
    if (this.isHost) {
      this.setFloor(null);
    } else {
      this.ch.publish('h', { t: 'floor-rel', uid: this.me.uid });
    }
    this.sendLive('', 'stop', true);
  }

  // Modo guía
  raiseHand() {
    if (this.mode !== 'talk' || this.isHost || this.handPending) return;
    this.handPending = true;
    this.ch.publish('h', { t: 'hand', uid: this.me.uid, name: this.me.name, lang: this.me.lang });
    this.changed();
  }

  cancelHand() {
    if (!this.handPending) return;
    this.handPending = false;
    this.ch.publish('h', { t: 'hand-cancel', uid: this.me.uid });
    this.changed();
  }

  acceptHand(uid) {
    if (!this.isHost) return;
    this.hands = this.hands.filter((h) => h.uid !== uid);
    this.setFloor(uid);
    this.ch.publish(`d/${uid}`, { t: 'granted' });
    this.changed();
  }

  denyHand(uid) {
    if (!this.isHost) return;
    this.hands = this.hands.filter((h) => h.uid !== uid);
    this.ch.publish(`d/${uid}`, { t: 'denied' });
    this.changed();
  }

  reclaimFloor() {
    if (!this.isHost) return;
    const prev = this.state.floor;
    if (prev && prev !== this.me.uid) this.ch.publish(`d/${prev}`, { t: 'revoked' });
    this.setFloor(this.me.uid);
  }

  kick(uid) {
    if (!this.isHost || uid === this.me.uid) return;
    this.ch.publish(`d/${uid}`, { t: 'kick' });
    this.ch.clear(`p/${uid}`);
    this.participants.delete(uid);
    this.recomputeLangs();
    this.changed();
  }

  /**
   * Texto parcial mientras se dicta o se escribe. Los demás lo ven en directo
   * y, mientras se habla, se va traduciendo a sus idiomas.
   */
  sendLive(text, kind = 'speech', force = false) {
    if (!this.ch || this.status === 'ended') return;
    if (!this.liveState) this.liveState = { text: '', kind: 'speech', tr: {}, trText: '', seq: 0, gen: 0 };
    const L = this.liveState;
    if (kind === 'stop') {
      clearTimeout(this.liveTimer);
      clearTimeout(this.liveTrTimer);
      L.gen++;
      L.text = '';
      L.tr = {};
      L.trText = '';
      this.ch.publish('l', { t: 'live', uid: this.me.uid, kind: 'stop', ts: Date.now(), seq: ++L.seq }, { qos: 0 });
      return;
    }
    L.text = (text || '').slice(0, 600);
    L.kind = kind;
    if (kind === 'speech' && L.text) this.pumpLiveTranslation();
    this.scheduleLive(force);
  }

  scheduleLive(force = false) {
    const L = this.liveState;
    const every = LIVE_MS[this.mode] || 250;
    const now = Date.now();
    clearTimeout(this.liveTimer);
    const go = () => {
      if (!this.ch) return;
      this.lastLiveSent = Date.now();
      this.ch.publish('l', {
        t: 'live', uid: this.me.uid, name: this.me.name, lang: this.me.lang,
        text: L.text, kind: L.kind, tr: L.tr, ts: Date.now(), seq: ++L.seq,
      }, { qos: 0 });
    };
    if (force || now - this.lastLiveSent >= every) go();
    else this.liveTimer = setTimeout(go, every - (now - this.lastLiveSent));
  }

  pumpLiveTranslation() {
    const L = this.liveState;
    if (this.liveTrBusy || !L.text || L.text === L.trText) return;
    const targets = ((this.state && this.state.langs) || []).filter((l) => l !== this.myTr);
    if (!targets.length) return;
    const every = LIVE_TR_MS[this.mode] || 500;
    const wait = every - (Date.now() - (this.lastLiveTr || 0));
    if (wait > 0) {
      clearTimeout(this.liveTrTimer);
      this.liveTrTimer = setTimeout(() => this.pumpLiveTranslation(), wait);
      return;
    }
    const text = L.text;
    const gen = L.gen;
    this.liveTrBusy = true;
    this.lastLiveTr = Date.now();
    const tr = {};
    Promise.all(targets.map((tl) => translate(text, this.myTr, tl).then((x) => { tr[tl] = x; }).catch(() => {})))
      .then(() => {
        this.liveTrBusy = false;
        if (gen !== L.gen || !this.ch) return;
        L.tr = { ...L.tr, ...tr };
        L.trText = text;
        this.scheduleLive(true);
        if (L.text !== text) this.pumpLiveTranslation();
      });
  }

  async send(text) {
    const clean = String(text || '').trim();
    if (!clean) return false;
    if (!this.canSpeak()) return false;
    const id = randomId(6);
    clearTimeout(this.liveTimer);
    clearTimeout(this.liveTrTimer);
    if (this.liveState) { this.liveState.gen++; this.liveState.text = ''; this.liveState.trText = ''; this.liveState.tr = {}; }
    const ts = Date.now();
    this.msgIds.add(id);
    const local = {
      id, uid: this.me.uid, name: this.me.name, lang: this.me.lang, text: clean, mine: clean, ts, own: true, status: 'sending',
    };
    this.messages.push(local);
    this.changed();
    const targets = ((this.state && this.state.langs) || []).filter((l) => l !== this.myTr);
    // Lo que ya se tradujo mientras se hablaba sale al momento
    const tr = {};
    const missing = [];
    for (const tl of targets) {
      const c = cachedTranslation(clean, this.myTr, tl);
      if (c) tr[tl] = c; else missing.push(tl);
    }
    let rest = null;
    if (missing.length) {
      rest = Promise.all(missing.map((tl) => translate(clean, this.myTr, tl).then((x) => { tr[tl] = x; }).catch(() => {})));
      await Promise.race([rest, sleep(FINAL_WAIT_MS)]);
    }
    const sentTr = { ...tr };
    const pending = missing.filter((tl) => !sentTr[tl]);
    const ok = await this.ch.publish('m', {
      t: 'msg', id, uid: this.me.uid, name: this.me.name, lang: this.me.lang, text: clean, tr: sentTr, pending, ts,
    });
    if (pending.length && rest) {
      // Las traducciones que faltaban se envían en cuanto estén
      rest.then(() => {
        const fix = {};
        for (const tl of pending) if (tr[tl]) fix[tl] = tr[tl];
        if (Object.keys(fix).length && this.ch) this.ch.publish('m', { t: 'trfix', id, tr: fix });
      });
    }
    local.status = ok ? 'sent' : 'failed';
    local.trCount = Object.keys(sentTr).length;
    this.saveRecord();
    if (this.mode === 'conv') this.releaseFloor();
    this.changed();
    return ok;
  }

  // ---------- historial ----------

  initRecord() {
    const participants = {};
    for (const p of this.participants.values()) participants[p.uid] = { name: p.name, lang: p.lang };
    this.record = {
      id: `${(this.topic || this.code).slice(0, 10)}-${this.joinedAt}`,
      code: this.code,
      mode: this.mode,
      role: this.isHost ? 'host' : 'guest',
      title: (this.state && this.state.title) || '',
      hostName: this.state ? this.state.hostName : '',
      myUid: this.me.uid,
      myLang: this.me.lang,
      startedAt: this.joinedAt,
      endedAt: null,
      participants,
      messages: [],
    };
    this.saveRecord();
  }

  saveRecord() {
    if (!this.record) return;
    this.record.messages = this.messages
      .filter((m) => m.status !== 'sending' || m.own)
      .map((m) => ({ id: m.id, uid: m.uid, name: m.name, lang: m.lang, text: m.text, mine: m.mine, ts: m.ts, own: m.own }));
    upsertHistory(this.record);
  }

  // ---------- salir ----------

  async leave() {
    if (this.status === 'ended') return;
    try {
      if (this.isHost && this.state) {
        const others = [...this.participants.values()].filter((p) => p.uid !== this.me.uid)
          .sort((a, b) => (a.joined - b.joined) || (a.uid < b.uid ? -1 : 1));
        if (this.mode === 'talk' || others.length === 0) {
          this.state = { ...this.state, ended: true };
          await this.publishState();
        } else {
          const next = others[0];
          this.state = {
            ...this.state,
            host: next.uid,
            hostName: next.name,
            hostLang: next.lang,
            floor: this.state.floor === this.me.uid ? null : this.state.floor,
          };
          this.isHost = false;
          await this.publishState();
        }
      } else {
        if (this.state && this.state.floor === this.me.uid) this.releaseFloor();
        if (this.handPending) this.cancelHand();
      }
      await this.ch.clear(`p/${this.me.uid}`);
    } catch (e) {
      log('leave error', e && e.message);
    }
    await this.finish('left');
  }

  async finish(reason) {
    if (this.status === 'ended') return;
    this.status = 'ended';
    this.endReason = reason;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    clearTimeout(this.electionTimer);
    clearTimeout(this.liveTimer);
    clearTimeout(this.stateTimer);
    clearTimeout(this.liveTrTimer);
    if (this.record) {
      this.record.endedAt = Date.now();
      this.saveRecord();
      flushHistory();
    }
    const ch = this.ch;
    this.ch = null;
    if (ch) {
      if (reason !== 'left') { try { await ch.clear(`p/${this.me.uid}`); } catch { /* */ } }
      await ch.end();
    }
    if (current === this) current = null;
    this.emit('ended', reason);
    this.changed();
  }
}
