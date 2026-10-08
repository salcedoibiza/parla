import { useEffect, useReducer, useRef, useState, useMemo } from 'preact/hooks';
import { html } from './h.js';
import { Icon } from './icons.js';
import { store, subscribe, closeSheet, toast } from '../core/store.js';
import { t, uiLangId } from '../core/i18n.js';
import { LANGS, localName, lang as langInfo, trCode } from '../core/langs.js';
import { hasLocalTr, onModels, refreshModels, modelsState, missingFor, downloadModel, mlCode } from '../core/localtr.js';
import { qrPath } from '../core/qr.js';
import { startCamera, stopCamera, photoFromFile, photoFromVideo } from '../core/media.js';
import { isApp, openAppSettings } from '../core/native.js';

export function useStore() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => subscribe(() => force()), []);
  return store;
}

export function useEmitter(emitter, ev = 'change') {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => (emitter ? emitter.on(ev, () => force()) : undefined), [emitter]);
}

// ---------- guardas del botón "atrás" ----------
let backGuard = null;
export function useBackGuard(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const g = () => ref.current();
    backGuard = g;
    return () => { if (backGuard === g) backGuard = null; };
  }, []);
}
export function runBackGuard() {
  return backGuard ? backGuard() : false;
}

// ---------- avatar ----------
const COLORS = ['#6366F1', '#0EA5E9', '#14B8A6', '#22C55E', '#F59E0B', '#F97316', '#EF4444', '#EC4899', '#A855F7', '#64748B'];
function colorFor(s) {
  let h = 0;
  const str = String(s || '?');
  for (let i = 0; i < str.length; i++) h = (h * 33 + str.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}
export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const a = (parts[0] || '?')[0] || '?';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}
export function Avatar({ name, photo, size = 40, seed, color, ring = false, speaking = false }) {
  const bg = photo ? 'var(--bg-2)' : (color || colorFor(seed || name));
  let style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;background-color:${bg}`;
  if (ring && color) style += `;box-shadow:0 0 0 2px var(--bg),0 0 0 4px ${color}`;
  return html`<span class=${`avatar ${speaking ? 'speaking' : ''}`} style=${`${style};--sc:${color || bg}`}>
    ${photo ? html`<img src=${photo} alt="" />` : initials(name)}
  </span>`;
}

// ---------- barra superior ----------
export function Topbar({ title, sub, onBack, right, backIcon = 'back' }) {
  return html`<div class="topbar">
    ${onBack ? html`<button class="icon-btn" onClick=${onBack} aria-label=${t('Atrás')}><${Icon} name=${backIcon} /></button>` : html`<span style="width:6px"></span>`}
    <div class="title">
      ${title ? html`<h1>${title}</h1>` : null}
      ${sub ? html`<div class="sub">${sub}</div>` : null}
    </div>
    ${right}
  </div>`;
}

// ---------- hoja inferior ----------
export function Sheet({ title, children, full = false, onClose }) {
  const close = onClose || closeSheet;
  return html`<div>
    <div class="backdrop" onClick=${close}></div>
    <div class=${`sheet ${full ? 'full' : ''}`} role="dialog">
      ${full ? html`<div style="height:var(--safe-top)"></div>` : html`<div class="grab"></div>`}
      <div class="sheet-head">
        <h2>${title}</h2>
        <button class="icon-btn" onClick=${close} aria-label=${t('Cerrar')}><${Icon} name="x" /></button>
      </div>
      <div class="sheet-body">${children}</div>
    </div>
  </div>`;
}

// ---------- selector segmentado ----------
export function Seg({ value, options, onChange }) {
  return html`<div class="seg" role="tablist">
    ${options.map((o) => html`<button class=${o.value === value ? 'on' : ''} onClick=${() => onChange(o.value)} role="tab" aria-selected=${o.value === value}>
      ${o.icon ? html`<${Icon} name=${o.icon} size=${18} />` : null}${o.label}
    </button>`)}
  </div>`;
}

// ---------- avisos y diálogos ----------
export function Toasts() {
  const s = useStore();
  if (!s.toasts.length) return null;
  return html`<div class="toasts">${s.toasts.map((x) => html`<div class=${`toast ${x.kind}`} key=${x.id}>${x.text}</div>`)}</div>`;
}

export function DialogView() {
  const s = useStore();
  const d = s.dialog;
  if (!d) return null;
  const cancel = d.actions.find((a) => a.value === false);
  return html`<div class="dialog-wrap">
    <div class="backdrop" onClick=${() => d.resolve(cancel ? false : null)}></div>
    <div class="dialog" role="alertdialog">
      <h3>${d.title}</h3>
      ${d.text ? html`<p>${d.text}</p>` : null}
      <div class="actions">
        ${d.actions.slice().reverse().map((a) => html`<button
          class=${`btn block ${a.primary ? (a.danger ? 'danger' : '') : 'ghost'}`}
          onClick=${() => d.resolve(a.value)}>${a.label}</button>`)}
      </div>
    </div>
  </div>`;
}

// ---------- selector de idioma ----------
export function LangSheet({ value, onPick, title, filter, auto = false }) {
  const [q, setQ] = useState('');
  const ui = uiLangId();
  const list = useMemo(() => {
    const items = LANGS.filter((l) => !filter || filter(l)).map((l) => ({ ...l, local: localName(l.id, ui) }));
    const needle = q.trim().toLowerCase();
    const res = needle
      ? items.filter((l) => l.name.toLowerCase().includes(needle) || l.local.toLowerCase().includes(needle) || l.id.toLowerCase() === needle)
      : items;
    return res;
  }, [q, ui]);
  return html`<${Sheet} title=${title || t('Idioma')} full>
    <div class="lang-search">
      <input class="input" placeholder=${t('Buscar idioma')} value=${q} onInput=${(e) => setQ(e.target.value)} />
    </div>
    ${auto && !q.trim() ? html`<button class=${`lang-item ${value === 'auto' ? 'on' : ''}`} onClick=${() => { closeSheet(); onPick('auto'); }}>
      <span class="n">${t('Detectar idioma')}</span><span class="l">${t('automático')}</span>
      ${value === 'auto' ? html`<${Icon} name="check" size=${20} />` : null}
    </button>` : null}
    ${list.map((l) => html`<button class=${`lang-item ${l.id === value ? 'on' : ''}`} key=${l.id}
      onClick=${() => { closeSheet(); onPick(l.id); }}>
      <span class="n">${l.name}</span>
      ${l.local !== l.name ? html`<span class="l">${l.local}</span>` : null}
      ${l.id === value ? html`<${Icon} name="check" size=${20} />` : null}
    </button>`)}
  </${Sheet}>`;
}

export function langLabel(id) {
  if (id === 'auto') return t('Detectar idioma');
  const l = langInfo(id);
  const local = localName(id, uiLangId());
  return local && local !== l.name ? local : l.name;
}

// ---------- código QR ----------
export function QrCode({ text }) {
  const q = useMemo(() => qrPath(text), [text]);
  const m = 2;
  return html`<svg viewBox=${`${-m} ${-m} ${q.size + 2 * m} ${q.size + 2 * m}`} shape-rendering="crispEdges" role="img" aria-label="QR">
    <rect x=${-m} y=${-m} width=${q.size + 2 * m} height=${q.size + 2 * m} fill="#fff" />
    <path d=${q.path} fill="#0c0c10" />
  </svg>`;
}

// ---------- cámara ----------
export function CameraView({ facing = 'environment', onVideo, mirror = false, children, style = '' }) {
  const ref = useRef(null);
  const [err, setErr] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stream = null;
    let cancelled = false;
    setErr(null);
    startCamera(ref.current, facing).then((s) => {
      if (cancelled) { stopCamera(s); return; }
      stream = s;
      if (onVideo) onVideo(ref.current);
    }).catch((e) => { if (!cancelled) setErr(e.code || 'error'); });
    return () => {
      cancelled = true;
      stopCamera(stream);
      if (onVideo) onVideo(null);
    };
  }, [facing, attempt]);
  return html`<div class="cam" style=${style}>
    <video ref=${ref} playsinline muted autoplay style=${mirror ? 'transform:scaleX(-1)' : ''}></video>
    ${err ? null : children}
    ${err ? html`<div class="cam-msg">
      <${Icon} name="camera" size=${34} />
      <div>${err === 'permission' ? t('Necesitamos permiso para usar la cámara.') : t('No se pudo abrir la cámara.')}</div>
      <div class="btn-row" style="width:auto">
        ${err === 'permission' && isApp ? html`<button class="btn small" onClick=${openAppSettings}>${t('Abrir ajustes')}</button>` : null}
        <button class="btn small ghost" onClick=${() => setAttempt(attempt + 1)}>${t('Reintentar')}</button>
      </div>
    </div>` : null}
  </div>`;
}

// ---------- foto de perfil ----------
export function PhotoSheet({ onPick, hasPhoto }) {
  const [mode, setMode] = useState('choose');
  const videoRef = useRef(null);
  const fileRef = useRef(null);

  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const p = await photoFromFile(f);
      closeSheet();
      onPick(p);
    } catch {
      toast(t('No se pudo abrir la imagen.'), 'error');
    }
  };

  if (mode === 'camera') {
    return html`<${Sheet} title=${t('Hacer foto')} full>
      <div style="border-radius:50%;overflow:hidden;aspect-ratio:1;width:min(78vw,320px);margin:10px auto 26px">
        <${CameraView} facing="user" mirror style="width:100%;height:100%" onVideo=${(v) => { videoRef.current = v; }} />
      </div>
      <div style="display:flex;justify-content:center">
        <button class="shutter" style="box-shadow:0 0 0 5px var(--accent-soft-2);background:var(--accent)" aria-label=${t('Hacer foto')}
          onClick=${() => {
            const v = videoRef.current;
            if (!v || !v.videoWidth) return;
            const p = photoFromVideo(v, true);
            closeSheet();
            onPick(p);
          }}></button>
      </div>
    </${Sheet}>`;
  }

  return html`<${Sheet} title=${t('Foto de perfil')}>
    <div class="group menu-list">
      <button class="row" onClick=${() => setMode('camera')}><span class="ic"><${Icon} name="camera" /></span><span class="txt t1">${t('Hacer foto')}</span></button>
      <button class="row" onClick=${() => fileRef.current && fileRef.current.click()}><span class="ic"><${Icon} name="image" /></span><span class="txt t1">${t('Elegir de la galería')}</span></button>
      ${hasPhoto ? html`<button class="row danger" onClick=${() => { closeSheet(); onPick({ photo: '', photoSmall: '' }); }}><span class="ic"><${Icon} name="trash" /></span><span class="txt t1">${t('Quitar foto')}</span></button>` : null}
    </div>
    <input ref=${fileRef} type="file" accept="image/*" class="visually-hidden" onChange=${onFile} />
  </${Sheet}>`;
}

export function Spinner({ size = 22 }) {
  return html`<span class="spinner" style=${`width:${size}px;height:${size}px`}></span>`;
}

// ---------- traducción en el móvil ----------
/** Nombre de un idioma del traductor del móvil (p. ej. "it" → "Italiano"). */
export function trLangName(code) {
  try {
    const dn = new Intl.DisplayNames([langInfo(uiLangId()).bcp], { type: 'language' });
    const n = dn.of(code);
    if (n && n !== code) return n.charAt(0).toLocaleUpperCase() + n.slice(1);
  } catch { /* */ }
  const l = LANGS.find((x) => mlCode(x.tr) === code);
  return l ? langLabel(l.id) : code;
}

export function useModels() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    if (!hasLocalTr()) return undefined;
    const off = onModels(() => force());
    refreshModels();
    return off;
  }, []);
  return modelsState();
}

const dismissedTr = new Set();

/** Aviso para descargar los idiomas que faltan y que la traducción salga al momento. */
export function LocalTrBanner({ langs }) {
  const st = useModels();
  const [, force] = useReducer((x) => x + 1, 0);
  if (!hasLocalTr() || !st.ready) return null;
  const trs = [...new Set(langs.filter(Boolean).map((id) => mlCode(trCode(id))))];
  // Si todos hablan el mismo idioma no hace falta traducir
  if (trs.length < 2) return null;
  const miss = missingFor(trs);
  const key = miss.join(',');
  if (!miss.length || dismissedTr.has(key)) return null;
  const busy = miss.filter((c) => st.downloading.has(c));
  if (busy.length === miss.length) {
    return html`<div class="banner accent tr-banner">
      <${Spinner} size=${18} />
      <span class="grow">${t('Descargando {langs} para traducir al momento…', { langs: miss.map(trLangName).join(', ') })}</span>
    </div>`;
  }
  return html`<div class="banner accent tr-banner">
    <${Icon} name="bolt" size=${20} />
    <span class="grow">${t('Descarga {langs} (unos {mb} MB) y la traducción saldrá al momento, también sin internet.', { langs: miss.map(trLangName).join(', '), mb: miss.length * 30 })}</span>
    <button class="btn small" onClick=${() => { for (const c of miss) downloadModel(c, false); }}>${t('Descargar')}</button>
    <button class="icon-btn" aria-label=${t('Cerrar')} onClick=${() => { dismissedTr.add(key); force(); }}><${Icon} name="x" size=${18} /></button>
  </div>`;
}
