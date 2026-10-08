// Prueba de la lectura en directo con una cámara simulada que enfoca un cartel.
// 1) web (Tesseract)  2) app (lector de Google simulado)
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { startServers } from './testserver.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const shots = path.join(root, 'out/shots');
fs.mkdirSync(shots, { recursive: true });
const S = await startServers({ mqttPort: 8885, webPort: 8083, trPort: 8093, trDelay: 250 });
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${path.join(root, 'out/sign.y4m')}`],
});
let fails = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++; };

function mockOcr() {
  const emit = (ev) => window.__parlaNative && window.__parlaNative(ev);
  window.__ocrCalls = 0;
  window.ParlaNative = {
    info: () => '{}', getInitialLink: () => '', log() {}, isSystemDark: () => false, setSystemBars() {}, keepAwake() {},
    hasMicPermission: () => true, hasCameraPermission: () => true, vibrate() {},
    translate(id, text, sl, tl) { emit({ type: 'translate', id, ok: false, error: 'no' }); },
    hasOcr: () => true,
    ocrWarmUp() {},
    ocr(id, url) {
      window.__ocrCalls++;
      const img = new Image();
      img.onload = () => {
        const w = img.width;
        const h = img.height;
        const B = (t, a, b, c, d) => ({ text: t, lang: 'en', box: [a * w, b * h, c * w, d * h], lines: [{ text: t, box: [a * w, b * h, c * w, d * h] }] });
        setTimeout(() => emit({
          type: 'ocr', id, ok: true, w, h, ms: 120,
          blocks: [
            B('Beach Restaurant', 0.08, 0.36, 0.9, 0.41),
            B('Open every day from noon until midnight.', 0.08, 0.43, 0.9, 0.5),
            B('Please wait here to be seated by our staff.', 0.08, 0.53, 0.98, 0.6),
          ],
        }), 120);
      };
      img.src = url;
    },
  };
}

function mockLocal() {
  const emit = (ev) => window.__parlaNative && window.__parlaNative(ev);
  const N = window.ParlaNative;
  N.hasLocalTr = () => true;
  N.localModels = () => setTimeout(() => emit({ type: 'trmodels', downloaded: ['en', 'es'], downloading: [], supported: ['en', 'es', 'fr'] }), 5);
  N.localDownload = () => {};
  N.localTranslate = (id, text, sl, tl) => setTimeout(() => emit({ type: 'localtr', id, ok: true, text: `[L-${tl}] ${text}` }), 20);
}

async function run(label, app, local = false) {
  console.log(label);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'es-ES', permissions: ['camera'] });
  await ctx.addInitScript(({ mqtt, tr, web }) => {
    window.__PARLA_BROKERS__ = [mqtt, mqtt, mqtt, mqtt];
    window.__PARLA_TRANSLATE_URL__ = tr;
    window.__PARLA_OCR__ = { corePath: `${web}_tcore`, langPath: `${web}_tdata/eng/4.0.0_best_int` };
    localStorage.setItem('parla.profile', JSON.stringify({ uid: 'x1', name: 'Ana', lang: 'es', photo: '', photoSmall: '' }));
  }, { mqtt: S.urls.mqtt, tr: S.urls.tr, web: S.urls.web });
  if (app) await ctx.addInitScript(mockOcr);
  if (local) await ctx.addInitScript(mockLocal);
  const page = await ctx.newPage();
  // Con la traducción del móvil, Google se simula lento para ver que la del móvil sale antes
  if (local) await page.route(`${S.urls.tr}**`, async (route) => { await new Promise((r) => setTimeout(r, 1500)); route.continue(); });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(S.urls.web);
  await page.click('.mode.m-read');
  await page.waitForSelector('.read-intro');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shots, `46-read-intro-${app ? 'app' : 'web'}.png`) });
  await page.click('.read-intro .btn');
  const t0 = Date.now();
  await page.waitForSelector('.live-layer .ov', { timeout: 90000 });
  const firstMs = Date.now() - t0;
  if (local) {
    const first = await page.textContent('.live-layer .ov');
    ok(/\[L-es\]/.test(first) && firstMs < 1500, `primero sale la traducción del móvil (${firstMs} ms): ${first}`);
    await page.waitForFunction(() => [...document.querySelectorAll('.live-layer .ov')].some((e) => /^\[es\]/.test(e.textContent)), null, { timeout: 8000 });
    ok(true, 'después la sustituye la de Google');
  }
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(shots, `47-live-${app ? 'app' : 'web'}${local ? '-local' : ''}.png`) });
  const ovs = await page.$$eval('.live-layer .ov', (els) => els.map((e) => e.textContent));
  ok(ovs.length >= 2, `traducción sobre la cámara (${ovs.length} bloques, primera en ${firstMs} ms)`);
  console.log('    ', ovs.join(' | '));
  const pill = await page.textContent('.lang-pair');
  console.log('     idiomas:', pill.trim());
  if (app) {
    ok(/Inglés/.test(pill), 'detecta el idioma solo');
    const calls1 = await page.evaluate(() => window.__ocrCalls);
    await page.waitForTimeout(2000);
    const calls2 = await page.evaluate(() => window.__ocrCalls);
    ok(calls2 - calls1 >= 4, `sigue leyendo en directo (${calls2 - calls1} lecturas en 2 s)`);
  }
  await page.click('.shutter');
  await page.waitForSelector('.read-result', { timeout: 60000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shots, `48-frozen-${app ? 'app' : 'web'}.png`) });
  const txt = await page.textContent('.read-bottom .txt');
  ok(/\[es\] Beach Restaurant/.test(txt), 'imagen congelada con el texto traducido');
  await ctx.close();
}

await run('Web (Tesseract)', false);
await run('App (lector de Google simulado)', true);
await run('App con la traducción del móvil (Google lento)', true, true);
await browser.close();
await S.close();
console.log(fails ? `${fails} FALLOS` : 'TODO OK');
process.exit(fails ? 1 : 0);
