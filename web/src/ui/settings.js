import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from './h.js';
import { Icon, Logo } from './icons.js';
import {
  store, setProfile, setSettings, openSheet, popScreen, navigate, toast, ACCENTS, replaceProfile, replaceSettings, closeSheet, confirmDialog,
} from '../core/store.js';
import { t } from '../core/i18n.js';
import { Avatar, Topbar, Seg, Sheet, useStore, langLabel, QrCode, CameraView, Spinner, trLangName } from './common.js';
import { isApp, openHotspotSettings, openVoiceSettings, share, copy, nativeInfo, openUrl } from '../core/native.js';
import { hasLocalTr, onModels, refreshModels, modelsState, mlCode, downloadModel, deleteModel } from '../core/localtr.js';
import { LANGS, trCode } from '../core/langs.js';
import { APP_VERSION, APK_URL, inviteLink } from '../core/config.js';
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
/** Idiomas de la app que el traductor del móvil sabe traducir (sin repetir variantes). */
function offlineLangs(supported) {
  const seen = new Set();
  const out = [];
  for (const l of LANGS) {
    const c = mlCode(l.tr);
    if (seen.has(c) || !supported.has(c)) continue;
    seen.add(c);
    out.push({ code: c, name: trLangName(c) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function OfflineScreen() {
  const s = useStore();
  const [, force] = useState(0);
  const local = hasLocalTr();
  useEffect(() => {
    if (!local) return undefined;
    const off = onModels(() => force((x) => x + 1));
    refreshModels();
    return off;
  }, []);
  const st = modelsState();
  const myCode = mlCode(trCode(s.profile.lang));
  const all = local && st.ready ? offlineLangs(st.supported) : [];
  const have = all.filter((l) => st.downloaded.has(l.code));
  const rest = all.filter((l) => !st.downloaded.has(l.code));
  // Tu idioma y el inglés primero
  rest.sort((a, b) => (b.code === myCode) - (a.code === myCode) || (b.code === 'en') - (a.code === 'en'));

  const remove = async (l) => {
    const yes = await confirmDialog({
      title: l.name,
      text: t('¿Borrar este idioma del móvil? Podrás descargarlo otra vez cuando quieras.'),
      ok: t('Borrar'),
      cancel: t('Cancelar'),
      danger: true,
    });
    if (yes) deleteModel(l.code);
  };

  const row = (l) => {
    const dl = st.downloading.has(l.code);
    const ok = st.downloaded.has(l.code);
    return html`<div class="row" key=${l.code}>
      <span class="ic" style=${ok ? 'color:var(--accent)' : ''}><${Icon} name=${ok ? 'check' : 'globe'} /></span>
      <span class="txt">
        <div class="t1">${l.name}</div>
        <div class="t2">${dl ? t('Descargando…') : ok ? (l.code === 'en' ? t('Hace falta para todos los idiomas') : t('Listo, funciona sin internet')) : t('Unos 30 MB')}</div>
      </span>
      <span class="end">
        ${dl ? html`<${Spinner} size=${20} />` : ok
    ? (l.code !== 'en' ? html`<button class="icon-btn" aria-label=${t('Borrar')} onClick=${() => remove(l)}><${Icon} name="trash" size=${20} /></button>` : null)
    : html`<button class="icon-btn" aria-label=${t('Descargar')} onClick=${() => downloadModel(l.code, false)}><${Icon} name="download" size=${20} /></button>`}
      </span>
    </div>`;
  };

  return html`<div class="screen">
    <${Topbar} onBack=${popScreen} title=${t('Idiomas sin conexión')} />
    <div class="body"><div class="pad">
      ${local ? html`
        <div class="info-card accent" style="display:flex;gap:14px;align-items:flex-start">
          <span style="color:var(--accent)"><${Icon} name="bolt" size=${28} /></span>
          <div>${t('Con los idiomas descargados, la traducción sale al momento y funciona sin internet. Cuando hay conexión, después se mejora con la de Google.')}</div>
        </div>
        ${!st.ready ? html`<div style="display:flex;justify-content:center;padding:30px"><${Spinner} /></div>` : html`
          ${have.length ? html`<div class="section-title">${t('En tu móvil')}</div>
          <div class="group">${have.map(row)}</div>` : null}
          <div class="section-title">${t('Para descargar')}</div>
          <div class="group">${rest.map(row)}</div>
          <p style="color:var(--text-3);font-size:13.5px;margin-top:12px">${t('El inglés se usa de puente entre idiomas, por eso hace falta siempre. Tu idioma y el inglés se descargan solos cuando estás con wifi.')}</p>
        `}
      ` : html`
        <div class="info-card accent" style="display:flex;gap:14px;align-items:flex-start">
          <span style="color:var(--accent)"><${Icon} name="cloudOff" size=${28} /></span>
          <div>${t('En la web, traducir necesita internet. Con la app de Android puedes descargar idiomas para traducir al momento y sin conexión.')}</div>
        </div>
        ${!isApp && APK_URL ? html`<button class="btn block" style="margin-top:6px" onClick=${() => openUrl(APK_URL)}><${Icon} name="download" size=${20} />${t('Descargar la app')}</button>` : null}
      `}
      <div class="section-title">${t('También funciona sin internet')}</div>
      <div class="group">
        <div class="row"><span class="ic"><${Icon} name="volume" /></span><span class="txt"><div class="t1">${t('Lectura en voz alta')}</div><div class="t2">${t('Usa las voces instaladas en tu móvil.')}</div></span></div>
        <div class="row"><span class="ic"><${Icon} name="mic" /></span><span class="txt"><div class="t1">${t('Dictado por voz')}</div><div class="t2">${t('Si tu móvil tiene descargado el idioma para dictar.')}</div></span></div>
        ${local ? html`<div class="row"><span class="ic"><${Icon} name="read" /></span><span class="txt"><div class="t1">${t('Modo lectura')}</div><div class="t2">${t('El lector de textos está dentro de la app.')}</div></span></div>` : null}
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
