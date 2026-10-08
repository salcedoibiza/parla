import fs from 'fs';
import path from 'path';
const files = [];
function walk(d){ for (const f of fs.readdirSync(d)) { const p = path.join(d,f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } }
walk(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../web/src'));
const keys = new Set();
for (const f of files) {
  const s = fs.readFileSync(f,'utf8');
  for (const m of s.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]);
}
const out = [...keys];
if (process.argv[2] === 'missing') {
  const { EN } = await import(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../web/src/core/i18n-en.js'));
  const miss = out.filter(k => !(k in EN));
  const extra = Object.keys(EN).filter(k => !keys.has(k));
  console.log('missing', miss.length); miss.forEach(k=>console.log(JSON.stringify(k)));
  console.log('extra', extra.length); extra.forEach(k=>console.log(JSON.stringify(k)));
} else { console.log(out.length); out.forEach(k=>console.log(k)); }
