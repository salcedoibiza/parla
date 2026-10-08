import { useEffect } from 'preact/hooks';
import { html } from './h.js';
import {
  store, emit, ACCENTS, currentScreen, navigate, closeSheet, popScreen, openSheet,
} from '../core/store.js';
import { uiLangId } from '../core/i18n.js';
import { isRtl, lang as langInfo } from '../core/langs.js';
import { setSystemBars } from '../core/native.js';
import { useStore, Toasts, DialogView, LangSheet, PhotoSheet, runBackGuard } from './common.js';
import { Welcome } from './welcome.js';
import { Home, MenuDrawer, NewConvSheet, NewTalkSheet } from './home.js';
import { ConversationScreen } from './conversation.js';
import { TalkScreen, HandsSheet } from './talk.js';
import { JoinScreen } from './join.js';
import { ReadScreen } from './read.js';
import { ListenScreen } from './listen.js';
import { HistoryScreen, HistoryDetailScreen } from './history.js';
import {
  SettingsScreen, OfflineScreen, HotspotScreen, AccountScreen, AboutScreen, AccountInfoSheet, ReceiveSheet,
} from './settings.js';
import { InviteSheet, ParticipantsSheet, OutputSheet } from './session-ui.js';

const SCREENS = {
  home: Home,
  conv: ConversationScreen,
  talk: TalkScreen,
  join: JoinScreen,
  read: ReadScreen,
  listen: ListenScreen,
  history: HistoryScreen,
  historyDetail: HistoryDetailScreen,
  settings: SettingsScreen,
  offline: OfflineScreen,
  hotspot: HotspotScreen,
  account: AccountScreen,
  about: AboutScreen,
};

const SHEETS = {
  menu: MenuDrawer,
  lang: LangSheet,
  photo: PhotoSheet,
  'new-conv': NewConvSheet,
  'new-talk': NewTalkSheet,
  invite: InviteSheet,
  participants: ParticipantsSheet,
  output: OutputSheet,
  hands: HandsSheet,
  account: AccountInfoSheet,
  receive: ReceiveSheet,
};

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance([r, g, b]) {
  const f = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hsl(h, s, l) {
  return `hsl(${Math.round(((h % 360) + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

export function applyTheme() {
  const st = store.settings;
  const dark = st.theme === 'dark' || (st.theme === 'system' && store.systemDark);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  const a = ACCENTS[st.accent] || ACCENTS.indigo;
  const c = dark ? a.dark : a.light;
  const rgb = hexToRgb(c);
  root.style.setProperty('--accent', c);
  // Texto sobre el color de acento: el que más contraste tenga
  const L = luminance(rgb);
  const cWhite = 1.05 / (L + 0.05);
  const cBlack = (L + 0.05) / (luminance([12, 12, 16]) + 0.05);
  root.style.setProperty('--accent-ink', cBlack > cWhite ? '#0c0c10' : '#ffffff');
  root.style.setProperty('--accent-soft', `rgba(${rgb.join(',')},${dark ? 0.16 : 0.1})`);
  root.style.setProperty('--accent-soft-2', `rgba(${rgb.join(',')},${dark ? 0.28 : 0.2})`);
  root.style.setProperty('--accent-glow', `rgba(${rgb.join(',')},${dark ? 0.45 : 0.38})`);
  // Segundo tono para los degradados: un poco más claro y desplazado de matiz
  const [h, s, l] = rgbToHsl(rgb);
  const second = s < 0.12 ? hsl(h, s, Math.min(0.92, l + (l > 0.5 ? -0.12 : 0.14))) : hsl(h + 22, Math.min(1, s * 1.02), Math.min(0.78, l + 0.08));
  root.style.setProperty('--accent-2', second);
  const ui = uiLangId();
  root.lang = langInfo(ui).bcp;
  root.dir = isRtl(ui) ? 'rtl' : 'ltr';
  setSystemBars(dark ? '#0B0B0F' : '#FFFFFF', !dark);
}

export function handleBack() {
  if (store.dialog) { store.dialog.resolve(false); return true; }
  if (store.sheet) { closeSheet(); return true; }
  if (runBackGuard()) return true;
  return popScreen();
}

export function App() {
  const s = useStore();
  useEffect(applyTheme, [s.settings.theme, s.settings.accent, s.systemDark, s.profile && s.profile.lang]);

  // Invitación abierta antes de tener perfil
  useEffect(() => {
    if (s.profile && s.pendingJoin) {
      const code = s.pendingJoin;
      store.pendingJoin = null;
      navigate('join', { code });
    }
    if (s.profile && s.pendingTransfer) {
      const code = s.pendingTransfer;
      store.pendingTransfer = null;
      navigate('account', { receive: code });
    }
    if (!s.profile && s.pendingTransfer) {
      store.pendingTransfer = null;
      openSheet('receive');
    }
  }, [s.profile, s.pendingJoin, s.pendingTransfer]);

  const sheet = s.sheet ? SHEETS[s.sheet.name] : null;
  let content;
  if (!s.profile) {
    content = html`<${Welcome} />`;
  } else {
    const top = currentScreen();
    const Screen = SCREENS[top.name] || Home;
    content = html`<${Screen} key=${top.key} params=${top.params || {}} />`;
  }
  return html`<div class="app-root">
    <div class="app-frame">
      ${content}
      ${sheet ? html`<${sheet} ...${s.sheet.params} />` : null}
      <${DialogView} />
      <${Toasts} />
    </div>
  </div>`;
}

export { emit };
