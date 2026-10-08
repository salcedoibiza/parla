// Puente con la app Android (si existe). En la web todo tiene alternativa.
import { log } from './log.js';

const N = typeof window !== 'undefined' ? window.ParlaNative : null;
export const isApp = !!N;

const listeners = new Set();
if (typeof window !== 'undefined') {
  window.__parlaNative = (ev) => {
    for (const l of listeners) {
      try { l(ev); } catch (e) { log('native listener error', e); }
    }
  };
}

export function onNative(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function nativeInfo() {
  if (!N) return null;
  try { return JSON.parse(N.info()); } catch { return null; }
}

export function initialLink() {
  if (!N) return '';
  try { return N.getInitialLink() || ''; } catch { return ''; }
}

export const native = N;

export function share(text, title = '') {
  if (N) { N.share(text, title); return Promise.resolve(true); }
  if (navigator.share) {
    return navigator.share({ text, title: title || undefined }).then(() => true).catch(() => false);
  }
  return copy(text);
}

export async function copy(text) {
  if (N) { N.copy(text); return true; }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch { return false; }
  }
}

let wakeLock = null;
export async function keepAwake(on) {
  if (N) { N.keepAwake(!!on); return; }
  try {
    if (on && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* no disponible */ }
}

export function setSystemBars(color, darkIcons) {
  if (N) { try { N.setSystemBars(color, !!darkIcons); } catch { /* */ } }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);
}

export function vibrate(ms = 20) {
  if (N) { try { N.vibrate(ms); } catch { /* */ } return; }
  try { navigator.vibrate && navigator.vibrate(ms); } catch { /* */ }
}

export function openUrl(url) {
  if (N) { N.openUrl(url); return; }
  window.open(url, '_blank', 'noopener');
}

export function openHotspotSettings() {
  if (N) N.openHotspotSettings();
}

export function openAppSettings() {
  if (N) N.openAppSettings();
}

export function openVoiceSettings() {
  if (N) N.openVoiceSettings();
}

export function systemDark() {
  if (N) { try { return !!N.isSystemDark(); } catch { /* */ } }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function onSystemThemeChange(fn) {
  const off1 = onNative((ev) => { if (ev.type === 'uimode') fn(!!ev.dark); });
  let mq = null;
  const h = (e) => fn(e.matches);
  if (!N && window.matchMedia) {
    mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener ? mq.addEventListener('change', h) : mq.addListener(h);
  }
  return () => {
    off1();
    if (mq) mq.removeEventListener ? mq.removeEventListener('change', h) : mq.removeListener(h);
  };
}

// Permiso de micrófono (solo app; en la web lo gestiona el navegador)
export function ensureMicPermission() {
  if (!N) return Promise.resolve(true);
  if (N.hasMicPermission()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const off = onNative((ev) => {
      if (ev.type === 'perm' && ev.perm === 'mic') { off(); resolve(!!ev.granted); }
    });
    N.requestMicPermission();
    setTimeout(() => { off(); resolve(N.hasMicPermission()); }, 60000);
  });
}
