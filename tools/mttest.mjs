// Prueba del traductor dentro del dispositivo (Bergamot) en Chromium, con modelos de Mozilla locales.
// Uso: node tools/mttest.mjs <carpeta-modelos-gz>   (carpeta con <par>/<archivo>.gz)
import { chromium } from 'playwright';
import esbuild from 'esbuild';
import http from 'http';
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const models = process.argv[2] || '/home/claude/mt/gcs';
const dist = path.join(root, 'web/dist');
await esbuild.build({
  stdin: { contents: `import * as mt from './web/src/core/mt.js'; window.mt = mt;`, resolveDir: root },
  bundle: true, format: 'iife', outfile: path.join(dist, 'mttest.js'), logLevel: 'error',
});
fs.writeFileSync(path.join(dist, 'mttest.html'), `<!doctype html><meta charset="utf-8"><script>window.__PARLA_MT_WS__=32;window.__PARLA_MT__={base:location.origin+'/models/',gz:true}</script><script src="mttest.js"></script>`);
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = u.startsWith('/models/') ? path.join(models, u.slice(8)) : path.join(dist, u);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => srv.listen(8099, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
page.on('console', (m) => console.log('  [page]', m.text()));
page.on('pageerror', (e) => console.log('  [error]', e.message));
await page.goto('http://localhost:8099/mttest.html');
const r = await page.evaluate(async () => {
  const out = {};
  const { mt } = window;
  await mt.refreshMt();
  out.supported = mt.mtSupported;
  out.before = [mt.packState('es'), mt.packState('it'), mt.packState('fr')];
  let t = Date.now();
  await mt.downloadPack('es');
  await mt.downloadPack('it');
  out.downloadMs = Date.now() - t;
  out.after = [mt.packState('es'), mt.packState('it'), mt.packState('en')];
  out.can = [mt.canMt('es', 'it'), mt.canMt('it', 'es'), mt.canMt('es', 'en'), mt.canMt('es', 'fr')];
  const tests = [
    ['es', 'en', 'Hola, ¿qué tal estás? Mañana vamos a visitar la catedral de Ibiza.'],
    ['es', 'it', 'El autobús sale a las nueve desde la plaza del ayuntamiento.'],
    ['it', 'es', 'Scusi, dove si trova la stazione dei treni più vicina?'],
    ['en', 'es', 'Please keep your tickets with you during the whole tour.'],
    ['es', 'it', 'Gracias por venir.'],
  ];
  out.res = [];
  for (const [sl, tl, text] of tests) {
    t = Date.now();
    const tr = await mt.translateMt(text, sl, tl);
    out.res.push({ sl, tl, ms: Date.now() - t, text, tr });
  }
  // Varias seguidas (ya cargado)
  t = Date.now();
  for (let i = 0; i < 10; i++) await mt.translateMt(`Esta es la frase número ${i} que digo durante la visita guiada.`, 'es', 'it');
  out.avg10 = (Date.now() - t) / 10;
  t = Date.now();
  const many = await mt.translateMtMany(['Salida', 'Entrada', 'Prohibido fumar', 'Abierto de 9 a 14 h', 'Precio por persona'], 'es', 'en');
  out.batch = { ms: Date.now() - t, many };
  out.mem = Math.round((mt.mtState().mem || 0) / 1048576);
  // Borrar y volver a comprobar
  await mt.deletePack('it');
  out.afterDelete = [mt.packState('it'), mt.canMt('es', 'it')];
  return out;
});
console.log(JSON.stringify(r, null, 1));
const { execSync } = await import('child_process');
const rss = execSync("ps -eo rss,args | grep -i chrom | grep -v grep | awk '{print $1, $2, $3, $4}'").toString();
console.log('RSS (KB) por proceso de Chromium:\n' + rss.split('\n').filter((l) => /type=renderer|type=gpu|chromium /.test(l) || /--type/.test(l) === false).slice(0, 12).join('\n'));
console.log('total MB', Math.round(rss.split('\n').filter(Boolean).reduce((a, l) => a + Number(l.split(' ')[0]), 0) / 1024));
await browser.close();
srv.close();
