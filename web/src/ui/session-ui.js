// Piezas compartidas por el modo conversación y el modo "uno habla".
import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from './h.js';
import { Icon } from './icons.js';
import { store, toast, closeSheet, goHome, confirmDialog, openSheet, choiceDialog } from '../core/store.js';
import { t, formatTime } from '../core/i18n.js';
import { Avatar, Sheet, QrCode, Seg, langLabel, useEmitter } from './common.js';
import { lang as langInfo, isRtl, trCode } from '../core/langs.js';
import { formatCode } from '../core/crypto.js';
import { inviteLink } from '../core/config.js';
import { share, copy, vibrate, keepAwake, isApp, openAppSettings, openVoiceSettings } from '../core/native.js';
import { Dictation, SpeechStream, speechSupported } from '../core/speech.js';
import { speak, stopSpeaking, onTts } from '../core/tts.js';
import { MAX_CONV } from '../core/session.js';

// ---------- salida (texto / voz / ambos) ----------
export function initialOutput(session) {
  const def = store.settings.output || 'both';
  if (session.mode === 'conv' && session.state && session.state.place === 'inperson') return 'text';
  return def;
}

export const OUTPUT_ICON = { text: 'msgText', voice: 'volume', both: 'both' };

/** Selector rápido: texto / voz / ambos (un toque). */
export function OutputSeg({ value, onChange }) {
  const opts = [
    { v: 'text', icon: 'msgText', l: t('Texto') },
    { v: 'voice', icon: 'volume', l: t('Voz') },
    { v: 'both', icon: 'both', l: t('Ambos') },
  ];
  return html`<div class="oseg" role="radiogroup" aria-label=${t('Cómo quieres recibir los mensajes')}>
    ${opts.map((o) => html`<button class=${o.v === value ? 'on' : ''} role="radio" aria-checked=${o.v === value}
      aria-label=${o.l} onClick=${() => { if (o.v !== value) { onChange(o.v); if (o.v !== 'text') stopSpeaking(); } }}>
      <${Icon} name=${o.icon} size=${18} stroke=${2} />${o.v === value ? o.l : null}
    </button>`)}
  </div>`;
}

export function OutputSheet({ value, onChange }) {
  const opts = [
    { v: 'text', icon: 'msgText', l: t('Solo texto'), d: t('Lees los mensajes en pantalla.') },
    { v: 'voice', icon: 'volume', l: t('Solo voz'), d: t('Escuchas los mensajes en tu idioma.') },
    { v: 'both', icon: 'both', l: t('Texto y voz'), d: t('Los lees y los escuchas.') },
  ];
  return html`<${Sheet} title=${t('Cómo quieres recibir los mensajes')}>
    <div class="group">
      ${opts.map((o) => html`<button class="row" onClick=${() => { onChange(o.v); closeSheet(); }}>
        <span class="ic" style=${o.v === value ? 'color:var(--accent)' : ''}><${Icon} name=${o.icon} /></span>
        <span class="txt"><div class="t1">${o.l}</div><div class="t2">${o.d}</div></span>
        ${o.v === value ? html`<span class="end" style="color:var(--accent)"><${Icon} name="check" /></span>` : null}
      </button>`)}
    </div>
    <p style="color:var(--text-3);font-size:13.5px;margin:14px 4px 0">${t('Consejo: si estáis en la misma sala, usad auriculares para escuchar la voz.')}</p>
  </${Sheet}>`;
}

// ---------- lectura en voz alta de los mensajes que llegan ----------
export function useSpeakIncoming(session, output) {
  const outRef = useRef(output);
  outRef.current = output;
  useEffect(() => {
    if (!session) return undefined;
    const off = session.on('message', (m) => {
      if (m.own || !m.mine) return;
      if (outRef.current === 'voice' || outRef.current === 'both') {
        speak(m.mine, langInfo(store.profile.lang).bcp, { rate: store.settings.rate || 1, tag: m.id });
      } else {
        vibrate(15);
      }
    });
    const offT = onTts((ev) => {
      if (ev.type === 'nolang') {
        choiceDialog({
          title: t('Falta la voz de tu idioma'),
          text: t('Tu móvil no tiene instalada la voz para leer en tu idioma. Puedes instalarla en los ajustes de voz del móvil.'),
          actions: [
            { label: t('Ahora no'), value: false },
            ...(isApp ? [{ label: t('Abrir ajustes de voz'), value: true, primary: true }] : []),
          ],
        }).then((v) => { if (v) openVoiceSettings(); });
      }
    });
    return () => { off(); offT(); stopSpeaking(); };
  }, [session]);
}

export function useKeepAwake() {
  useEffect(() => {
    keepAwake(true);
    return () => keepAwake(false);
  }, []);
}

// ---------- estado de conexión ----------
export function StatusBanner({ session }) {
  if (session.status === 'reconnecting') {
    return html`<div class="banner warn"><span class="status-dot warn"></span><span class="grow">${t('Reconectando…')}</span></div>`;
  }
  return null;
}

// ---------- invitación ----------
export function InviteSheet({ session }) {
  useEmitter(session);
  const link = inviteLink(session.code);
  const count = session.participants.size;
  const doShare = () => {
    const msg = session.mode === 'talk'
      ? t('Únete a mi sesión en Parla y escúchame en tu idioma.')
      : t('Únete a mi conversación en Parla y hablemos cada uno en su idioma.');
    share(`${msg}\n${t('Código')}: ${formatCode(session.code)}\n${link.startsWith('http') ? link : ''}`.trim(), 'Parla');
  };
  return html`<${Sheet} title=${session.mode === 'talk' ? t('Invita a los oyentes') : t('Invita a otros')}>
    <div class="qr-box"><${QrCode} text=${link} /></div>
    <div class="code-big" onClick=${async () => { if (await copy(session.code)) toast(t('Código copiado')); }}>${formatCode(session.code)}</div>
    <p class="center-note">${t('Que abran Parla, pulsen «Unirse» y escaneen el código. También pueden escribirlo.')}</p>
    <div class="btn-row">
      <button class="btn ghost" onClick=${async () => { if (await copy(session.code)) toast(t('Código copiado')); }}><${Icon} name="copy" size=${20} />${t('Copiar')}</button>
      <button class="btn" onClick=${doShare}><${Icon} name="share" size=${20} />${t('Compartir')}</button>
    </div>
    <p class="center-note" style="margin-top:14px;margin-bottom:0">
      ${session.mode === 'conv' ? t('{n} de {max} personas', { n: count, max: MAX_CONV }) : t('{n} oyentes conectados', { n: Math.max(0, count - 1) })}
    </p>
  </${Sheet}>`;
}

// ---------- participantes ----------
export function ParticipantsSheet({ session }) {
  useEmitter(session);
  const list = [...session.participants.values()].sort((a, b) => a.joined - b.joined);
  return html`<${Sheet} title=${t('Participantes')}>
    <div class="group">
      ${list.map((p) => html`<div class="row" key=${p.uid}>
        <${Avatar} name=${p.name} photo=${p.photo} size=${40} seed=${p.uid} />
        <span class="txt">
          <div class="t1">${p.name}${p.uid === session.me.uid ? ` (${t('tú')})` : ''}</div>
          <div class="t2">${langLabel(p.lang)}${p.uid === session.hostUid ? ` · ${t('anfitrión')}` : ''}</div>
        </span>
        ${session.isHost && p.uid !== session.me.uid ? html`<button class="btn small danger-soft" onClick=${async () => {
          const ok = await confirmDialog({ title: t('¿Quitar a {name}?', { name: p.name }), text: t('Saldrá de la conversación.'), ok: t('Quitar'), cancel: t('Cancelar'), danger: true });
          if (ok) session.kick(p.uid);
        }}>${t('Quitar')}</button>` : null}
      </div>`)}
    </div>
  </${Sheet}>`;
}

// ---------- mensajes ----------
function VoiceBubble({ m, onReveal }) {
  const bars = [8, 14, 10, 18, 12, 16, 9, 13, 7];
  return html`<div class="bubble voice" onClick=${onReveal}>
    <${Icon} name="volume" size=${20} />
    <span class="wave">${bars.map((h) => html`<i style=${`height:${h}px`}></i>`)}</span>
    <span style="font-size:13px;color:var(--text-2)">${t('Ver texto')}</span>
  </div>`;
}

/** Marca qué mensajes empiezan un "turno" (cambio de persona o pausa larga). */
export function groupMessages(messages) {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    const first = !prev || prev.uid !== m.uid || m.ts - prev.ts > 120000;
    return { m, first };
  });
}

export function MessageItem({ m, session, output, first = true }) {
  const [reveal, setReveal] = useState(false);
  const who = session.presenceOf(m.uid);
  const myLang = store.profile.lang;
  const sameLang = trCode(m.lang) === trCode(myLang);
  const replay = () => {
    if (m.mine) { stopSpeaking(); speak(m.mine, langInfo(myLang).bcp, { rate: store.settings.rate || 1 }); }
  };
  if (m.own) {
    return html`<div class=${`msg own ${first ? 'first' : ''}`}>
      <div class="mcol" style="align-items:flex-end">
        <div class="bubble" dir="auto">${m.text}</div>
        <div class="msg-status">
          ${m.status === 'sending' ? t('Enviando…') : m.status === 'failed' ? html`<span style="color:var(--danger)">${t('No enviado')}</span>` : html`<${Icon} name="check" size=${14} stroke=${2.4} />${formatTime(m.ts)}`}
        </div>
      </div>
    </div>`;
  }
  const color = session.colorOf(m.uid);
  const voiceOnly = output === 'voice' && !reveal;
  const shown = m.mine || m.provisional;
  return html`<div class=${`msg other ${first ? 'first' : ''}`} style=${`--sc:${color}`}>
    <div class="av-slot">${first ? html`<${Avatar} name=${m.name} photo=${who && who.photo} size=${32} seed=${m.uid} color=${color} />` : null}</div>
    <div class="mcol">
      ${first ? html`<div class="who-line"><span class="nm">${m.name}</span><span>${formatTime(m.ts)}</span></div>` : null}
      ${voiceOnly ? html`<${VoiceBubble} m=${m} onReveal=${() => setReveal(true)} />` : html`<div class="bubble" onClick=${replay}>
        ${shown
          ? html`<div dir="auto" class=${m.mine ? '' : 'prov'} style=${isRtl(myLang) ? 'text-align:right' : ''}>${shown}</div>`
          : html`<div class="pending">${t('Traduciendo…')}</div>`}
        ${!sameLang ? html`<div class="orig"><span class="code">${langInfo(m.lang).id.split('-')[0]}</span><span dir="auto">${m.text}</span></div>` : null}
      </div>`}
    </div>
  </div>`;
}

/** Fila de personas con su color; la que tiene la palabra se resalta. */
export function SpeakerStrip({ session, people, onClick }) {
  const floor = session.floor;
  const liveUids = new Set([...session.live.keys()]);
  const speakingUid = floor || [...liveUids][0] || null;
  const speaker = speakingUid ? (speakingUid === session.me.uid ? session.me : session.presenceOf(speakingUid)) : null;
  const colorFor = (uid) => (uid === session.me.uid ? 'var(--accent)' : session.colorOf(uid));
  return html`<button class="speaker-strip" onClick=${onClick} aria-label=${t('Participantes')}>
    <span class="avatar-stack">
      ${people.slice(0, 6).map((p) => html`<span class=${`sp ${speakingUid && speakingUid !== p.uid ? 'dim' : ''}`} key=${p.uid}>
        <${Avatar} name=${p.name} photo=${p.photo} size=${30} seed=${p.uid} color=${colorFor(p.uid)} ring speaking=${speakingUid === p.uid} />
      </span>`)}
    </span>
    ${speaker ? html`<span class="speaking-label" style=${`--sc:${colorFor(speakingUid)}`}>
      <${Icon} name="mic" size=${14} stroke=${2.4} />${speakingUid === session.me.uid ? t('Hablas tú') : (speaker.name || '').split(/\s+/)[0]}
    </span>` : null}
  </button>`;
}

/** Lo que alguien está diciendo ahora mismo, ya traducido, con su color. */
export function LiveBubbles({ session, output }) {
  const items = [...session.live.values()].filter((l) => l.uid !== session.me.uid);
  if (!items.length) return null;
  const myLang = store.profile.lang;
  return html`${items.map((l) => {
    const color = session.colorOf(l.uid);
    const who = session.presenceOf(l.uid);
    const same = trCode(l.lang || '') === trCode(myLang);
    const typing = l.kind === 'typing';
    const shown = typing ? '' : (l.tr || (same ? l.text : ''));
    return html`<div class="msg other first live" key=${`live-${l.uid}`} style=${`--sc:${color}`}>
      <div class="av-slot"><${Avatar} name=${l.name} photo=${who && who.photo} size=${32} seed=${l.uid} color=${color} speaking /></div>
      <div class="mcol">
        <div class="who-line"><span class="nm">${l.name}</span><span class="live-tag"><span class="dots"><i></i><i></i><i></i></span>${typing ? t('escribiendo') : t('hablando')}</span></div>
        ${output === 'voice' && !typing ? null : html`<div class="bubble">
          ${shown ? html`<div dir="auto">${shown}</div>` : html`<div class="pending"><span class="dots"><i></i><i></i><i></i></span></div>`}
          ${!same && l.text && !typing ? html`<div class="orig"><span class="code">${langInfo(l.lang).id.split('-')[0]}</span><span dir="auto">${l.text}</span></div>` : null}
        </div>`}
      </div>
    </div>`;
  })}`;
}

export function useAutoScroll(dep) {
  const ref = useRef(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onScroll = () => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}

export function LiveRow() { return null; }

// ---------- compositor: voz y texto ----------
function micErrorText(code) {
  switch (code) {
    case 'permission': return t('Permite el uso del micrófono para poder dictar.');
    case 'unavailable': return t('Este móvil no tiene reconocimiento de voz. Puedes escribir.');
    case 'language': return t('El dictado no está disponible en tu idioma en este móvil. Puedes escribir.');
    case 'network': return t('Sin conexión para dictar. Revisa internet.');
    case 'busy': return t('El micrófono está ocupado. Inténtalo de nuevo.');
    default: return t('No se pudo usar el micrófono.');
  }
}

export function Composer({ session, variant = 'conv', onFinishTurn }) {
  useEmitter(session);
  const [text, setText] = useState('');
  const [dictState, setDictState] = useState('idle');
  const [live, setLive] = useState('');
  const [level, setLevel] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const [focus, setFocus] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const dictRef = useRef(null);
  const pressRef = useRef({ down: false, at: 0 });
  const cdRef = useRef(null);
  const taRef = useRef(null);
  const typingPing = useRef(0);
  const textRef = useRef('');
  textRef.current = text;
  const bcp = langInfo(store.profile.lang).bcp;
  const autoSend = store.settings.autoSend || '3s';

  useEffect(() => () => {
    if (dictRef.current) dictRef.current.cancel();
    clearInterval(cdRef.current);
  }, []);

  const cancelCountdown = () => {
    clearInterval(cdRef.current);
    cdRef.current = null;
    setCountdown(0);
  };

  const doSend = async (value) => {
    const v = (value !== undefined ? value : textRef.current).trim();
    cancelCountdown();
    if (!v) return;
    if (!session.canSpeak()) {
      const ok = await session.requestFloor();
      if (!ok) { busyToast(); return; }
    }
    setText('');
    setLive('');
    const ok = await session.send(v);
    if (!ok) toast(t('No se pudo enviar. Revisa la conexión.'), 'error');
  };

  const startCountdown = (value) => {
    cancelCountdown();
    const total = 3000;
    const t0 = Date.now();
    setCountdown(1);
    cdRef.current = setInterval(() => {
      const left = 1 - (Date.now() - t0) / total;
      if (left <= 0) {
        cancelCountdown();
        doSend(value);
      } else {
        setCountdown(left);
        session.sendLive('', 'typing');
      }
    }, 100);
  };

  const busyToast = () => {
    const f = session.floor;
    const p = f && session.presenceOf(f);
    toast(p ? t('{name} tiene la palabra. Espera tu turno.', { name: p.name }) : t('Ahora no puedes hablar.'));
    vibrate(30);
  };

  const ensureDict = () => {
    if (dictRef.current) return dictRef.current;
    dictRef.current = new Dictation(bcp, {
      onState: (s) => setDictState(s),
      onText: (c, p) => {
        const full = `${c} ${p}`.trim();
        setLive(full);
        session.sendLive(full, 'speech');
      },
      onLevel: (l) => setLevel(l),
      onDone: (txt) => {
        setLevel(0);
        setLive('');
        if (!txt) {
          if (!textRef.current.trim()) {
            if (variant === 'conv') session.releaseFloor();
            else session.sendLive('', 'stop', true);
          }
          toast(t('No te he entendido. Prueba otra vez.'));
          return;
        }
        const combined = textRef.current.trim() ? `${textRef.current.trim()} ${txt}` : txt;
        if (autoSend === 'instant') {
          doSend(combined);
        } else {
          setText(combined);
          session.sendLive('', 'typing');
          if (autoSend === '3s') startCountdown(combined);
        }
      },
      onError: (code) => {
        toast(micErrorText(code), 'error', 3500);
        if (code === 'permission' && isApp) {
          choiceDialog({
            title: t('Permiso de micrófono'),
            text: t('Para dictar, Parla necesita usar el micrófono. Puedes activarlo en los ajustes de la app.'),
            actions: [{ label: t('Ahora no'), value: false }, { label: t('Abrir ajustes'), value: true, primary: true }],
          }).then((v) => { if (v) openAppSettings(); });
        }
      },
    });
    return dictRef.current;
  };

  const onMicDown = async (e) => {
    e.preventDefault();
    if (e.currentTarget.setPointerCapture) { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ } }
    cancelCountdown();
    const d = ensureDict();
    if (d.active) {
      // Segundo toque mientras escucha: terminar
      d.stop();
      return;
    }
    pressRef.current = { down: true, at: Date.now() };
    if (!speechSupported()) {
      toast(micErrorText('unavailable'), 'error');
      return;
    }
    if (session.floorTakenByOther()) { busyToast(); return; }
    stopSpeaking();
    // Se empieza a escuchar al momento; el turno se pide a la vez para no perder las primeras palabras
    const floorP = session.canSpeak() ? null : session.requestFloor();
    vibrate(12);
    const held = pressRef.current.down;
    await d.start(held ? 'hold' : 'tap');
    // Si se soltó mientras se pedía permiso, seguir en modo "tocar"
    if (!pressRef.current.down && d.active && d.mode === 'hold') d.setMode('tap');
    if (floorP) {
      setRequesting(true);
      const ok = await floorP;
      setRequesting(false);
      if (!ok) {
        d.cancel();
        setLive('');
        session.sendLive('', 'stop', true);
        busyToast();
      }
    }
  };

  const onMicUp = () => {
    const pr = pressRef.current;
    if (!pr.down) return;
    pr.down = false;
    const d = dictRef.current;
    if (!d || !d.active) return;
    const heldMs = Date.now() - pr.at;
    if (heldMs < 400) d.setMode('tap');
    else if (d.mode === 'hold') d.stop();
  };

  const onType = async (e) => {
    const v = e.target.value;
    setText(v);
    cancelCountdown();
    if (v.trim() && !session.canSpeak() && !session.floorTakenByOther()) {
      session.requestFloor();
    }
    const now = Date.now();
    if (v.trim() && now - typingPing.current > 2500) {
      typingPing.current = now;
      session.sendLive('', 'typing');
    }
    const ta = taRef.current;
    if (ta) { ta.style.height = 'auto'; ta.style.height = `${Math.min(140, ta.scrollHeight)}px`; }
  };

  const onBlur = () => {
    setFocus(false);
    if (!textRef.current.trim() && variant === 'conv' && session.canSpeak() && dictState === 'idle') session.releaseFloor();
  };

  const listening = dictState === 'listening';
  const lockedByOther = session.floorTakenByOther() && !listening;
  const holder = lockedByOther ? session.presenceOf(session.floor) : null;
  const holderName = holder ? holder.name : (session.state && session.state.floor === session.hostUid ? session.state.hostName : '');

  const liveCard = listening || live ? html`<div class="live-card">
    <div class="lbl"><span class="dots"><i></i><i></i><i></i></span>${t('Te escucho…')}</div>
    <div dir="auto">${live || html`<span style="color:var(--text-3)">${t('Habla ahora')}</span>`}</div>
  </div>` : null;

  const ring = countdown > 0 ? html`<svg class="ring" viewBox="0 0 50 50"><circle cx="25" cy="25" r="23" fill="none" stroke="var(--accent-soft-2)" stroke-width="3"/><circle cx="25" cy="25" r="23" fill="none" stroke="var(--accent)" stroke-width="3" stroke-dasharray=${`${2 * Math.PI * 23}`} stroke-dashoffset=${`${2 * Math.PI * 23 * (1 - countdown)}`} stroke-linecap="round"/></svg>` : null;

  const micBtn = (big) => html`<button
    class=${`mic ${big ? 'big' : ''} ${listening ? 'listening' : ''} ${requesting ? 'busy' : ''}`}
    style=${`--lvl:${level}`}
    disabled=${lockedByOther}
    onPointerDown=${onMicDown} onPointerUp=${onMicUp} onPointerCancel=${onMicUp}
    onContextMenu=${(e) => e.preventDefault()}
    aria-label=${t('Hablar')}>
    <${Icon} name=${listening ? 'stop' : 'mic'} size=${big ? 36 : 26} />
  </button>`;

  const hint = listening
    ? (dictRef.current && dictRef.current.mode === 'hold' ? t('Suelta para terminar') : t('Toca para terminar'))
    : t('Toca o mantén pulsado para hablar');

  // Modo discurso (el que habla): toca una vez y cada frase se envía al terminarla
  if (variant === 'host' && !keyboard) {
    return html`<${HostMic} session=${session} lockedByOther=${lockedByOther} holderName=${holderName} onKeyboard=${() => setKeyboard(true)} />`;
  }

  return html`<div>
    ${liveCard}
    <div class="composer">
      ${lockedByOther ? html`<div class="lock-bar" style=${holder ? `--sc:${session.colorOf(holder.uid)}` : ''}>
        ${holder ? html`<${Avatar} name=${holder.name} photo=${holder.photo} size=${28} seed=${holder.uid} color=${session.colorOf(holder.uid)} speaking />` : html`<${Icon} name="mic" size=${20} />`}
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t('{name} tiene la palabra', { name: holderName || '…' })}</span>
      </div>` : html`<div class=${`field-wrap ${focus ? 'focus' : ''}`}>
        <textarea ref=${taRef} rows="1" value=${text} placeholder=${t('Escribe o pulsa el micro')}
          onInput=${onType} onFocus=${() => { setFocus(true); cancelCountdown(); }} onBlur=${onBlur}
          onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } }}></textarea>
        ${text.trim() ? html`<button class="send" onClick=${() => doSend()} aria-label=${t('Enviar')}>${ring}<${Icon} name="send" size=${22} stroke=${2.4} /></button>` : null}
      </div>`}
      ${variant === 'host' ? html`<button class="icon-btn soft" style="width:56px;height:56px" onClick=${() => setKeyboard(false)} aria-label=${t('Micrófono')}><${Icon} name="mic" /></button>` : micBtn(false)}
    </div>
    ${variant === 'listener' ? html`<button class="btn block ghost" style="margin-top:10px" onClick=${onFinishTurn}>${t('He terminado, devolver la palabra')}</button>` : null}
    ${listening ? html`<div class="mic-hint">${hint}</div>` : null}
  </div>`;
}

function HostMic({ session, lockedByOther, holderName, onKeyboard }) {
  const [active, setActive] = useState(false);
  const [partial, setPartial] = useState('');
  const [level, setLevel] = useState(0);
  const streamRef = useRef(null);
  const bcp = langInfo(store.profile.lang).bcp;
  if (!streamRef.current) {
    streamRef.current = new SpeechStream(bcp, {
      onPartial: (p) => { setPartial(p); session.sendLive(p, 'speech'); },
      onSentence: (s) => { setPartial(''); if (session.canSpeak()) session.send(s); },
      onLevel: (l) => setLevel(l),
      onState: (a) => { setActive(a); if (!a) { setLevel(0); session.sendLive('', 'stop', true); } },
      onError: (code) => toast(micErrorText(code), 'error', 3500),
    });
  }
  useEffect(() => () => streamRef.current && streamRef.current.cancel(), []);
  // Si da la palabra a otra persona, deja de escuchar
  useEffect(() => { if (lockedByOther && active) streamRef.current.stop(); }, [lockedByOther]);

  const toggle = async () => {
    const st = streamRef.current;
    if (st.active) { st.stop(); return; }
    if (!speechSupported()) { toast(micErrorText('unavailable'), 'error'); return; }
    if (lockedByOther) return;
    stopSpeaking();
    if (!session.canSpeak()) await session.requestFloor();
    vibrate(12);
    st.start();
  };

  return html`<div>
    ${active ? html`<div class="live-card">
      <div class="lbl"><span class="dots"><i></i><i></i><i></i></span>${t('Te escucho…')}</div>
      <div dir="auto">${partial || html`<span style="color:var(--text-3)">${t('Habla ahora')}</span>`}</div>
    </div>` : null}
    <div class="talk-foot">
      <div class="row2">
        <span style="width:52px"></span>
        <button class=${`mic big ${active ? 'listening' : ''}`} style=${`--lvl:${level}`} disabled=${lockedByOther} onClick=${toggle} aria-label=${active ? t('Parar') : t('Hablar')}>
          <${Icon} name=${active ? 'stop' : 'mic'} size=${36} />
        </button>
        <button class="icon-btn soft" style="width:52px;height:52px" onClick=${onKeyboard} aria-label=${t('Escribir')}><${Icon} name="keyboard" /></button>
      </div>
      <div class="mic-hint">${lockedByOther
        ? t('{name} tiene la palabra', { name: holderName })
        : active ? t('Cada frase se envía al terminarla. Toca para parar.') : t('Toca para empezar a hablar')}</div>
    </div>
  </div>`;
}

// ---------- salir de la sesión ----------
export async function confirmLeave(session) {
  let text = t('Guardaremos la conversación en tu historial.');
  let title = t('¿Salir de la conversación?');
  let ok = t('Salir');
  if (session.mode === 'talk' && session.isHost) {
    title = t('¿Terminar la sesión?');
    text = t('Los oyentes dejarán de recibir tus mensajes.');
    ok = t('Terminar para todos');
  } else if (session.mode === 'talk') {
    title = t('¿Salir de la sesión?');
  }
  const yes = await confirmDialog({ title, text, ok, cancel: t('Cancelar'), danger: true });
  if (!yes) return false;
  await session.leave();
  goHome();
  return true;
}

export function endReasonText(reason, mode) {
  switch (reason) {
    case 'ended': return t('El anfitrión ha terminado la sesión.');
    case 'full': return mode === 'talk' ? t('El discurso está completo (máximo 200 personas).') : t('La conversación está completa (máximo 6 personas).');
    case 'kicked': return t('El anfitrión te ha quitado de la conversación.');
    default: return t('La sesión ha terminado.');
  }
}

export function EndedView({ session }) {
  return html`<div class="ended-card">
    <b>${endReasonText(session.endReason, session.mode)}</b>
    <span>${t('La conversación se ha guardado en tu historial.')}</span>
    <button class="btn block" style="margin-top:6px" onClick=${goHome}>${t('Volver al inicio')}</button>
  </div>`;
}

export function openInvite(session) { openSheet('invite', { session }); }
