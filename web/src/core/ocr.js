// Reconocimiento de texto en imágenes (modo lectura).
// En la app de Android se usa el lector de Google (ML Kit): rápido, preciso y sin conexión.
// En la web, y para escrituras que ML Kit no incluye (chino, japonés, árabe…), se usa Tesseract.
import { native, onNative, isApp } from './native.js';
import { log } from './log.js';

// ---------- lector de Google (app) ----------

export function hasNativeOcr() {
  try { return !!(native && native.hasOcr && native.hasOcr()); } catch { return false; }
}

// Escrituras que el lector de Google incluido en la app sabe leer (alfabeto latino)
const LATIN_OCR = new Set(['eng', 'spa', 'ita', 'fra', 'deu', 'por', 'cat', 'glg', 'eus', 'nld', 'pol', 'ces', 'slk',
  'slv', 'hrv', 'ron', 'hun', 'tur', 'swe', 'dan', 'nor', 'fin', 'est', 'lav', 'lit', 'sqi', 'vie', 'ind', 'msa', 'tgl', 'swa', 'afr']);

export function nativeOcrSupports(ocrLang) {
  return hasNativeOcr() && (!ocrLang || ocrLang === 'auto' || LATIN_OCR.has(ocrLang));
}

let seq = 0;
const pending = new Map();
onNative((ev) => {
  if (ev.type !== 'ocr') return;
  const p = pending.get(ev.id);
  if (!p) return;
  pending.delete(ev.id);
  if (ev.ok) p.resolve(ev); else p.reject(new Error(ev.error || 'ocr'));
});

export function warmUpNativeOcr() {
  if (hasNativeOcr() && native.ocrWarmUp) { try { native.ocrWarmUp(); } catch { /* */ } }
}

function joinLines(lines) {
  return lines.map((l) => l.text.trim()).filter(Boolean).reduce((acc, l) => {
    if (!acc) return l;
    // Palabra partida con guion al final de la línea
    if (/[\p{L}]-$/u.test(acc)) return acc.slice(0, -1) + l;
    return `${acc} ${l}`;
  }, '');
}

/** Lee el texto con el lector de Google. Devuelve párrafos en coordenadas del lienzo. */
export function recognizeNative(canvas, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const id = `o${++seq}`;
    const url = canvas.toDataURL('image/jpeg', quality);
    pending.set(id, {
      resolve: (ev) => {
        const sx = canvas.width / (ev.w || canvas.width);
        const sy = canvas.height / (ev.h || canvas.height);
        const out = [];
        for (const b of ev.blocks || []) {
          const lines = (b.lines || []).filter((l) => l.text && l.text.trim());
          const text = joinLines(lines.length ? lines : [{ text: b.text }]);
          if (!text || text.replace(/[^\p{L}\p{N}]/gu, '').length < 2) continue;
          const [x0, y0, x1, y1] = b.box;
          const lh = lines.length
            ? lines.reduce((acc, l) => acc + (l.box[3] - l.box[1]), 0) / lines.length
            : (y1 - y0);
          out.push({
            text,
            lang: b.lang && b.lang !== 'und' ? b.lang : null,
            bbox: { x0: x0 * sx, y0: y0 * sy, x1: x1 * sx, y1: y1 * sy },
            lineHeight: lh * sy,
            lines: lines.length || 1,
          });
        }
        resolve({ paras: out, ms: ev.ms });
      },
      reject,
    });
    try {
      native.ocr(id, url);
    } catch (e) {
      pending.delete(id);
      reject(e);
      return;
    }
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); } }, 10000);
  });
}

// ---------- Tesseract (web y otras escrituras) ----------

let libPromise = null;
let workerPromise = null;
let workerLang = null;
let progressCb = null;
let workerBlob = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`load ${src}`));
    document.head.appendChild(s);
  });
}

function loadLib() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!libPromise) libPromise = loadScript(new URL('vendor/tesseract.min.js', location.href).href).then(() => window.Tesseract);
  return libPromise;
}

async function getWorker(ocrLang) {
  const T = await loadLib();
  if (workerPromise && workerLang === ocrLang) return workerPromise;
  if (workerPromise) {
    try { (await workerPromise).terminate(); } catch { /* */ }
  }
  workerLang = ocrLang;
  // El script del lector se carga aquí y se entrega como Blob: así funciona igual en la app que en la web.
  if (!workerBlob) {
    const src = await fetch(new URL('vendor/worker.min.js', location.href).href).then((r) => r.text());
    workerBlob = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
  }
  const opts = {
    workerPath: workerBlob,
    workerBlobURL: false,
    logger: (m) => { if (progressCb) progressCb(m); },
    errorHandler: (e) => log('ocr worker error', e && (e.message || e)),
  };
  // En la web el motor se sirve desde nuestra propia página (más rápido que desde fuera)
  if (!isApp) opts.corePath = new URL('vendor/core/', location.href).href;
  Object.assign(opts, (typeof window !== 'undefined' && window.__PARLA_OCR__) || {});
  workerPromise = T.createWorker(ocrLang, 1, opts).catch((e) => {
    workerPromise = null;
    throw e;
  });
  return workerPromise;
}

function cleanText(s) {
  return String(s || '')
    .replace(/-\s*\n\s*/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Mejora la imagen para el lector: escala de grises, más contraste y tamaño suficiente.
 * Las fotos de carteles suelen tener poco contraste y letras pequeñas.
 */
export function enhance(src) {
  const scale = Math.min(2, Math.max(1, 1400 / Math.max(src.width, src.height)));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * scale);
  c.height = Math.round(src.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = g;
    hist[g | 0]++;
  }
  // Estira el contraste entre los percentiles 2 y 98
  const total = d.length / 4;
  let lo = 0;
  let hi = 255;
  for (let acc = 0, i = 0; i < 256; i++) { acc += hist[i]; if (acc > total * 0.02) { lo = i; break; } }
  for (let acc = 0, i = 255; i >= 0; i--) { acc += hist[i]; if (acc > total * 0.02) { hi = i; break; } }
  const range = Math.max(30, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range));
    d[i] = v; d[i + 1] = v; d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, scale };
}

/**
 * Devuelve los párrafos encontrados: [{ text, bbox:{x0,y0,x1,y1}, lineHeight }]
 */
export async function recognize(canvas, ocrLang, onProgress) {
  progressCb = onProgress;
  const worker = await getWorker(ocrLang);
  const { canvas: better, scale } = enhance(canvas);
  const { data } = await worker.recognize(better, {}, { blocks: true, text: true });
  progressCb = null;
  const out = [];
  const k = 1 / scale;
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      const text = cleanText(p.text);
      if (!text || text.replace(/[^\p{L}\p{N}]/gu, '').length < 2) continue;
      if (typeof p.confidence === 'number' && p.confidence < 45) continue;
      const lines = p.lines || [];
      const lh = lines.length
        ? lines.reduce((acc, l) => acc + (l.bbox.y1 - l.bbox.y0), 0) / lines.length
        : (p.bbox.y1 - p.bbox.y0);
      out.push({
        text,
        bbox: { x0: p.bbox.x0 * k, y0: p.bbox.y0 * k, x1: p.bbox.x1 * k, y1: p.bbox.y1 * k },
        lineHeight: lh * k,
        lines: lines.length || 1,
      });
    }
  }
  return out;
}
