import { useEffect, useState } from 'preact/hooks';
import { html } from './h.js';
import { Icon } from './icons.js';
import { store, toast, openSheet, goHome, closeSheet } from '../core/store.js';
import { t, formatTime } from '../core/i18n.js';
import { Avatar, Topbar, Sheet, useEmitter, useBackGuard, langLabel, LocalTrBanner } from './common.js';
import { formatCode } from '../core/crypto.js';
import {
  initialOutput, useSpeakIncoming, useKeepAwake, StatusBanner, MessageItem, LiveBubbles, Composer,
  confirmLeave, EndedView, openInvite, useAutoScroll, OutputSeg, groupMessages,
} from './session-ui.js';
import { vibrate } from '../core/native.js';
import { lang as langInfo, trCode, isRtl } from '../core/langs.js';

export function HandsSheet({ session }) {
  useEmitter(session);
  const hands = session.hands;
  return html`<${Sheet} title=${t('Quieren hablar')}>
    ${!hands.length ? html`<div class="empty" style="padding:30px 10px">${t('Nadie ha pedido la palabra.')}</div>` : null}
    ${hands.map((h) => html`<div class="hand-row" key=${h.uid}>
      <${Avatar} name=${h.name} size=${42} seed=${h.uid} />
      <div class="grow">
        <div class="n">${h.name}</div>
        <div class="l">${langLabel(h.lang)} · ${formatTime(h.ts)}</div>
      </div>
      <button class="btn small ghost" onClick=${() => session.denyHand(h.uid)}>${t('Rechazar')}</button>
      <button class="btn small" onClick=${() => { session.acceptHand(h.uid); closeSheet(); }}>${t('Dar la palabra')}</button>
    </div>`)}
  </${Sheet}>`;
}

function HostView({ session }) {
  const [output, setOutput] = useState(() => initialOutput(session));
  useSpeakIncoming(session, output);
  const scrollRef = useAutoScroll(`${session.messages.length}-${session.live.size}`);
  const st = session.state || {};
  const floorOther = st.floor && st.floor !== session.me.uid;
  const speaker = floorOther ? (session.presenceOf(st.floor) || { name: '…' }) : null;
  const listeners = session.listenerCount;
  const ended = session.status === 'ended';

  useEffect(() => {
    const off = session.on('hand', () => vibrate(40));
    return off;
  }, [session]);

  return html`<div class="screen">
    <${Topbar}
      onBack=${() => (ended ? goHome() : confirmLeave(session))}
      backIcon=${ended ? 'back' : 'x'}
      title=${st.title || t('Modo discurso')}
      sub=${ended ? t('Terminada') : formatCode(session.code)}
      right=${ended ? null : html`
        <button class="icon-btn" onClick=${() => openSheet('hands', { session })} aria-label=${t('Solicitudes')}>
          <${Icon} name="hand" />
          ${session.hands.length ? html`<span class="badge">${session.hands.length}</span>` : null}
        </button>
        <button class="icon-btn soft" onClick=${() => openInvite(session)} aria-label=${t('Invitar')}><${Icon} name="qr" /></button>
      `} />
    ${ended ? null : html`<div class="subbar">
      <span class="chip"><${Icon} name="users" size=${17} />${t('{n} oyentes', { n: listeners })}</span>
      <span class="grow"></span>
      <${OutputSeg} value=${output} onChange=${setOutput} />
    </div>`}
    <${StatusBanner} session=${session} />
    ${floorOther && !ended ? html`<div class="banner accent">
      <${Avatar} name=${speaker.name} photo=${speaker.photo} size=${30} seed=${st.floor} />
      <span class="grow">${t('{name} tiene la palabra', { name: speaker.name })}</span>
      <button class="btn small" onClick=${() => session.reclaimFloor()}>${t('Recuperar')}</button>
    </div>` : null}
    ${session.hands.length && !floorOther && !ended ? html`<div class="banner">
      <${Icon} name="hand" size=${20} />
      <span class="grow">${t('{n} solicitudes para hablar', { n: session.hands.length })}</span>
      <button class="btn small soft" onClick=${() => openSheet('hands', { session })}>${t('Ver')}</button>
    </div>` : null}
    <div class="body" ref=${scrollRef}>
      ${!session.messages.length && listeners === 0 && !ended ? html`<div class="empty-invite">
        <span class="ic-big" style="background:linear-gradient(140deg,#ffa24d,#f5572d);box-shadow:0 12px 24px -10px rgba(245,87,45,.5)"><${Icon} name="megaphone" size=${30} /></span>
        <h3>${t('Invita a tus oyentes')}</h3>
        <p>${t('Que escaneen el código con Parla. Cuando empieces a hablar, cada uno verá y oirá lo que dices en su idioma, frase a frase.')}</p>
        <button class="btn" onClick=${() => openInvite(session)}><${Icon} name="qr" size=${20} />${t('Mostrar código QR')}</button>
      </div>` : null}
      ${!session.messages.length && listeners > 0 && !ended ? html`<div class="sys-note" style="margin-top:30px">${t('Pulsa el micro y empieza a hablar.')}</div>` : null}
      <div class="msgs">
        ${groupMessages(session.messages).map(({ m, first }) => html`<${MessageItem} key=${m.id} m=${m} first=${first} session=${session} output=${output} />`)}
        <${LiveBubbles} session=${session} output=${output} />
      </div>
    </div>
    <div class="footer">
      ${ended ? html`<${EndedView} session=${session} />` : html`<${Composer} session=${session} variant="host" />`}
    </div>
  </div>`;
}

function ListenerView({ session }) {
  const [output, setOutput] = useState(() => initialOutput(session));
  const [hostGone, setHostGone] = useState(false);
  useSpeakIncoming(session, output);
  const st = session.state || {};
  const myLang = store.profile.lang;
  const ended = session.status === 'ended';
  const canSpeak = session.canSpeak();
  const msgs = session.messages;
  // Si alguien está hablando ahora, se muestra lo que dice en directo
  const lives = [...session.live.values()].filter((l) => l.uid !== session.me.uid && l.kind !== 'typing');
  const live = lives.find((l) => l.uid === st.floor) || lives[0] || null;
  const last = live ? null : msgs[msgs.length - 1];
  const past = (live ? msgs : msgs.slice(0, -1)).slice(-30).reverse();

  useEffect(() => {
    const offs = [
      session.on('granted', () => vibrate(60)),
      session.on('denied', () => toast(t('Ahora no es posible hablar. Tu solicitud se ha rechazado.'))),
      session.on('revoked', () => toast(t('El anfitrión ha recuperado la palabra.'))),
      session.on('hostgone', () => setHostGone(true)),
      session.on('hostback', () => setHostGone(false)),
    ];
    return () => offs.forEach((f) => f());
  }, [session]);

  const host = session.presenceOf(st.host);
  const renderText = (m) => {
    const shown = m.mine || m.provisional;
    if (!shown) return html`<span style="color:var(--text-3)">${t('Traduciendo…')}</span>`;
    return html`<span dir="auto" style=${isRtl(myLang) ? 'text-align:right;display:block' : ''}>${shown}</span>`;
  };

  return html`<div class="screen">
    <${Topbar}
      onBack=${() => (ended ? goHome() : confirmLeave(session))}
      backIcon=${ended ? 'back' : 'x'}
      title=${st.title || t('Modo discurso')}
      sub=${ended ? t('Terminada') : t('Discurso de {name}', { name: st.hostName || '' })} />
    ${ended ? null : html`<div class="subbar">
      <span class="chip">${langLabel(st.hostLang)} <${Icon} name="arrow" size=${15} /> ${langLabel(myLang)}</span>
      <span class="grow"></span>
      <${OutputSeg} value=${output} onChange=${setOutput} />
    </div>`}
    <${StatusBanner} session=${session} />
    ${hostGone && !ended ? html`<div class="banner warn"><span class="status-dot warn"></span><span class="grow">${t('El anfitrión se ha desconectado. Esperando…')}</span></div>` : null}
    ${ended ? null : html`<${LocalTrBanner} langs=${[st.hostLang, myLang]} />`}
    ${canSpeak ? html`<div class="banner accent"><${Icon} name="mic" size=${20} /><span class="grow">${t('Tienes la palabra. Todos te escuchan en su idioma.')}</span></div>` : null}
    <div class="body">
      <div class="stage">
        ${live ? (() => {
          const color = session.colorOf(live.uid);
          const same = trCode(live.lang || '') === trCode(myLang);
          const shown = live.tr || (same ? live.text : '');
          return html`<div class="subtitle-card speaker" style=${`--sc:${color}`}>
            <div class="who"><${Avatar} name=${live.name} photo=${live.uid === st.host && host ? host.photo : ''} size=${26} seed=${live.uid} color=${color} speaking />
              <span class="nm">${live.name}</span><span class="live-tag"><span class="dots"><i></i><i></i><i></i></span>${t('hablando')}</span></div>
            ${output === 'voice' ? html`<span style="color:var(--text-2);display:flex;align-items:center;gap:10px"><${Icon} name="volume" size=${26} />${t('Escuchando…')}</span>`
              : shown ? html`<span dir="auto" style=${isRtl(myLang) ? 'text-align:right;display:block' : ''}>${shown}</span>`
              : html`<span class="dots big"><i></i><i></i><i></i></span>`}
            ${!same && live.text && output !== 'voice' ? html`<div class="orig" dir="auto">${live.text}</div>` : null}
          </div>`;
        })() : last ? html`<div class="subtitle-card speaker" style=${`--sc:${last.own ? 'var(--accent)' : session.colorOf(last.uid)}`}>
          <div class="who"><${Avatar} name=${last.name} photo=${last.uid === st.host && host ? host.photo : ''} size=${26} seed=${last.uid} color=${last.own ? 'var(--accent)' : session.colorOf(last.uid)} /><span class="nm">${last.own ? t('Tú') : last.name}</span></div>
          ${last.own ? html`<span dir="auto">${last.text}</span>` : (output === 'voice' ? html`<span style="color:var(--text-2);display:flex;align-items:center;gap:10px"><${Icon} name="volume" size=${26} />${t('Escuchando…')}</span>` : renderText(last))}
          ${!last.own && output !== 'voice' && trCode(last.lang) !== trCode(myLang) ? html`<div class="orig" dir="auto">${last.text}</div>` : null}
        </div>` : html`<div class="subtitle-card muted">
          <span class="ic-big" style="background:linear-gradient(140deg,#ffa24d,#f5572d);box-shadow:0 12px 24px -10px rgba(245,87,45,.5)"><${Icon} name="megaphone" size=${28} /></span>
          <div>${t('Aquí verás lo que dice {name}, en tu idioma, mientras habla.', { name: st.hostName || t('el anfitrión') })}</div>
          <div style="font-size:14.5px;color:var(--text-3)">${t('Si quieres intervenir, pulsa «Pedir la palabra».')}</div>
        </div>`}
      </div>
      ${output !== 'voice' ? html`<div class="past">
        ${past.map((m) => html`<div class="p" key=${m.id} style=${`--sc:${m.own ? 'var(--accent)' : session.colorOf(m.uid)}`}>
          <div class="w"><span class="nm">${m.own ? t('Tú') : m.name}</span> · ${formatTime(m.ts)}</div>
          ${m.own ? m.text : renderText(m)}
        </div>`)}
      </div>` : null}
    </div>
    <div class="footer">
      ${ended ? html`<${EndedView} session=${session} />`
        : canSpeak ? html`<${Composer} session=${session} variant="listener" onFinishTurn=${() => session.releaseFloor()} />`
        : session.handPending ? html`<div class="btn-row">
          <div class="lock-bar" style="flex:2"><span class="dots"><i></i><i></i><i></i></span>${t('Solicitud enviada')}</div>
          <button class="btn ghost" style="flex:1" onClick=${() => session.cancelHand()}>${t('Cancelar')}</button>
        </div>`
        : html`<button class="btn block soft" style="height:56px" onClick=${() => { session.raiseHand(); vibrate(15); }}>
          <${Icon} name="hand" size=${22} />${t('Pedir la palabra')}
        </button>`}
    </div>
  </div>`;
}

export function TalkScreen({ params }) {
  const session = params.session;
  useEmitter(session);
  useKeepAwake();
  useBackGuard(() => {
    if (session.status === 'ended') { goHome(); return true; }
    confirmLeave(session);
    return true;
  });
  useEffect(() => {
    if (params.fresh) setTimeout(() => openInvite(session), 250);
  }, []);
  return session.isHost ? html`<${HostView} session=${session} />` : html`<${ListenerView} session=${session} />`;
}
