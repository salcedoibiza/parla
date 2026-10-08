// Lectura en voz alta de los mensajes traducidos, en cola, en el idioma de cada uno.
import { native, onNative } from './native.js';
import { log } from './log.js';

const queue = [];
let speaking = null;
let seq = 0;
const listeners = new Set();
let missingWarned = new Set();

export function onTts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(ev) {
  for (const l of listeners) {
    try { l(ev); } catch { /* */ }
  }
}

export function isSpeaking() { return !!speaking; }

onNative((ev) => {
  if (ev.type !== 'tts') return;
  if (!speaking || ev.id !== speaking.id) return;
  if (ev.ev === 'start') notify({ type: 'start', item: speaking });
  if (ev.ev === 'done' || ev.ev === 'error') finishCurrent(ev.ev === 'error' ? ev.code : null);
  if (ev.ev === 'nolang') {
    if (!missingWarned.has(speaking.bcp)) {
      missingWarned.add(speaking.bcp);
      notify({ type: 'nolang', bcp: speaking.bcp });
    }
    finishCurrent('nolang');
  }
});

function finishCurrent(err) {
  const it = speaking;
  speaking = null;
  clearTimeout(finishCurrent.timer);
  if (it) notify({ type: 'end', item: it, error: err });
  setTimeout(pump, 120);
}

function webVoiceFor(bcp) {
  try {
    const voices = window.speechSynthesis.getVoices();
    const lc = bcp.toLowerCase();
    return voices.find((v) => v.lang && v.lang.toLowerCase() === lc)
      || voices.find((v) => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith(lc.split('-')[0]))
      || null;
  } catch { return null; }
}

function pump() {
  if (speaking || !queue.length) return;
  const it = queue.shift();
  speaking = it;
  // Seguridad: si nunca llega el "terminado", seguir tras un tiempo razonable
  finishCurrent.timer = setTimeout(() => { if (speaking === it) finishCurrent('timeout'); }, 8000 + it.text.length * 150);
  if (native) {
    try {
      native.speak(it.id, it.text, it.bcp, it.rate);
    } catch (e) {
      log('tts native', e && e.message);
      finishCurrent('exception');
    }
    return;
  }
  if (!('speechSynthesis' in window)) { finishCurrent('unsupported'); return; }
  const u = new SpeechSynthesisUtterance(it.text);
  u.lang = it.bcp;
  u.rate = it.rate;
  const v = webVoiceFor(it.bcp);
  if (v) u.voice = v;
  u.onstart = () => notify({ type: 'start', item: it });
  u.onend = () => { if (speaking === it) finishCurrent(null); };
  u.onerror = () => { if (speaking === it) finishCurrent('error'); };
  try {
    window.speechSynthesis.speak(u);
  } catch {
    finishCurrent('error');
  }
}

export function speak(text, bcp, { rate = 1, tag = null } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return;
  queue.push({ id: `s${++seq}`, text: clean, bcp, rate, tag });
  pump();
}

export function stopSpeaking() {
  queue.length = 0;
  if (native) { try { native.stopSpeaking(); } catch { /* */ } } else if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch { /* */ }
  }
  if (speaking) finishCurrent('stopped');
}

// Algunos navegadores cargan las voces más tarde
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  try { window.speechSynthesis.getVoices(); } catch { /* */ }
}
