// Prueba del detector de tono (YIN) y del agrupador de voces con voces sintéticas.
import { yin, VoiceClusterer } from '../web/src/core/voices.js';

function voice(f0, ms, { noise = 0.02, vibrato = 0.02 } = {}) {
  const sr = 16000;
  const n = Math.round((sr * ms) / 1000);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = f0 * (1 + vibrato * Math.sin((2 * Math.PI * 5 * i) / sr));
    phase += (2 * Math.PI * f) / sr;
    let s = 0;
    for (let h = 1; h <= 12; h++) s += Math.sin(h * phase) / (h * 1.2);
    out[i] = 0.12 * s + noise * (Math.random() * 2 - 1);
  }
  return out;
}

function medianPitch(sig) {
  const f = [];
  for (let i = 0; i + 1024 <= sig.length; i += 512) {
    const p = yin(sig.subarray(i, i + 1024));
    if (p > 0) f.push(p);
  }
  f.sort((a, b) => a - b);
  return f.length ? f[f.length >> 1] : 0;
}

let fails = 0;
for (const hz of [85, 110, 140, 190, 230, 300]) {
  const est = medianPitch(voice(hz, 600));
  const err = Math.abs(est - hz) / hz;
  console.log(`tono ${hz} Hz → medido ${est.toFixed(1)} Hz (${(err * 100).toFixed(1)}%)`);
  if (err > 0.04) fails++;
}

// Conversación: hombre (115), mujer (215), hombre (118), otro hombre más grave (90), mujer (205)
const cl = new VoiceClusterer();
const turns = [115, 215, 118, 214, 90, 205, 116, 92];
const got = turns.map((hz) => cl.assign(medianPitch(voice(hz, 900, { noise: 0.04 }))));
console.log('voces asignadas', turns.map((hz, i) => `${hz}Hz→Voz ${got[i] + 1}`).join(', '));
const same = (a, b) => got[a] === got[b];
if (!same(0, 2) || !same(1, 3) || !same(1, 5) || same(0, 1) || same(0, 4) || !same(4, 7) || !same(0, 6)) fails++;
console.log(fails ? `${fails} FALLOS` : 'TODO OK');
process.exit(fails ? 1 : 0);
