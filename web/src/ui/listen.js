import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { html } from './h.js';
import { Icon } from './icons.js';
import { store, popScreen, openSheet, setSettings, toast, choiceDialog } from '../core/store.js';
import { t, formatTime } from '../core/i18n.js';
import { Topbar, langLabel, useBackGuard } from './common.js';
import { OutputSeg, useKeepAwake } from './session-ui.js';
import { ListenEngine } from '../core/listen.js';
import { lang as langInfo, trCode, isRtl } from '../core/langs.js';
import { speak, stopSpeaking, onTts, isSpeaking } from '../core/tts.js';
import { isApp, openAppSettings, vibrate } from '../core/native.js';
import { speechSupported } from '../core/speech.js';
import { SPEAKER_COLORS } from '../core/colors.js';

function errorText(code) {
  switch (code) {
    case 'permission': return t('Permite el uso del micrófono para poder escuchar.');
    case 'unavailable': return t('Este móvil no tiene reconocimiento de voz.');
    case 'language': return t('Tu móvil no puede reconocer ese idioma. Prueba con otro o descarga el idioma en los ajustes de voz del móvil.');
    default: return t('Se ha detenido la escucha. Comprueba tu conexión e inténtalo de nuevo.');
  }
}

export function ListenScreen() {
  const [, force] = useReducer((x) => x + 1, 0);
  const [output, setOutput] = useState(store.settings.output || 'text');
  const outRef = useRef(output);
  outRef.current = output;
  const from = store.settings.listenFrom || 'en';
  const to = store.profile.lang;
  const size = store.settings.subSize || 26;
  const engRef = useRef(null);
  const bodyRef = useRef(null);
  useKeepAwake();

  if (!engRef.current) {
    engRef.current = new ListenEngine({
      from,
      to,
      voices: store.settings.voices !== false && !store.settings.voicesBlocked,
      onVoicesBlocked: () => {
        setSettings({ voicesBlocked: true });
        toast(t('Este móvil no deja distinguir voces mientras escucha. Lo he desactivado para que la escucha siga funcionando.'), 'info', 5000);
      },
      onChange: () => force(),
      onError: (code) => {
        if (code === 'permission' && isApp) {
          choiceDialog({
            title: t('Permiso de micrófono'),
            text: errorText(code),
            actions: [{ label: t('Ahora no'), value: false }, { label: t('Abrir ajustes'), value: true, primary: true }],
          }).then((v) => { if (v) openAppSettings(); });
        } else {
          toast(errorText(code), 'error', 4500);
        }
      },
      onSegment: (seg) => {
        if (outRef.current === 'voice' || outRef.current === 'both') {
          // Mientras habla la voz, se deja de escuchar para no traducirse a sí mismo
          engRef.current.hold(true);
          speak(seg.tr || seg.text, langInfo(store.profile.lang).bcp, { rate: store.settings.rate || 1 });
        } else {
          vibrate(8);
        }
      },
    });
  }
  const eng = engRef.current;

  useEffect(() => {
    const off = onTts((ev) => {
      if (ev.type === 'end' || ev.type === 'nolang') {
        setTimeout(() => { if (!isSpeaking()) eng.hold(false); }, 250);
      }
    });
    return () => { off(); stopSpeaking(); eng.stop(); };
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  useBackGuard(() => {
    eng.stop();
    return false;
  });

  const toggle = async () => {
    if (eng.running) { eng.stop(); return; }
    if (!speechSupported()) { toast(errorText('unavailable'), 'error'); return; }
    await eng.start();
  };

  const pickFrom = () => openSheet('lang', {
    value: eng.from,
    title: t('Idioma que se escucha'),
    onPick: (id) => { setSettings({ listenFrom: id }); eng.setFrom(id); force(); },
  });

  const setSize = (d) => setSettings({ subSize: Math.max(18, Math.min(44, size + d)) });

  const hasVoice = (s) => s && s.voice !== null && s.voice !== undefined;
  const voiceCls = (s) => (hasVoice(s) ? 'voiced' : '');
  const voiceStyle = (s) => (hasVoice(s) ? `--sc:${SPEAKER_COLORS[s.voice % SPEAKER_COLORS.length]}` : '');
  // La etiqueta "Voz N" aparece cuando cambia la voz
  const voiceTag = (s, prev, always = false) => {
    if (!hasVoice(s)) return null;
    if (!always && prev && prev.voice === s.voice) return html`<span class="vdot"></span>`;
    return html`<span class="vtag"><span class="vdot"></span>${t('Voz {n}', { n: s.voice + 1 })}</span>`;
  };
  const segs = eng.segments;
  const last = segs[segs.length - 1];
  const older = segs.slice(-40, -1);
  const showOrig = trCode(eng.from) !== trCode(to);
  const rtl = isRtl(to);
  const voiceOnly = output === 'voice';

  return html`<div class="screen" style=${`--sub-size:${size}px`}>
    <${Topbar}
      onBack=${() => { eng.stop(); popScreen(); }}
      title=${t('Modo escucha')}
      sub=${eng.running ? (eng.warning === 'network' ? t('Sin conexión, reintentando…') : t('Escuchando…')) : t('En pausa')}
      right=${html`<button class=${`icon-btn ${eng.voicesWanted ? 'voices-on' : ''}`} aria-pressed=${!!eng.voicesWanted}
        aria-label=${t('Distinguir voces')} onClick=${() => {
          const on = !eng.voicesWanted;
          setSettings({ voices: on, voicesBlocked: false });
          eng.setVoices(on);
          toast(on ? t('Distinguir voces activado (aproximado, por el tono de voz)') : t('Distinguir voces desactivado'));
        }}><${Icon} name="users" /></button>
      <div class="size-ctl" role="group" aria-label=${t('Tamaño del texto')}>
        <button onClick=${() => setSize(-3)} aria-label=${t('Texto más pequeño')}>A</button>
        <button onClick=${() => setSize(3)} aria-label=${t('Texto más grande')}>A</button>
      </div>`} />
    <div class="subbar">
      <button class="chip" onClick=${pickFrom}>
        ${langLabel(eng.from)} <${Icon} name="arrow" size=${15} /> ${langLabel(to)}
        <${Icon} name="down" size=${15} />
      </button>
      <span class="grow"></span>
      <${OutputSeg} value=${output} onChange=${(v) => { setOutput(v); setSettings({ output: v }); }} />
    </div>
    <div class="body" ref=${bodyRef}>
      <div class="listen-body">
        ${!segs.length && !eng.partial.text ? html`<div class="empty-invite" style="margin:10px 0">
          <span class="ic-big" style="background:linear-gradient(140deg,#f472b6,#c026d3);box-shadow:0 12px 24px -10px rgba(192,38,211,.55)"><${Icon} name="wave" size=${30} /></span>
          <h3>${eng.running ? t('Escuchando…') : t('Modo escucha')}</h3>
          <p>${eng.running
            ? t('Acerca el móvil al sonido. Irán apareciendo aquí las frases traducidas.')
            : t('Subtítulos de lo que suena a tu alrededor: una película, la tele, una charla o alguien que habla cerca. No hace falta invitar a nadie. Elige arriba el idioma que se oye, pon el móvil cerca del sonido y pulsa el botón.')}</p>
        </div>` : null}
        ${voiceOnly ? null : older.map((s, i) => html`<div class=${`sub-line ${voiceCls(s)}`} key=${s.id} dir="auto" style=${voiceStyle(s)}>
          <div class="t">${voiceTag(s, older[i - 1])}${formatTime(s.ts)}</div>
          <div style=${rtl ? 'text-align:right' : ''}>${s.tr || html`<span style="color:var(--text-3)">${t('Traduciendo…')}</span>`}</div>
          ${showOrig ? html`<div class="o">${s.text}</div>` : null}
        </div>`)}
        ${last && !voiceOnly ? html`<div class=${`sub-line current ${voiceCls(last)}`} key=${last.id} dir="auto" style=${voiceStyle(last)}>
          ${hasVoice(last) ? html`<div class="t">${voiceTag(last, older[older.length - 1], true)}</div>` : null}
          <div style=${rtl ? 'text-align:right' : ''}>${last.tr || html`<span style="color:var(--text-3)">${t('Traduciendo…')}</span>`}</div>
          ${showOrig ? html`<div class="o">${last.text}</div>` : null}
        </div>` : null}
        ${last && voiceOnly ? html`<div class="sub-line current" style="display:flex;align-items:center;gap:12px;color:var(--text-2)">
          <${Icon} name="volume" size=${28} />${t('Escuchando en tu idioma…')}
        </div>` : null}
        ${eng.partial.text && !voiceOnly ? html`<div class="sub-line partial" dir="auto">
          <div class="t"><span class="dots"><i></i><i></i><i></i></span></div>
          <div>${eng.partial.tr || eng.partial.text}</div>
          ${showOrig && eng.partial.tr ? html`<div class="o">${eng.partial.text}</div>` : null}
        </div>` : null}
      </div>
    </div>
    <div class="footer">
      <div class="listen-foot">
        <button class="icon-btn soft" style="width:52px;height:52px" disabled=${!segs.length} onClick=${() => { eng.reset(); toast(t('Guardado en el historial')); }} aria-label=${t('Empezar de nuevo')}>
          <${Icon} name="refresh" />
        </button>
        <button class=${`listen-btn ${eng.running ? 'on' : ''}`} onClick=${toggle} aria-label=${eng.running ? t('Pausar') : t('Empezar a escuchar')}>
          <${Icon} name=${eng.running ? 'pause' : 'play'} size=${34} />
        </button>
        <span style="width:52px"></span>
      </div>
      <div class="mic-hint">${eng.running ? t('Toca para pausar') : t('Toca para empezar a escuchar')}</div>
    </div>
  </div>`;
}
