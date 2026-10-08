// Estado global sencillo con suscripción y guardado en el dispositivo.
import { guessLang } from './langs.js';

const KEY_PROFILE = 'parla.profile';
const KEY_SETTINGS = 'parla.settings';

export const ACCENTS = {
  indigo: { name: 'Índigo', light: '#4F46E5', dark: '#8B85FF' },
  blue: { name: 'Azul', light: '#1F6FEB', dark: '#5EA1FF' },
  teal: { name: 'Verde azulado', light: '#0E8A7E', dark: '#3CCFBE' },
  coral: { name: 'Coral', light: '#E5482E', dark: '#FF7A62' },
  pink: { name: 'Rosa', light: '#D12D78', dark: '#FF6FAE' },
  graphite: { name: 'Grafito', light: '#18181B', dark: '#F4F4F5' },
};

export const DEFAULT_SETTINGS = {
  theme: 'system', // system | light | dark
  accent: 'indigo',
  output: 'text', // text | voice | both
  autoSend: 'instant', // review | 3s | instant
  rate: 1.0,
  readFrom: '', // vacío: detectar (app) o inglés (web)
  hotspot: { ssid: '', pass: '' },
  subSize: 26,
  v: 3,
  voices: true,
};

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

function save(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* lleno o bloqueado */ }
}

export function randomId(bytes = 8) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

// v2: por defecto los mensajes llegan solo como texto
function migrateSettings(s) {
  if (!s.v || s.v < 2) {
    s.output = 'text';
    s.v = 2;
    save(KEY_SETTINGS, s);
  }
  // v3: el mensaje se envía en cuanto terminas de hablar (antes esperaba 3 s)
  if (s.v < 3) {
    if (s.autoSend === '3s') s.autoSend = 'instant';
    if (s.readFrom === 'en') s.readFrom = '';
    s.v = 3;
    save(KEY_SETTINGS, s);
  }
  return s;
}

const listeners = new Set();

export const store = {
  profile: load(KEY_PROFILE, null),
  settings: migrateSettings({ ...DEFAULT_SETTINGS, ...load(KEY_SETTINGS, {}) }),
  stack: [{ name: 'home', key: 'home' }],
  sheet: null, // { name, params }
  dialog: null, // { title, text, actions }
  toasts: [],
  systemDark: false,
  i18nTick: 0,
  pendingJoin: null,
  pendingTransfer: null,
};

export function emit() {
  for (const l of listeners) {
    try { l(store); } catch (e) { console.error(e); }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setProfile(patch) {
  store.profile = { ...(store.profile || {}), ...patch };
  save(KEY_PROFILE, store.profile);
  emit();
}

export function createProfile({ name, lang, photo, photoSmall }) {
  store.profile = {
    uid: randomId(8),
    name: name.trim(),
    lang: lang || guessLang(),
    photo: photo || '',
    photoSmall: photoSmall || '',
    account: null,
    created: Date.now(),
  };
  save(KEY_PROFILE, store.profile);
  emit();
}

export function replaceProfile(p) {
  store.profile = p;
  save(KEY_PROFILE, p);
  emit();
}

export function setSettings(patch) {
  store.settings = { ...store.settings, ...patch };
  save(KEY_SETTINGS, store.settings);
  emit();
}

export function replaceSettings(s) {
  store.settings = { ...DEFAULT_SETTINGS, ...s };
  save(KEY_SETTINGS, store.settings);
  emit();
}

// ---------- navegación ----------
let navSeq = 0;
export const navHooks = { onPush: null };

export function navigate(name, params = {}) {
  store.stack = [...store.stack, { name, params, key: `${name}-${++navSeq}` }];
  store.sheet = null;
  if (navHooks.onPush) navHooks.onPush();
  emit();
}

export function replaceTop(name, params = {}) {
  const s = store.stack.slice(0, -1);
  store.stack = [...s, { name, params, key: `${name}-${++navSeq}` }];
  emit();
}

export function goHome() {
  store.stack = [{ name: 'home', key: 'home' }];
  store.sheet = null;
  emit();
}

export function popScreen() {
  if (store.stack.length > 1) {
    store.stack = store.stack.slice(0, -1);
    emit();
    return true;
  }
  return false;
}

export function currentScreen() {
  return store.stack[store.stack.length - 1];
}

export function openSheet(name, params = {}) {
  store.sheet = { name, params };
  emit();
}

export function closeSheet() {
  if (!store.sheet) return false;
  store.sheet = null;
  emit();
  return true;
}

// ---------- avisos ----------
let toastSeq = 0;
export function toast(text, kind = 'info', ms = 2600) {
  const id = ++toastSeq;
  store.toasts = [...store.toasts, { id, text, kind }];
  emit();
  setTimeout(() => {
    store.toasts = store.toasts.filter((t) => t.id !== id);
    emit();
  }, ms);
}

// ---------- diálogos ----------
export function confirmDialog({ title, text, ok, cancel, danger = false }) {
  return new Promise((resolve) => {
    store.dialog = {
      title,
      text,
      actions: [
        { label: cancel, value: false },
        { label: ok, value: true, primary: true, danger },
      ],
      resolve: (v) => {
        store.dialog = null;
        emit();
        resolve(v);
      },
    };
    emit();
  });
}

export function choiceDialog({ title, text, actions }) {
  return new Promise((resolve) => {
    store.dialog = {
      title,
      text,
      actions,
      resolve: (v) => {
        store.dialog = null;
        emit();
        resolve(v);
      },
    };
    emit();
  });
}
