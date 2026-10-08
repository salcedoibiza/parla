// Prueba de la traducción en el móvil (ML Kit simulado): directo, mensaje final, aviso de descarga y pantalla de idiomas.
// Google se simula lento (TR_DELAY) para comprobar que la del móvil sale antes.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { startServers } from './testserver.mjs';

process.env.TR_DELAY = process.env.TR_DELAY || '1500';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const shots = path.join(root, 'out/shots');
fs.mkdirSync(shots, { recursive: true });
const S = await startServers();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  ✓', msg);
  else { console.log('  ✗', msg); failures++; }
};

function mockNative() {
  const emit = (ev) => window.__parlaNative && window.__parlaNative(ev);
  window.__spoken = [];
  window.__downloads = [];
  window.__dling = [];
  const models = () => emit({ type: 'trmodels', downloaded: window.__dl, downloading: window.__dling, supported: ['en', 'es', 'it', 'fr', 'de', 'pt'] });
  window.ParlaNative = {
    info: () => JSON.stringify({ version: 'test', sdk: 34, model: 'Mock', dark: false, speech: true, mic: true }),
    getInitialLink: () => '',
    log() {},
    hasMicPermission: () => true,
    hasCameraPermission: () => true,
    requestMicPermission() { setTimeout(() => emit({ type: 'perm', perm: 'mic', granted: true }), 10); },
    openAppSettings() {},
    startListening(sid) {
      const phrase = window.__nextPhrase;
      window.__nextPhrase = null;
      emit({ type: 'stt', sid, ev: 'ready' });
      if (!phrase) {
        const t0 = Date.now();
        const iv0 = setInterval(() => {
          if (window.__mockStop || Date.now() - t0 > 3000) {
            clearInterval(iv0);
            window.__mockStop = false;
            emit({ type: 'stt', sid, ev: 'error', code: 'nomatch' });
            emit({ type: 'stt', sid, ev: 'end' });
          }
        }, 100);
        return;
      }
      const words = phrase.split(' ');
      let i = 0;
      const iv = setInterval(() => {
        i++;
        if (i <= words.length) {
          if (i === 1) window.__firstPartialAt = Date.now();
          emit({ type: 'stt', sid, ev: 'partial', text: words.slice(0, i).join(' ') });
        }
        if (i >= words.length + 1 || window.__mockStop) {
          clearInterval(iv);
          window.__mockStop = false;
          emit({ type: 'stt', sid, ev: 'speechend' });
          window.__finalAt = Date.now();
          emit({ type: 'stt', sid, ev: 'final', text: phrase });
          emit({ type: 'stt', sid, ev: 'end' });
        }
      }, 250);
    },
    stopListening() { window.__mockStop = true; },
    cancelListening() { window.__mockStop = true; },
    speak(id, text, bcp) {
      window.__spoken.push({ text, bcp });
      setTimeout(() => emit({ type: 'tts', id, ev: 'start' }), 20);
      setTimeout(() => emit({ type: 'tts', id, ev: 'done' }), 150);
    },
    stopSpeaking() {},
    ttsLanguages: () => '[]',
    installTtsData() {},
    translate(id) { setTimeout(() => emit({ type: 'translate', id, ok: false, error: 'off' }), 10); },
    share() {},
    copy() {},
    keepAwake() {},
    setSystemBars() {},
    isSystemDark: () => false,
    vibrate() {},
    openUrl() {},
    openHotspotSettings() {},
    openVoiceSettings() {},
    setQuiet() {},
    // Traducción en el móvil
    hasLocalTr: () => true,
    localModels() { setTimeout(models, 10); },
    localDownload(c) {
      window.__downloads.push(c);
      if (!window.__dling.includes(c)) window.__dling.push(c);
      models();
      setTimeout(() => {
        window.__dling = window.__dling.filter((x) => x !== c);
        if (!window.__dl.includes(c)) window.__dl.push(c);
        models();
      }, 400);
    },
    localDelete(c) { window.__dl = window.__dl.filter((x) => x !== c); setTimeout(models, 10); },
    localTranslate(id, text, sl, tl) {
      const ok = window.__dl.includes(sl) && window.__dl.includes(tl) && window.__dl.includes('en');
      setTimeout(() => emit(ok ? { type: 'localtr', id, ok: true, text: `[L-${tl}] ${text}` } : { type: 'localtr', id, ok: false, error: 'nomodel' }), 30);
    },
  };
}

async function phone(label, models) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'es-ES' });
  await ctx.addInitScript(({ mqtt, tr, dl }) => {
    window.__PARLA_BROKERS__ = [mqtt, mqtt, mqtt];
    window.__PARLA_TRANSLATE_URL__ = tr;
    window.__dl = dl;
  }, { mqtt: S.urls.mqtt, tr: S.urls.tr, dl: models });
  await ctx.addInitScript(mockNative);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { failures++; console.log(`[${label}] PAGEERROR`, e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[${label}] console.error`, m.text()); });
  await page.goto(S.urls.web);
  return page;
}

const shot = async (page, name) => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(shots, `${name}.png`) }); };

async function onboard(page, name, langSearch) {
  await page.waitForSelector('.welcome');
  await page.fill('input[autocomplete="name"]', name);
  await page.click('.welcome .select-row');
  await page.fill('.lang-search input', langSearch);
  await page.click('.lang-item >> nth=0');
  await page.click('.welcome .btn.block');
  await page.waitForSelector('.modes');
}

async function join(page, code) {
  await page.click('.mode >> nth=4');
  await page.waitForSelector('.input.code');
  await page.fill('.input.code', code);
  await page.click('.pad .btn.block');
}

try {
  console.log(`Google simulado con ${process.env.TR_DELAY} ms de retraso`);
  const ana = await phone('Ana', ['en', 'es', 'it']);
  await onboard(ana, 'Ana', 'espa');
  const berta = await phone('Berta', ['en', 'es', 'it']);
  await onboard(berta, 'Berta', 'ital');

  console.log('1) Conversación con la traducción del móvil');
  await ana.click('.mode.m-conv');
  await ana.waitForSelector('.sheet');
  await ana.click('.sheet .btn.block');
  await ana.waitForSelector('.code-big');
  const code = (await ana.textContent('.code-big')).trim();
  await ana.click('.sheet-head .icon-btn');
  await join(berta, code);
  await berta.waitForSelector('.composer', { timeout: 15000 });
  ok(!(await berta.$('.tr-banner')), 'Con los idiomas descargados no sale el aviso');

  await ana.evaluate(() => { window.__nextPhrase = 'hola a todos y bienvenidos a la reunión de hoy'; });
  await ana.click('.mic');
  await berta.waitForFunction(() => { const b = document.querySelector('.msg.live .bubble'); return b && b.textContent.includes('[L-it] hola'); }, null, { timeout: 8000 });
  const liveAt = await berta.evaluate(() => Date.now());
  const firstAt = await ana.evaluate(() => window.__firstPartialAt);
  ok(liveAt - firstAt < 700, `Berta ve la traducción en directo ${liveAt - firstAt} ms después de la primera palabra`);
  await shot(berta, 'L1-live-local');
  await berta.waitForFunction(() => [...document.querySelectorAll('.msg.other:not(.live) .bubble')].some((b) => /\[(L-)?it\] hola a todos y bienvenidos a la reunión de hoy/.test(b.textContent)), null, { timeout: 8000 });
  const finalSeen = await berta.evaluate(() => Date.now());
  const finalAt = await ana.evaluate(() => window.__finalAt);
  ok(finalSeen - finalAt < 600, `Mensaje completo en Berta ${finalSeen - finalAt} ms después de terminar de hablar (Google tarda ${process.env.TR_DELAY} ms)`);
  await berta.waitForFunction(() => [...document.querySelectorAll('.msg.other:not(.live) .bubble')].some((b) => b.textContent.includes('[it] hola a todos y bienvenidos')), null, { timeout: 10000 });
  ok(true, 'Después la traducción de Google sustituye a la del móvil');
  await shot(berta, 'L2-final-google');

  console.log('2) Aviso de idiomas que faltan');
  const carla = await phone('Carla', ['es']);
  await onboard(carla, 'Carla', 'fran');
  await join(carla, code);
  await carla.waitForSelector('.composer', { timeout: 15000 });
  await carla.waitForSelector('.tr-banner', { timeout: 5000 });
  const btxt = await carla.textContent('.tr-banner');
  ok(/Fran/i.test(btxt) && /(Ingl|Angl)/i.test(btxt) && /Itali/i.test(btxt), `Aviso: ${btxt.trim().slice(0, 110)}`);
  await shot(carla, 'L3-banner');
  await carla.click('.tr-banner .btn');
  await carla.waitForFunction(() => document.querySelector('.tr-banner') && document.querySelector('.tr-banner').textContent.includes('Descargando'), null, { timeout: 3000 });
  ok(true, 'Al pulsar Descargar se ve que está descargando');
  const dls = await carla.evaluate(() => window.__downloads.slice().sort().join(','));
  ok(dls === 'en,fr,it', `Descarga los que faltan (${dls})`);
  await carla.waitForSelector('.tr-banner', { state: 'detached', timeout: 4000 });
  ok(true, 'El aviso desaparece al terminar');

  console.log('3) Pantalla de idiomas sin conexión');
  const dani = await phone('Dani', ['en', 'es']);
  await onboard(dani, 'Dani', 'espa');
  await dani.click('.home-head .icon-btn');
  await dani.waitForSelector('.drawer');
  await dani.click('.drawer .row:has-text("Idiomas sin conexión")');
  await dani.waitForSelector('.section-title:has-text("En tu móvil")');
  const haveTxt = await dani.textContent('.group >> nth=0');
  ok(/Español/.test(haveTxt) && /Inglés/.test(haveTxt), `Descargados: ${haveTxt.replace(/\s+/g, ' ').trim().slice(0, 90)}`);
  await shot(dani, 'L4-offline');
  await dani.click('.group >> nth=1 >> .row:has-text("Italiano") >> .icon-btn');
  await dani.waitForFunction(() => window.__downloads.includes('it'), null, { timeout: 3000 });
  await dani.waitForFunction(() => document.querySelector('.group').textContent.includes('Italiano'), null, { timeout: 3000 });
  ok(true, 'Descargar italiano lo pasa a "En tu móvil"');
  await dani.click('.group >> nth=0 >> .row:has-text("Italiano") >> .icon-btn');
  await dani.waitForSelector('.dialog');
  await dani.click('.dialog .btn.danger');
  await dani.waitForFunction(() => !document.querySelector('.group').textContent.includes('Italiano'), null, { timeout: 3000 });
  ok(true, 'Borrar italiano lo quita');
  await shot(dani, 'L5-offline-after');
} catch (e) {
  console.log('ERROR', e);
  failures++;
}

await browser.close();
await S.close();
console.log(failures ? `FALLOS: ${failures}` : 'TODO OK');
process.exit(failures ? 1 : 0);
