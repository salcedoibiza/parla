// Reconocimiento de texto en imágenes (modo lectura), con Tesseract.
// El motor y los idiomas se descargan la primera vez que se usan.
import { log } from './log.js';

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
  workerPromise = T.createWorker(ocrLang, 1, {
    workerPath: workerBlob,
    workerBlobURL: false,
    ...((typeof window !== 'undefined' && window.__PARLA_OCR__) || {}),
    logger: (m) => { if (progressCb) progressCb(m); },
    errorHandler: (e) => log('ocr worker error', e && (e.message || e)),
  }).catch((e) => {
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
 * Devuelve los párrafos encontrados: [{ text, bbox:{x0,y0,x1,y1}, lineHeight }]
 */
export async function recognize(canvas, ocrLang, onProgress) {
  progressCb = onProgress;
  const worker = await getWorker(ocrLang);
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
  progressCb = null;
  const out = [];
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      const text = cleanText(p.text);
      if (!text || text.replace(/[^\p{L}\p{N}]/gu, '').length < 2) continue;
      if (typeof p.confidence === 'number' && p.confidence < 40) continue;
      const lines = p.lines || [];
      const lh = lines.length
        ? lines.reduce((acc, l) => acc + (l.bbox.y1 - l.bbox.y0), 0) / lines.length
        : (p.bbox.y1 - p.bbox.y0);
      out.push({ text, bbox: p.bbox, lineHeight: lh, lines: lines.length || 1 });
    }
  }
  return out;
}
