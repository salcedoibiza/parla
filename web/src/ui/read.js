import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { html } from './h.js';
import { Icon } from './icons.js';
import { store, toast, popScreen, openSheet, setSettings } from '../core/store.js';
import { t } from '../core/i18n.js';
import { CameraView, Seg, langLabel, useBackGuard, Spinner } from './common.js';
import { frameFromVideo, canvasFromFile } from '../core/media.js';
import {
  recognize, recognizeNative, nativeOcrSupports, hasNativeOcr, warmUpNativeOcr,
} from '../core/ocr.js';
import { translate, detectedLang } from '../core/translate.js';
import { lang as langInfo, trCode } from '../core/langs.js';
import { copy, share } from '../core/native.js';
import { log } from '../core/log.js';

function useStageSize(ref, dep) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const upd = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    upd();
    let ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(upd);
      ro.observe(el);
    } else {
      window.addEventListener('resize', upd);
    }
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', upd); };
  }, [dep]);
  return size;
}

// Color de fondo de una zona (se miden los bordes, donde casi no hay letras)
function sampleColors(canvas, b) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const x0 = Math.max(0, Math.floor(b.x0) - 2);
    const y0 = Math.max(0, Math.floor(b.y0) - 2);
    const x1 = Math.min(canvas.width - 1, Math.ceil(b.x1) + 2);
    const y1 = Math.min(canvas.height - 1, Math.ceil(b.y1) + 2);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 2 || h < 2) return null;
    const px = [];
    for (const d of [ctx.getImageData(x0, y0, w, 1).data, ctx.getImageData(x0, y1, w, 1).data,
      ctx.getImageData(x0, y0, 1, h).data, ctx.getImageData(x1, y0, 1, h).data]) {
      for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
    }
    const ch = [0, 1, 2].map((c) => {
      const v = px.map((p) => p[c]).sort((a, z) => a - z);
      return v[Math.floor(v.length / 2)];
    });
    const lum = (0.299 * ch[0] + 0.587 * ch[1] + 0.114 * ch[2]) / 255;
    return { bg: `rgb(${ch.join(',')})`, fg: lum > 0.55 ? '#111' : '#fff' };
  } catch { return null; }
}

// Miniatura en gris para detectar si la cámara se mueve
const TW = 48;
const TH = 36;
function tiny(video, canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, TW, TH);
  const d = ctx.getImageData(0, 0, TW, TH).data;
  const out = new Uint8Array(TW * TH);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) out[j] = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
  return out;
}
function diff(a, b) {
  if (!a || !b) return 255;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

// Parecido entre dos textos (para no volver a traducir lo que ya se tradujo con pequeñas variaciones)
function norm(s) { return String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}
function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

/** Memoria de traducciones de la sesión de lectura. */
class Memory {
  constructor() { this.items = []; }
  find(text) {
    const n = norm(text);
    let best = null;
    let bestS = 0;
    for (const it of this.items) {
      const s = similarity(n, it.n);
      if (s > bestS) { bestS = s; best = it; }
    }
    return bestS >= 0.82 ? best : null;
  }
  add(text, tr, src) {
    this.items.unshift({ n: norm(text), tr, src });
    if (this.items.length > 80) this.items.length = 80;
  }
}

function ocrLangFor(from) {
  return from === 'auto' ? 'eng' : (langInfo(from).ocr || 'eng');
}

function fontFor(p, scale) {
  const w = Math.max(10, (p.bbox.x1 - p.bbox.x0) * scale);
  const h = Math.max(10, (p.bbox.y1 - p.bbox.y0) * scale);
  const chars = Math.max(4, (p.tr || p.text).length);
  const byArea = Math.sqrt((w * h) / (chars * 0.55));
  return Math.max(9, Math.min(byArea, p.lineHeight * scale * 0.95, 34));
}

function Overlay({ p, scale, ox = 0, oy = 0 }) {
  const b = p.bbox;
  const c = p.colors || { bg: '#fff', fg: '#111' };
  return html`<div class="ov" dir="auto" style=${`left:${ox + b.x0 * scale - 2}px;top:${oy + b.y0 * scale - 2}px;width:${(b.x1 - b.x0) * scale + 4}px;min-height:${(b.y1 - b.y0) * scale + 4}px;font-size:${fontFor(p, scale)}px;background:${c.bg};color:${c.fg}`}>${p.tr}</div>`;
}

export function ReadScreen() {
  const [, force] = useReducer((x) => x + 1, 0);
  const [phase, setPhase] = useState('live'); // live | busy | result
  const [status, setStatus] = useState({ label: '', p: 0 });
  const [result, setResult] = useState(null);
  const [view, setView] = useState('tr');
  const videoRef = useRef(null);
  const fileRef = useRef(null);
  const stageRef = useRef(null);
  const memRef = useRef(new Memory());
  const liveRef = useRef({ result: null, busy: false, ref: null, prev: null, stableSince: 0, moving: false, ready: false, empty: false, lastStart: 0, emptyCount: 0 });
  const tinyCanvas = useRef(null);
  const nativeOk = hasNativeOcr();
  const from = store.settings.readFrom || (nativeOk ? 'auto' : 'en');
  const to = store.profile.lang;
  const useNative = nativeOcrSupports(from === 'auto' ? 'auto' : langInfo(from).ocr);
  const sl = from === 'auto' ? 'auto' : trCode(from);
  const tl = trCode(to);
  const stage = useStageSize(stageRef, phase);
  const showIntro = !store.settings.readIntro;

  useEffect(() => { if (useNative) warmUpNativeOcr(); }, [useNative]);

  useBackGuard(() => {
    if (phase === 'result') { setPhase('live'); setResult(null); return true; }
    return false;
  });

  /** Traduce los párrafos; lo ya visto se reutiliza al momento. */
  const attachTranslations = (paras, onLate) => {
    const mem = memRef.current;
    const late = [];
    for (const p of paras) {
      if (sl !== 'auto' && sl === tl) { p.tr = p.text; continue; }
      const hit = mem.find(p.text);
      if (hit) { p.tr = hit.tr; p.src = hit.src; continue; }
      p.tr = null;
      late.push(translate(p.text, sl, tl).then((tr) => {
        p.tr = tr;
        p.src = detectedLang(p.text);
        mem.add(p.text, tr, p.src);
        if (onLate) onLate();
      }).catch(() => {}));
    }
    return Promise.all(late);
  };

  // ---------- lectura en directo ----------
  useEffect(() => {
    if (phase !== 'live') return undefined;
    const L = liveRef.current;
    if (!tinyCanvas.current) {
      tinyCanvas.current = document.createElement('canvas');
      tinyCanvas.current.width = TW;
      tinyCanvas.current.height = TH;
    }
    let alive = true;
    const tickMs = useNative ? 120 : 300;
    const iv = setInterval(async () => {
      const v = videoRef.current;
      if (!alive || !v || !v.videoWidth || document.hidden || showIntro) return;
      let cur;
      try { cur = tiny(v, tinyCanvas.current); } catch { return; }
      const now = Date.now();
      const motion = diff(cur, L.prev);
      L.prev = cur;
      const moving = motion > (useNative ? 14 : 9);
      if (moving !== L.moving) { L.moving = moving; force(); }
      if (moving) { L.stableSince = now; return; }
      if (L.busy) return;

      if (useNative) {
        // Lector de Google: rápido, se lee continuamente
        if (now - L.lastStart < 260) return;
      } else {
        // Tesseract: más lento, se espera a que la imagen esté quieta y cambie
        const changed = diff(cur, L.ref) > 16;
        if (changed && L.result) { L.result = null; force(); }
        if (now - L.stableSince < 450) return;
        if (L.result || (L.empty && !changed)) return;
      }
      L.busy = true;
      L.lastStart = now;
      const refAtStart = cur;
      try {
        let paras;
        let canvas;
        if (useNative) {
          canvas = frameFromVideo(v, 1280);
          paras = (await recognizeNative(canvas, 0.8)).paras;
        } else {
          force();
          canvas = frameFromVideo(v, 1100);
          paras = await recognize(canvas, ocrLangFor(from), (m) => {
            if (/load|init/.test(m.status || '') && !L.ready) setStatus({ label: t('Preparando el lector (solo la primera vez)…'), p: m.progress || 0 });
          });
          setStatus({ label: '', p: 0 });
        }
        L.ready = true;
        // Si la cámara se movió mientras leía, se descarta
        const after = tiny(v, tinyCanvas.current);
        if (!alive || diff(after, refAtStart) > 18) return;
        for (const p of paras) p.colors = sampleColors(canvas, p.bbox);
        const res = { paras, w: canvas.width, h: canvas.height, vw: v.videoWidth, vh: v.videoHeight };
        if (!useNative) await attachTranslations(paras);
        else attachTranslations(paras, () => { if (L.result === res) force(); });
        if (!alive) return;
        L.ref = refAtStart;
        L.empty = !paras.length;
        L.emptyCount = paras.length ? 0 : L.emptyCount + 1;
        // Con el lector rápido, un fotograma sin texto no borra lo anterior enseguida (evita parpadeos)
        if (paras.length || !useNative || L.emptyCount > 3) L.result = paras.length ? res : null;
      } catch (e) {
        log('live read failed', e && (e.message || e));
        if (!useNative) setStatus({ label: t('No se pudo preparar el lector. Comprueba tu conexión.'), p: 0 });
      } finally {
        L.busy = false;
        if (alive) force();
      }
    }, tickMs);
    return () => { alive = false; clearInterval(iv); };
  }, [phase, from, useNative, showIntro]);

  useEffect(() => { liveRef.current.result = null; liveRef.current.empty = false; }, [from]);

  // ---------- foto congelada ----------
  const process = async (canvas, known) => {
    setPhase('busy');
    setStatus({ label: t('Leyendo el texto…'), p: 0 });
    try {
      let paras = known;
      if (!paras) {
        paras = useNative
          ? (await recognizeNative(canvas, 0.9)).paras
          : await recognize(canvas, ocrLangFor(from), (m) => {
            if (m.status === 'recognizing text') setStatus({ label: t('Leyendo el texto…'), p: m.progress || 0 });
            else if (/load|init/.test(m.status || '')) setStatus({ label: t('Preparando el lector (solo la primera vez)…'), p: m.progress || 0 });
          });
      }
      if (!paras.length) {
        toast(t('No se ha encontrado texto. Acércate un poco y prueba otra vez.'), 'info', 3500);
        setPhase('live');
        return;
      }
      for (const p of paras) p.colors = sampleColors(canvas, p.bbox);
      setStatus({ label: t('Traduciendo…'), p: 1 });
      await attachTranslations(paras);
      for (const p of paras) if (!p.tr) p.tr = p.text;
      setResult({ img: canvas.toDataURL('image/jpeg', 0.9), w: canvas.width, h: canvas.height, paras });
      setView('tr');
      setPhase('result');
    } catch (e) {
      log('read failed', e && (e.message || e));
      toast(t('No se pudo leer la imagen. Comprueba tu conexión (la primera vez se descarga el lector).'), 'error', 4500);
      setPhase('live');
    } finally {
      setStatus({ label: '', p: 0 });
    }
  };

  const freeze = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    // Se lee otra vez con más resolución para que el texto congelado sea lo más exacto posible
    process(frameFromVideo(v, 1800));
  };

  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { process(await canvasFromFile(f, 2000)); } catch { toast(t('No se pudo abrir la imagen.'), 'error'); }
  };

  const pickFrom = () => openSheet('lang', {
    value: from,
    title: t('Idioma del texto'),
    auto: true,
    filter: (l) => !!l.ocr,
    onPick: (id) => setSettings({ readFrom: id }),
  });

  // ---------- capa en directo sobre el vídeo ----------
  const L = liveRef.current;
  let liveLayer = null;
  const v = videoRef.current;
  if (phase === 'live' && L.result && v && v.clientWidth) {
    const cw = v.clientWidth;
    const chh = v.clientHeight;
    const cover = Math.max(cw / L.result.vw, chh / L.result.vh);
    const ox = (cw - L.result.vw * cover) / 2;
    const oy = (chh - L.result.vh * cover) / 2;
    const scale = cover * (L.result.vw / L.result.w);
    liveLayer = html`<div class=${`live-layer ${L.moving ? 'hide' : ''}`}>
      ${L.result.paras.filter((p) => p.tr).map((p, i) => html`<${Overlay} key=${i} p=${p} scale=${scale} ox=${ox} oy=${oy} />`)}
    </div>`;
  }

  // Idioma detectado (si se eligió "Detectar idioma")
  let detected = null;
  if (from === 'auto') {
    const ps = (L.result && L.result.paras) || (result && result.paras) || [];
    const src = ps.map((p) => p.src).find(Boolean);
    if (src) detected = src;
  }

  let liveStatus = null;
  if (phase === 'live' && !showIntro) {
    if (status.label) liveStatus = html`<${Spinner} size=${14} />${status.label}`;
    else if (L.busy && !useNative) liveStatus = html`<${Spinner} size=${14} />${t('Leyendo…')}`;
    else if (L.moving && !L.result) liveStatus = t('Mantén el móvil quieto');
    else if (L.empty && !L.result) liveStatus = t('No veo texto. Acércate un poco.');
    else if (!L.result) liveStatus = useNative && !L.ready ? html`<${Spinner} size=${14} />${t('Buscando texto…')}` : t('Apunta a un texto');
  }

  const fullText = result ? result.paras.map((p) => (view === 'tr' ? p.tr : p.text)).join('\n\n') : '';

  let frozen = null;
  if (result && stage.w && stage.h) {
    const scale = Math.min(stage.w / result.w, stage.h / result.h);
    frozen = html`<div class="read-img-wrap" style=${`width:${result.w * scale}px;height:${result.h * scale}px`}>
      <img src=${result.img} alt="" />
      ${view === 'tr' ? result.paras.map((p, i) => html`<${Overlay} key=${i} p=${p} scale=${scale} />`) : null}
    </div>`;
  }

  return html`<div class="screen read-screen">
    <div class="topbar">
      <button class="icon-btn" onClick=${() => (phase === 'result' ? (setPhase('live'), setResult(null)) : popScreen())} aria-label=${t('Atrás')}><${Icon} name="back" /></button>
      <div class="title" style="display:flex;justify-content:center">
        <button class="lang-pair" onClick=${pickFrom}>
          ${from === 'auto' && detected ? `${langLabel(detected)} ✓` : langLabel(from)} <${Icon} name="arrow" size=${16} /> ${langLabel(to)}
        </button>
      </div>
      <button class="icon-btn" onClick=${() => setSettings({ readIntro: false })} aria-label=${t('Cómo funciona')}><${Icon} name="info" /></button>
    </div>

    ${phase !== 'result' ? html`<div class="read-cam">
      <${CameraView} facing="environment" style="width:100%;height:100%" onVideo=${(vv) => { videoRef.current = vv; }}>
        ${liveLayer}
      </${CameraView}>
      ${liveStatus ? html`<div class="read-status">${liveStatus}</div>` : null}
      <div class="read-controls">
        <button class="round-dark" onClick=${() => fileRef.current && fileRef.current.click()} aria-label=${t('Elegir de la galería')}><${Icon} name="image" /></button>
        <button class="shutter" onClick=${freeze} aria-label=${t('Congelar la imagen')}><${Icon} name="freeze" size=${28} /></button>
        <span style="width:52px"></span>
      </div>
      <input ref=${fileRef} type="file" accept="image/*" class="visually-hidden" onChange=${onFile} />
    </div>` : null}

    ${showIntro && phase === 'live' ? html`<div class="read-intro">
      <div class="card">
        <span class="ic-big" style="background:linear-gradient(140deg,#38bdf8,#0b82d8);box-shadow:0 12px 24px -10px rgba(11,130,216,.55)"><${Icon} name="read" size=${30} /></span>
        <h3>${t('Modo lectura')}</h3>
        <p>${nativeOk
          ? t('Apunta la cámara a cualquier texto (un cartel, un menú, una carta…) y verás la traducción encima, en tu idioma, sin hacer foto. El idioma del texto se detecta solo.')
          : t('Apunta la cámara a cualquier texto (un cartel, un menú, una carta…) y verás la traducción encima, en tu idioma, sin hacer foto. Arriba puedes elegir el idioma del texto.')}</p>
        <p>${t('Pulsa el botón central para congelar la imagen y leerla con calma, copiarla o compartirla. También puedes elegir una foto de la galería.')}</p>
        <button class="btn block" onClick=${() => setSettings({ readIntro: true })}>${t('Entendido')}</button>
      </div>
    </div>` : null}

    ${phase === 'busy' ? html`<div class="busy-overlay">
      <div>${status.label || t('Leyendo el texto…')}</div>
      <div class="progress"><i style=${`width:${Math.round((status.p || 0) * 100)}%`}></i></div>
    </div>` : null}

    ${phase === 'result' && result ? html`<div class="read-result" style="padding-top:calc(62px + var(--safe-top))">
      <div class="read-stage" ref=${stageRef}>${frozen}</div>
      <div class="read-bottom">
        <${Seg} value=${view} onChange=${setView} options=${[
          { value: 'tr', label: langLabel(to) },
          { value: 'orig', label: t('Original') },
        ]} />
        <div class="txt" dir="auto" style="margin-top:10px">${fullText}</div>
        <div class="btn-row">
          <button class="btn ghost small" onClick=${async () => { if (await copy(fullText)) toast(t('Texto copiado')); }}><${Icon} name="copy" size=${18} />${t('Copiar')}</button>
          <button class="btn ghost small" onClick=${() => share(fullText, 'Parla')}><${Icon} name="share" size=${18} />${t('Compartir')}</button>
          <button class="btn small" onClick=${() => { setPhase('live'); setResult(null); }}><${Icon} name="camera" size=${18} />${t('Seguir')}</button>
        </div>
      </div>
    </div>` : null}
  </div>`;
}
