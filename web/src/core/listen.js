// Modo Escucha: oye continuamente (una película, una charla…) y va traduciendo lo que entiende.
import { Utterance } from './speech.js';
import { ensureMicPermission, native } from './native.js';
import { translate, translateFast } from './translate.js';
import { canLocal, translateLocal } from './localtr.js';
import { lang as langInfo, trCode } from './langs.js';
import { upsertHistory, flushHistory } from './history.js';
import { randomId } from './store.js';
import { log } from './log.js';
import { createVoiceTracker, VoiceClusterer, onAppResume } from './voices.js';

const FATAL = new Set(['permission', 'unavailable', 'language']);

export class ListenEngine {
  constructor({ from, to, onChange, onError, onSegment, voices = false, onVoicesBlocked }) {
    this.from = from;
    this.to = to;
    this.onChange = onChange || (() => {});
    this.onError = onError || (() => {});
    this.onSegment = onSegment || (() => {});
    this.onVoicesBlocked = onVoicesBlocked || (() => {});
    this.voicesWanted = voices;
    this.tracker = null;
    this.trackerOn = false;
    this.clusterer = new VoiceClusterer();
    this.segStart = 0;
    this.lastHeard = 0;
    this.lastVoice = null;
    this.running = false;
    this.held = false;
    this.segments = [];
    this.partial = { text: '', tr: '' };
    this.current = null;
    this.errors = 0;
    this.lastEvent = 0;
    this.trTimer = null;
    this.lastTrAt = 0;
    this.lastTrText = '';
    this.record = null;
    this.warning = '';
  }

  get sl() { return trCode(this.from); }
  get tl() { return trCode(this.to); }

  setFrom(id) {
    this.from = id;
    if (this.running) { this.restartSoon(0, true); }
  }

  async start() {
    if (this.running) return true;
    const ok = await ensureMicPermission();
    if (!ok) { this.onError('permission'); return false; }
    this.running = true;
    this.held = false;
    this.errors = 0;
    this.warning = '';
    if (native && native.setQuiet) { try { native.setQuiet(true); } catch { /* */ } }
    if (this.voicesWanted) this.startVoices();
    this.offResume = onAppResume(() => { if (this.running && this.trackerOn && this.tracker) this.tracker.start(); });
    this.watchdog = setInterval(() => {
      if (this.running && !this.held && Date.now() - this.lastEvent > 20000) {
        log('listen watchdog restart');
        this.restartSoon(0, true);
      }
      this.checkVoices();
    }, 3000);
    this.loop();
    this.onChange();
    return true;
  }

  // ---------- voces ----------
  async startVoices() {
    if (this.trackerOn) return;
    this.tracker = this.tracker || createVoiceTracker();
    if (!this.tracker) return;
    const ok = await this.tracker.start();
    if (!ok || !this.running) { if (ok) this.tracker.stop(); return; }
    this.trackerOn = true;
    this.trackerStartedAt = Date.now();
    this.heardSinceTracker = false;
  }

  stopVoices() {
    if (this.tracker) this.tracker.stop();
    this.trackerOn = false;
  }

  setVoices(on) {
    this.voicesWanted = on;
    if (!this.running) return;
    if (on) this.startVoices(); else this.stopVoices();
    this.onChange();
  }

  /**
   * Comprueba que medir el tono no estorba al reconocimiento de voz.
   * Algunos móviles no dejan usar el micrófono a la vez desde dos sitios.
   */
  checkVoices() {
    if (!this.trackerOn || !this.tracker || !this.running) return;
    const now = Date.now();
    const s = this.tracker.stats(now - 6000, now) || {};
    // 1) El tono no recibe sonido (el sistema le da silencio) pero el reconocimiento sí oye
    if (s.frames > 40 && s.zeroFrac > 0.9 && now - this.lastHeard < 6000) {
      log('voices: tracker silenced');
      this.blockVoices();
      return;
    }
    // 2) Hay sonido fuerte pero el reconocimiento no oye nada desde que se activó el tono
    if (!this.heardSinceTracker && now - this.trackerStartedAt > 12000 && s.rms > 0.02) {
      log('voices: recognizer starved');
      this.blockVoices();
      this.restartSoon(0, true);
    }
  }

  blockVoices() {
    this.stopVoices();
    this.voicesWanted = false;
    this.onVoicesBlocked();
    this.onChange();
  }

  voiceFor(t0, t1) {
    if (!this.trackerOn || !this.tracker) return null;
    const s = this.tracker.stats(t0, t1) || {};
    if ((s.n || 0) >= 5) return this.clusterer.assign(s.median);
    return this.lastVoice;
  }

  stop() {
    this.running = false;
    this.stopVoices();
    if (this.offResume) { this.offResume(); this.offResume = null; }
    clearInterval(this.watchdog);
    clearTimeout(this.restartTimer);
    clearTimeout(this.trTimer);
    if (this.current) { this.current.cancel(); this.current = null; }
    if (native && native.setQuiet) { try { native.setQuiet(false); } catch { /* */ } }
    // Lo que quedaba a medias se guarda como frase
    if (this.partial.text.trim()) this.commit(this.partial.text.trim());
    this.partial = { text: '', tr: '' };
    this.save(true);
    this.onChange();
  }

  /** Pausa breve (p. ej. mientras se lee en voz alta una traducción, para no oírse a sí mismo). */
  hold(on) {
    if (this.held === on) return;
    this.held = on;
    if (on) {
      clearTimeout(this.restartTimer);
      if (this.current) { this.current.cancel(); this.current = null; }
    } else if (this.running) {
      this.restartSoon(150);
    }
  }

  restartSoon(ms = 150, force = false) {
    clearTimeout(this.restartTimer);
    if (force && this.current) { const c = this.current; this.current = null; c.cancel(); }
    this.restartTimer = setTimeout(() => this.loop(), ms);
  }

  loop() {
    if (!this.running || this.held || this.current) return;
    this.lastEvent = Date.now();
    const u = new Utterance(langInfo(this.from).bcp, {
      onPartial: (p) => {
        this.lastEvent = Date.now();
        this.lastHeard = Date.now();
        this.heardSinceTracker = true;
        if (!this.partial.text) this.segStart = Date.now();
        this.errors = 0;
        this.warning = '';
        this.partial = { ...this.partial, text: p };
        this.scheduleProvisional();
        this.onChange();
      },
      onFinal: (f) => {
        this.lastEvent = Date.now();
        this.lastHeard = Date.now();
        this.heardSinceTracker = true;
        this.errors = 0;
        if (f && f.trim()) this.commit(f.trim());
        this.partial = { text: '', tr: '' };
        this.lastTrText = '';
        this.onChange();
      },
      onError: (code) => {
        this.lastEvent = Date.now();
        if (code === 'nomatch' || code === 'timeout') return;
        if (FATAL.has(code)) {
          this.onError(code);
          this.stop();
          return;
        }
        this.errors++;
        if (code === 'network') this.warning = 'network';
        if (this.errors > 8) {
          this.onError(code);
          this.stop();
        }
        this.onChange();
      },
      onEnd: () => {
        if (this.current === u) this.current = null;
        if (!this.running || this.held) return;
        const wait = this.errors ? Math.min(4000, 400 * this.errors) : 120;
        this.restartSoon(wait);
      },
    }, { continuous: true });
    this.current = u;
    u.start();
  }

  scheduleProvisional() {
    if (this.trTimer) return;
    // Con la traducción del móvil se puede actualizar mucho más a menudo
    const every = canLocal(this.sl, this.tl) ? 200 : 500;
    const wait = Math.max(0, every - (Date.now() - this.lastTrAt));
    this.trTimer = setTimeout(async () => {
      this.trTimer = null;
      const text = this.partial.text.trim();
      if (!text || text === this.lastTrText || this.sl === this.tl) {
        if (this.sl === this.tl) { this.partial = { ...this.partial, tr: text }; this.onChange(); }
        return;
      }
      this.lastTrText = text;
      this.lastTrAt = Date.now();
      try {
        const tr = await translateFast(text, this.sl, this.tl);
        if (this.partial.text.trim().startsWith(text.slice(0, Math.min(12, text.length)))) {
          this.partial = { ...this.partial, tr };
          this.onChange();
        }
      } catch { /* sin traducción provisional */ }
    }, wait);
  }

  commit(text) {
    const now = Date.now();
    // La voz empieza un poco antes de que llegue el primer texto reconocido
    const start = (this.segStart || now - 2500) - 700;
    const voice = this.voiceFor(start, now - 200);
    this.lastVoice = voice;
    this.segStart = 0;
    const seg = { id: randomId(5), ts: now, text, tr: this.sl === this.tl ? text : '', lang: this.from, voice };
    this.segments.push(seg);
    if (this.segments.length > 400) this.segments = this.segments.slice(-400);
    if (!seg.tr) {
      // Lo que ya se veía mientras hablaban se mantiene hasta que llegue la traducción buena
      if (this.partial.tr) { seg.tr = this.partial.tr; seg.prov = true; }
      if (canLocal(this.sl, this.tl)) {
        translateLocal(text, this.sl, this.tl, 2000)
          .then((tr) => { if (!seg.done && tr) { seg.tr = tr; seg.prov = true; this.onChange(); } })
          .catch(() => {});
      }
      translate(text, this.sl, this.tl)
        .then((tr) => { seg.done = true; seg.tr = tr; seg.prov = false; this.onChange(); this.onSegment(seg); this.save(); })
        .catch(() => { seg.done = true; if (!seg.tr) { seg.tr = text; seg.failed = true; } seg.prov = false; this.onChange(); this.save(); });
    } else {
      this.onSegment(seg);
      this.save();
    }
  }

  save(flush = false) {
    if (!this.segments.length) return;
    if (!this.record) {
      this.record = {
        id: `listen-${this.segments[0].ts}`,
        mode: 'listen',
        role: 'host',
        title: '',
        myUid: 'me',
        myLang: this.to,
        startedAt: this.segments[0].ts,
        endedAt: null,
        participants: {},
        messages: [],
      };
    }
    this.record.endedAt = Date.now();
    this.record.messages = this.segments.map((s) => ({
      id: s.id, uid: s.voice !== null && s.voice !== undefined ? `voz${s.voice + 1}` : 'audio', name: s.voice !== null && s.voice !== undefined ? `Voz ${s.voice + 1}` : '', lang: s.lang, text: s.text, mine: s.tr || s.text, ts: s.ts, own: false,
    }));
    upsertHistory(this.record);
    if (flush) flushHistory();
  }

  /** Empezar de cero (lo anterior queda en el historial). */
  reset() {
    this.save(true);
    this.clusterer.reset();
    this.lastVoice = null;
    this.segments = [];
    this.partial = { text: '', tr: '' };
    this.record = null;
    this.onChange();
  }
}
