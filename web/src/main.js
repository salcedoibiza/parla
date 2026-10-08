import './styles.css';
import { render } from 'preact';
import { html } from './ui/h.js';
import { App, applyTheme, handleBack } from './ui/app.js';
import { store, emit, navHooks, subscribe } from './core/store.js';
import { isApp, onNative, initialLink, systemDark, onSystemThemeChange, nativeInfo } from './core/native.js';
import { normalizeCode } from './core/crypto.js';
import { log } from './core/log.js';
import { APP_VERSION } from './core/config.js';
import { hasLocalTr, ensureOwnModels, refreshModels } from './core/localtr.js';
import { trCode } from './core/langs.js';

log('start', APP_VERSION, isApp ? 'app' : 'web', isApp ? JSON.stringify(nativeInfo()) : navigator.userAgent);

store.systemDark = systemDark();
onSystemThemeChange((d) => {
  store.systemDark = d;
  emit();
});

function handleLink(url) {
  if (!url) return;
  const s = String(url);
  const tx = s.match(/(?:[#?&]x=|parla:\/\/x\/)([A-Za-z0-9-]+)/i);
  if (tx) {
    const c = normalizeCode(tx[1]);
    if (c) { store.pendingTransfer = c; emit(); }
    return;
  }
  const c = normalizeCode(s);
  if (c) {
    store.pendingJoin = c;
    emit();
  }
}

// Enlaces de invitación
if (isApp) {
  handleLink(initialLink());
  onNative((ev) => { if (ev.type === 'link') handleLink(ev.url); });
} else if (location.hash) {
  handleLink(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
}

// Botón atrás
window.__parlaBack = handleBack;
if (!isApp) {
  history.pushState({ parla: 1 }, '');
  window.addEventListener('popstate', () => {
    if (handleBack()) history.pushState({ parla: 1 }, '');
  });
  navHooks.onPush = null;
}

applyTheme();
render(html`<${App} />`, document.getElementById('app'));

// Quitar la pantalla de carga
const splash = document.getElementById('splash');
if (splash) splash.remove();

// Traducción en el móvil: tu idioma y el inglés se descargan solos (solo con wifi)
if (hasLocalTr()) {
  refreshModels();
  let ownLang = null;
  const check = () => {
    const l = store.profile && store.profile.lang;
    if (!l || l === ownLang) return;
    ownLang = l;
    setTimeout(() => ensureOwnModels(trCode(l)), 1500);
  };
  subscribe(check);
  check();
}
