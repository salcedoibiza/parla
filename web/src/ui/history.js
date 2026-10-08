import { useEffect, useReducer } from 'preact/hooks';
import { html } from './h.js';
import { Icon } from './icons.js';
import { store, navigate, popScreen, confirmDialog, toast } from '../core/store.js';
import { t, formatDateTime, formatTime, formatDate } from '../core/i18n.js';
import { Topbar, langLabel } from './common.js';
import { listHistory, getHistory, deleteHistory, onHistory, clearHistory } from '../core/history.js';
import { lang as langInfo, trCode } from '../core/langs.js';
import { share, copy } from '../core/native.js';

function useHistoryTick() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => onHistory(() => force()), []);
}

function titleOf(h) {
  if (h.title) return h.title;
  const names = Object.entries(h.participants || {})
    .filter(([uid]) => uid !== h.myUid)
    .map(([, p]) => p.name);
  if (h.mode === 'listen') {
    const m = (h.messages || [])[0];
    return t('Escucha · {lang}', { lang: langLabel((m && m.lang) || 'en') });
  }
  if (h.mode === 'talk') {
    return h.role === 'host' ? t('Tu discurso') : t('Discurso de {name}', { name: h.hostName || names[0] || '?' });
  }
  if (!names.length) return t('Conversación');
  return t('Con {names}', { names: names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '') });
}

export function historyToText(h) {
  const lines = [];
  lines.push(`Parla · ${titleOf(h)}`);
  lines.push(formatDateTime(h.startedAt));
  const ps = Object.values(h.participants || {}).map((p) => `${p.name} (${langLabel(p.lang)})`);
  if (ps.length) lines.push(`${t('Participantes')}: ${ps.join(', ')}`);
  lines.push('');
  for (const m of h.messages || []) {
    const who = m.own ? t('Yo') : m.name;
    const body = m.own ? m.text : (m.mine || m.text);
    lines.push(who ? `[${formatTime(m.ts)}] ${who}: ${body}` : `[${formatTime(m.ts)}] ${body}`);
    if (!m.own && m.mine && trCode(m.lang) !== trCode(h.myLang)) lines.push(`    (${langInfo(m.lang).id}) ${m.text}`);
  }
  return lines.join('\n');
}

export function HistoryScreen() {
  useHistoryTick();
  const items = listHistory().filter((h) => (h.messages || []).length > 0);
  return html`<div class="screen">
    <${Topbar} onBack=${popScreen} title=${t('Historial')} right=${items.length ? html`<button class="icon-btn" aria-label=${t('Borrar todo')} onClick=${async () => {
      const ok = await confirmDialog({ title: t('¿Borrar todo el historial?'), text: t('No se puede deshacer.'), ok: t('Borrar'), cancel: t('Cancelar'), danger: true });
      if (ok) clearHistory();
    }}><${Icon} name="trash" /></button>` : null} />
    <div class="body">
      ${!items.length ? html`<div class="empty">
        <span class="ic-big muted"><${Icon} name="history" size=${30} /></span>
        <div style="font-weight:600;color:var(--text);font-size:17px;margin-bottom:6px">${t('Aún no hay conversaciones')}</div>
        <div>${t('Aquí se guardarán tus conversaciones para que puedas releerlas o compartirlas.')}</div>
      </div>` : html`<div class="pad hist-list" style="padding-top:0">
        ${items.map((h) => {
          const last = h.messages[h.messages.length - 1];
          const icon = h.mode === 'talk' ? 'megaphone' : h.mode === 'listen' ? 'wave' : 'chat';
          const who = last ? (last.own ? t('Tú') : last.name) : '';
          const txt = last ? (last.own ? last.text : (last.mine || last.text)) : '';
          return html`<button class=${`hist-item m-${h.mode || 'conv'}`} key=${h.id} onClick=${() => navigate('historyDetail', { id: h.id })}>
            <span class="ic"><${Icon} name=${icon} size=${22} /></span>
            <span class="grow">
              <div class="t1">${titleOf(h)}</div>
              <div class="t2">${who ? `${who}: ${txt}` : txt}</div>
            </span>
            <span class="when">${formatDate(h.startedAt)}</span>
          </button>`;
        })}
      </div>`}
    </div>
  </div>`;
}

export function HistoryDetailScreen({ params }) {
  useHistoryTick();
  const h = getHistory(params.id);
  if (!h) {
    return html`<div class="screen"><${Topbar} onBack=${popScreen} title=${t('Historial')} /><div class="empty">${t('Esta conversación ya no existe.')}</div></div>`;
  }
  const myLang = store.profile.lang;
  return html`<div class="screen">
    <${Topbar} onBack=${popScreen} title=${titleOf(h)} sub=${formatDateTime(h.startedAt)} right=${html`
      <button class="icon-btn" aria-label=${t('Compartir')} onClick=${() => share(historyToText(h), titleOf(h))}><${Icon} name="share" /></button>
      <button class="icon-btn" aria-label=${t('Borrar')} onClick=${async () => {
        const ok = await confirmDialog({ title: t('¿Borrar esta conversación?'), text: t('No se puede deshacer.'), ok: t('Borrar'), cancel: t('Cancelar'), danger: true });
        if (ok) { deleteHistory(h.id); popScreen(); }
      }}><${Icon} name="trash" /></button>
    `} />
    <div class="body">
      <div class="msgs">
        ${(h.messages || []).map((m) => (m.own
          ? html`<div class="msg own" key=${m.id}><div style="display:flex;flex-direction:column;align-items:flex-end">
              <div class="bubble" dir="auto">${m.text}</div>
              <div class="msg-status" style="margin:4px 6px 0">${formatTime(m.ts)}</div>
            </div></div>`
          : html`<div class="msg" key=${m.id}><div style="min-width:0">
              <div class="meta">${m.name ? `${m.name} · ` : ""}${formatTime(m.ts)}</div>
              <div class="bubble">
                <div dir="auto">${m.mine || m.text}</div>
                ${trCode(m.lang) !== trCode(myLang) ? html`<div class="orig"><span class="code">${langInfo(m.lang).id.split('-')[0]}</span><span dir="auto">${m.text}</span></div>` : null}
              </div>
            </div></div>`))}
      </div>
    </div>
    <div class="footer">
      <div class="btn-row">
        <button class="btn ghost" onClick=${async () => { if (await copy(historyToText(h))) toast(t('Conversación copiada')); }}><${Icon} name="copy" size=${20} />${t('Copiar')}</button>
        <button class="btn" onClick=${() => share(historyToText(h), titleOf(h))}><${Icon} name="share" size=${20} />${t('Compartir')}</button>
      </div>
    </div>
  </div>`;
}
