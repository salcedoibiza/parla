// Servidores locales para probar: broker MQTT por WebSocket, traductor falso y web estática.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { WebSocketServer, createWebSocketStream } from 'ws';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { Aedes } = await import('aedes').then((m) => ({ Aedes: m.Aedes || m.default }));

export async function startServers({ mqttPort = 8883, webPort = 8080, trPort = 8090, dir = path.join(root, 'web/dist'), trDelay = Number(process.env.TR_DELAY || 0) } = {}) {
  // --- broker MQTT ---
  const broker = typeof Aedes.createBroker === 'function' ? await Aedes.createBroker() : new Aedes();
  const wsHttp = http.createServer();
  const wss = new WebSocketServer({ server: wsHttp, handleProtocols: (protocols) => (protocols.has('mqtt') ? 'mqtt' : false) });
  wss.on('connection', (ws) => {
    const stream = createWebSocketStream(ws);
    broker.handle(stream);
  });
  await new Promise((r) => wsHttp.listen(mqttPort, r));

  // --- traductor falso: añade [idioma] delante ---
  const trCount = { n: 0 };
  const tr = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (q) => setTimeout(() => reply(q), trDelay);
    const reply = (q) => {
      trCount.n++;
      const tl = u.searchParams.get('tl');
      const sl = u.searchParams.get('sl');
      const lines = String(q).split('\n').map((l) => (l ? `[${tl}] ${l}` : l)).join('\n');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify([[[lines, q, null, null, 10]], null, sl === 'auto' ? 'en' : sl]));
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
      res.end();
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => send(new URLSearchParams(body).get('q') || ''));
      return;
    }
    send(u.searchParams.get('q') || '');
  });
  await new Promise((r) => tr.listen(trPort, r));

  // --- web estática ---
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.json': 'application/json' };
  const mounts = { '/_tcore/': path.join(root, 'node_modules/tesseract.js-core'), '/_tdata/': path.join(root, 'node_modules/@tesseract.js-data') };
  const web = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    let base = dir;
    for (const [m, d] of Object.entries(mounts)) if (p.startsWith(m)) { base = d; p = p.slice(m.length - 1); }
    const f = path.join(base, p);
    if (!f.startsWith(base) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': f.endsWith('.wasm') ? 'application/wasm' : (types[path.extname(f)] || 'application/octet-stream'), 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => web.listen(webPort, r));

  return {
    broker, trCount,
    urls: { mqtt: `ws://localhost:${mqttPort}`, web: `http://localhost:${webPort}/`, tr: `http://localhost:${trPort}/translate_a/single` },
    close: async () => {
      web.close(); tr.close(); wss.close(); wsHttp.close();
      await new Promise((r) => broker.close(r));
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith('testserver.mjs')) {
  const s = await startServers();
  console.log('servers up', s.urls);
}
