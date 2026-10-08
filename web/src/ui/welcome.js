import { useState } from 'preact/hooks';
import { html } from './h.js';
import { Icon, Logo } from './icons.js';
import { store, createProfile, openSheet } from '../core/store.js';
import { t } from '../core/i18n.js';
import { guessLang } from '../core/langs.js';
import { langLabel } from './common.js';

export function Welcome() {
  const [name, setName] = useState('');
  const [lang, setLang] = useState(guessLang());
  const [photo, setPhoto] = useState({ photo: '', photoSmall: '' });
  const invited = !!store.pendingJoin;

  const start = () => {
    if (!name.trim()) return;
    createProfile({ name, lang, photo: photo.photo, photoSmall: photo.photoSmall });
  };

  return html`<div class="screen root tinted">
    <div class="body">
      <div class="welcome">
        <div class="logo-row"><${Logo} size=${38} /><span class="wordmark">parla</span></div>
        <h1>${t('Cada uno en su móvil.')}<br /><em>${t('Cada uno en su idioma.')}</em></h1>
        <p class="lead">${invited ? t('Te han invitado a una conversación. Crea tu perfil para unirte.') : t('Crea tu perfil en unos segundos. No hace falta registrarse.')}</p>

        <div class="welcome-card">
        <button class="photo-pick" style="text-align:left" onClick=${() => openSheet('photo', { onPick: setPhoto, hasPhoto: !!photo.photo })}>
          <span class="ph">
            ${photo.photo ? html`<img src=${photo.photo} alt="" />` : html`<${Icon} name="camera" size=${30} />`}
            <span class="plus"><${Icon} name=${photo.photo ? 'edit' : 'plus'} size=${14} stroke=${2.6} /></span>
          </span>
          <span class="t">${photo.photo ? t('Cambiar foto') : t('Añade una foto (opcional)')}</span>
        </button>

        <label class="field">
          <span>${t('Tu nombre')}</span>
          <input class="input" value=${name} maxlength="40" placeholder=${t('Cómo quieres que te vean')}
            onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') start(); }} autocomplete="name" />
        </label>

        <div class="field">
          <span>${t('Idioma en el que hablas')}</span>
          <button class="select-row" onClick=${() => openSheet('lang', { value: lang, onPick: setLang, title: t('Idioma en el que hablas') })}>
            <${Icon} name="globe" size=${20} />
            <span class="v">${langLabel(lang)}</span>
            <${Icon} name="down" size=${20} />
          </button>
        </div>
        </div>

        <div class="grow"></div>
        <button class="btn block" disabled=${!name.trim()} onClick=${start}>${invited ? t('Unirme') : t('Empezar')}</button>
        <div class="btn-row" style="margin-top:6px">
          <button class="btn link" onClick=${() => openSheet('account')}><${Icon} name="mail" size=${18} />${t('Crear cuenta con correo')}</button>
        </div>
        <div class="fine">${t('Tus datos se quedan en este móvil.')}</div>
      </div>
    </div>
  </div>`;
}
