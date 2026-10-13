// Descarga el APK compilado en GitHub (rama apk-build) y lo firma con la clave de Parla (keys/).
// No hace falta el SDK de Android: firma v2 con tools/sign-v2.mjs (Node + OpenSSL + keytool).
// Uso: node tools/sign.mjs   → out/Parla-<versión>.apk
import fs from 'fs';
import path from 'path';
import { execSync, execFileSync } from 'child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const sh = (c) => execSync(c, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] }).toString();

sh('git fetch -q --depth 1 origin apk-build');
const tmp = fs.mkdtempSync('/tmp/parla-apk-');
sh(`git --work-tree=${tmp} checkout FETCH_HEAD -- .`);
sh('git reset -q');
const status = fs.readFileSync(path.join(tmp, 'STATUS'), 'utf8').trim();
const src = fs.readFileSync(path.join(tmp, 'SOURCE_SHA'), 'utf8').trim();
console.log('compilación', status, 'de', src);
if (status !== 'ok') {
  console.log(fs.readFileSync(path.join(tmp, 'build.log'), 'utf8').split('\n').filter((l) => /error|FAIL|What went wrong|\.java:\d+/i.test(l)).slice(0, 60).join('\n'));
  process.exit(1);
}
const ks = path.join(root, 'keys/parla-release.jks');
const pass = fs.readFileSync(path.join(root, 'keys/password.txt'), 'utf8').trim();
const out = path.join(root, `out/Parla-${pkg.version}.apk`);
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync('node', [path.join(root, 'tools/sign-v2.mjs'), path.join(tmp, 'parla-unsigned.apk'), out, ks, pass, 'parla'], { stdio: 'inherit' });
console.log(`APK firmada → ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
