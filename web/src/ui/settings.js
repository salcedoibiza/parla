import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from './h.js';
import { Icon, Logo } from './icons.js';
import {
  store, setProfile, setSettings, openSheet, popScreen, navigate, toast, ACCENTS, replaceProfile, replaceSettings, closeSheet,
} from '../core/store.js';
import { t } from '../core/i18n.js';
import { Avatar, Topbar, Seg, Sheet, useStore, langLabel, QrCode, CameraView, Spinner } from './common.js';
import { isApp, openHotspotSettings, openVoiceSettings, share, copy, nativeInfo } from '../core/native.js';
import { APP_VERSION, inviteLink } from '../core/config.js';
import { clearLogs } from '../core/log.js';
import { diagText } from '../core/diag.js';
import { startSending, receiveFrom } from '../core/transfer.js';
import { listHistory, mergeHistory } from '../core/history.js';
import { formatCode, normalizeCode, ALPHABET } from '../core/crypto.js';
import { scanVideo } from '../core/qr.js';
import { vibrate } from '../core/native.js';

export function SettingsScreen() {
  const s = useStore();
  const p = s.profile;
  const st = s.settings;
  const [name, setName] = useState(p.name);
  const dark = st.theme === 'dark' || (st.theme === 'system' && s.systemDark);
  const saveName = () => {
    const n = name.trim();
    if (n && n !== p.name) { setProfile({ name: n }); toast(t('Nombre guardado')); } else setName(p.name);
  };
  return html`<div class="screen">
    <${Topbar} onBack=${() => { saveName(); popScreen(); }} title=${t('Ajustes')} />
    <div class="body"><div class="pad">
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;margin:6px 0 18px">
        <button style="position:relative" onClick=${() => openSheet('photo', { onPick: (ph) => setProfile(ph), hasPhoto: !!p.photo })} aria-label=${t('Cambiar foto')}>
          <${Avatar} name=${p.name} photo=${p.photo} size=${96} seed=${p.uid} />
          <span style="position:absolute;right:0;bottom:0;width:32px;height:32px;border-radius:50%;background:var(--accent);color:var(--accent-ink);display:flex;align-items:center;justify-content:center;border:3px solid var(--bg)"><${Icon} name="camera" size=${16} stroke=${2.2} /></span>
        </button>
      </div>

      <div class="section-title">${t('Perfil')}</div>
      <label class="field">
        <span>${t('Nombre')}</span>
        <input class="input" value=${name} maxlength="40" onInput=${(e) => setName(e.target.value)} onBlur=${saveName} onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }} />
      </label>
      <div class="field">
        <span>${t('Idioma en el que hablas')}</span>
        <button class="select-row" onClick=${() => openSheet('lang', { value: p.lang, onPick: (id) => setProfile({ lang: id }), title: t('Idioma en el que hablas') })}>
          <${Icon} name="globe" size=${20} /><span class="v">${langLabel(p.lang)}</span><${Icon} name="down" size=${20} />
        </button>
      </div>

      <div class="section-title">${t('Apariencia')}</div>
      <div class="field">
        <span>${t('Modo')}</span>
        <${Seg} value=${st.theme} onChange=${(v) => setSettings({ theme: v })} options=${[
          { value: 'light', icon: 'sun', label: t('Día') },
          { value: 'system', label: t('Auto') },
          { value: 'dark', icon: 'moon', label: t('Noche') },
        ]} />
      </div>
      <div class="field">
        <span>${t('Color')}</span>
        <div class="swatches">
          ${Object.entries(ACCENTS).map(([k, a]) => html`<button class=${`swatch ${st.accent === k ? 'on' : ''}`} key=${k}
            style=${`background:${dark ? a.dark : a.light}`} aria-label=${a.name} onClick=${() => setSettings({ accent: k })}></button>`)}
        </div>
      </div>

      <div class="section-title">${t('Mensajes')}</div>
      <div class="field">
        <span>${t('Recibir mensajes por defecto')}</span>
        <${Seg} value=${st.output} onChange=${(v) => setSettings({ output: v })} options=${[
          { value: 'text', label: t('Texto') },
          { value: 'voice', label: t('Voz') },
          { value: 'both', label: t('Ambos') },
        ]} />
      </div>
      <div class="field">
        <span>${t('Después de dictar')}</span>
        <${Seg} value=${st.autoSend} onChange=${(v) => setSettings({ autoSend: v })} options=${[
          { value: 'instant', label: t('Al momento') },
          { value: '3s', label: t('Enviar en 3 s') },
          { value: 'review', label: t('Revisar') },
        ]} />
      </div>
      <div class="field">
        <span>${t('Velocidad de la voz')}</span>
        <${Seg} value=${String(st.rate)} onChange=${(v) => setSettings({ rate: Number(v) })} options=${[
          { value: '0.8', label: t('Lenta') },
          { value: '1', label: t('Normal') },
          { value: '1.2', label: t('Rápida') },
        ]} />
      </div>

      <div class="section-title">${t('Más')}</div>
      <div class="group">
        <button class="row" onClick=${() => navigate('account')}><span class="ic"><${Icon} name="phone" /></span><span class="txt"><div class="t1">${t('Cuenta y dispositivos')}</div><div class="t2">${p.account ? p.account.email : t('Invitado')}</div></span><span class="end"><${Icon} name="chevron" size=${18} /></span></button>
        ${isApp ? html`<button class="row" onClick=${openVoiceSettings}><span class="ic"><${Icon} name="volume" /></span><span class="txt"><div class="t1">${t('Voces del móvil')}</div><div class="t2">${t('Instalar o cambiar la voz de lectura')}</div></span><span class="end"><${Icon} name="chevron" size=${18} /></span></button>` : null}
        <button class="row" onClick=${() => navigate('about')}><span class="ic"><${Icon} name="info" /></span><span class="txt"><div class="t1">${t('Acerca de Parla')}</div><div class="t2">${t('Versión')} ${APP_VERSION}</div></span><span class="end"><${Icon} name="chevron" size=${18} /></span></button>
      </div>
    </div></div>
  </div>`;
}

// ---------- idiomas sin conexión ----------
export function OfflineScreen() {
  return html`<div class="screen">
    <${Topbar} onBack=${popScreen} title=${t('Idiomas sin conexión')} />
    <div class="body"><div class="pad">
      <div class="info-card accent" style="display:flex;gap:14px;align-items:flex-start">
        <span style="color:var(--accent)"><${Icon} name="cloudOff" size=${28} /></span>
        <div><b>${t('Versión de prueba')}</b><br />${t('En esta versión, traducir necesita internet. En la versión completa podrás descargar aquí cada idioma (unos 30 MB) para traducir sin conexión.')}</div>
      </div>
      <div class="section-title">${t('Ya funciona sin internet')}</div>
      <div class="group">
        <div class="row"><span class="ic"><${Icon} name="volume" /></span><span class="txt"><div class="t1">${t('Lectura en voz alta')}</div><div class="t2">${t('Usa las voces instaladas en tu móvil.')}</div></span></div>
        <div class="row"><span class="ic"><${Icon} name="mic" /></span><span class="txt"><div class="t1">${t('Dictado por voz')}</div><div class="t2">${t('Si tu móvil tiene descargado el idioma para dictar.')}</div></span></div>
      </div>
      ${isApp ? html`<button class="btn block ghost" style="margin-top:18px" onClick=${openVoiceSettings}><${Icon} name="download" size=${20} />${t('Descargar voces en el móvil')}</button>` : null}
    </div></div>
  </div>`;
}

// ---------- compartir internet ----------
function wifiEscape(s) { return String(s || '').replace(/([\\;,:"])/g, '\\$1'); }

export function HotspotScreen() {
  const s = useStore();
  const hs = s.settings.hotspot || { ssid: '', pass: '' };
  const [ssid, setSsid] = useState(hs.ssid || '');
  const [pass, setPass] = useState(hs.pass || '');
  useEffect(() => {
    const tmr = setTimeout(() => setSettings({ hotspot: { ssid, pass } }), 400);
    return () => clearTimeout(tmr);
  }, [ssid, pass]);
  const qr = ssid ? `WIFI:T:${pass ? 'WPA' : 'nopass'};S:${wifiEscape(ssid)};${pass ? `P:${wifiEscape(pass)};` : ''};` : '';
  return html`<div class="screen">
    <${Topbar} onBack=${popScreen} title=${t('Compartir internet')} />
    <div class="body"><div class="pad">
      <p style="color:var(--text-2);margin:0 0 18px">${t('Si alguien no tiene datos, comparte tu conexión para que la conversación funcione bien.')}</p>
      <ol class="steps">
        <li>
          ${t('Activa el punto de acceso (zona wifi) de tu móvil.')}
          ${isApp ? html`<div style="margin-top:10px"><button class="btn small soft" onClick=${openHotspotSettings}><${Icon} name="wifi" size=${18} />${t('Abrir ajustes del punto de acceso')}</button></div>` : null}
        </li>
        <li>
          ${t('Escribe el nombre y la contraseña de tu zona wifi.')}
          <div style="margin-top:10px">
            <input class="input" style="margin-bottom:8px" placeholder=${t('Nombre de la red')} value=${ssid} onInput=${(e) => setSsid(e.target.value)} />
            <input class="input" placeholder=${t('Contraseña')} value=${pass} onInput=${(e) => setPass(e.target.value)} />
          </div>
        </li>
        <li>${t('Los demás escanean este código con la cámara de su móvil y se conectan.')}</li>
      </ol>
      ${qr ? html`<div class="qr-box"><${QrCode} text=${qr} /></div>` : html`<div class="info-card" style="text-align:center">${t('El código aparecerá aquí.')}</div>`}
      <p style="color:var(--text-3);font-size:13.5px;text-align:center">${t('Compartir internet usa tus datos móviles.')}</p>
    </div></div>
  </div>`;
}

// ---------- cuenta y dispositivos ----------
function exportData() {
  return { v: 1, profile: store.profile, settings: store.settings, history: listHistory() };
}

function applyData(data, keepUid) {
  if (!data || !data.profile) throw new Error('bad data');
  const prof = { ...data.profile };
  if (keepUid && store.profile) prof.uid = store.profile.uid;
  replaceProfile(prof);
  if (data.settings) replaceSettings(data.settings);
  if (data.history) mergeHistory(data.history);
}

export function TransferSend() {
  const [st, setSt] = useState({ phase: 'starting', p: 0, code: '' });
  const cancelRef = useRef(null);
  useEffect(() => {
    let alive = true;
    startSending(exportData, (phase, p) => { if (alive) setSt((x) => ({ ...x, phase, p })); })
      .then(({ code, cancel }) => {
        cancelRef.current = cancel;
        if (alive) setSt((x) => ({ ...x, code }));
        else cancel();
      })
      .catch(() => { if (alive) setSt({ phase: 'error', p: 0, code: '' }); });
    return () => { alive = false; if (cancelRef.current) cancelRef.current(); };
  }, []);
  if (st.phase === 'error') return html`<div class="info-card">${t('No se pudo conectar. Comprueba tu conexión a internet.')}</div>`;
  if (!st.code) return html`<div class="center-fill"><${Spinner} /></div>`;
  return html`<div>
    ${st.phase === 'done' ? html`<div class="info-card accent" style="text-align:center"><b>${t('¡Listo! Tus datos ya están en el otro móvil.')}</b></div>` : html`
      <div class="qr-box"><${QrCode} text=${inviteLink(st.code, 'x')} /></div>
      <div class="code-big">${formatCode(st.code)}</div>
      <p class="center-note">${st.phase === 'sending' ? `${t('Enviando…')} ${Math.round(st.p * 100)}%` : t('En el otro móvil abre Parla y elige «Recibir datos de otro móvil».')}</p>`}
  </div>`;
}

function formatInput(v) {
  const clean = v.toUpperCase().replace(/[^A-Z0-9]/g, '').split('').filter((c) => ALPHABET.includes(c)).join('').slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

export function TransferReceive({ initialCode, onDone }) {
  const [code, setCode] = useState(initialCode ? formatCode(initialCode) : '');
  const [busy, setBusy] = useState(false);
  const [p, setP] = useState(0);
  const busyRef = useRef(false);
  const stopRef = useRef(null);
  const go = async (raw) => {
    if (busyRef.current) return;
    const c = normalizeCode(String(raw).replace(/.*(?:[#?&]x=|parla:\/\/x\/)/i, ''));
    if (!c) { toast(t('El código no es válido.'), 'error'); return; }
    busyRef.current = true;
    setBusy(true);
    try {
      const data = await receiveFrom(c, setP);
      applyData(data, false);
      toast(t('Datos recibidos'));
      if (onDone) onDone();
    } catch {
      toast(t('No se pudieron recibir los datos. Comprueba el código y que el otro móvil siga mostrándolo.'), 'error', 4500);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  useEffect(() => { if (initialCode) go(initialCode); }, []);
  useEffect(() => () => stopRef.current && stopRef.current(), []);
  return html`<div>
    <div class="scan-wrap" style="max-width:300px;margin:0 auto 14px">
      <${CameraView} facing="environment" style="width:100%;height:100%" onVideo=${(v) => {
        if (stopRef.current) { stopRef.current(); stopRef.current = null; }
        if (v) stopRef.current = scanVideo(v, (txt) => { if (!busyRef.current) { vibrate(20); go(txt); } });
      }}>
        <div class="frame"></div>
        ${busy ? html`<div class="busy-overlay"><${Spinner} size=${28} />${Math.round(p * 100)}%</div>` : null}
      </${CameraView}>
    </div>
    <div class="or">${t('o escribe el código')}</div>
    <input class="input code" value=${code} placeholder="XXXX-XXXX" onInput=${(e) => setCode(formatInput(e.target.value))} />
    <button class="btn block" style="margin-top:12px" disabled=${busy || code.replace('-', '').length !== 8} onClick=${() => go(code)}>${t('Recibir')}</button>
  </div>`;
}

export function ReceiveSheet() {
  return html`<${Sheet} title=${t('Recibir datos de otro móvil')} full>
    <p style="color:var(--text-2);margin:0 0 14px">${t('En el otro móvil ve a Menú → Cuenta y dispositivos → Enviar mis datos. Luego escanea el código.')}</p>
    <${TransferReceive} onDone=${closeSheet} />
  </${Sheet}>`;
}

export function AccountInfoSheet() {
  return html`<${Sheet} title=${t('Cuenta con correo')}>
    <div class="info-card accent" style="display:flex;gap:14px">
      <span style="color:var(--accent)"><${Icon} name="mail" size=${26} /></span>
      <div>${t('Las cuentas con correo llegarán en la versión completa. Servirán para usar tu perfil y tu historial en varios móviles.')}</div>
    </div>
    <p style="color:var(--text-2);margin:0 0 16px">${t('Mientras tanto no hace falta registrarse: usa Parla como invitado y, si cambias de móvil, pasa tus datos con un código QR.')}</p>
    <button class="btn block ghost" onClick=${() => openSheet('receive')}><${Icon} name="phone" size=${20} />${t('Recibir datos de otro móvil')}</button>
  </${Sheet}>`;
}

export function AccountScreen({ params }) {
  const s = useStore();
  const [mode, setMode] = useState(params && params.receive ? 'receive' : 'menu');
  return html`<div class="screen">
    <${Topbar} onBack=${() => (mode === 'menu' ? popScreen() : setMode('menu'))} title=${t('Cuenta y dispositivos')} />
    <div class="body"><div class="pad">
      ${mode === 'menu' ? html`
        <div class="info-card" style="display:flex;gap:14px;align-items:center">
          <${Avatar} name=${s.profile.name} photo=${s.profile.photo} size=${48} seed=${s.profile.uid} />
          <div><b>${s.profile.name}</b><br />${t('Estás usando Parla como invitado. Todo se guarda en este móvil.')}</div>
        </div>
        <div class="section-title">${t('Usar en otro móvil')}</div>
        <div class="group">
          <button class="row" onClick=${() => setMode('send')}><span class="ic"><${Icon} name="share" /></span><span class="txt"><div class="t1">${t('Enviar mis datos a otro móvil')}</div><div class="t2">${t('Perfil, ajustes e historial')}</div></span><span class="end"><${Icon} name="chevron" size=${18} /></span></button>
          <button class="row" onClick=${() => setMode('receive')}><span class="ic"><${Icon} name="download" /></span><span class="txt"><div class="t1">${t('Recibir datos de otro móvil')}</div><div class="t2">${t('Sustituye el perfil de este móvil')}</div></span><span class="end"><${Icon} name="chevron" size=${18} /></span></button>
        </div>
        <div class="section-title">${t('Cuenta con correo')}</div>
        <div class="group">
          <button class="row" onClick=${() => openSheet('account')}><span class="ic"><${Icon} name="mail" /></span><span class="txt"><div class="t1">${t('Crear cuenta con correo')}</div><div class="t2">${t('Próximamente')}</div></span><span class="end"><${Icon} name="chevron" size=${18} /></span></button>
        </div>
      ` : null}
      ${mode === 'send' ? html`<${TransferSend} />` : null}
      ${mode === 'receive' ? html`<${TransferReceive} initialCode=${params && params.receive} onDone=${() => setMode('menu')} />` : null}
    </div></div>
  </div>`;
}

// ---------- acerca de / diagnóstico ----------
export function AboutScreen() {
  const [showLogs, setShowLogs] = useState(false);
  const diag = diagText;
  return html`<div class="screen">
    <${Topbar} onBack=${popScreen} title=${t('Acerca de Parla')} />
    <div class="body"><div class="pad">
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;margin:14px 0 24px">
        <${Logo} size=${72} />
        <div class="wordmark" style="font-size:28px">parla</div>
        <div style="color:var(--text-2)">${t('Versión de prueba')} ${APP_VERSION}</div>
      </div>
      <div class="info-card">
        ${t('Parla es gratuita. Usa servicios gratuitos: el traductor web de Google, servidores públicos de mensajería (todo va cifrado de extremo a extremo) y el lector de texto Tesseract.')}
      </div>
      <div class="group">
        <button class="row" onClick=${() => setShowLogs(!showLogs)}><span class="ic"><${Icon} name="activity" /></span><span class="txt"><div class="t1">${t('Diagnóstico')}</div><div class="t2">${t('Registro técnico por si algo falla')}</div></span><span class="end"><${Icon} name=${showLogs ? 'down' : 'chevron'} size=${18} /></span></button>
      </div>
      ${showLogs ? html`<div style="margin-top:12px">
        <div class="logs">${diag()}</div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn small ghost" onClick=${() => { clearLogs(); setShowLogs(false); }}>${t('Borrar')}</button>
          <button class="btn small" onClick=${() => share(diag(), 'Parla diagnóstico')}><${Icon} name="share" size=${18} />${t('Enviar')}</button>
        </div>
      </div>` : null}
    </div></div>
  </div>`;
}
