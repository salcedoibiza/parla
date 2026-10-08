// Prueba de carga del modo "uno habla": 1 guía + N oyentes simulados en Node.
import { startServers } from './testserver.mjs';

const N = Number(process.argv[2] || 60);
const S = await startServers({ mqttPort: 8893, webPort: 8081, trPort: 8091 });
globalThis.window = {
  __PARLA_BROKERS__: [S.urls.mqtt, S.urls.mqtt, S.urls.mqtt],
  __PARLA_TRANSLATE_URL__: S.urls.tr,
  addEventListener() {},
};
const { Session } = await import('../web/src/core/session.js');
const langs = ['it', 'fr', 'de', 'en', 'pt', 'nl', 'ja', 'ko', 'zh-CN', 'ru'];
const prof = (i, lang) => ({ uid: `u${String(i).padStart(4, '0')}${Math.random().toString(16).slice(2, 8)}`, name: `Oyente ${i}`, lang, photoSmall: '' });

const t0 = Date.now();
const host = await Session.create({ uid: 'host0001', name: 'Guía', lang: 'es', photoSmall: 'data:image/jpeg;base64,' + 'A'.repeat(5000) }, { mode: 'talk', title: 'Prueba' });
console.log('código', host.code);
let statePublishes = 0;
const origPub = host.ch.publish.bind(host.ch);
host.ch.publish = (sub, obj, o) => { if (sub === 's') statePublishes++; return origPub(sub, obj, o); };

const listeners = [];
const batch = 20;
for (let i = 0; i < N; i += batch) {
  const group = await Promise.all(Array.from({ length: Math.min(batch, N - i) }, (_, k) => Session.join(prof(i + k, langs[(i + k) % langs.length]), host.code)));
  listeners.push(...group);
}
console.log(`${N} oyentes unidos en ${Date.now() - t0} ms`);
await new Promise((r) => setTimeout(r, 1500));
console.log('el guía ve', host.listenerCount, 'oyentes; idiomas', host.state.langs.join(','));

const got = new Map();
for (const l of listeners) l.on('message', (m) => got.set(l.me.uid, m.mine));
const t1 = Date.now();
await host.send('Bienvenidos a la visita');
const deadline = Date.now() + 10000;
while (got.size < N && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
console.log(`mensaje recibido por ${got.size}/${N} en ${Date.now() - t1} ms`);
const sample = listeners.slice(0, 4).map((l) => `${l.me.lang}: ${got.get(l.me.uid)}`);
console.log(sample.join(' | '));
const bad = listeners.filter((l) => !String(got.get(l.me.uid) || '').startsWith(`[${l.myTr}]`));
console.log('traducciones incorrectas:', bad.length);
console.log('peticiones de traducción del servidor falso:', S.trCount.n);
console.log('publicaciones de estado del guía:', statePublishes);

// Un oyente pide la palabra y habla
const l0 = listeners[0];
l0.raiseHand();
await new Promise((r) => setTimeout(r, 400));
console.log('manos levantadas:', host.hands.length);
host.acceptHand(l0.me.uid);
await new Promise((r) => setTimeout(r, 400));
console.log('el oyente puede hablar:', l0.canSpeak());
const got2 = new Map();
for (const l of listeners.slice(1)) l.on('message', (m) => { if (!m.own && m.uid === l0.me.uid) got2.set(l.me.uid, m.mine); });
let hostGot = null;
host.on('message', (m) => { if (m.uid === l0.me.uid) hostGot = m.mine; });
await l0.send('Una pregunta');
const d2 = Date.now() + 8000;
while ((got2.size < N - 1 || !hostGot) && Date.now() < d2) await new Promise((r) => setTimeout(r, 50));
console.log(`pregunta recibida por ${got2.size}/${N - 1} oyentes; guía: ${hostGot}`);
l0.releaseFloor();
await new Promise((r) => setTimeout(r, 400));
console.log('la palabra vuelve al guía:', host.state.floor === host.me.uid);

await host.leave();
await new Promise((r) => setTimeout(r, 800));
const ended = listeners.filter((l) => l.status === 'ended').length;
console.log(`sesión terminada para ${ended}/${N}`);
await S.close();
process.exit(0);
