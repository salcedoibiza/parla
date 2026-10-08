import { useEffect, useState } from 'preact/hooks';
import { html } from './h.js';
import { Icon } from './icons.js';
import { store, toast, openSheet, goHome } from '../core/store.js';
import { t } from '../core/i18n.js';
import { Avatar, Topbar, useEmitter, useBackGuard, LocalTrBanner } from './common.js';
import { formatCode } from '../core/crypto.js';
import {
  initialOutput, useSpeakIncoming, useKeepAwake, StatusBanner, MessageItem, LiveBubbles, Composer,
  confirmLeave, EndedView, openInvite, useAutoScroll, OutputSeg, groupMessages, SpeakerStrip,
} from './session-ui.js';
import { vibrate } from '../core/native.js';

function useSessionToasts(session) {
  useEffect(() => {
    const offs = [
      session.on('joined', (p) => { toast(t('{name} se ha unido', { name: p.name })); vibrate(15); }),
      session.on('left', (p) => toast(t('{name} ha salido', { name: p.name }))),
      session.on('host', () => toast(t('Ahora eres el anfitrión de la conversación'))),
    ];
    return () => offs.forEach((f) => f());
  }, [session]);
}

export function ConversationScreen({ params }) {
  const session = params.session;
  useEmitter(session);
  const [output, setOutput] = useState(() => initialOutput(session));
  useSpeakIncoming(session, output);
  useKeepAwake();
  useSessionToasts(session);
  useBackGuard(() => {
    if (session.status === 'ended') { goHome(); return true; }
    confirmLeave(session);
    return true;
  });
  useEffect(() => {
    if (params.fresh) setTimeout(() => openInvite(session), 250);
  }, []);
  const liveKey = [...session.live.values()].map((l) => `${l.uid}:${(l.tr || '').length}:${(l.text || '').length}`).join('|');
  const scrollRef = useAutoScroll(`${session.messages.length}-${liveKey}-${session.messages.filter((m) => m.mine || m.provisional).length}`);

  const people = [...session.participants.values()].sort((a, b) => a.joined - b.joined);
  const others = people.filter((p) => p.uid !== session.me.uid);
  const ended = session.status === 'ended';
  const sub = ended
    ? t('Terminada')
    : t('{n} de {max} personas', { n: people.length, max: 6 });

  return html`<div class="screen">
    <${Topbar}
      onBack=${() => (ended ? goHome() : confirmLeave(session))}
      backIcon=${ended ? 'back' : 'x'}
      title=${t('Modo conversación')}
      sub=${sub}
      right=${ended ? null : html`
        <button class="icon-btn soft" onClick=${() => openInvite(session)} aria-label=${t('Invitar')}><${Icon} name="qr" /></button>
      `} />
    ${ended ? null : html`<div class="subbar">
      <${SpeakerStrip} session=${session} people=${people} onClick=${() => openSheet('participants', { session })} />
      <span class="grow"></span>
      <${OutputSeg} value=${output} onChange=${setOutput} />
    </div>`}
    <${StatusBanner} session=${session} />
    ${ended || !others.length ? null : html`<${LocalTrBanner} langs=${people.map((p) => p.lang)} />`}
    <div class="body" ref=${scrollRef}>
      ${!session.messages.length && others.length === 0 && !ended ? html`<div class="empty-invite">
        <span class="ic-big"><${Icon} name="chat" size=${30} /></span>
        <h3>${t('Modo conversación')}</h3>
        <p>${t('Hasta 6 personas, cada una con su móvil. Habla o escribe en tu idioma y a cada uno le llega en el suyo, por texto, por voz o de las dos formas. Mientras uno habla, los demás esperan su turno.')}</p>
        <button class="btn" onClick=${() => openInvite(session)}><${Icon} name="qr" size=${20} />${t('Invitar con código QR')}</button>
      </div>` : null}
      ${!session.messages.length && others.length > 0 && !ended && !session.live.size ? html`<div class="sys-note" style="margin-top:30px">
        ${t('Pulsa el micro y habla. Cada uno lo recibirá en su idioma.')}
      </div>` : null}
      <div class="msgs">
        ${groupMessages(session.messages).map(({ m, first }) => html`<${MessageItem} key=${m.id} m=${m} first=${first} session=${session} output=${output} />`)}
        <${LiveBubbles} session=${session} output=${output} />
      </div>
    </div>
    <div class="footer">
      ${ended ? html`<${EndedView} session=${session} />` : html`<${Composer} session=${session} variant="conv" />`}
    </div>
  </div>`;
}
