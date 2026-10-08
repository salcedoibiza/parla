// Textos de la interfaz. La clave es el texto en español.
// Inglés está escrito a mano; el resto de idiomas se traduce automáticamente la primera vez y se guarda.
import { EN } from './i18n-en.js';
import { store, emit } from './store.js';
import { lang as langInfo, guessLang } from './langs.js';
import { translateLines } from './translate.js';
import { log } from './log.js';

const KEYS = Object.keys(EN);
const VERSION = `${KEYS.length}-${hash(KEYS.join('|'))}`;
let current = { tr: 'es', dict: null };
const loading = new Set();

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function uiLangId() {
  return (store.profile && store.profile.lang) || guessLang();
}

function fill(s, vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

export function t(key, vars) {
  const tr = langInfo(uiLangId()).tr;
  if (tr !== current.tr) switchTo(tr);
  let s = key;
  if (tr === 'es') s = key;
  else if (tr === 'en') s = EN[key] || key;
  else if (current.dict && current.dict[key]) s = current.dict[key];
  else s = EN[key] || key;
  return fill(s, vars);
}

function switchTo(tr) {
  current = { tr, dict: null };
  if (tr === 'es' || tr === 'en') return;
  try {
    const cached = JSON.parse(localStorage.getItem(`parla.i18n.${tr}`) || 'null');
    if (cached && cached.v === VERSION) {
      current.dict = cached.d;
      return;
    }
    if (cached && cached.d) current.dict = cached.d; // versión anterior mientras se actualiza
  } catch { /* */ }
  loadMachine(tr);
}

// Protege {variables} para que el traductor no las toque
function protect(s) {
  const names = [];
  const out = s.replace(/\{(\w+)\}/g, (m, k) => {
    names.push(k);
    return `XQ${names.length}`;
  });
  return { out, names };
}

function restore(s, names) {
  let r = s;
  names.forEach((n, i) => {
    r = r.replace(new RegExp(`X\\s*Q\\s*${i + 1}`, 'i'), `{${n}}`);
  });
  return r;
}

async function loadMachine(tr) {
  if (loading.has(tr)) return;
  loading.add(tr);
  try {
    const src = KEYS.map((k) => protect(EN[k] || k));
    const lines = src.map((p) => p.out.replace(/\n/g, ' '));
    const outs = await translateLines(lines, 'en', tr);
    const dict = {};
    KEYS.forEach((k, i) => {
      if (outs[i]) dict[k] = restore(outs[i], src[i].names);
    });
    try { localStorage.setItem(`parla.i18n.${tr}`, JSON.stringify({ v: VERSION, d: dict })); } catch { /* */ }
    if (current.tr === tr) {
      current.dict = dict;
      store.i18nTick++;
      emit();
    }
  } catch (e) {
    log('i18n load failed', tr, e && e.message);
  } finally {
    loading.delete(tr);
  }
}

export function formatTime(ts) {
  try {
    return new Intl.DateTimeFormat(langInfo(uiLangId()).bcp, { hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
  } catch { return new Date(ts).toLocaleTimeString(); }
}

export function formatDate(ts) {
  try {
    return new Intl.DateTimeFormat(langInfo(uiLangId()).bcp, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ts));
  } catch { return new Date(ts).toLocaleDateString(); }
}

export function formatDateTime(ts) {
  return `${formatDate(ts)} · ${formatTime(ts)}`;
}
