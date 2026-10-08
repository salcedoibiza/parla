// Dictado por voz. En la app usa el reconocimiento de voz de Android; en la web, el del navegador.
import { native, onNative, ensureMicPermission } from './native.js';
import { log } from './log.js';

let sidSeq = 0;

function webRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function speechSupported() {
  return !!native || !!webRecognitionCtor();
}

/**
 * Un "enunciado": empieza a escuchar y termina solo al detectar silencio o al llamar a stop().
 * cb: { onPartial(text), onFinal(text), onLevel(0..1), onEnd(), onError(code) }
 */
export class Utterance {
  constructor(bcp, cb, { continuous = false } = {}) {
    this.bcp = bcp;
    this.cb = cb;
    this.continuous = continuous;
    this.ended = false;
    this.gotFinal = false;
  }

  start() {
    if (native) {
      this.sid = ++sidSeq;
      this.off = onNative((ev) => {
        if (ev.type !== 'stt' || ev.sid !== this.sid) return;
        switch (ev.ev) {
          case 'partial': this.cb.onPartial && this.cb.onPartial(ev.text || ''); break;
          case 'final':
            this.gotFinal = true;
            this.cb.onFinal && this.cb.onFinal(ev.text || '');
            break;
          case 'level': this.cb.onLevel && this.cb.onLevel(ev.level || 0); break;
          case 'speechend': this.cb.onSpeechEnd && this.cb.onSpeechEnd(); break;
          case 'begin': this.cb.onBegin && this.cb.onBegin(); break;
          case 'error':
            if (!this.gotFinal) this.cb.onError && this.cb.onError(ev.code || 'error');
            break;
          case 'end': this.finish(); break;
          default: break;
        }
      });
      if (this.continuous && typeof native.startContinuous === 'function') native.startContinuous(this.sid, this.bcp);
      else native.startListening(this.sid, this.bcp, false);
      return;
    }
    const Ctor = webRecognitionCtor();
    if (!Ctor) {
      this.cb.onError && this.cb.onError('unavailable');
      this.finish();
      return;
    }
    const r = new Ctor();
    this.rec = r;
    r.lang = this.bcp;
    r.interimResults = true;
    r.continuous = this.continuous && !/Android/i.test(navigator.userAgent);
    r.maxAlternatives = 1;
    let finalText = '';
    const stream = this.continuous;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          // En modo continuo cada frase terminada se entrega al momento
          if (stream) { this.gotFinal = true; this.cb.onFinal && this.cb.onFinal(res[0].transcript.trim()); } else finalText += res[0].transcript;
        } else interim += res[0].transcript;
      }
      if (interim && this.cb.onPartial) this.cb.onPartial(stream ? interim.trim() : (finalText + ' ' + interim).trim());
    };
    r.onspeechend = () => { this.cb.onSpeechEnd && this.cb.onSpeechEnd(); };
    r.onspeechstart = () => { this.cb.onBegin && this.cb.onBegin(); };
    r.onerror = (e) => {
      const code = e.error === 'not-allowed' ? 'permission' : e.error === 'no-speech' ? 'nomatch' : e.error;
      if (code !== 'aborted' && this.cb.onError) this.cb.onError(code);
    };
    r.onend = () => {
      if (finalText.trim()) {
        this.gotFinal = true;
        this.cb.onFinal && this.cb.onFinal(finalText.trim());
      }
      this.finish();
    };
    try { r.start(); } catch (e) {
      log('web stt start', e && e.message);
      this.cb.onError && this.cb.onError('start');
      this.finish();
    }
  }

  stop() {
    if (this.ended) return;
    if (native) native.stopListening();
    else if (this.rec) { try { this.rec.stop(); } catch { /* */ } }
  }

  cancel() {
    if (this.ended) return;
    if (native) native.cancelListening();
    else if (this.rec) { try { this.rec.abort(); } catch { /* */ } }
    this.finish();
  }

  finish() {
    if (this.ended) return;
    this.ended = true;
    if (this.off) this.off();
    this.cb.onEnd && this.cb.onEnd();
  }
}

/**
 * Dictado completo. Modo "hold": sigue escuchando mientras se mantiene pulsado (encadena enunciados).
 * Modo "tap": un enunciado; termina al callar o al volver a pulsar.
 * Eventos: onState(state), onText(committed, partial), onLevel(level), onDone(text), onError(code)
 */
export class Dictation {
  constructor(bcp, cb) {
    this.bcp = bcp;
    this.cb = cb;
    this.state = 'idle';
    this.committed = '';
    this.partial = '';
    this.active = false;
    this.mode = 'tap';
    this.errors = 0;
    this.current = null;
  }

  setState(s) {
    this.state = s;
    this.cb.onState && this.cb.onState(s);
  }

  async start(mode = 'tap') {
    if (this.active) return;
    const ok = await ensureMicPermission();
    if (!ok) {
      this.cb.onError && this.cb.onError('permission');
      return;
    }
    this.mode = mode;
    this.active = true;
    this.committed = '';
    this.partial = '';
    this.errors = 0;
    this.setState('listening');
    this.next();
  }

  setMode(mode) { this.mode = mode; }

  next() {
    if (!this.active) return;
    const u = new Utterance(this.bcp, {
      onPartial: (p) => {
        this.partial = p;
        this.cb.onText && this.cb.onText(this.committed, p);
      },
      onFinal: (f) => {
        if (f) this.committed = (this.committed ? `${this.committed} ${f}` : f).trim();
        this.partial = '';
        this.errors = 0;
        this.cb.onText && this.cb.onText(this.committed, '');
      },
      onLevel: (l) => this.cb.onLevel && this.cb.onLevel(l),
      onSpeechEnd: () => {
        // Al callar: si el resultado final tarda, se usa lo ya reconocido para no hacer esperar
        if (this.mode !== 'tap' || this.stopping || this.current !== u) return;
        clearTimeout(this.endTimer);
        this.endTimer = setTimeout(() => {
          if (this.current === u && this.partial && !this.stopping) {
            this.stopping = true;
            u.cancel();
          }
        }, 600);
      },
      onError: (code) => {
        if (code === 'nomatch' || code === 'timeout') return;
        this.errors++;
        if (code === 'permission' || code === 'unavailable' || code === 'language' || this.errors > 2) {
          this.cb.onError && this.cb.onError(code);
          this.active = false;
        }
      },
      onEnd: () => {
        if (this.current !== u) return;
        this.current = null;
        if (this.active && this.mode === 'hold' && !this.stopping) {
          setTimeout(() => this.next(), 250);
          return;
        }
        this.complete();
      },
    });
    this.current = u;
    u.start();
  }

  /** Terminar y entregar el texto. */
  stop() {
    if (!this.active) return;
    this.stopping = true;
    if (this.current) {
      this.current.stop();
      // Si el resultado final tarda, se usa lo ya reconocido
      clearTimeout(this.stopTimer);
      this.stopTimer = setTimeout(() => {
        if (this.current) { this.current.cancel(); }
      }, 700);
    } else {
      this.complete();
    }
  }

  cancel() {
    this.active = false;
    this.stopping = false;
    const c = this.current;
    this.current = null;
    if (c) c.cancel();
    this.committed = '';
    this.partial = '';
    this.setState('idle');
  }

  complete() {
    clearTimeout(this.stopTimer);
    clearTimeout(this.endTimer);
    const text = `${this.committed} ${this.partial}`.trim();
    this.active = false;
    this.stopping = false;
    this.committed = '';
    this.partial = '';
    this.setState('idle');
    this.cb.onDone && this.cb.onDone(text);
  }
}

/**
 * Habla continua (modo discurso): escucha sin parar y entrega cada frase en cuanto termina.
 * cb: { onPartial(text), onSentence(text), onLevel(l), onError(code), onState(active) }
 */
export class SpeechStream {
  constructor(bcp, cb) {
    this.bcp = bcp;
    this.cb = cb;
    this.active = false;
    this.current = null;
    this.partial = '';
    this.errors = 0;
  }

  async start() {
    if (this.active) return true;
    const ok = await ensureMicPermission();
    if (!ok) { this.cb.onError && this.cb.onError('permission'); return false; }
    this.active = true;
    this.errors = 0;
    // Algunos móviles pitan cada vez que empiezan a escuchar: se silencian esos avisos mientras tanto
    if (native && native.setQuiet) { try { native.setQuiet(true); } catch { /* */ } }
    this.cb.onState && this.cb.onState(true);
    this.loop();
    return true;
  }

  unquiet() {
    if (native && native.setQuiet) { try { native.setQuiet(false); } catch { /* */ } }
  }

  loop() {
    if (!this.active || this.current) return;
    const u = new Utterance(this.bcp, {
      onPartial: (p) => {
        this.partial = p;
        this.errors = 0;
        this.cb.onPartial && this.cb.onPartial(p);
      },
      onFinal: (f) => {
        this.partial = '';
        this.errors = 0;
        if (f && f.trim()) this.cb.onSentence && this.cb.onSentence(f.trim());
      },
      onLevel: (l) => this.cb.onLevel && this.cb.onLevel(l),
      onError: (code) => {
        if (code === 'nomatch' || code === 'timeout') return;
        this.errors++;
        if (code === 'permission' || code === 'unavailable' || code === 'language' || this.errors > 6) {
          this.cb.onError && this.cb.onError(code);
          this.stop();
        }
      },
      onEnd: () => {
        if (this.current === u) this.current = null;
        if (!this.active) { this.flush(); return; }
        // Lo que quedó a medias se envía igualmente
        if (this.partial.trim()) this.flush();
        setTimeout(() => this.loop(), this.errors ? Math.min(3000, 300 * this.errors) : 80);
      },
    }, { continuous: true });
    this.current = u;
    u.start();
  }

  flush() {
    const p = this.partial.trim();
    this.partial = '';
    if (p) this.cb.onSentence && this.cb.onSentence(p);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.unquiet();
    this.cb.onState && this.cb.onState(false);
    const u = this.current;
    if (u) {
      u.stop();
      // Si el resultado final tarda, se envía lo ya reconocido
      setTimeout(() => { if (this.current === u) { this.current = null; u.cancel(); this.flush(); } }, 700);
    } else this.flush();
  }

  cancel() {
    if (this.active) this.unquiet();
    this.active = false;
    this.partial = '';
    const u = this.current;
    this.current = null;
    if (u) u.cancel();
    this.cb.onState && this.cb.onState(false);
  }
}
