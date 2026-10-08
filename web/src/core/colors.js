// Colores para distinguir a cada persona que habla (y cada voz en el modo escucha).
// Tonos medios que se leen bien sobre fondo claro y oscuro. No incluye el índigo,
// que es el color de tus propios mensajes.
export const SPEAKER_COLORS = [
  '#F2711C', // naranja
  '#0EA5E9', // azul cielo
  '#10B981', // esmeralda
  '#E8478B', // rosa
  '#8B5CF6', // violeta
  '#CA8A04', // ámbar
  '#E5484D', // rojo
  '#0D9488', // verde azulado
];

function hash(s) {
  let h = 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

/** Asigna colores distintos a cada persona de una sesión (el primero que llega, primero elige). */
export class ColorBook {
  constructor() { this.map = new Map(); }

  of(uid, preferred = null) {
    if (this.map.has(uid)) return SPEAKER_COLORS[this.map.get(uid)];
    const used = new Set(this.map.values());
    const n = SPEAKER_COLORS.length;
    const start = preferred !== null ? preferred : hash(uid) % n;
    let idx = start;
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      if (!used.has(i)) { idx = i; break; }
    }
    this.map.set(uid, idx);
    return SPEAKER_COLORS[idx];
  }
}
