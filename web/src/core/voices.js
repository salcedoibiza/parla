// Distinguir voces en el modo escucha por el tono (más grave, más agudo…).
// Es aproximado: separa bien voces distintas (por ejemplo un hombre y una mujer),
// pero dos voces parecidas pueden salir como una sola.
import { native, onNative } from './native.js';
import { log } from './log.js';

const SR = 16000;
const TAU_MIN = Math.floor(SR / 400);
const TAU_MAX = Math.floor(SR / 70);

/** Algoritmo YIN sobre una ventana de muestras a 16 kHz. Devuelve Hz o 0. */
export function yin(x) {
  const n = x.length - TAU_MAX;
  if (n <= 0) return 0;
  const d = new Float32Array(TAU_MAX + 2);
  for (let tau = 1; tau <= TAU_MAX; tau++) {
    let s = 0;
    for (let j = 0; j < n; j++) {
      const delta = x[j] - x[j + tau];
      s += delta * delta;
    }
    d[tau] = s;
  }
  let run = 0;
  for (let tau = 1; tau <= TAU_MAX; tau++) {
    run += d[tau];
    d[tau] = run === 0 ? 1 : (d[tau] * tau) / run;
  }
  let best = -1;
  for (let tau = TAU_MIN; tau <= TAU_MAX; tau++) {
    if (d[tau] < 0.15) {
      while (tau + 1 <= TAU_MAX && d[tau + 1] < d[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) return 0;
  let t = best;
  if (best > 1 && best < TAU_MAX) {
    const a = d[best - 1];
    const b = d[best];
    const c = d[best + 1];
    const den = a + c - 2 * b;
    if (den !== 0) t = best + (a - c) / (2 * den);
  }
  return SR / t;
}

/** Historial de tono y volumen de los últimos segundos (no guarda audio). */
class Ring {
  constructor(size = 2600) {
    this.t = new Float64Array(size);
    this.f = new Float32Array(size);
    this.r = new Float32Array(size);
    this.z = new Uint8Array(size);
    this.size = size;
    this.head = 0;
    this.count = 0;
  }

  push(t, f0, rms, zero) {
    this.t[this.head] = t;
    this.f[this.head] = f0;
    this.r[this.head] = rms;
    this.z[this.head] = zero ? 1 : 0;
    this.head = (this.head + 1) % this.size;
    if (this.count < this.size) this.count++;
  }

  stats(t0, t1) {
    const f = [];
    let frames = 0;
    let zeros = 0;
    let rms = 0;
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - 1 - i + this.size) % this.size;
      const t = this.t[idx];
      if (t < t0) break;
      if (t > t1) continue;
      frames++;
      rms += this.r[idx];
      zeros += this.z[idx];
      if (this.f[idx] > 0) f.push(this.f[idx]);
    }
    f.sort((a, b) => a - b);
    return {
      frames,
      n: f.length,
      median: f.length ? f[f.length >> 1] : 0,
      rms: frames ? rms / frames : 0,
      zeroFrac: frames ? zeros / frames : 0,
    };
  }
}

/** En la app: el tono lo mide Android. */
class NativeTracker {
  async start() {
    try { return !!native.voiceStart(); } catch { return false; }
  }

  stop() { try { native.voiceStop(); } catch { /* */ } }

  stats(t0, t1) {
    try { return JSON.parse(native.voiceStats(t0, t1) || '{}'); } catch { return {}; }
  }
}

/** En la web: el tono se mide en la página con el micrófono. */
class WebTracker {
  constructor() { this.ring = new Ring(); }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.an = this.ctx.createAnalyser();
      this.an.fftSize = 2048;
      src.connect(this.an);
      const buf = new Float32Array(this.an.fftSize);
      const step = this.ctx.sampleRate / SR;
      const len = Math.floor(buf.length / step);
      const win = new Float32Array(len);
      this.timer = setInterval(() => {
        this.an.getFloatTimeDomainData(buf);
        let sum = 0;
        let zero = true;
        for (let i = 0; i < len; i++) {
          const v = buf[Math.min(buf.length - 1, Math.round(i * step))];
          win[i] = v;
          sum += v * v;
          if (v !== 0) zero = false;
        }
        const rms = Math.sqrt(sum / len);
        this.ring.push(Date.now(), rms > 0.006 ? yin(win) : 0, rms, zero);
      }, 32);
      return true;
    } catch (e) {
      log('voice tracker web', e && e.message);
      this.stop();
      return false;
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.stream) for (const t of this.stream.getTracks()) { try { t.stop(); } catch { /* */ } }
    this.stream = null;
    if (this.ctx) { try { this.ctx.close(); } catch { /* */ } }
    this.ctx = null;
  }

  stats(t0, t1) { return this.ring.stats(t0, t1); }
}

export function createVoiceTracker() {
  if (native && typeof native.voiceStart === 'function') return new NativeTracker();
  if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) return new WebTracker();
  return null;
}

/** Agrupa frases por voz según su tono medio (en semitonos). */
export class VoiceClusterer {
  constructor({ max = 4, threshold = 2.6 } = {}) {
    this.max = max;
    this.threshold = threshold;
    this.voices = [];
  }

  static semitones(hz) { return 12 * Math.log2(hz / 110); }

  assign(hz) {
    if (!hz || hz < 60 || hz > 450) return null;
    const st = VoiceClusterer.semitones(hz);
    let best = -1;
    let bestD = Infinity;
    this.voices.forEach((v, i) => {
      const d = Math.abs(v.mean - st);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0 && (bestD <= this.threshold || this.voices.length >= this.max)) {
      const v = this.voices[best];
      const w = Math.min(v.n, 12);
      v.mean = (v.mean * w + st) / (w + 1);
      v.n++;
      return best;
    }
    this.voices.push({ mean: st, n: 1 });
    return this.voices.length - 1;
  }

  reset() { this.voices = []; }
}

// La app avisa cuando pasa a segundo plano: Android deja de medir el tono
let resumeHandlers = new Set();
onNative((ev) => {
  if (ev.type === 'lifecycle' && ev.state === 'resume') for (const h of resumeHandlers) { try { h(); } catch { /* */ } }
});
export function onAppResume(fn) {
  resumeHandlers.add(fn);
  return () => resumeHandlers.delete(fn);
}
