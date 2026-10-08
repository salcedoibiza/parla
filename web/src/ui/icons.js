import { html } from './h.js';

const P = {
  mic: '<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M18.5 10.5v.5a6.5 6.5 0 0 1-13 0v-.5"/><path d="M12 17.5V21"/>',
  keyboard: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M6.5 9.5h.01M10 9.5h.01M14 9.5h.01M17.5 9.5h.01M6.5 12.8h.01M17.5 12.8h.01M8 15.5h8"/>',
  send: '<path d="M12 19V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><path d="M14 14h3v3h-3zM20.5 14v.01M14 20.5h.01M17 20.5h3.5V17"/>',
  scan: '<path d="M3 7.5V5.5A2.5 2.5 0 0 1 5.5 3h2M16.5 3h2A2.5 2.5 0 0 1 21 5.5v2M21 16.5v2a2.5 2.5 0 0 1-2.5 2.5h-2M7.5 21h-2A2.5 2.5 0 0 1 3 18.5v-2"/><path d="M7 12h10"/>',
  camera: '<path d="M14.5 4h-5L7.5 6.5H5a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5a2 2 0 0 0-2-2h-2.5z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3.5"/><circle cx="9" cy="9" r="1.8"/><path d="m21 15-4.5-4.5L6 21"/>',
  chat: '<path d="M14.5 9.5a2 2 0 0 1-2 2H7l-3.5 3v-10a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2z"/><path d="M18 9h1.5a2 2 0 0 1 2 2v10L18 18h-6a2 2 0 0 1-2-2v-1.5"/>',
  megaphone: '<path d="M3 10.5v3a1 1 0 0 0 1 1h2l6 4.5V5L6 9.5H4a1 1 0 0 0-1 1z"/><path d="M16 8.5a5 5 0 0 1 0 7M19 5.5a9 9 0 0 1 0 13"/>',
  read: '<path d="M3 7.5V5.5A2.5 2.5 0 0 1 5.5 3h2M16.5 3h2A2.5 2.5 0 0 1 21 5.5v2M21 16.5v2a2.5 2.5 0 0 1-2.5 2.5h-2M7.5 21h-2A2.5 2.5 0 0 1 3 18.5v-2"/><path d="M7.5 8.5h9M7.5 12h9M7.5 15.5h5.5"/>',
  users: '<path d="M16 20.5v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1.5"/><circle cx="9" cy="7.5" r="3.8"/><path d="M22 20.5v-1.5a4 4 0 0 0-3-3.87M16 3.63a3.8 3.8 0 0 1 0 7.5"/>',
  userPlus: '<path d="M15 20.5v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1.5"/><circle cx="8.5" cy="7.5" r="3.8"/><path d="M19 8v6M22 11h-6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  back: '<path d="M15 18.5 8.5 12 15 5.5"/>',
  chevron: '<path d="m9.5 18 6-6-6-6"/>',
  down: '<path d="m6 9.5 6 6 6-6"/>',
  check: '<path d="M20 6.5 9 17.5l-5-5"/>',
  hand: '<path d="M18 11.5V6.5a2 2 0 0 0-4 0"/><path d="M14 10.5V4.5a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6.5a2 2 0 0 0-4 0V14"/><path d="M18 8.5a2 2 0 1 1 4 0v5.5a8 8 0 0 1-8 8h-1.5c-2.8 0-4.4-.9-5.9-2.4l-3.4-3.5a2 2 0 0 1 2.8-2.8L7.5 15"/>',
  volume: '<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.8 5.2a9.5 9.5 0 0 1 0 13.6"/>',
  volumeOff: '<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="m21.5 9.5-5 5M16.5 9.5l5 5"/>',
  text: '<path d="M4.5 7V4.5h15V7M9 19.5h6M12 4.5v15"/>',
  msgText: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/>',
  both: '<path d="M2.5 9.5v5h3l4.5 4v-13l-4.5 4z"/><path d="M14 8.5h7.5M14 12h7.5M14 15.5h5"/>',
  wave: '<path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 6v12M23 11v2"/>',
  pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1.2" fill="currentColor"/><rect x="14" y="5" width="3.5" height="14" rx="1.2" fill="currentColor"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  freeze: '<circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/>',
  captions: '<rect x="3" y="5" width="18" height="14" rx="3.5"/><path d="M7 15h4M14.5 15H17M7 11h2M12.5 11H17"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M12 7.5V12l3.5 2"/>',
  download: '<path d="M12 3.5v11.5M7 10.5l5 5 5-5"/><path d="M5 20.5h14"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18"/>',
  wifi: '<path d="M5 12.5a10.5 10.5 0 0 1 14 0M2 9a15 15 0 0 1 20 0M8.5 16a5.5 5.5 0 0 1 7 0"/><path d="M12 19.5h.01"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  moon: '<path d="M20.5 14.1A8.5 8.5 0 1 1 9.9 3.5a6.6 6.6 0 0 0 10.6 10.6z"/>',
  share: '<path d="M4.5 12.5V19a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6.5"/><path d="M16 6.5 12 2.5l-4 4M12 2.5v13"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15h-.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5"/>',
  trash: '<path d="M3.5 6h17M8.5 6V4.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V6M18.5 6l-.9 13.5a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 6"/>',
  logout: '<path d="M9 20.5H5.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2H9M16 16.5l4.5-4.5L16 7.5M20.5 12H9"/>',
  edit: '<path d="M16.5 3.5a2.5 2.5 0 0 1 3.5 3.5L8 19l-4.5 1.5L5 16z"/>',
  phone: '<rect x="5.5" y="2" width="13" height="20" rx="3"/><path d="M11 18.5h2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16.5v-5M12 8h.01"/>',
  activity: '<path d="M21.5 12H18l-3 8.5L9 3.5 6 12H2.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  mail: '<rect x="2.5" y="4.5" width="19" height="15" rx="3"/><path d="m21.5 7.5-9.5 6-9.5-6"/>',
  swap: '<path d="M7.5 3.5 4 7l3.5 3.5M4 7h16M16.5 20.5 20 17l-3.5-3.5M20 17H4"/>',
  arrow: '<path d="M5 12h14M13 5.5l6.5 6.5-6.5 6.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6l2.5 2.5"/><path d="M20.5 3.5v5h-5"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.6l5.8-.8z"/>',
  link: '<path d="M10 13.5a4.5 4.5 0 0 0 6.8.5l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.6 1.6"/><path d="M14 10.5a4.5 4.5 0 0 0-6.8-.5l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6"/>',
  flip: '<path d="M4 13a8 8 0 0 0 14.3 3.5M20 11A8 8 0 0 0 5.7 7.5"/><path d="M4.5 4v4h4M19.5 20v-4h-4"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>',
  bolt: '<path d="M13 2.5 4.5 13.5h7L10.5 21.5 19 10.5h-7z"/>',
  cloudOff: '<path d="m2 2 20 20"/><path d="M5.8 8.2A6 6 0 0 0 7 20h10.5M21.4 16.8A4.5 4.5 0 0 0 17.5 10h-1A7 7 0 0 0 9.8 5.3"/>',
  sparkles: '<path d="M12 3.5 13.8 9 19.5 10.5 13.8 12 12 17.5 10.2 12 4.5 10.5 10.2 9z"/><path d="M19 3v4M21 5h-4"/>',
};

export function Icon({ name, size = 24, stroke = 1.9, style = '' }) {
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round" style=${style} aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: P[name] || '' }}></svg>`;
}

/** Logotipo: dos bocadillos superpuestos. */
export function Logo({ size = 36 }) {
  return html`<svg width=${size} height=${size} viewBox="0 0 108 108" aria-label="Parla">
    <rect width="108" height="108" rx="30" fill="var(--accent)" />
    <path fill="var(--accent-ink)" fill-opacity="0.5" d="M57,30 H67 A13,13 0 0 1 80,43 V68 L69,60 H57 A13,13 0 0 1 44,47 V43 A13,13 0 0 1 57,30 Z" />
    <path fill="var(--accent-ink)" stroke="var(--accent)" stroke-width="4" d="M41,44 H51 A13,13 0 0 1 64,57 V61 A13,13 0 0 1 51,74 H39 L28,82 V57 A13,13 0 0 1 41,44 Z" />
  </svg>`;
}
