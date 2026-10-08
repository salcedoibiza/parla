import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { html } from './h.js';
import { Icon } from './icons.js';
import { store, toast, popScreen, openSheet, setSettings } from '../core/store.js';
import { t } from '../core/i18n.js';
import { CameraView, Seg, langLabel, useBackGuard, Spinner } from './common.js';
import { frameFromVideo, canvasFromFile } from '../core/media.js';
import { recognize } from '../core/ocr.js';
import { translateLines } from '../core/translate.js';
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

/** Reconoce y traduce: devuelve { paras:[{text,tr,bbox,lineHeight,colors}], w, h } en coordenadas del lienzo. */
async function readCanvas(canvas, from, to, onProgress) {
  const paras = await recognize(canvas, langInfo(from).ocr || 'eng', onProgress);
  if (!paras.length) return { paras: [], w: canvas.width, h: canvas.height };
  let trs = paras.map((p) => p.text);
  if (trCode(from) !== trCode(to)) {
    const out = await translateLines(paras.map((p) => p.text), trCode(from), trCode(to));
    trs = out.map((x, i) => x || paras[i].text);
  }
  return {
    w: canvas.width,
    h: canvas.height,
    paras: paras.map((p, i) => ({ ...p, tr: trs[i], colors: sampleColors(canvas, p.bbox) })),
  };
}

function Overlay({ p, scale, ox = 0, oy = 0 }) {
  const b = p.bbox;
  const ratio = Math.max(1, (p.tr || '').length / Math.max(1, p.text.length));
  const fs = Math.max(9, Math.min(30, (p.lineHeight * scale * 0.8) / Math.sqrt(ratio)));
  const c = p.colors || { bg: '#fff', fg: '#111' };
  return html`<div class="ov" dir="auto" style=${`left:${ox + b.x0 * scale - 2}px;top:${oy + b.y0 * scale - 2}px;width:${(b.x1 - b.x0) * scale + 4}px;min-height:${(b.y1 - b.y0) * scale + 4}px;font-size:${fs}px;background:${c.bg};color:${c.fg}`}>${p.tr}</div>`;
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
  const liveRef = useRef({ result: null, busy: false, ref: null, prev: null, stableSince: 0, moving: false, ready: false, empty: false });
  const tinyCanvas = useRef(null);
  const from = store.settings.readFrom || 'en';
  const to = store.profile.lang;
  const stage = useStageSize(stageRef, phase);
  const fromRef = useRef(from);
  fromRef.current = from;

  useBackGuard(() => {
    if (phase === 'result') { setPhase('live'); setResult(null); return true; }
    return false;
  });

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
    const iv = setInterval(async () => {
      const v = videoRef.current;
      if (!alive || !v || !v.videoWidth || document.hidden) return;
      let cur;
      try { cur = tiny(v, tinyCanvas.current); } catch { return; }
      const now = Date.now();
      const motion = diff(cur, L.prev);
      L.prev = cur;
      if (motion > 9) { L.stableSince = now; L.moving = true; } else L.moving = false;
      // Si la imagen ha cambiado respecto a la última lectura, se ocultan las traducciones
      const changed = diff(cur, L.ref) > 16;
      if (changed && L.result) { L.result = null; force(); }
      if (L.busy || L.moving || now - L.stableSince < 450) { force(); return; }
      if (L.result || (L.empty && !changed)) return;
      L.busy = true;
      force();
      const refAtStart = cur;
      try {
        const canvas = frameFromVideo(v, 1100);
        const res = await readCanvas(canvas, fromRef.current, to, (m) => {
          if (/load|init/.test(m.status || '') && !L.ready) setStatus({ label: t('Preparando el lector (solo la primera vez)…'), p: m.progress || 0 });
        });
        L.ready = true;
        setStatus({ label: '', p: 0 });
        // Si la cámara se movió mientras leía, se descarta
        const after = tiny(v, tinyCanvas.current);
        if (alive && diff(after, refAtStart) < 16) {
          L.ref = refAtStart;
          L.empty = !res.paras.length;
          L.result = res.paras.length ? { ...res, vw: v.videoWidth, vh: v.videoHeight } : null;
        }
      } catch (e) {
        log('live read failed', e && (e.message || e));
        setStatus({ label: t('No se pudo preparar el lector. Comprueba tu conexión.'), p: 0 });
      } finally {
        L.busy = false;
        if (alive) force();
      }
    }, 300);
    return () => { alive = false; clearInterval(iv); };
  }, [phase, from]);

  useEffect(() => { liveRef.current.result = null; liveRef.current.empty = false; }, [from]);

  // ---------- foto congelada ----------
  const process = async (canvas, known) => {
    setPhase('busy');
    setStatus({ label: t('Leyendo el texto…'), p: 0 });
    try {
      const res = known || await readCanvas(canvas, from, to, (m) => {
        if (m.status === 'recognizing text') setStatus({ label: t('Leyendo el texto…'), p: m.progress || 0 });
        else if (/load|init/.test(m.status || '')) setStatus({ label: t('Preparando el lector (solo la primera vez)…'), p: m.progress || 0 });
      });
      if (!res.paras.length) {
        toast(t('No se ha encontrado texto. Acércate un poco y prueba otra vez.'), 'info', 3500);
        setPhase('live');
        return;
      }
      setResult({ img: canvas.toDataURL('image/jpeg', 0.9), ...res });
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
    const L = liveRef.current;
    const canvas = frameFromVideo(v, 1600);
    // Si ya hay una lectura de esta misma imagen, se reutiliza
    if (L.result && !L.moving) {
      const k = canvas.width / L.result.w;
      const scaled = {
        w: canvas.width,
        h: canvas.height,
        paras: L.result.paras.map((p) => ({
          ...p,
          lineHeight: p.lineHeight * k,
          bbox: { x0: p.bbox.x0 * k, y0: p.bbox.y0 * k, x1: p.bbox.x1 * k, y1: p.bbox.y1 * k },
        })),
      };
      process(canvas, scaled);
    } else {
      process(canvas);
    }
  };

  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { process(await canvasFromFile(f)); } catch { toast(t('No se pudo abrir la imagen.'), 'error'); }
  };

  const pickFrom = () => openSheet('lang', {
    value: from,
    title: t('Idioma del texto'),
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
      ${L.result.paras.map((p, i) => html`<${Overlay} key=${i} p=${p} scale=${scale} ox=${ox} oy=${oy} />`)}
    </div>`;
  }

  let liveStatus = null;
  if (phase === 'live') {
    if (status.label) liveStatus = html`<span><${Spinner} size=${14} /></span>${status.label}`;
    else if (L.busy) liveStatus = html`<${Spinner} size=${14} />${t('Leyendo…')}`;
    else if (L.moving && !L.result) liveStatus = t('Mantén el móvil quieto');
    else if (L.empty && !L.result) liveStatus = t('No veo texto. Acércate un poco.');
    else if (!L.result) liveStatus = t('Apunta a un texto');
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
          ${langLabel(from)} <${Icon} name="arrow" size=${16} /> ${langLabel(to)}
        </button>
      </div>
      <span style="width:44px"></span>
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
