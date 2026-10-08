// Registro de diagnóstico: guarda los últimos eventos para poder enviarlos si algo falla.
const MAX = 300;
const KEY = 'parla.logs';
let buf = [];
try { buf = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { buf = []; }
let saveTimer = null;

function fmt(a) {
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  if (typeof a === 'object') {
    try { return JSON.stringify(a).slice(0, 400); } catch { return String(a); }
  }
  return String(a);
}

export function log(...args) {
  const line = `${new Date().toISOString().slice(11, 23)} ${args.map(fmt).join(' ')}`;
  buf.push(line);
  if (buf.length > MAX) buf = buf.slice(-MAX);
  try { console.log('[parla]', ...args); } catch { /* */ }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(buf)); } catch { /* */ }
  }, 500);
}

export function getLogs() { return buf.slice(); }
export function clearLogs() {
  buf = [];
  try { localStorage.removeItem(KEY); } catch { /* */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => log('ERROR', e.message, e.filename ? `${e.filename}:${e.lineno}` : ''));
  window.addEventListener('unhandledrejection', (e) => log('REJECTION', e.reason && (e.reason.message || e.reason)));
}
