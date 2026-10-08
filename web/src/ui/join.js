import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from './h.js';
import { Icon } from './icons.js';
import { store, toast, replaceTop, popScreen } from '../core/store.js';
import { t } from '../core/i18n.js';
import { Topbar, CameraView, Spinner } from './common.js';
import { normalizeCode, formatCode, ALPHABET } from '../core/crypto.js';
import { scanVideo, scanImageFile } from '../core/qr.js';
import { Session } from '../core/session.js';
import { vibrate, isApp } from '../core/native.js';
import { log } from '../core/log.js';
import { showConnectError } from './home.js';

export function joinErrorText(code) {
  switch (code) {
    case 'notfound': return t('No encontramos esa sesión. Comprueba el código.');
    case 'ended': return t('Esa sesión ya ha terminado.');
    case 'full': return t('La conversación está completa (máximo 6 personas).');
    case 'badcode': return t('El código no es válido.');
    default: return t('No se pudo conectar. Comprueba tu conexión a internet.');
  }
}

export async function joinWithCode(raw, { replace = true } = {}) {
  const s = await Session.join(store.profile, raw);
  const name = s.mode === 'conv' ? 'conv' : 'talk';
  if (replace) replaceTop(name, { session: s });
  return s;
}

function formatInput(v) {
  const clean = v.toUpperCase().replace(/[^A-Z0-9]/g, '').split('').filter((c) => ALPHABET.includes(c)).join('').slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

export function JoinScreen({ params }) {
  const [code, setCode] = useState(params && params.code ? formatCode(normalizeCode(params.code)) : '');
  // Si llega por enlace no hace falta abrir la cámara, salvo que falle
  const [viaLink, setViaLink] = useState(!!(params && params.code));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const lastScan = useRef('');
  const stopScan = useRef(null);
  const fileRef = useRef(null);

  const doJoin = async (raw) => {
    if (busyRef.current) return;
    const text = String(raw || '').trim();
    if (/^WIFI:/i.test(text)) {
      toast(t('Es un código de wifi. Escanéalo con la cámara de tu móvil para conectarte.'), 'info', 4000);
      return;
    }
    if (/[#?&]x=|parla:\/\/x\//i.test(text)) {
      replaceTop('account', { receive: normalizeCode(text.replace(/.*(?:[#?&]x=|parla:\/\/x\/)/i, '')) });
      return;
    }
    const c = normalizeCode(text);
    if (!c) { toast(t('El código no es válido.'), 'error'); return; }
    busyRef.current = true;
    setBusy(true);
    setCode(formatCode(c));
    try {
      await joinWithCode(c);
    } catch (e) {
      log('join failed', e && (e.code || e.message), e && e.message);
      if (e && e.code === 'connect') showConnectError();
      else toast(joinErrorText(e && e.code), 'error', 4000);
      lastScan.current = '';
    } finally {
      busyRef.current = false;
      setBusy(false);
      setViaLink(false);
    }
  };

  useEffect(() => {
    if (params && params.code) doJoin(params.code);
  }, []);

  const onVideo = (video) => {
    if (stopScan.current) { stopScan.current(); stopScan.current = null; }
    if (!video) return;
    stopScan.current = scanVideo(video, (txt) => {
      if (busyRef.current || txt === lastScan.current) return;
      lastScan.current = txt;
      vibrate(25);
      doJoin(txt);
    });
  };
  useEffect(() => () => { if (stopScan.current) stopScan.current(); }, []);

  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const txt = await scanImageFile(f).catch(() => null);
    if (txt) doJoin(txt); else toast(t('No se encontró ningún código QR en la imagen.'), 'error');
  };

  return html`<div class="screen">
    <${Topbar} onBack=${popScreen} title=${t('Unirse')} />
    <div class="body">
      <div class="pad">
        ${viaLink ? html`<div class="empty-invite" style="margin:10px 0 18px">
          <span class="ic-big"><${Spinner} size=${28} /></span>
          <h3>${t('Conectando…')}</h3>
          <p>${t('Entrando en la sesión {code}', { code })}</p>
          ${!isApp && /Android/i.test(navigator.userAgent) ? html`<a class="btn link" href=${`intent://j/${code.replace('-', '')}#Intent;scheme=parla;package=app.parla.talk;end`}>${t('¿Tienes la app? Ábrela aquí')}</a>` : null}
        </div>` : html`<div class="scan-wrap">
          <${CameraView} facing="environment" onVideo=${onVideo} style="width:100%;height:100%">
            <div class="frame"></div>
            ${busy ? html`<div class="busy-overlay"><${Spinner} size=${30} />${t('Conectando…')}</div>` : null}
          </${CameraView}>
        </div>`}
        <p class="center-note" style="margin-top:-4px">${t('Apunta al código QR de la otra persona.')}
          <button class="btn link" style="height:auto;padding:0 4px;display:inline" onClick=${() => fileRef.current && fileRef.current.click()}>${t('Usar una imagen')}</button>
        </p>
        <input ref=${fileRef} type="file" accept="image/*" class="visually-hidden" onChange=${onFile} />
        <div class="or">${t('o escribe el código')}</div>
        <input class="input code" value=${code} placeholder="XXXX-XXXX" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false"
          onInput=${(e) => setCode(formatInput(e.target.value))}
          onKeyDown=${(e) => { if (e.key === 'Enter') doJoin(code); }} />
        <button class="btn block" style="margin-top:14px" disabled=${busy || code.replace('-', '').length !== 8} onClick=${() => doJoin(code)}>
          ${busy ? html`<${Spinner} />` : null}${t('Unirme')}
        </button>
      </div>
    </div>
  </div>`;
}
