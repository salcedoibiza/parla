// Modo Escucha: oye continuamente (una película, una charla…) y va traduciendo lo que entiende.
import { Utterance } from './speech.js';
import { ensureMicPermission, native } from './native.js';
import { translate } from './translate.js';
import { lang as langInfo, trCode } from './langs.js';
import { upsertHistory, flushHistory } from './history.js';
import { randomId } from './store.js';
import { log } from './log.js';

const FATAL = new Set(['permission', 'unavailable', 'language']);

export class ListenEngine {
  constructor({ from, to, onChange, onError, onSegment }) {
    this.from = from;
    this.to = to;
    this.onChange = onChange || (() => {});
    this.onError = onError || (() => {});
    this.onSegment = onSegment || (() => {});
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
    this.watchdog = setInterval(() => {
      if (this.running && !this.held && Date.now() - this.lastEvent > 20000) {
        log('listen watchdog restart');
        this.restartSoon(0, true);
      }
    }, 5000);
    this.loop();
    this.onChange();
    return true;
  }

  stop() {
    this.running = false;
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
        this.errors = 0;
        this.warning = '';
        this.partial = { ...this.partial, text: p };
        this.scheduleProvisional();
        this.onChange();
      },
      onFinal: (f) => {
        this.lastEvent = Date.now();
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
    const wait = Math.max(0, 1100 - (Date.now() - this.lastTrAt));
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
        const tr = await translate(text, this.sl, this.tl);
        if (this.partial.text.trim().startsWith(text.slice(0, Math.min(12, text.length)))) {
          this.partial = { ...this.partial, tr };
          this.onChange();
        }
      } catch { /* sin traducción provisional */ }
    }, wait);
  }

  commit(text) {
    const seg = { id: randomId(5), ts: Date.now(), text, tr: this.sl === this.tl ? text : '', lang: this.from };
    this.segments.push(seg);
    if (this.segments.length > 400) this.segments = this.segments.slice(-400);
    if (!seg.tr) {
      translate(text, this.sl, this.tl)
        .then((tr) => { seg.tr = tr; this.onChange(); this.onSegment(seg); this.save(); })
        .catch(() => { seg.tr = text; seg.failed = true; this.onChange(); this.save(); });
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
      id: s.id, uid: 'audio', name: '', lang: s.lang, text: s.text, mine: s.tr || s.text, ts: s.ts, own: false,
    }));
    upsertHistory(this.record);
    if (flush) flushHistory();
  }

  /** Empezar de cero (lo anterior queda en el historial). */
  reset() {
    this.save(true);
    this.segments = [];
    this.partial = { text: '', tr: '' };
    this.record = null;
    this.onChange();
  }
}
