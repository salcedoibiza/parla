// Genera web/src/core/mtindex-data.js: la lista de modelos de traducción de Mozilla que usa Parla.
// Entrada: el registro de Mozilla (db/models.json) y la lista de archivos del espejo de Hugging Face.
// Uso: node tools/mtindex.mjs <models.json> <hf-tree.json>
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [dbFile, hfFile, gzFile] = process.argv.slice(2);
const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
const hfTree = hfFile ? JSON.parse(fs.readFileSync(hfFile, 'utf8')) : [];
const hfSizes = new Map(hfTree.filter((x) => x.type === 'file').map((x) => [x.path, (x.lfs && x.lfs.size) || x.size]));

// Código de Parla (el del traductor) → código de Mozilla
const LANGS = {
  es: 'es', it: 'it', fr: 'fr', de: 'de', pt: 'pt', ca: 'ca', gl: 'gl', eu: 'eu', nl: 'nl', ru: 'ru', uk: 'uk', pl: 'pl',
  cs: 'cs', sk: 'sk', sl: 'sl', hr: 'hr', sr: 'sr', bg: 'bg', ro: 'ro', hu: 'hu', el: 'el', tr: 'tr', sv: 'sv', da: 'da',
  no: 'no', fi: 'fi', et: 'et', lv: 'lv', lt: 'lt', sq: 'sq', ar: 'ar', iw: 'he', fa: 'fa', ur: 'ur', hi: 'hi', bn: 'bn',
  ta: 'ta', th: 'th', vi: 'vi', id: 'id', ms: 'ms', tl: 'tl', 'zh-CN': 'zh', 'zh-TW': 'zh_hant', ja: 'ja', ko: 'ko', af: 'af', sw: 'sw',
};
// Si no hay modelo de un idioma al inglés, se usa el de un idioma muy cercano
const TO_EN_ALT = { hr: 'hbs', sr: 'hbs', bs: 'hbs' };
const PREF = ['Release Android', 'Release', 'Release Desktop'];
const KIND = { model: 'model', lexicalShortlist: 'lex', vocab: 'vocab', srcVocab: 'srcvocab', trgVocab: 'trgvocab' };
// Tamaños comprimidos (opcional): salida de la comprobación de tamaños en GitHub Actions
const gzSizes = new Map();
if (gzFile) {
  const g = JSON.parse(fs.readFileSync(gzFile, 'utf8'));
  for (const [p, e] of Object.entries(g.pairs)) for (const f of Object.values(e.files)) gzSizes.set(`${p}/${f.name.replace(/\.gz$/, '')}`, f.gz);
}
const hfPair = (p) => p.replace(/zh_hant/g, 'zh-Hant');

function pick(pair) {
  const es = db.models[pair];
  if (!es) return null;
  for (const s of PREF) {
    const e = es.find((x) => x.releaseStatus === s);
    if (e) return e;
  }
  return null;
}

const pairs = {};
function addPair(pair) {
  if (pairs[pair]) return true;
  const e = pick(pair);
  if (!e) return false;
  const files = [];
  for (const [k, f] of Object.entries(e.files)) {
    if (!f || !f.path || !KIND[k]) continue;
    const name = path.basename(f.path).replace(/\.gz$/, '');
    files.push({ k: KIND[k], name, path: f.path, size: f.uncompressedSize || hfSizes.get(`${hfPair(pair)}/${name}`) || 0, gz: gzSizes.get(`${pair}/${name}`) || 0, sha: f.uncompressedHash || null });
  }
  // El espejo de Hugging Face solo sirve si tiene exactamente los mismos archivos
  const hfOk = files.every((f) => hfSizes.has(`${hfPair(pair)}/${f.name}`));
  pairs[pair] = { files, hf: hfOk ? hfPair(pair) : null, comet: (e.metrics && e.metrics['flores200-plus'] && e.metrics['flores200-plus'].comet22) || null };
  return true;
}

const packs = {};
for (const [tr, m] of Object.entries(LANGS)) {
  const toEn = addPair(`${m}-en`) ? `${m}-en` : (TO_EN_ALT[m] && addPair(`${TO_EN_ALT[m]}-en`) ? `${TO_EN_ALT[m]}-en` : null);
  const fromEn = addPair(`en-${m}`) ? `en-${m}` : null;
  if (toEn && fromEn) packs[tr] = [toEn, fromEn];
  else console.log('sin modelos:', tr, toEn, fromEn);
}

const out = `// Generado por tools/mtindex.mjs a partir del registro de modelos de Mozilla (${db.generated}). No editar a mano.
// Modelos de Firefox Translations (Mozilla, licencia MPL-2.0).
export const MT_GCS = ${JSON.stringify(db.baseUrl.replace(/\/$/, '') + '/')};
export const MT_HF = 'https://huggingface.co/midudev/firefox-translations/resolve/main/';
// Idioma (código del traductor) → [idioma→inglés, inglés→idioma]
export const MT_PACKS = ${JSON.stringify(packs)};
// k: tipo de archivo, name: nombre, path: ruta en el servidor de Mozilla (.gz), size: bytes sin comprimir, gz: bytes comprimido, sha: sha256 sin comprimir
export const MT_PAIRS = ${JSON.stringify(pairs)};
`;
fs.writeFileSync(path.join(root, 'web/src/core/mtindex-data.js'), out);
console.log('packs', Object.keys(packs).length, 'pairs', Object.keys(pairs).length, 'sin hf', Object.entries(pairs).filter(([, v]) => !v.hf).map(([k]) => k).join(' '));
