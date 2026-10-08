// Genera los iconos PNG (web y Android antiguo) a partir del logotipo SVG.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ACC = '#4F46E5';
const BACK = 'M57,30 H67 A13,13 0 0 1 80,43 V68 L69,60 H57 A13,13 0 0 1 44,47 V43 A13,13 0 0 1 57,30 Z';
const FRONT = 'M41,44 H51 A13,13 0 0 1 64,57 V61 A13,13 0 0 1 51,74 H39 L28,82 V57 A13,13 0 0 1 41,44 Z';

function svg({ rounded, circle, full }) {
  const bg = circle
    ? `<circle cx="54" cy="54" r="54" fill="${ACC}"/>`
    : `<rect width="108" height="108" rx="${full ? 0 : rounded}" fill="${ACC}"/>`;
  // En el icono "maskable" la marca se reduce para caber en la zona segura
  const g = full ? 'transform="translate(10.8 10.8) scale(0.8)"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">${bg}<g ${g}>
    <path fill="#fff" fill-opacity="0.5" d="${BACK}"/>
    <path fill="#fff" stroke="${ACC}" stroke-width="4" d="${FRONT}"/></g></svg>`;
}

const jobs = [
  { out: 'web/public/icons/icon-192.png', size: 192, opt: { rounded: 24 } },
  { out: 'web/public/icons/icon-512.png', size: 512, opt: { rounded: 24 } },
  { out: 'web/public/icons/icon-180.png', size: 180, opt: { full: true } },
  { out: 'web/public/icons/icon-maskable-512.png', size: 512, opt: { full: true } },
  { out: 'android/res/mipmap-mdpi/ic_launcher.png', size: 48, opt: { circle: true } },
  { out: 'android/res/mipmap-hdpi/ic_launcher.png', size: 72, opt: { circle: true } },
  { out: 'android/res/mipmap-xhdpi/ic_launcher.png', size: 96, opt: { circle: true } },
  { out: 'android/res/mipmap-xxhdpi/ic_launcher.png', size: 144, opt: { circle: true } },
  { out: 'android/res/mipmap-xxxhdpi/ic_launcher.png', size: 192, opt: { circle: true } },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
for (const j of jobs) {
  await page.setViewportSize({ width: j.size, height: j.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(j.opt).replace('<svg ', `<svg width="${j.size}" height="${j.size}" `)}</body></html>`);
  const out = path.join(root, j.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: j.size, height: j.size } });
  console.log('icon', j.out);
}
await browser.close();
