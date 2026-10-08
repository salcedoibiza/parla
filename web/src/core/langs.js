// Idiomas disponibles. id: identificador interno; tr: código para el traductor;
// bcp: código para voz (dictado y lectura en voz alta); ocr: código de Tesseract para el modo lectura.
export const LANGS = [
  { id: 'es', name: 'Español', tr: 'es', bcp: 'es-ES', ocr: 'spa' },
  { id: 'en', name: 'English (US)', tr: 'en', bcp: 'en-US', ocr: 'eng' },
  { id: 'en-GB', name: 'English (UK)', tr: 'en', bcp: 'en-GB', ocr: 'eng' },
  { id: 'it', name: 'Italiano', tr: 'it', bcp: 'it-IT', ocr: 'ita' },
  { id: 'fr', name: 'Français', tr: 'fr', bcp: 'fr-FR', ocr: 'fra' },
  { id: 'de', name: 'Deutsch', tr: 'de', bcp: 'de-DE', ocr: 'deu' },
  { id: 'pt', name: 'Português (Portugal)', tr: 'pt', bcp: 'pt-PT', ocr: 'por' },
  { id: 'pt-BR', name: 'Português (Brasil)', tr: 'pt', bcp: 'pt-BR', ocr: 'por' },
  { id: 'ca', name: 'Català', tr: 'ca', bcp: 'ca-ES', ocr: 'cat' },
  { id: 'gl', name: 'Galego', tr: 'gl', bcp: 'gl-ES', ocr: 'glg' },
  { id: 'eu', name: 'Euskara', tr: 'eu', bcp: 'eu-ES', ocr: 'eus' },
  { id: 'nl', name: 'Nederlands', tr: 'nl', bcp: 'nl-NL', ocr: 'nld' },
  { id: 'ru', name: 'Русский', tr: 'ru', bcp: 'ru-RU', ocr: 'rus' },
  { id: 'uk', name: 'Українська', tr: 'uk', bcp: 'uk-UA', ocr: 'ukr' },
  { id: 'pl', name: 'Polski', tr: 'pl', bcp: 'pl-PL', ocr: 'pol' },
  { id: 'cs', name: 'Čeština', tr: 'cs', bcp: 'cs-CZ', ocr: 'ces' },
  { id: 'sk', name: 'Slovenčina', tr: 'sk', bcp: 'sk-SK', ocr: 'slk' },
  { id: 'sl', name: 'Slovenščina', tr: 'sl', bcp: 'sl-SI', ocr: 'slv' },
  { id: 'hr', name: 'Hrvatski', tr: 'hr', bcp: 'hr-HR', ocr: 'hrv' },
  { id: 'sr', name: 'Српски', tr: 'sr', bcp: 'sr-RS', ocr: 'srp' },
  { id: 'bg', name: 'Български', tr: 'bg', bcp: 'bg-BG', ocr: 'bul' },
  { id: 'ro', name: 'Română', tr: 'ro', bcp: 'ro-RO', ocr: 'ron' },
  { id: 'hu', name: 'Magyar', tr: 'hu', bcp: 'hu-HU', ocr: 'hun' },
  { id: 'el', name: 'Ελληνικά', tr: 'el', bcp: 'el-GR', ocr: 'ell' },
  { id: 'tr', name: 'Türkçe', tr: 'tr', bcp: 'tr-TR', ocr: 'tur' },
  { id: 'sv', name: 'Svenska', tr: 'sv', bcp: 'sv-SE', ocr: 'swe' },
  { id: 'da', name: 'Dansk', tr: 'da', bcp: 'da-DK', ocr: 'dan' },
  { id: 'no', name: 'Norsk', tr: 'no', bcp: 'nb-NO', ocr: 'nor' },
  { id: 'fi', name: 'Suomi', tr: 'fi', bcp: 'fi-FI', ocr: 'fin' },
  { id: 'et', name: 'Eesti', tr: 'et', bcp: 'et-EE', ocr: 'est' },
  { id: 'lv', name: 'Latviešu', tr: 'lv', bcp: 'lv-LV', ocr: 'lav' },
  { id: 'lt', name: 'Lietuvių', tr: 'lt', bcp: 'lt-LT', ocr: 'lit' },
  { id: 'sq', name: 'Shqip', tr: 'sq', bcp: 'sq-AL', ocr: 'sqi' },
  { id: 'ar', name: 'العربية', tr: 'ar', bcp: 'ar-SA', ocr: 'ara', rtl: true },
  { id: 'he', name: 'עברית', tr: 'iw', bcp: 'he-IL', ocr: 'heb', rtl: true },
  { id: 'fa', name: 'فارسی', tr: 'fa', bcp: 'fa-IR', ocr: 'fas', rtl: true },
  { id: 'ur', name: 'اردو', tr: 'ur', bcp: 'ur-PK', ocr: 'urd', rtl: true },
  { id: 'hi', name: 'हिन्दी', tr: 'hi', bcp: 'hi-IN', ocr: 'hin' },
  { id: 'bn', name: 'বাংলা', tr: 'bn', bcp: 'bn-IN', ocr: 'ben' },
  { id: 'ta', name: 'தமிழ்', tr: 'ta', bcp: 'ta-IN', ocr: 'tam' },
  { id: 'th', name: 'ไทย', tr: 'th', bcp: 'th-TH', ocr: 'tha' },
  { id: 'vi', name: 'Tiếng Việt', tr: 'vi', bcp: 'vi-VN', ocr: 'vie' },
  { id: 'id', name: 'Bahasa Indonesia', tr: 'id', bcp: 'id-ID', ocr: 'ind' },
  { id: 'ms', name: 'Bahasa Melayu', tr: 'ms', bcp: 'ms-MY', ocr: 'msa' },
  { id: 'fil', name: 'Filipino', tr: 'tl', bcp: 'fil-PH', ocr: 'tgl' },
  { id: 'zh-CN', name: '中文（简体）', tr: 'zh-CN', bcp: 'zh-CN', ocr: 'chi_sim' },
  { id: 'zh-TW', name: '中文（繁體）', tr: 'zh-TW', bcp: 'zh-TW', ocr: 'chi_tra' },
  { id: 'ja', name: '日本語', tr: 'ja', bcp: 'ja-JP', ocr: 'jpn' },
  { id: 'ko', name: '한국어', tr: 'ko', bcp: 'ko-KR', ocr: 'kor' },
  { id: 'sw', name: 'Kiswahili', tr: 'sw', bcp: 'sw-KE', ocr: 'swa' },
  { id: 'af', name: 'Afrikaans', tr: 'af', bcp: 'af-ZA', ocr: 'afr' },
];

const byId = new Map(LANGS.map((l) => [l.id, l]));

export function lang(id) {
  return byId.get(id) || byId.get(String(id || '').split('-')[0]) || byId.get('en');
}

export function trCode(id) { return lang(id).tr; }
export function bcp(id) { return lang(id).bcp; }
export function isRtl(id) { return !!lang(id).rtl; }

// Nombre del idioma en el idioma de la interfaz (p. ej. "italiano" en español)
const dnCache = new Map();
export function localName(id, uiLangId) {
  const key = `${uiLangId}|${id}`;
  if (dnCache.has(key)) return dnCache.get(key);
  let out = lang(id).name;
  try {
    const dn = new Intl.DisplayNames([lang(uiLangId).bcp], { type: 'language' });
    const n = dn.of(lang(id).id);
    if (n) out = n.charAt(0).toLocaleUpperCase(lang(uiLangId).bcp) + n.slice(1);
  } catch { /* sin Intl.DisplayNames */ }
  dnCache.set(key, out);
  return out;
}

// Adivina el idioma a partir del idioma del dispositivo
export function guessLang() {
  const cands = [];
  try {
    if (navigator.languages) cands.push(...navigator.languages);
    if (navigator.language) cands.push(navigator.language);
  } catch { /* */ }
  for (const c of cands) {
    if (!c) continue;
    const exact = LANGS.find((l) => l.bcp.toLowerCase() === c.toLowerCase() || l.id.toLowerCase() === c.toLowerCase());
    if (exact) return exact.id;
    const base = c.split('-')[0].toLowerCase();
    const b = LANGS.find((l) => l.id === base || l.tr === base);
    if (b) return b.id;
  }
  return 'es';
}
