// Traducción con el servicio web gratuito de Google Translate.
// Se llama directamente desde la página (una sola conexión que se reutiliza, más rápido);
// si falla, se prueba a través de Android y después con alternativas gratuitas.
import { native, onNative } from './native.js';
import { log } from './log.js';

const cache = new Map();
const inflight = new Map();
const detected = new Map();
const CACHE_MAX = 1500;
let seq = 0;
const pending = new Map();

onNative((ev) => {
  if (ev.type !== 'translate') return;
  const p = pending.get(ev.id);
  if (!p) return;
  pending.delete(ev.id);
  if (ev.ok) p.resolve(ev.text); else p.reject(new Error(ev.error || 'translate failed'));
});

function nativeTranslate(text, sl, tl) {
  return new Promise((resolve, reject) => {
    const id = `t${++seq}`;
    pending.set(id, { resolve, reject });
    try {
      native.translate(id, text, sl, tl);
    } catch (e) {
      pending.delete(id);
      reject(e);
      return;
    }
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); }
    }, 8000);
  });
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

// Permite a las pruebas redirigir el traductor
const override = typeof window !== 'undefined' && window.__PARLA_TRANSLATE_URL__;
const GTX = override || 'https://translate.googleapis.com/translate_a/single';

async function gtx(text, sl, tl, ms = 4000) {
  const url = `${GTX}?client=gtx&dt=t&ie=UTF-8&oe=UTF-8&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}`;
  let res;
  if (text.length > 1500) {
    res = await withTimeout(fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: `q=${encodeURIComponent(text)}`,
    }), ms);
  } else {
    res = await withTimeout(fetch(`${url}&q=${encodeURIComponent(text)}`), ms);
  }
  if (!res.ok) throw new Error(`gtx ${res.status}`);
  const data = await res.json();
  const segs = data && data[0];
  if (!Array.isArray(segs)) throw new Error('gtx format');
  if (sl === 'auto' && typeof data[2] === 'string') detected.set(text, data[2]);
  return segs.map((s) => (s && typeof s[0] === 'string' ? s[0] : '')).join('');
}

async function chromeDict(text, sl, tl) {
  const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(text)}`;
  const res = await withTimeout(fetch(url), 6000);
  if (!res.ok) throw new Error(`dict ${res.status}`);
  const data = await res.json();
  // Formatos posibles: ["texto"] | [["texto","es"]] | {sentences:[{trans}]}
  if (Array.isArray(data)) {
    const first = data[0];
    if (typeof first === 'string') return data.join('');
    if (Array.isArray(first)) return data.map((d) => d[0]).join('');
  }
  if (data && Array.isArray(data.sentences)) return data.sentences.map((s) => s.trans || '').join('');
  throw new Error('dict format');
}

async function myMemory(text, sl, tl) {
  const s = sl === 'auto' ? 'autodetect' : sl;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=${encodeURIComponent(s)}|${encodeURIComponent(tl)}`;
  const res = await withTimeout(fetch(url), 6000);
  const data = await res.json();
  const out = data && data.responseData && data.responseData.translatedText;
  if (!out) throw new Error('mymemory');
  return out;
}

function keyOf(text, sl, tl) {
  return `${sl}|${tl}|${text}`;
}

/** Traducción ya hecha (sin esperar). */
export function cachedTranslation(text, sl, tl) {
  const src = String(text || '').trim();
  if (!src) return '';
  if (sl === tl) return src;
  return cache.get(keyOf(src, sl, tl)) || null;
}

/** Idioma detectado por el traductor cuando se usó sl = 'auto'. */
export function detectedLang(text) {
  return detected.get(String(text || '').trim()) || null;
}

/** Abre la conexión con el traductor por adelantado, para que la primera traducción sea rápida. */
let warmed = 0;
export function warmUp() {
  if (Date.now() - warmed < 60000) return;
  warmed = Date.now();
  gtx('hola', 'es', 'en', 6000).catch(() => {});
}

async function doTranslate(src, sl, tl) {
  const attempts = [() => gtx(src, sl, tl)];
  if (native && !override) attempts.push(() => nativeTranslate(src, sl, tl));
  if (!override) {
    attempts.push(() => chromeDict(src, sl, tl));
    attempts.push(() => myMemory(src, sl, tl));
  }
  let lastErr = null;
  for (const a of attempts) {
    try {
      const out = await a();
      if (out && out.trim()) return out;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('translate failed');
}

/**
 * Traduce un texto. sl/tl son códigos del traductor (ver langs.js -> tr). sl puede ser 'auto'.
 */
export function translate(text, sl, tl) {
  const src = String(text || '').trim();
  if (!src) return Promise.resolve('');
  if (sl === tl) return Promise.resolve(src);
  const key = keyOf(src, sl, tl);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  // Si ya se está traduciendo lo mismo, se espera a esa misma petición
  if (inflight.has(key)) return inflight.get(key);
  const p = doTranslate(src, sl, tl)
    .then((out) => {
      cache.set(key, out);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return out;
    })
    .catch((e) => {
      log('translate failed', sl, tl, e && e.message);
      throw e;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Traduce a varios idiomas a la vez. Devuelve { tl: texto } con los que salieron bien. */
export async function translateMany(text, sl, tls, timeoutMs = 6000) {
  const out = {};
  await Promise.all(tls.map(async (tl) => {
    if (tl === sl) return;
    try {
      out[tl] = await withTimeout(translate(text, sl, tl), timeoutMs);
    } catch { /* el receptor lo traducirá por su cuenta */ }
  }));
  return out;
}

/** Traduce una lista de frases cortas en pocas peticiones (una por línea). */
export async function translateLines(lines, sl, tl) {
  const result = new Array(lines.length).fill(null);
  const BATCH = 35;
  for (let i = 0; i < lines.length; i += BATCH) {
    const chunk = lines.slice(i, i + BATCH);
    try {
      const joined = chunk.join('\n');
      const out = await translate(joined, sl, tl);
      const parts = out.split('\n');
      if (parts.length === chunk.length) {
        parts.forEach((p, j) => { result[i + j] = p.trim(); });
        continue;
      }
    } catch { /* se intenta una a una */ }
    // De una en una en grupos pequeños para no saturar el servicio
    for (let k = 0; k < chunk.length; k += 5) {
      await Promise.all(chunk.slice(k, k + 5).map(async (line, j) => {
        try { result[i + k + j] = await translate(line, sl, tl); } catch { /* */ }
      }));
    }
  }
  return result;
}
