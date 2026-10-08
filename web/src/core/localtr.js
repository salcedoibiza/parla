// Traducción en el propio móvil (ML Kit de Google, solo en la app de Android).
// Es casi instantánea y funciona sin internet, aunque algo menos precisa que la de Google en línea.
// Se usa para enseñar la traducción al momento; después la de Google la sustituye.
import { native, onNative } from './native.js';
import { log } from './log.js';

const st = { downloaded: new Set(), downloading: new Set(), supported: new Set(), ready: false };
const listeners = new Set();
const pending = new Map();
let seq = 0;

export function hasLocalTr() {
  try { return !!(native && native.hasLocalTr && native.hasLocalTr()); } catch { return false; }
}

/** Código del traductor de Google → código de ML Kit. */
export function mlCode(tr) {
  const map = { iw: 'he', 'zh-CN': 'zh', 'zh-TW': 'zh' };
  if (!tr) return null;
  return map[tr] || String(tr).split('-')[0];
}

function notify() {
  for (const l of listeners) { try { l(st); } catch { /* */ } }
}

export function onModels(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

onNative((ev) => {
  if (ev.type === 'trmodels') {
    st.downloaded = new Set(ev.downloaded || []);
    st.downloading = new Set(ev.downloading || []);
    st.supported = new Set(ev.supported || []);
    st.ready = true;
    notify();
  } else if (ev.type === 'trmodelerror') {
    log('model download failed', ev.lang, ev.error);
    st.error = ev.lang;
    notify();
  } else if (ev.type === 'localtr') {
    const p = pending.get(ev.id);
    if (!p) return;
    pending.delete(ev.id);
    if (ev.ok) p.resolve(ev.text); else p.reject(new Error(ev.error || 'localtr'));
  }
});

export function refreshModels() {
  if (hasLocalTr()) { try { native.localModels(''); } catch { /* */ } }
}

export function modelsState() { return st; }

/** 'unsupported' | 'downloaded' | 'downloading' | 'missing' */
export function modelState(tr) {
  const c = mlCode(tr);
  if (!hasLocalTr() || !st.ready) return 'unsupported';
  if (!st.supported.has(c)) return 'unsupported';
  if (st.downloaded.has(c)) return 'downloaded';
  if (st.downloading.has(c)) return 'downloading';
  return 'missing';
}

/** ¿Se puede traducir de sl a tl en el móvil ahora mismo? */
export function canLocal(sl, tl) {
  if (!hasLocalTr() || !st.ready || !sl || !tl || sl === 'auto') return false;
  const a = mlCode(sl);
  const b = mlCode(tl);
  return st.downloaded.has(a) && st.downloaded.has(b) && st.downloaded.has('en');
}

const cache = new Map();

export function translateLocal(text, sl, tl, timeoutMs = 3000) {
  const src = String(text || '').trim();
  if (!src) return Promise.resolve('');
  if (mlCode(sl) === mlCode(tl)) return Promise.resolve(src);
  const key = `${sl}|${tl}|${src}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  return new Promise((resolve, reject) => {
    const id = `l${++seq}`;
    pending.set(id, {
      resolve: (t) => {
        cache.set(key, t);
        if (cache.size > 800) cache.delete(cache.keys().next().value);
        resolve(t);
      },
      reject,
    });
    try {
      native.localTranslate(id, src, mlCode(sl), mlCode(tl));
    } catch (e) {
      pending.delete(id);
      reject(e);
      return;
    }
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); } }, timeoutMs);
  });
}

export function downloadModel(tr, wifiOnly = false) {
  if (!hasLocalTr()) return;
  try { native.localDownload(mlCode(tr), !!wifiOnly); } catch { /* */ }
}

export function deleteModel(tr) {
  if (!hasLocalTr()) return;
  try { native.localDelete(mlCode(tr)); } catch { /* */ }
}

/** Idiomas que faltan para traducir al momento entre estos idiomas (incluye el inglés, que hace de puente). */
export function missingFor(trs) {
  if (!hasLocalTr() || !st.ready) return [];
  const want = new Set(['en', ...trs.map(mlCode)]);
  return [...want].filter((c) => st.supported.has(c) && !st.downloaded.has(c));
}

/** Al abrir la app: descarga tu idioma y el inglés, solo con wifi. */
export function ensureOwnModels(myTr) {
  if (!hasLocalTr()) return;
  const off = onModels(() => {
    off();
    for (const c of missingFor([myTr])) if (!st.downloading.has(c)) downloadModel(c, true);
  });
  refreshModels();
}
