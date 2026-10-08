// Prueba de extremo a extremo: varios "móviles" en Chromium hablando entre sí.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { startServers } from './testserver.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const shots = path.join(root, 'out/shots');
fs.mkdirSync(shots, { recursive: true });
const S = await startServers();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  ✓', msg);
  else { console.log('  ✗', msg); failures++; }
};

function mockNative() {
  const emit = (ev) => window.__parlaNative && window.__parlaNative(ev);
  window.__spoken = [];
  window.__shared = [];
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
        // Silencio: termina sin resultado salvo que se pare antes
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
        emit({ type: 'stt', sid, ev: 'level', level: Math.random() });
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
    translate(id, text, sl, tl) {
      setTimeout(() => emit({ type: 'translate', id, ok: true, text: text.split('\n').map((l) => `[${tl}] ${l}`).join('\n') }), 40);
    },
    share(text) { window.__shared.push(text); },
    copy(text) { window.__copied = text; },
    keepAwake(on) { window.__awake = on; },
    setSystemBars() {},
    isSystemDark: () => false,
    vibrate() {},
    openUrl() {},
    openHotspotSettings() { window.__hotspot = true; },
    openVoiceSettings() {},
    setQuiet(on) { window.__quiet = on; },
  };
}

async function phone(label, { app = false, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light', locale: 'es-ES' });
  await ctx.addInitScript(({ mqtt, tr, app: isApp }) => {
    window.__PARLA_BROKERS__ = [mqtt, mqtt, mqtt];
    window.__PARLA_TRANSLATE_URL__ = tr;
  }, { mqtt: S.urls.mqtt, tr: S.urls.tr, app });
  if (app) await ctx.addInitScript(mockNative);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { errors.push(`${label}: ${e.message}`); console.log(`[${label}] PAGEERROR`, e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[${label}] console.error`, m.text()); });
  await page.goto(S.urls.web);
  page.label = label;
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

async function readCode(page) {
  await page.waitForSelector('.code-big');
  return (await page.textContent('.code-big')).trim();
}

async function join(page, code) {
  await page.click('.mode >> nth=4');
  await page.waitForSelector('.input.code');
  await page.fill('.input.code', code);
  await page.click('.pad .btn.block');
}

try {
  console.log('1) Perfiles');
  const ana = await phone('Ana', { app: true });
  await shot(ana, '01-welcome');
  await onboard(ana, 'Ana García', 'espa');
  await shot(ana, '02-home');
  await ana.evaluate(() => document.documentElement.setAttribute('data-x', '1'));
  const mario = await phone('Mario');
  await onboard(mario, 'Mario Rossi', 'ital');
  const berta = await phone('Berta', { dark: true });
  await onboard(berta, 'Berta Martin', 'fran');
  ok((await mario.textContent('.me .lang')).toLowerCase().includes('ital'), 'Mario tiene italiano');

  console.log('2) Conversación');
  await ana.click('.mode.m-conv');
  await ana.waitForSelector('.sheet');
  await shot(ana, '03-new-conv');
  await ana.click('.sheet .btn.block');
  const code = await readCode(ana);
  ok(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code), `código ${code}`);
  await shot(ana, '04-invite');
  await ana.click('.sheet-head .icon-btn');
  await shot(ana, '05-conv-empty');

  await join(mario, code);
  await mario.waitForSelector('.composer', { timeout: 15000 });
  await join(berta, code);
  await berta.waitForSelector('.composer', { timeout: 15000 });
  await ana.waitForFunction(() => document.querySelector('.topbar .sub') && document.querySelector('.topbar .sub').textContent.includes('3 de 6'), null, { timeout: 8000 });
  ok(true, 'Ana ve 3 de 6 personas');

  // Ana dicta (modo app con voz simulada)
  await ana.evaluate(() => { window.__nextPhrase = 'hola a todos, bienvenidos'; });
  await ana.click('.mic');
  await ana.waitForSelector('.live-card');
  await shot(ana, '06-dictating');
  // Mientras Ana habla, Mario ya ve la traducción en directo
  await mario.waitForFunction(() => { const b = document.querySelector('.msg.live .bubble'); return b && b.textContent.includes('[it] hola'); }, null, { timeout: 8000 });
  const liveAt = await mario.evaluate(() => Date.now());
  const firstPartialAt = await ana.evaluate(() => window.__firstPartialAt);
  ok(true, `Mario ve la traducción en directo ${liveAt - firstPartialAt} ms después de la primera palabra`);
  await shot(mario, '07-live');
  await mario.waitForFunction(() => [...document.querySelectorAll('.msg.other:not(.live) .bubble')].some((b) => b.textContent.includes('[it] hola a todos, bienvenidos')), null, { timeout: 10000 });
  const finalSeenAt = await mario.evaluate(() => Date.now());
  const finalAt = await ana.evaluate(() => window.__finalAt);
  const lat = finalSeenAt - finalAt;
  ok(lat < 1500, `Mensaje final en Mario ${lat} ms después de que Ana termina de hablar`);
  const mt = await mario.textContent('.msg.other:not(.live) .bubble');
  ok(mt.includes('[it] hola a todos'), `Mario recibe en italiano: ${mt.slice(0, 60)}`);
  await berta.waitForFunction(() => document.querySelector('.msg .bubble') && document.querySelector('.msg .bubble').textContent.includes('[fr]'), null, { timeout: 8000 });
  ok(true, 'Berta recibe en francés');

  // Turnos: Mario escribe -> Ana queda bloqueada
  await mario.fill('.composer textarea', 'ciao a tutti');
  await mario.dispatchEvent('.composer textarea', 'input');
  await ana.waitForSelector('.lock-bar', { timeout: 6000 });
  const lockTxt = await ana.textContent('.lock-bar');
  ok(lockTxt.includes('Mario'), `Ana ve el turno de Mario: ${lockTxt.trim()}`);
  await shot(ana, '08-locked');
  await berta.waitForSelector('.lock-bar', { timeout: 6000 });
  await shot(berta, '09-berta-dark-locked');
  await mario.press('.composer textarea', 'Enter');
  await ana.waitForFunction(() => [...document.querySelectorAll('.msg .bubble')].some((b) => b.textContent.includes('[es] ciao')), null, { timeout: 8000 });
  ok(true, 'Ana recibe a Mario en español');
  await ana.waitForSelector('.lock-bar', { state: 'detached', timeout: 6000 });
  ok(true, 'El turno se libera tras enviar');
  const spoken = await ana.evaluate(() => window.__spoken.length);
  ok(spoken === 0, `En persona, Ana no recibe voz por defecto (voz=${spoken})`);

  // Berta responde
  await berta.fill('.composer textarea', 'bonjour');
  await berta.dispatchEvent('.composer textarea', 'input');
  await berta.waitForTimeout(400);
  await berta.press('.composer textarea', 'Enter');
  await mario.waitForFunction(() => [...document.querySelectorAll('.msg .bubble')].some((b) => b.textContent.includes('[it] bonjour')), null, { timeout: 8000 });
  ok(true, 'Mario recibe a Berta en italiano');
  await shot(mario, '10-mario-conv');
  await shot(berta, '11-berta-conv');

  // Ana activa la voz
  await shot(ana, '12-output');
  await ana.click('.oseg button >> nth=2');
  await berta.fill('.composer textarea', 'merci');
  await berta.dispatchEvent('.composer textarea', 'input');
  await berta.waitForTimeout(300);
  await berta.press('.composer textarea', 'Enter');
  await ana.waitForFunction(() => window.__spoken.some((s) => s.text.includes('merci')), null, { timeout: 8000 });
  const sp = await ana.evaluate(() => window.__spoken[window.__spoken.length - 1]);
  ok(sp.bcp === 'es-ES', `Ana escucha la voz en español (${sp.text})`);
  await shot(ana, '13-ana-conv');

  // Participantes
  await ana.click('.avatar-stack');
  await ana.waitForSelector('.sheet .row');
  await shot(ana, '14-participants');
  await ana.click('.sheet-head .icon-btn');

  // Ana sale: Mario pasa a ser anfitrión
  await ana.click('.topbar .icon-btn >> nth=0');
  await ana.waitForSelector('.dialog');
  await shot(ana, '15-leave-dialog');
  await ana.click('.dialog .btn.danger');
  await ana.waitForSelector('.modes');
  await mario.waitForFunction(() => /\b2\b/.test(document.querySelector('.topbar .sub').textContent), null, { timeout: 8000 });
  ok(true, 'Mario ve que Ana ha salido');
  await mario.fill('.composer textarea', 'ancora qui');
  await mario.dispatchEvent('.composer textarea', 'input');
  await mario.waitForTimeout(400);
  await mario.press('.composer textarea', 'Enter');
  await berta.waitForFunction(() => [...document.querySelectorAll('.msg .bubble')].some((b) => b.textContent.includes('ancora qui')), null, { timeout: 8000 });
  ok(true, 'La conversación sigue sin Ana (nuevo anfitrión)');

  // Historial de Ana
  await ana.click('.home-head .icon-btn');
  await ana.waitForSelector('.drawer');
  await shot(ana, '16-menu');
  await ana.click('.drawer .row >> nth=0');
  await ana.waitForSelector('.hist-item');
  await shot(ana, '17-history');
  await ana.click('.hist-item');
  await ana.waitForSelector('.msgs .bubble');
  await shot(ana, '18-history-detail');
  await ana.click('.footer .btn:not(.ghost)');
  const shared = await ana.evaluate(() => window.__shared[window.__shared.length - 1] || '');
  ok(shared.includes('Mario Rossi') && shared.includes('hola a todos'), 'Compartir historial genera el texto');
  await ana.click('.topbar .icon-btn >> nth=0');
  await ana.click('.topbar .icon-btn >> nth=0');

  // Mario y Berta salen
  for (const p of [mario, berta]) {
    await p.click('.topbar .icon-btn >> nth=0');
    await p.waitForSelector('.dialog');
    await p.click('.dialog .btn.danger');
    await p.waitForSelector('.modes');
  }

  console.log('3) Modo "uno habla"');
  await ana.click('.mode.m-talk');
  await ana.waitForSelector('.sheet');
  await ana.fill('.sheet input', 'Visita a Dalt Vila');
  await shot(ana, '19-new-talk');
  await ana.click('.sheet .btn.block');
  const code2 = await readCode(ana);
  await ana.click('.sheet-head .icon-btn');
  await join(mario, code2);
  await mario.waitForSelector('.subtitle-card', { timeout: 15000 });
  await join(berta, code2);
  await berta.waitForSelector('.subtitle-card', { timeout: 15000 });
  await ana.waitForFunction(() => document.querySelector('.subbar .chip').textContent.trim().startsWith('2 '), null, { timeout: 8000 });
  ok(true, 'El guía ve 2 oyentes');
  await shot(mario, '20-listener-empty');

  await ana.evaluate(() => { window.__nextPhrase = 'a la izquierda veréis la catedral de Ibiza'; });
  await ana.click('.mic');
  await mario.waitForFunction(() => { const c = document.querySelector('.subtitle-card'); return c && c.querySelector('.live-tag') && c.textContent.includes('[it] a la'); }, null, { timeout: 10000 });
  ok(true, 'El oyente ve el subtítulo en directo mientras el guía habla');
  await shot(mario, '22a-listener-live');
  await mario.waitForFunction(() => { const c = document.querySelector('.subtitle-card'); return c && !c.querySelector('.live-tag') && c.textContent.includes('[it] a la izquierda veréis la catedral de Ibiza'); }, null, { timeout: 10000 });
  ok(true, 'El oyente recibe la frase completa en su idioma');
  await shot(ana, '21-host');
  await shot(mario, '22-listener');
  // El guía sigue escuchando: una segunda frase sale sola
  await ana.evaluate(() => { window.__nextPhrase = 'ahora subimos a la muralla'; });
  await mario.waitForFunction(() => document.querySelector('.subtitle-card').textContent.includes('[it] ahora subimos a la muralla'), null, { timeout: 12000 });
  ok(true, 'La segunda frase llega sin volver a pulsar');
  await ana.click('.mic');
  await ana.waitForSelector('.mic:not(.listening)', { timeout: 5000 });

  // Mario pide la palabra
  await mario.click('.footer .btn.block');
  await mario.waitForSelector('.lock-bar');
  await shot(mario, '23-hand-pending');
  await ana.waitForSelector('.topbar .badge', { timeout: 6000 });
  await ana.click('.banner .btn');
  await ana.waitForSelector('.hand-row');
  await shot(ana, '24-hands');
  await ana.click('.hand-row .btn:not(.ghost)');
  await mario.waitForSelector('.composer', { timeout: 6000 });
  ok(true, 'Mario recibe la palabra');
  await ana.waitForSelector('.banner.accent');
  await shot(ana, '25-host-floor-given');
  await mario.fill('.composer textarea', 'una domanda');
  await mario.dispatchEvent('.composer textarea', 'input');
  await mario.press('.composer textarea', 'Enter');
  await berta.waitForFunction(() => document.querySelector('.subtitle-card').textContent.includes('[fr] una domanda'), null, { timeout: 8000 });
  ok(true, 'Berta oye la pregunta de Mario en francés');
  await ana.waitForFunction(() => [...document.querySelectorAll('.msg .bubble')].some((b) => b.textContent.includes('[es] una domanda')), null, { timeout: 8000 });
  ok(true, 'El guía recibe la pregunta en español');
  await shot(mario, '26-listener-speaking');
  await mario.click('.footer .btn.ghost');
  await mario.waitForSelector('.footer .btn.block.soft', { timeout: 6000 });
  ok(true, 'Mario devuelve la palabra');
  await ana.waitForSelector('.banner.accent', { state: 'detached', timeout: 6000 });

  // Berta pide y Ana rechaza
  await berta.click('.footer .btn.block');
  await ana.waitForSelector('.topbar .badge', { timeout: 6000 });
  await ana.click('.banner .btn');
  await ana.click('.hand-row .btn.ghost');
  await berta.waitForSelector('.footer .btn.block.soft', { timeout: 6000 });
  ok(true, 'Solicitud rechazada vuelve al estado inicial');
  await ana.click('.sheet-head .icon-btn');

  // Ana termina la sesión
  await ana.click('.topbar .icon-btn >> nth=0');
  await ana.click('.dialog .btn.danger');
  await mario.waitForSelector('.ended-card', { timeout: 8000 });
  ok(true, 'Los oyentes ven que la sesión ha terminado');
  await shot(mario, '27-ended');

  console.log('4) Otras pantallas');
  await ana.click('.home-head .me');
  await ana.waitForSelector('.swatches');
  await shot(ana, '28-settings');
  await ana.click('.swatch >> nth=3');
  await ana.click('.seg >> nth=0 >> button >> nth=2');
  await shot(ana, '29-settings-dark-coral');
  await ana.click('.topbar .icon-btn');
  await shot(ana, '30-home-dark-coral');
  await ana.click('.home-head .icon-btn');
  await ana.click('.drawer .row >> nth=2');
  await ana.fill('.steps input >> nth=0', 'MiWifi');
  await ana.fill('.steps input >> nth=1', 'clave123');
  await shot(ana, '31-hotspot');
  await ana.click('.topbar .icon-btn');
  await ana.click('.home-head .icon-btn');
  await ana.click('.drawer .row >> nth=1');
  await shot(ana, '32-offline');
  await ana.click('.topbar .icon-btn');
  await ana.click('.home-head .icon-btn');
  await ana.click('.drawer .row >> nth=4');
  await shot(ana, '33-account');

  // Transferir datos de Ana a un móvil nuevo
  await ana.click('.group .row >> nth=0');
  await ana.waitForSelector('.code-big', { timeout: 10000 });
  const tcode = await readCode(ana);
  await shot(ana, '34-transfer-send');
  const nuevo = await phone('Nuevo');
  await nuevo.click('.welcome .btn.link');
  await nuevo.waitForSelector('.sheet');
  await shot(nuevo, '35-account-sheet');
  await nuevo.click('.sheet .btn.block');
  await nuevo.waitForSelector('.input.code');
  await nuevo.fill('.input.code', tcode);
  await nuevo.click('.sheet .btn.block');
  await nuevo.waitForSelector('.modes', { timeout: 15000 });
  const nn = await nuevo.textContent('.me .name');
  ok(nn.includes('Ana'), `El móvil nuevo recibe el perfil (${nn})`);
  await nuevo.click('.home-head .icon-btn');
  await nuevo.click('.drawer .row >> nth=0');
  const hcount = await nuevo.locator('.hist-item').count();
  ok(hcount >= 2, `…y el historial (${hcount} conversaciones)`);

  // Unirse / leer (pantallas)
  await mario.click('.ended-card .btn');
  await mario.waitForSelector('.modes');
  await mario.click('.mode >> nth=4');
  await shot(mario, '36-join');
  await mario.click('.topbar .icon-btn');
  await mario.click('.mode >> nth=3');
  await shot(mario, '37-read');
  await mario.click('.topbar .icon-btn');

  console.log('5) Modo Escucha');
  for (let i = 0; i < 5 && !(await ana.$('.modes')); i++) { await ana.click('.topbar .icon-btn'); await ana.waitForTimeout(300); }
  await ana.waitForSelector('.modes');
  await ana.evaluate(() => { window.__nextPhrase = 'the museum opens at nine'; });
  await ana.click('.mode.m-listen');
  await ana.waitForSelector('.listen-btn');
  await shot(ana, '38-listen-empty');
  await ana.click('.subbar .chip');
  await ana.fill('.lang-search input', 'ingl');
  await ana.click('.lang-item >> nth=0');
  await ana.click('.listen-btn');
  await ana.waitForFunction(() => [...document.querySelectorAll('.sub-line')].some((b) => b.textContent.includes('[es] the museum')), null, { timeout: 10000 });
  ok(true, 'Escucha traduce lo que oye');
  const quiet = await ana.evaluate(() => window.__quiet);
  ok(quiet === true, 'Silencia los pitidos mientras escucha');
  await ana.waitForTimeout(1200);
  await shot(ana, '39-listen');
  await ana.click('.listen-btn');
  const quiet2 = await ana.evaluate(() => window.__quiet);
  ok(quiet2 === false, 'Recupera el sonido al pausar');
  await ana.click('.topbar .icon-btn');
  await ana.click('.home-head .icon-btn');
  await ana.click('.drawer .row >> nth=0');
  await ana.waitForSelector('.hist-item.m-listen');
  ok(true, 'La escucha queda en el historial');
  await shot(ana, '40-history');

  console.log(`\nErrores de página: ${errors.length}`);
  errors.forEach((e) => console.log('  ', e));
} catch (e) {
  failures++;
  console.log('FALLO', e.message);
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      try { await p.screenshot({ path: path.join(shots, `zz-fail-${p.label}.png`) }); } catch { /* */ }
    }
  }
} finally {
  await browser.close();
  await S.close();
  console.log(failures ? `\n${failures} FALLOS` : '\nTODO OK');
  process.exit(failures ? 1 : 0);
}
