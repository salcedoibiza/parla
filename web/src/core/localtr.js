// Traducción en el propio dispositivo: casi instantánea y sin internet.
// Hay dos motores y se elige solo:
//  - App de Android: ML Kit de Google, muy ligero (unos 30 MB por idioma y poca memoria).
//  - Web, y en la app los idiomas que ML Kit no tiene (euskera, serbio): los modelos de
//    Firefox Translations de Mozilla (ver mt.js), de más calidad pero que piden más memoria.
// Con conexión, la traducción de Google en línea sustituye después a la del dispositivo.
import { native, onNative } from './native.js';
import { log } from './log.js';
import * as mt from './mt.js';
import { LANGS } from './langs.js';

// ---------- ML Kit (solo app) ----------
const kit = { downloaded: new Set(), downloading: new Set(), supported: new Set(), ready: false };
const listeners = new Set();
const pending = new Map();
let seq = 0;

export function hasMlKit() {
  try { return !!(native && native.hasLocalTr && native.hasLocalTr()); } catch { return false; }
}

/** ¿Hay algún motor para traducir en el dispositivo? */
export function hasLocalTr() { return hasMlKit() || mt.mtSupported; }

/** Código del traductor (langs.js → tr) → código de idioma «local» (p. ej. iw → he, zh-TW → zh-Hant). */
export function mlCode(tr) {
  const map = { iw: 'he', 'zh-CN': 'zh', 'zh-TW': 'zh-Hant' };
  if (!tr) return null;
  return map[tr] || String(tr).split('-')[0];
}
// Código local → código de ML Kit (no distingue chino tradicional)
const kitCode = (c) => (c === 'zh-Hant' ? 'zh' : c);
// Código local → código del traductor (para los paquetes de Mozilla)
const trOf = new Map(LANGS.map((l) => [mlCode(l.tr), l.tr]));
trOf.set('en', 'en');
const toTr = (c) => trOf.get(c) || c;

function notify() {
  for (const l of listeners) { try { l(state()); } catch { /* */ } }
}

export function onModels(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
mt.onMt(() => notify());

onNative((ev) => {
  if (ev.type === 'trmodels') {
    kit.downloaded = new Set(ev.downloaded || []);
    kit.downloading = new Set(ev.downloading || []);
    kit.supported = new Set(ev.supported || []);
    kit.ready = true;
    notify();
  } else if (ev.type === 'trmodelerror') {
    log('model download failed', ev.lang, ev.error);
    notify();
  } else if (ev.type === 'localtr') {
    const p = pending.get(ev.id);
    if (!p) return;
    pending.delete(ev.id);
    if (ev.ok) p.resolve(ev.text); else p.reject(new Error(ev.error || 'localtr'));
  }
});

const kitOk = (c) => hasMlKit() && kit.ready && kit.supported.has(kitCode(c));
const kitHas = (c) => kitOk(c) && kit.downloaded.has(kitCode(c));

/** Motor para un idioma: 'kit' (ML Kit), 'mt' (Mozilla) o null. */
function engineOf(c) {
  if (kitOk(c)) return 'kit';
  if (mt.mtSupported && mt.hasPack(toTr(c))) return 'mt';
  return null;
}

/** Motor para traducir entre varios idiomas: ML Kit si los tiene todos; si no, Mozilla. */
function engineFor(codes) {
  const cs = codes.filter(Boolean);
  if (cs.length && cs.every((c) => kitOk(c))) return 'kit';
  if (mt.mtSupported && cs.every((c) => mt.hasPack(toTr(c)))) return 'mt';
  return null;
}

export function refreshModels() {
  if (hasMlKit()) { try { native.localModels(''); } catch { /* */ } }
  if (mt.mtSupported) mt.refreshMt();
}

// ---------- estado para la pantalla de idiomas ----------
/** Idiomas que se pueden descargar (códigos locales) con su motor. */
function supportedCodes() {
  const out = new Set();
  for (const l of LANGS) {
    const c = mlCode(l.tr);
    // El inglés solo hay que descargarlo para ML Kit
    if (c !== 'en' && engineOf(c)) out.add(c);
  }
  if (hasMlKit()) out.add('en');
  return out;
}

function ready(c) {
  if (c === 'en') return hasMlKit() ? kitHas('en') : mt.mtSupported;
  const e = engineOf(c);
  if (e === 'kit') return kitHas(c) || mt.packState(toTr(c)) === 'ready';
  if (e === 'mt') return mt.packState(toTr(c)) === 'ready';
  return false;
}

function busy(c) {
  if (kit.downloading.has(kitCode(c))) return true;
  return c !== 'en' && mt.packState(toTr(c)) === 'downloading';
}

function state() {
  const st = mt.mtState();
  const supported = supportedCodes();
  const downloaded = new Set([...supported].filter(ready));
  const downloading = new Set([...supported].filter((c) => !downloaded.has(c) && busy(c)));
  return {
    ready: (hasMlKit() ? kit.ready : true) && (!mt.mtSupported || st.ready),
    supported,
    downloaded,
    downloading,
  };
}

export function modelsState() { return state(); }

/** Progreso (0-1) de la descarga de un idioma con el motor de Mozilla, o null. */
export function modelProgress(c) {
  return engineOf(c) === 'mt' ? mt.packProgress(toTr(c)) : null;
}

/** Megas aproximados que ocupa descargar un idioma. */
export function modelMB(c) {
  if (c === 'en') return 30;
  return engineOf(c) === 'mt' ? mt.packMB(toTr(c)) : 30;
}

/** ¿Se puede traducir de sl a tl (códigos del traductor) en el dispositivo ahora mismo? */
export function canLocal(sl, tl) {
  if (!sl || !tl || sl === 'auto') return false;
  const a = mlCode(sl);
  const b = mlCode(tl);
  if (a === b) return true;
  const e = engineFor([a, b]);
  if (e === 'kit' && kitHas(a) && kitHas(b) && kitHas('en')) return true;
  return mt.canMt(toTr(a), toTr(b));
}

const cache = new Map();

function kitTranslate(text, a, b, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = `l${++seq}`;
    pending.set(id, { resolve, reject });
    try {
      native.localTranslate(id, text, kitCode(a), kitCode(b));
    } catch (e) {
      pending.delete(id);
      reject(e);
      return;
    }
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); } }, timeoutMs);
  });
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

export function translateLocal(text, sl, tl, timeoutMs = 3000) {
  const src = String(text || '').trim();
  if (!src) return Promise.resolve('');
  const a = mlCode(sl);
  const b = mlCode(tl);
  if (a === b) return Promise.resolve(src);
  const key = `${a}|${b}|${src}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  const useKit = engineFor([a, b]) === 'kit' && kitHas(a) && kitHas(b) && kitHas('en');
  // El motor de Mozilla tarda un poco más la primera vez (carga los modelos)
  const p = useKit ? kitTranslate(src, a, b, timeoutMs) : withTimeout(mt.translateMt(src, toTr(a), toTr(b)), Math.max(timeoutMs, 8000));
  return p.then((t) => {
    cache.set(key, t);
    if (cache.size > 800) cache.delete(cache.keys().next().value);
    return t;
  });
}

/** Varias frases a la vez (el motor de Mozilla las traduce juntas, más rápido). */
export async function translateLocalMany(texts, sl, tl) {
  const a = mlCode(sl);
  const b = mlCode(tl);
  const useKit = engineFor([a, b]) === 'kit' && kitHas(a) && kitHas(b) && kitHas('en');
  if (!useKit && mt.canMt(toTr(a), toTr(b))) return mt.translateMtMany(texts, toTr(a), toTr(b));
  return Promise.all(texts.map((t) => translateLocal(t, sl, tl, 4000).catch(() => null)));
}

/** Prepara el motor para que la primera traducción entre estos idiomas salga rápido. */
export function warmLocal(sl, tl) {
  const a = mlCode(sl);
  const b = mlCode(tl);
  if (!a || !b || a === b) return;
  if (engineFor([a, b]) === 'kit' && kitHas(a) && kitHas(b)) return;
  mt.warmMt(toTr(a), toTr(b));
}

/** Descarga un idioma (código local). */
export function downloadModel(c, wifiOnly = false) {
  const e = c === 'en' ? (hasMlKit() ? 'kit' : null) : engineOf(c);
  if (e === 'kit') {
    try { native.localDownload(kitCode(c), !!wifiOnly); } catch { /* */ }
  } else if (e === 'mt') {
    mt.downloadPack(toTr(c)).catch((err) => log('mt download', c, err && err.message));
  }
}

/** Descarga con el motor de Mozilla aunque ML Kit tenga el idioma (para hablar con idiomas que ML Kit no tiene). */
function downloadMt(c) {
  mt.downloadPack(toTr(c)).catch((err) => log('mt download', c, err && err.message));
}

export function deleteModel(c) {
  if (hasMlKit() && c !== 'zh-Hant') { try { native.localDelete(kitCode(c)); } catch { /* */ } }
  if (c !== 'en' && mt.hasPack(toTr(c))) mt.deletePack(toTr(c)).catch(() => {});
}

/**
 * Lo que falta descargar para traducir al momento entre estos idiomas (códigos del traductor).
 * Devuelve una lista de códigos locales.
 */
export function missingFor(trs) {
  const codes = [...new Set(trs.map(mlCode))];
  const e = engineFor(codes);
  if (e === 'kit') {
    const want = new Set(['en', ...codes]);
    return [...want].filter((c) => !kitHas(c));
  }
  if (e === 'mt') return codes.filter((c) => c !== 'en' && mt.packState(toTr(c)) !== 'ready');
  return [];
}

/** Descarga lo que falta para estos idiomas (con el motor que toque). */
export function downloadFor(trs) {
  const codes = [...new Set(trs.map(mlCode))];
  const e = engineFor(codes);
  for (const c of missingFor(trs)) {
    if (e === 'mt') downloadMt(c); else downloadModel(c, false);
  }
}

/** Megas de lo que falta para estos idiomas. */
export function missingMB(trs) {
  const codes = [...new Set(trs.map(mlCode))];
  const e = engineFor(codes);
  return missingFor(trs).reduce((a, c) => a + (e === 'mt' ? mt.packMB(toTr(c)) : 30), 0);
}

/** Al abrir la app: descarga tu idioma y el inglés con ML Kit, solo con wifi. En la web no se descarga nada solo. */
export function ensureOwnModels(myTr) {
  if (!hasMlKit()) return;
  const off = onModels((s) => {
    if (!kit.ready) return;
    off();
    if (!kitOk(mlCode(myTr))) return;
    for (const c of ['en', mlCode(myTr)]) if (!kitHas(c) && !kit.downloading.has(kitCode(c))) downloadModel(c, true);
  });
  refreshModels();
}
