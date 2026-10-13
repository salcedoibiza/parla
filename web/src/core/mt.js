// Traducción dentro del dispositivo con los modelos de Firefox Translations (Mozilla).
// - Cada idioma es un «paquete» con dos modelos: idioma→inglés e inglés→idioma.
//   Entre dos idiomas que no son el inglés se traduce pasando por el inglés.
// - Los modelos se descargan de una copia pública en Hugging Face y se guardan en el dispositivo;
//   después funcionan sin internet.
// - La traducción la hace Bergamot (WebAssembly) en un hilo aparte: ver public/mt-worker.js.
// - Ocupa bastante memoria (unos 250 MB por modelo), por eso solo se tienen 2 cargados a la vez
//   y el motor se cierra cuando lleva un rato sin usarse.
import { MT_HF, MT_PACKS, MT_PAIRS } from './mtindex-data.js';
import { log } from './log.js';

const W = typeof window !== 'undefined' ? window : {};
// Las pruebas pueden servir los modelos desde otro sitio: { base: 'http://…/', gz: false }
const override = W.__PARLA_MT__ || null;
const CACHE = 'parla-mt-1';
const KEY = 'https://mt.parla.app/';
const devMem = typeof navigator !== 'undefined' && navigator.deviceMemory ? navigator.deviceMemory : 0;
// Modelos cargados a la vez (una traducción entre dos idiomas que no son el inglés usa 2)
const MAX_LOADED = devMem && devMem <= 4 ? 2 : 3;
// Tras este rato sin traducir se cierra el motor para devolver la memoria
const IDLE_MS = 90000;

export const mtSupported = typeof WebAssembly === 'object' && typeof Worker !== 'undefined'
  && typeof caches !== 'undefined' && (typeof isSecureContext === 'undefined' || isSecureContext)
  // En móviles con poca memoria no merece la pena
  && !(devMem && devMem < 3);

// ---------- estado ----------
const st = { ready: false, have: new Set(), busy: new Map(), failed: new Set() };
const listeners = new Set();
function notify() { for (const l of listeners) { try { l(st); } catch { /* */ } } }
export function onMt(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function mtState() { return st; }

/** Pares de modelos de un idioma (código del traductor), o null si Mozilla no tiene ese idioma. */
export function packPairs(tr) {
  const p = MT_PACKS[tr] || MT_PACKS[String(tr || '').split('-')[0]];
  if (!p) return null;
  // Solo se pueden descargar los que están en la copia de Hugging Face
  if (!override && !p.every((k) => MT_PAIRS[k].hf)) return null;
  return p;
}

export function hasPack(tr) { return tr === 'en' || !!packPairs(tr); }

/** Megas que hay que descargar para un idioma. */
export function packMB(tr) {
  const p = packPairs(tr);
  if (!p) return 0;
  let b = 0;
  for (const k of p) for (const f of MT_PAIRS[k].files) b += f.size;
  return Math.max(1, Math.round(b / 1048576));
}

/** 'ready' | 'downloading' | 'missing' | 'none' */
export function packState(tr) {
  if (tr === 'en') return mtSupported ? 'ready' : 'none';
  const p = mtSupported && packPairs(tr);
  if (!p) return 'none';
  if (p.every((k) => st.have.has(k))) return 'ready';
  if (p.some((k) => st.busy.has(k))) return 'downloading';
  return 'missing';
}

/** Progreso de la descarga de un idioma (0-1) o null. */
export function packProgress(tr) {
  const p = packPairs(tr);
  if (!p) return null;
  let done = 0;
  let total = 0;
  let any = false;
  for (const k of p) {
    const size = MT_PAIRS[k].files.reduce((a, f) => a + (f.size || 1), 0);
    total += size;
    if (st.have.has(k)) done += size;
    else if (st.busy.has(k)) { any = true; done += Math.min(size, st.busy.get(k).loaded || 0); }
  }
  return any ? Math.min(1, done / total) : null;
}

/** Modelos necesarios para traducir de sl a tl (códigos del traductor), o null. */
export function routeFor(sl, tl) {
  if (!sl || !tl || sl === 'auto' || sl === tl) return null;
  if (sl === 'en') { const p = packPairs(tl); return p ? [p[1]] : null; }
  if (tl === 'en') { const p = packPairs(sl); return p ? [p[0]] : null; }
  const a = packPairs(sl);
  const b = packPairs(tl);
  return a && b ? [a[0], b[1]] : null;
}

export function canMt(sl, tl) {
  if (!mtSupported || !st.ready) return false;
  const r = routeFor(sl, tl);
  return !!r && r.every((k) => st.have.has(k));
}

// ---------- almacenamiento ----------
async function openCache() { return caches.open(CACHE); }

export async function refreshMt() {
  if (!mtSupported) { st.ready = true; notify(); return; }
  try {
    const c = await openCache();
    const keys = await c.keys();
    st.have = new Set(keys.map((r) => r.url).filter((u) => u.endsWith('/.ok')).map((u) => u.slice(KEY.length, -4)).filter((k) => MT_PAIRS[k]));
  } catch (e) {
    log('mt refresh', e && e.message);
  }
  st.ready = true;
  notify();
}


function sourcesFor(k) {
  const p = MT_PAIRS[k];
  const out = [];
  if (override) out.push((f) => [`${override.base}${k}/${f.name}${override.gz ? '.gz' : ''}`, !!override.gz]);
  if (p.hf) out.push((f) => [`${MT_HF}${p.hf}/${f.name}`, false]);
  return out;
}

async function readAll(res, onBytes) {
  if (!res.body || !res.body.getReader) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.byteLength;
    onBytes(n);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

async function gunzip(bytes) {
  const ds = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));
  return new Uint8Array(await ds.arrayBuffer());
}

async function sha256(bytes) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function downloadPairWeb(k) {
  const p = MT_PAIRS[k];
  const c = await openCache();
  let lastErr = null;
  for (const src of sourcesFor(k)) {
    try {
      let base = 0;
      for (const f of p.files) {
        const [url, gz] = src(f);
        const res = await fetch(url, { credentials: 'omit' });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${f.name}`);
        let bytes = await readAll(res, (n) => { st.busy.set(k, { loaded: base + n * (gz ? 1.4 : 1) }); notify(); });
        if (gz) bytes = await gunzip(bytes);
        if (f.size && bytes.byteLength !== f.size) throw new Error(`size ${f.name}`);
        if (f.sha && typeof crypto !== 'undefined' && crypto.subtle && (await sha256(bytes)) !== f.sha) throw new Error(`hash ${f.name}`);
        await c.put(`${KEY}${k}/${f.name}`, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }));
        base += f.size || bytes.byteLength;
      }
      await c.put(`${KEY}${k}/.ok`, new Response('ok'));
      return;
    } catch (e) {
      lastErr = e;
      log('mt source failed', k, e && e.message);
    }
  }
  throw lastErr || new Error('no source');
}

const pairJobs = new Map();
function downloadPair(k) {
  if (st.have.has(k)) return Promise.resolve();
  if (pairJobs.has(k)) return pairJobs.get(k);
  st.busy.set(k, { loaded: 0 });
  st.failed.delete(k);
  notify();
  const job = downloadPairWeb(k)
    .then(() => { st.have.add(k); })
    .catch((e) => { st.failed.add(k); throw e; })
    .finally(() => { st.busy.delete(k); pairJobs.delete(k); notify(); });
  pairJobs.set(k, job);
  return job;
}

/** Descarga un idioma. Devuelve una promesa que se cumple cuando está listo. */
export async function downloadPack(tr) {
  const p = packPairs(tr);
  if (!p || !mtSupported) throw new Error('unsupported');
  if (!st.ready) await refreshMt();
  // Uno detrás de otro: así el primero ya sirve antes y no se satura la conexión
  for (const k of p) await downloadPair(k);
}

/** Borra un idioma del dispositivo. */
export async function deletePack(tr) {
  const p = packPairs(tr);
  if (!p) return;
  for (const k of p) {
    await unload(k);
    try {
      const c = await openCache();
      for (const f of MT_PAIRS[k].files) await c.delete(`${KEY}${k}/${f.name}`);
      await c.delete(`${KEY}${k}/.ok`);
    } catch { /* */ }
    st.have.delete(k);
  }
  notify();
}

async function readPairFile(k, name) {
  const c = await openCache();
  const res = await c.match(`${KEY}${k}/${name}`);
  if (!res) throw new Error(`missing ${name}`);
  return res.arrayBuffer();
}

// ---------- motor de traducción (en un hilo aparte) ----------
let worker = null;
let booted = null;
let seq = 0;
const calls = new Map();
const loaded = new Map(); // par → último uso
let chain = Promise.resolve();

function call(name, args, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    calls.set(id, { resolve, reject });
    worker.postMessage({ id, name, args }, transfer);
  });
}

function boot() {
  if (booted) return booted;
  booted = (async () => {
    const t0 = Date.now();
    const get = async (u, kind) => {
      const res = await fetch(new URL(u, location.href).href);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${u}`);
      return kind === 'bin' ? res.arrayBuffer() : res.text();
    };
    const [src, glue, wasm] = await Promise.all([
      get('mt-worker.js'), get('vendor/bergamot/bergamot-translator-worker.js'), get('vendor/bergamot/bergamot-translator-worker.wasm', 'bin'),
    ]);
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = (ev) => {
      const c = calls.get(ev.data.id);
      if (!c) return;
      calls.delete(ev.data.id);
      if (ev.data.error) c.reject(new Error(ev.data.error)); else c.resolve(ev.data.result);
    };
    worker.onerror = (ev) => {
      const err = new Error((ev && ev.message) || 'worker');
      for (const c of calls.values()) c.reject(err);
      calls.clear();
      log('mt worker error', err.message);
      // Se vuelve a crear en la próxima traducción
      shutdown();
    };
    await call('init', { glue, wasm, workspace: 64 }, [wasm]);
    log('mt ready', Date.now() - t0, 'ms');
  })();
  booted.catch(() => { booted = null; });
  return booted;
}

let idleTimer = null;
function shutdown() {
  if (!worker) return;
  try { worker.terminate(); } catch { /* */ }
  worker = null;
  booted = null;
  loaded.clear();
  for (const c of calls.values()) c.reject(new Error('closed'));
  calls.clear();
  log('mt closed');
}

/** Se ejecuta en orden, una cosa detrás de otra (el motor solo hace una cosa a la vez). */
function serial(fn) {
  clearTimeout(idleTimer);
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  chain.then(() => {
    clearTimeout(idleTimer);
    if (worker) idleTimer = setTimeout(() => { chain = chain.then(shutdown, shutdown); }, IDLE_MS);
  });
  return p;
}

async function ensureLoaded(k, keep) {
  if (loaded.has(k)) { loaded.set(k, Date.now()); return; }
  // Para no llenar la memoria del móvil, se descarga de memoria el que hace más tiempo que no se usa
  while (loaded.size >= MAX_LOADED) {
    const old = [...loaded.entries()].filter(([x]) => !keep.includes(x)).sort((a, b) => a[1] - b[1])[0];
    if (!old) break;
    await call('free', { key: old[0] });
    loaded.delete(old[0]);
  }
  const p = MT_PAIRS[k];
  const byKind = {};
  for (const f of p.files) byKind[f.k] = f;
  const vocabFiles = byKind.vocab ? [byKind.vocab] : [byKind.srcvocab, byKind.trgvocab];
  const t0 = Date.now();
  const [model, lex, ...vocabs] = await Promise.all([byKind.model, byKind.lex, ...vocabFiles].map((f) => readPairFile(k, f.name)));
  const r = await call('load', { key: k, modelName: byKind.model.name, model, lex, vocabs }, [model, lex, ...vocabs]);
  loaded.set(k, Date.now());
  st.mem = r && r.mem;
  log('mt load', k, Date.now() - t0, 'ms', Math.round((st.mem || 0) / 1048576), 'MB');
}

async function unload(k) {
  if (!loaded.has(k) || !worker) return;
  await serial(async () => {
    await call('free', { key: k });
    loaded.delete(k);
  });
}

/** Precarga los modelos para que la primera traducción salga rápido. */
export function warmMt(sl, tl) {
  if (!canMt(sl, tl)) return;
  const route = routeFor(sl, tl);
  serial(async () => {
    await boot();
    for (const k of route) await ensureLoaded(k, route);
    // La primera traducción de cada modelo reserva su memoria y tarda más: se hace ya, con algo corto
    const t0 = Date.now();
    await call('translate', { route, texts: ['Hola.'] });
    log('mt warm', route.join('+'), Date.now() - t0, 'ms');
  }).catch((e) => log('mt warm', e && e.message));
}

/** Traduce una lista de textos de sl a tl en el dispositivo. */
export function translateMtMany(texts, sl, tl) {
  const route = routeFor(sl, tl);
  if (!route || !canMt(sl, tl)) return Promise.reject(new Error('mt not ready'));
  return serial(async () => {
    await boot();
    for (const k of route) await ensureLoaded(k, route);
    const r = await call('translate', { route, texts });
    return r.texts;
  });
}

export async function translateMt(text, sl, tl) {
  const [out] = await translateMtMany([text], sl, tl);
  return out;
}
