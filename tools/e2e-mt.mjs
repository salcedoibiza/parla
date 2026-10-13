// Prueba de la traducción dentro del dispositivo (modelos de Mozilla) en la web, con dos "móviles".
// Uso: node tools/e2e-mt.mjs [carpeta con los modelos .gz: <par>/<archivo>.gz]
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { startServers } from './testserver.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const models = process.argv[2] || '/home/claude/mt/gcs';
const shots = path.join(root, 'out/shots-mt');
fs.mkdirSync(shots, { recursive: true });
// El traductor de Google simulado tarda 1,5 s: así se ve primero la traducción del dispositivo
const S = await startServers({ trDelay: 1500 });
const ms = http.createServer((req, res) => {
  const f = path.join(models, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end(); return; }
  res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Length': fs.statSync(f).size });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => ms.listen(8097, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.log('  ✗', msg); failures++; } };
const shot = async (page, name) => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(shots, `${name}.png`) }); };

async function phone(label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'es-ES' });
  await ctx.addInitScript(({ mqtt, tr }) => {
    window.__PARLA_BROKERS__ = [mqtt, mqtt, mqtt];
    window.__PARLA_TRANSLATE_URL__ = tr;
    window.__PARLA_MT__ = { base: 'http://localhost:8097/', gz: true };
  }, { mqtt: S.urls.mqtt, tr: S.urls.tr });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { errors.push(`${label}: ${e.message}`); console.log(`[${label}] PAGEERROR`, e.message); });
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /mt|local tr|warm/.test(t)) console.log(`  [${label}]`, t.slice(0, 160)); });
  await page.goto(S.urls.web);
  page.ctx = ctx;
  return page;
}

async function onboard(page, name, langSearch) {
  await page.waitForSelector('.welcome');
  await page.fill('input[autocomplete="name"]', name);
  await page.click('.welcome .select-row');
  await page.fill('.lang-search input', langSearch);
  await page.click('.lang-item >> nth=0');
  await page.click('.welcome .btn.block');
  await page.waitForSelector('.modes');
}

async function downloadLangs(page, names) {
  await page.click('.home-head .icon-btn');
  await page.waitForSelector('.drawer');
  await page.click('.drawer .row >> nth=1');
  await page.waitForSelector('.group .row');
  await shot(page, `${page.label}-offline-screen`);
  for (const n of names) {
    const row = page.locator('.group .row', { hasText: n }).first();
    await row.locator('button').click();
  }
  await shot(page, `${page.label}-downloading`);
  for (const n of names) {
    await page.locator('.group .row', { hasText: n }).filter({ hasText: /Listo|Ready/ }).first().waitFor({ timeout: 60000 });
  }
}

try {
  console.log('1) Descargar idiomas en la web');
  const ana = await phone('Ana'); ana.label = 'ana';
  await onboard(ana, 'Ana García', 'espa');
  const mario = await phone('Mario'); mario.label = 'mario';
  await onboard(mario, 'Mario Rossi', 'ital');
  let t0 = Date.now();
  await downloadLangs(mario, ['Italiano', 'Spagnolo']);
  ok(true, `Mario descarga italiano y español (${Date.now() - t0} ms)`);
  await shot(mario, 'mario-offline-langs');
  const sizeTxt = await mario.textContent('.group');
  ok(/Listo, funciona sin internet|Ready, works offline/.test(sizeTxt), 'La pantalla marca los idiomas como listos');
  await mario.click('.topbar .icon-btn');
  await mario.waitForSelector('.modes');
  await downloadLangs(ana, ['Español', 'Italiano']);
  await ana.click('.topbar .icon-btn');
  await ana.waitForSelector('.modes');

  console.log('2) Conversación: primero la traducción del dispositivo, luego la de Google');
  await ana.click('.mode.m-conv');
  await ana.waitForSelector('.sheet');
  await ana.click('.sheet .btn.block');
  await ana.waitForSelector('.code-big');
  const code = (await ana.textContent('.code-big')).trim();
  await ana.click('.sheet-head .icon-btn');
  await mario.click('.mode >> nth=4');
  await mario.waitForSelector('.input.code');
  await mario.fill('.input.code', code);
  await mario.click('.pad .btn.block');
  await mario.waitForSelector('.composer', { timeout: 15000 });
  await ana.waitForFunction(() => document.querySelector('.topbar .sub') && document.querySelector('.topbar .sub').textContent.includes('2 de 6'), null, { timeout: 8000 });
  await mario.waitForTimeout(1500);

  await ana.fill('.composer textarea', 'El autobús sale a las nueve desde la plaza del ayuntamiento.');
  await ana.dispatchEvent('.composer textarea', 'input');
  await ana.waitForTimeout(300);
  t0 = Date.now();
  await ana.press('.composer textarea', 'Enter');
  // Mientras llega la de Google (tarda 1,5 s), Mario ya ve la de su móvil
  const prov = await mario.waitForFunction(() => [...document.querySelectorAll('.msg.other .bubble > div:first-child')].some((d) => /autobus|piazza/i.test(d.textContent)), null, { timeout: 1400 }).then(() => true).catch(() => false);
  const provTxt = await mario.evaluate(() => [...document.querySelectorAll('.msg.other .bubble > div:first-child')].map((d) => d.textContent).pop());
  ok(prov, `Antes, la traducción del móvil en ${Date.now() - t0} ms: ${provTxt}`);
  await shot(mario, 'mario-local-first');
  // Con conexión llega la de Google que manda Ana (la simulada empieza por [it])
  await mario.waitForFunction(() => [...document.querySelectorAll('.msg.other .bubble')].some((b) => b.textContent.includes('[it] El autobús')), null, { timeout: 10000 });
  ok(true, `Con Google disponible, Mario recibe la traducción de Google (${Date.now() - t0} ms)`);

  console.log('3) Sin el traductor de Google: todo con la del dispositivo');
  for (const p of [ana, mario]) await p.ctx.route('**/translate_a/**', (r) => r.abort());
  await mario.fill('.composer textarea', 'Scusi, dove si trova la stazione dei treni più vicina?');
  await mario.dispatchEvent('.composer textarea', 'input');
  await mario.waitForTimeout(300);
  t0 = Date.now();
  await mario.press('.composer textarea', 'Enter');
  await ana.waitForFunction(() => [...document.querySelectorAll('.msg.other .bubble > div:first-child')].some((d) => /estación/i.test(d.textContent)), null, { timeout: 15000 });
  const t2 = Date.now() - t0;
  const anaTxt = await ana.evaluate(() => [...document.querySelectorAll('.msg.other .bubble > div:first-child')].map((d) => d.textContent).pop());
  ok(/estación/i.test(anaTxt), `Ana recibe en español sin Google (${t2} ms): ${anaTxt}`);
  await ana.waitForTimeout(3500);
  const still = await ana.evaluate(() => [...document.querySelectorAll('.msg.other .bubble > div:first-child')].map((d) => d.textContent).pop());
  ok(/estación/i.test(still) && !/untranslated|sin traducir/i.test(still), `Se queda como traducción final: ${still}`);
  await shot(ana, 'ana-offline-google');

  console.log('4) Borrar un idioma');
  await mario.reload();
  await mario.waitForSelector('.modes', { timeout: 10000 }).catch(() => {});
  if (await mario.$('.modes')) {
    await mario.click('.home-head .icon-btn');
    await mario.waitForSelector('.drawer');
    await mario.click('.drawer .row >> nth=1');
    await mario.waitForSelector('.group .row');
    const row = mario.locator('.group .row', { hasText: 'Spagnolo' }).first();
    await row.locator('button').click();
    await mario.click('.dialog .btn.danger, .sheet .btn.danger, button.danger').catch(() => {});
    await mario.waitForTimeout(800);
    const txt = await mario.locator('.group .row', { hasText: 'Spagnolo' }).first().textContent();
    ok(/About \d+ MB|Unos \d+ MB/.test(txt), `Español borrado del móvil de Mario: ${txt}`);
  } else ok(false, 'no se pudo volver al inicio');
} catch (e) {
  console.log('ERROR', e);
  failures++;
}
console.log(`\nErrores de página: ${errors.length}`);
console.log(failures ? `FALLOS: ${failures}` : 'TODO OK');
await browser.close();
ms.close();
process.exit(failures ? 1 : 0);
