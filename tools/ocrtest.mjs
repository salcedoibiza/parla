// Prueba del modo lectura con una imagen generada.
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { startServers } from './testserver.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const shots = path.join(root, 'out/shots');
fs.mkdirSync(shots, { recursive: true });
const S = await startServers({ mqttPort: 8884, webPort: 8082, trPort: 8092 });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// 1) generar un cartel
const gen = await browser.newPage({ viewport: { width: 900, height: 1200 } });
await gen.setContent(`<body style="margin:0;background:#d9d2c5;display:flex;align-items:center;justify-content:center;height:1200px;font-family:Arial">
  <div style="background:#fff;padding:60px 70px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);width:640px">
    <div style="font-size:64px;font-weight:bold;margin-bottom:30px">Beach Restaurant</div>
    <div style="font-size:38px;line-height:1.35;margin-bottom:28px">Open every day from noon until midnight.</div>
    <div style="font-size:38px;line-height:1.35">Please wait here to be seated by our staff.</div>
  </div></body>`);
const img = path.join(root, 'out/sign.png');
await gen.screenshot({ path: img });
await gen.close();

// 2) abrir el modo lectura en la web
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'es-ES' });
await ctx.addInitScript(({ mqtt, tr, web }) => {
  window.__PARLA_BROKERS__ = [mqtt, mqtt, mqtt];
  window.__PARLA_TRANSLATE_URL__ = tr;
  window.__PARLA_OCR__ = { corePath: `${web}_tcore`, langPath: `${web}_tdata/eng/4.0.0_best_int` };
  localStorage.setItem('parla.profile', JSON.stringify({ uid: 'x1', name: 'Ana', lang: 'es', photo: '', photoSmall: '' }));
}, { mqtt: S.urls.mqtt, tr: S.urls.tr, web: S.urls.web });
const page = await ctx.newPage();
page.on('console', (m) => { if (/error|ocr|read/i.test(m.text())) console.log('console:', m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(S.urls.web);
await page.click('.tile >> nth=2');
await page.waitForSelector('.read-controls');
await page.setInputFiles('.read-cam input[type=file]', img);
await page.waitForSelector('.busy-overlay');
await page.screenshot({ path: path.join(shots, '40-read-busy.png') });
await page.waitForSelector('.ov', { timeout: 90000 });
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(shots, '41-read-result.png') });
const ovs = await page.$$eval('.ov', (els) => els.map((e) => e.textContent));
console.log('párrafos:', ovs.length);
ovs.forEach((o) => console.log('  ', o));
await page.click('.read-bottom .seg button >> nth=1');
await page.screenshot({ path: path.join(shots, '42-read-original.png') });
await browser.close();
await S.close();
process.exit(ovs.length ? 0 : 1);
