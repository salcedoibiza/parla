import { useState } from 'preact/hooks';
import { html } from './h.js';
import { Icon } from './icons.js';
import { store, navigate, openSheet, closeSheet, setSettings, toast, choiceDialog } from '../core/store.js';
import { diagText } from '../core/diag.js';
import { share } from '../core/native.js';
import { t } from '../core/i18n.js';
import { Avatar, Sheet, Seg, langLabel, useStore, Spinner } from './common.js';
import { isApp, openUrl } from '../core/native.js';
import { APK_URL, APP_VERSION } from '../core/config.js';
import { Session } from '../core/session.js';
import { log } from '../core/log.js';

export function Home() {
  const s = useStore();
  const p = s.profile;
  const first = (p.name || '').split(/\s+/)[0];
  const mode = (cls, icon, title, onClick) => html`<button class=${`mode ${cls}`} onClick=${onClick}>
    <span class="mi"><${Icon} name=${icon} size=${26} stroke=${2} /></span>
    <span class="mt"><h3>${title}</h3></span>
    <span class="go"><${Icon} name="chevron" size=${18} stroke=${2.2} /></span>
  </button>`;
  return html`<div class="screen root tinted">
    <div class="home-head">
      <button class="me" onClick=${() => navigate('settings')} aria-label=${t('Ajustes de perfil')}>
        <${Avatar} name=${p.name} photo=${p.photo} size=${46} seed=${p.uid} />
        <span class="who">
          <div class="name">${p.name}</div>
          <div class="lang"><${Icon} name="globe" size=${14} stroke=${2} />${langLabel(p.lang)}</div>
        </span>
      </button>
      <button class="icon-btn soft" onClick=${() => openSheet('menu')} aria-label=${t('Menú')}><${Icon} name="menu" /></button>
    </div>
    <div class="body">
      <div class="home-hero">
        <h2>${t('Hola, {name}', { name: first })}</h2>
        <p>${t('¿Qué quieres hacer?')}</p>
      </div>
      <div class="modes">
        ${mode('m-conv', 'chat', t('Modo conversación'), () => openSheet('new-conv'))}
        ${mode('m-talk', 'megaphone', t('Modo discurso'), () => openSheet('new-talk'))}
        ${mode('m-listen', 'wave', t('Modo escucha'), () => navigate('listen'))}
        ${mode('m-read', 'read', t('Modo lectura'), () => navigate('read'))}
        ${mode('m-join', 'qr', t('Unirse'), () => navigate('join'))}
      </div>
      ${!isApp && APK_URL ? html`<div class="web-banner">
        <${Icon} name="phone" size=${26} />
        <div class="grow"><b>${t('Descarga la app')}</b>${t('Funciona mejor y sin conexión.')}</div>
        <button class="btn small" onClick=${() => openUrl(APK_URL)}>${t('Descargar')}</button>
      </div>` : null}
      <div class="home-foot">${t('Versión de prueba')} ${APP_VERSION}</div>
    </div>
  </div>`;
}

export function MenuDrawer() {
  const s = useStore();
  const p = s.profile;
  const go = (name) => { closeSheet(); navigate(name); };
  const item = (icon, label, name, sub) => html`<button class="row" onClick=${() => go(name)}>
    <span class="ic"><${Icon} name=${icon} /></span>
    <span class="txt"><div class="t1">${label}</div>${sub ? html`<div class="t2">${sub}</div>` : null}</span>
    <span class="end"><${Icon} name="chevron" size=${18} /></span>
  </button>`;
  return html`<div>
    <div class="backdrop" onClick=${closeSheet}></div>
    <div class="drawer">
      <div style="display:flex;align-items:center;gap:12px;padding:6px 6px 14px 10px">
        <${Avatar} name=${p.name} photo=${p.photo} size=${44} seed=${p.uid} />
        <div style="flex:1;min-width:0">
          <div style="font-weight:650;font-size:17px">${p.name}</div>
          <div style="font-size:13.5px;color:var(--text-2)">${p.account ? p.account.email : t('Invitado')}</div>
        </div>
        <button class="icon-btn" onClick=${closeSheet} aria-label=${t('Cerrar')}><${Icon} name="x" /></button>
      </div>
      <div class="menu-list" style="flex:1;overflow-y:auto">
        ${item('history', t('Historial'), 'history')}
        ${item('download', t('Idiomas sin conexión'), 'offline')}
        ${item('wifi', t('Compartir internet'), 'hotspot')}
        ${item('sliders', t('Ajustes'), 'settings', t('Perfil, idioma, colores'))}
        ${item('phone', t('Cuenta y dispositivos'), 'account')}
        ${item('info', t('Acerca de Parla'), 'about')}
      </div>
      <div style="padding:10px 6px 0">
        <${Seg} value=${s.settings.theme} onChange=${(v) => setSettings({ theme: v })} options=${[
          { value: 'light', icon: 'sun', label: '' },
          { value: 'system', label: t('Auto') },
          { value: 'dark', icon: 'moon', label: '' },
        ]} />
      </div>
    </div>
  </div>`;
}

async function createSession(mode, opts, setBusy) {
  setBusy(true);
  try {
    const sess = await Session.create(store.profile, { mode, ...opts });
    closeSheet();
    navigate(mode === 'conv' ? 'conv' : 'talk', { session: sess, fresh: true });
  } catch (e) {
    log('create failed', e && (e.code || e.message), e && e.message);
    showConnectError();
  } finally {
    setBusy(false);
  }
}

export async function showConnectError() {
  const v = await choiceDialog({
    title: t('No se pudo conectar'),
    text: t('Comprueba que tienes internet (wifi o datos) y vuelve a intentarlo. Si sigue fallando, envíame el diagnóstico para ver qué pasa.'),
    actions: [
      { label: t('Cerrar'), value: false },
      { label: t('Enviar diagnóstico'), value: true, primary: true },
    ],
  });
  if (v) share(diagText(), 'Parla diagnóstico');
}

export function NewConvSheet() {
  const [place, setPlace] = useState('inperson');
  const [busy, setBusy] = useState(false);
  return html`<${Sheet} title=${t('Modo conversación')}>
    <p class="explain">${t('Para hablar entre varias personas, cada una con su móvil (hasta 6). Tú hablas o escribes en tu idioma y a cada uno le llega en el suyo. Mientras uno habla, los demás esperan su turno y ven en directo lo que se está diciendo.')}</p>
    <div class="field">
      <span>${t('¿Dónde estáis?')}</span>
      <${Seg} value=${place} onChange=${setPlace} options=${[
        { value: 'inperson', label: t('En el mismo sitio') },
        { value: 'remote', label: t('A distancia') },
      ]} />
    </div>
    <div class="info-card">
      ${place === 'inperson'
        ? t('Los mensajes llegarán como texto para evitar que los móviles se oigan entre sí. Cada uno puede activar la voz cuando quiera.')
        : t('Cada uno recibe los mensajes como prefiera: texto, voz o las dos cosas.')}
    </div>
    <button class="btn block" disabled=${busy} onClick=${() => createSession('conv', { place }, setBusy)}>
      ${busy ? html`<${Spinner} />` : null}${busy ? t('Conectando…') : t('Crear conversación')}
    </button>
  </${Sheet}>`;
}

export function NewTalkSheet() {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  return html`<${Sheet} title=${t('Modo discurso')}>
    <p class="explain">${t('Para guías, profesores o cualquier charla: tú hablas y hasta 200 personas te escuchan, cada una en su idioma y en su móvil. Si alguien quiere intervenir, te envía una solicitud y tú decides si le das la palabra.')}</p>
    <label class="field">
      <span>${t('Nombre de la sesión (opcional)')}</span>
      <input class="input" value=${title} maxlength="80" placeholder=${t('Ej.: Visita al casco antiguo')} onInput=${(e) => setTitle(e.target.value)} />
    </label>
    <button class="btn block" disabled=${busy} onClick=${() => createSession('talk', { title, place: 'remote' }, setBusy)}>
      ${busy ? html`<${Spinner} />` : null}${busy ? t('Conectando…') : t('Empezar')}
    </button>
  </${Sheet}>`;
}
