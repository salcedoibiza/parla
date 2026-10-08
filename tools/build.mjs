// Compila la web (también la que va dentro de la app de Android).
// Uso: node tools/build.mjs [--app] [--web-base=https://...] [--apk-url=https://...]
import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const VERSION = args.version || pkg.version || '0.1.0';
const WEB_BASE = args['web-base'] || '';
const APK_URL = args['apk-url'] || '';
const dist = path.join(root, 'web/dist');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ---------- web ----------
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(root, 'web/src/main.js')],
  bundle: true,
  minify: !args.dev,
  sourcemap: args.dev ? 'inline' : false,
  format: 'iife',
  target: ['chrome87', 'safari15', 'firefox100'],
  outfile: path.join(dist, 'app.js'),
  loader: { '.woff2': 'file', '.woff': 'file' },
  assetNames: 'fonts/[name]-[hash]',
  define: {
    __WEB_BASE__: JSON.stringify(WEB_BASE),
    __APK_URL__: JSON.stringify(APK_URL),
    __APP_VERSION__: JSON.stringify(VERSION),
  },
  legalComments: 'none',
  logLevel: 'info',
});
// Solo se necesitan las fuentes woff2
for (const f of fs.readdirSync(path.join(dist, 'fonts'))) {
  if (f.endsWith('.woff')) fs.rmSync(path.join(dist, 'fonts', f));
}
copyDir(path.join(root, 'web/public'), dist);
// Evita que el navegador use una versión vieja de la app
const idx = path.join(dist, 'index.html');
fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('href="app.css"', `href="app.css?v=${VERSION}"`).replace('src="app.js"', `src="app.js?v=${VERSION}"`));
fs.mkdirSync(path.join(dist, 'vendor'), { recursive: true });
for (const f of ['tesseract.min.js', 'worker.min.js']) {
  fs.copyFileSync(path.join(root, 'node_modules/tesseract.js/dist', f), path.join(dist, 'vendor', f));
}
// El lector de texto para la web (en la app se usa el de Google, que va incluido)
if (!args.app) {
  fs.mkdirSync(path.join(dist, 'vendor/core'), { recursive: true });
  for (const f of ['tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js']) {
    fs.copyFileSync(path.join(root, 'node_modules/tesseract.js-core', f), path.join(dist, 'vendor/core', f));
  }
}
console.log('web ok →', dist);
// La app de Android se compila en GitHub (ver .github/workflows/android.yml) y se firma con tools/sign.mjs
