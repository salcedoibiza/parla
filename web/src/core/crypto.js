// Códigos de sesión y cifrado de extremo a extremo (AES-GCM).
// El código (p. ej. KX7P-Q2MA) es la única llave: de él salen el canal y la clave de cifrado,
// así que el servidor de mensajería solo ve datos cifrados.

// Sin I, O, 0, 1 para evitar confusiones al dictarlo.
export const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LEN = 8;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomCode(brokerIndex = 0, brokerCount = 3) {
  const bytes = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % 32]);
  // El primer carácter indica en qué servidor está la sesión.
  const first = ALPHABET.indexOf(chars[0]);
  const want = brokerIndex % brokerCount;
  const adj = first - (first % brokerCount) + want;
  chars[0] = ALPHABET[adj < 32 ? adj : want];
  return chars.join('');
}

export function brokerOf(code, brokerCount = 3) {
  const i = ALPHABET.indexOf(code[0]);
  return i < 0 ? 0 : i % brokerCount;
}

export function normalizeCode(input) {
  if (!input) return '';
  let s = String(input).trim();
  // Acepta enlaces completos: ...#j=CODE, parla://j/CODE, ?j=CODE
  const m = s.match(/(?:[#?&]j=|parla:\/\/j\/|parla:)([A-Za-z0-9-]{8,12})/i);
  if (m) s = m[1];
  s = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== CODE_LEN) return '';
  for (const c of s) if (!ALPHABET.includes(c)) return '';
  return s;
}

export function formatCode(code) {
  return code ? `${code.slice(0, 4)}-${code.slice(4)}` : '';
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Deriva el canal y la clave a partir del código. */
export async function deriveSession(code, purpose = 'session') {
  const material = await crypto.subtle.importKey('raw', enc.encode(`${purpose}:${code}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode('parla.v1.salt'), iterations: 120000, hash: 'SHA-256' },
    material,
    384,
  );
  const keyBytes = bits.slice(0, 32);
  const topicBytes = bits.slice(32, 48);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { key, topic: toHex(topicBytes) };
}

export async function encryptJson(key, obj) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const data = enc.encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return out;
}

export async function decryptJson(key, payload) {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  if (bytes.length < 13) return null;
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(dec.decode(pt));
  } catch {
    return null;
  }
}
