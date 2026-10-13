// Firma un APK con el esquema de firma v2 de Android (válido desde Android 7, que es el mínimo de Parla),
// sin herramientas del SDK de Android: solo Node y OpenSSL.
// No toca el contenido del APK: añade el bloque de firma antes del directorio central (APK ya alineado).
//
// Uso: node tools/sign-v2.mjs <entrada.apk> <salida.apk> <almacén .jks o .p12> <contraseña> [alias]
// Referencia: https://source.android.com/docs/security/features/apksigning/v2
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

const [inp, out, store, pass, alias = 'parla'] = process.argv.slice(2);
if (!inp || !out || !store || !pass) {
  console.log('Uso: node tools/sign-v2.mjs <entrada.apk> <salida.apk> <almacén> <contraseña> [alias]');
  process.exit(1);
}

// ---------- clave y certificado (keytool + openssl) ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parla-sign-'));
let p12 = store;
if (!/\.p12$|\.pfx$/i.test(store)) {
  p12 = path.join(tmp, 'k.p12');
  execFileSync('keytool', ['-importkeystore', '-noprompt', '-srckeystore', store, '-srcstorepass', pass, '-srcalias', alias,
    '-destkeystore', p12, '-deststoretype', 'PKCS12', '-deststorepass', pass, '-destkeypass', pass], { stdio: 'pipe' });
}
const pem = execFileSync('openssl', ['pkcs12', '-in', p12, '-nodes', '-passin', `pass:${pass}`], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
fs.rmSync(tmp, { recursive: true, force: true });
const keyPem = pem.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/)[0];
const certPem = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)[0];
const privateKey = crypto.createPrivateKey(keyPem);
const cert = new crypto.X509Certificate(certPem);
const certDer = cert.raw;
const pubDer = cert.publicKey.export({ type: 'spki', format: 'der' });
if (privateKey.asymmetricKeyType !== 'rsa') throw new Error('Solo claves RSA');
const SIG_ALG = 0x0103; // RSASSA-PKCS1-v1_5 con SHA2-256

// ---------- estructura del ZIP ----------
const apk = fs.readFileSync(inp);
let eocd = -1;
for (let i = apk.length - 22; i >= Math.max(0, apk.length - 22 - 65535); i--) {
  if (apk.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) throw new Error('No es un ZIP');
const cdSize = apk.readUInt32LE(eocd + 12);
const cdOffset = apk.readUInt32LE(eocd + 16);
if (cdOffset + cdSize !== eocd) throw new Error('ZIP con datos extra entre el directorio central y el final');
if (cdOffset >= 16 && apk.toString('latin1', cdOffset - 16, cdOffset) === 'APK Sig Block 42') throw new Error('El APK ya está firmado');

// ---------- resumen (digest) por bloques de 1 MB ----------
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const lp = (buf) => Buffer.concat([u32(buf.length), buf]);
const sha = (...parts) => { const h = crypto.createHash('sha256'); for (const p of parts) h.update(p); return h.digest(); };

const sections = [apk.subarray(0, cdOffset), apk.subarray(cdOffset, eocd), apk.subarray(eocd)];
const chunkDigests = [];
for (const s of sections) {
  for (let o = 0; o < s.length; o += 1048576) {
    const c = s.subarray(o, Math.min(s.length, o + 1048576));
    chunkDigests.push(sha(Buffer.from([0xa5]), u32(c.length), c));
  }
}
const digest = sha(Buffer.from([0x5a]), u32(chunkDigests.length), ...chunkDigests);

// ---------- bloque de firma v2 ----------
const digests = lp(lp(Buffer.concat([u32(SIG_ALG), lp(digest)])));
const certs = lp(lp(certDer));
const attrs = lp(Buffer.alloc(0));
const signedData = Buffer.concat([digests, certs, attrs]);
const signature = crypto.sign('sha256', signedData, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING });
const signer = Buffer.concat([lp(signedData), lp(lp(Buffer.concat([u32(SIG_ALG), lp(signature)]))), lp(pubDer)]);
const v2Block = lp(lp(signer));

const pair = Buffer.concat([u64(4 + v2Block.length), u32(0x7109871a), v2Block]);
const blockSize = pair.length + 8 + 16; // pares + tamaño repetido + firma mágica
const block = Buffer.concat([u64(blockSize), pair, u64(blockSize), Buffer.from('APK Sig Block 42', 'latin1')]);

// ---------- APK firmado ----------
const newEocd = Buffer.from(apk.subarray(eocd));
newEocd.writeUInt32LE(cdOffset + block.length, 16);
fs.writeFileSync(out, Buffer.concat([apk.subarray(0, cdOffset), block, apk.subarray(cdOffset, eocd), newEocd]));
console.log(`APK firmado (v2) → ${out}`);
console.log(`Certificado SHA-256: ${crypto.createHash('sha256').update(certDer).digest('hex')}`);
