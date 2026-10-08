// Prueba de la lectura en directo con una cámara simulada que enfoca un cartel.
import { chromium } from 'playwright';
import path from 'path';
import { startServers } from './testserver.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const S = await startServers({ mqttPort: 8885, webPort: 8083, trPort: 8093 });
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${path.join(root, 'out/sign.y4m')}`],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'es-ES', permissions: ['camera'] });
await ctx.addInitScript(({ mqtt, tr, web }) => {
  window.__PARLA_BROKERS__ = [mqtt, mqtt, mqtt, mqtt];
  window.__PARLA_TRANSLATE_URL__ = tr;
  window.__PARLA_OCR__ = { corePath: `${web}_tcore`, langPath: `${web}_tdata/eng/4.0.0_best_int` };
  localStorage.setItem('parla.profile', JSON.stringify({ uid: 'x1', name: 'Ana', lang: 'es', photo: '', photoSmall: '' }));
}, { mqtt: S.urls.mqtt, tr: S.urls.tr, web: S.urls.web });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (/fail|error/i.test(m.text())) console.log('console:', m.text().slice(0, 200)); });
await page.goto(S.urls.web);
await page.click('.mode.m-read');
await page.waitForSelector('.read-status', { timeout: 10000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(root, 'out/shots/43-live-status.png') });
await page.waitForSelector('.live-layer .ov', { timeout: 90000 });
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(root, 'out/shots/44-live-read.png') });
const ovs = await page.$$eval('.live-layer .ov', (els) => els.map((e) => e.textContent));
console.log('en directo:', ovs);
await page.click('.shutter');
await page.waitForSelector('.read-result', { timeout: 30000 });
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(root, 'out/shots/45-frozen.png') });
await browser.close();
await S.close();
process.exit(ovs.length ? 0 : 1);
