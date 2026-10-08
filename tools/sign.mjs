// Descarga el APK compilado en GitHub (rama apk-build), lo alinea y lo firma con la clave de Parla.
// Uso: node tools/sign.mjs   → out/Parla-<versión>.apk
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const site = process.env.PARLA_REPO || '/home/claude/parla-site';
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const sh = (c, o = {}) => execSync(c, { stdio: ['ignore', 'pipe', 'inherit'], ...o }).toString();

sh(`git -C ${site} fetch -q origin apk-build`);
const tmp = fs.mkdtempSync('/tmp/parla-apk-');
sh(`git -C ${site} --work-tree=${tmp} checkout origin/apk-build -- .`);
const status = fs.readFileSync(path.join(tmp, 'STATUS'), 'utf8').trim();
const src = fs.readFileSync(path.join(tmp, 'SOURCE_SHA'), 'utf8').trim();
console.log('compilación', status, 'de', src);
if (status !== 'ok') {
  console.log(fs.readFileSync(path.join(tmp, 'build.log'), 'utf8').split('\n').filter((l) => /error|FAIL|What went wrong|\.java:\d+/i.test(l)).slice(0, 60).join('\n'));
  process.exit(1);
}
const ks = path.join(root, 'keys/parla-release.jks');
const out = path.join(root, `out/Parla-${pkg.version}.apk`);
fs.mkdirSync(path.dirname(out), { recursive: true });
sh(`zipalign -f -p 4 ${tmp}/parla-unsigned.apk ${tmp}/aligned.apk`);
sh(`apksigner sign --ks ${ks} --ks-pass pass:parla-test-2026 --key-pass pass:parla-test-2026 --ks-key-alias parla --out ${out} ${tmp}/aligned.apk`);
sh(`apksigner verify ${out}`);
console.log(sh(`aapt dump badging ${out} | head -1`).trim());
console.log(`APK firmada → ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
