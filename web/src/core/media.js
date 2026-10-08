// Cámara y fotos.
import { loadImage } from './qr.js';
import { log } from './log.js';

export async function startCamera(video, facing = 'environment') {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const e = new Error('unsupported');
    e.code = 'unsupported';
    throw e;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (e) {
    log('camera error', e && e.name, e && e.message);
    const err = new Error(e && e.name);
    err.code = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'permission' : 'error';
    throw err;
  }
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  try { await video.play(); } catch { /* algunos navegadores lo inician solos */ }
  return stream;
}

export function stopCamera(stream) {
  if (!stream) return;
  for (const t of stream.getTracks()) {
    try { t.stop(); } catch { /* */ }
  }
}

/** Recorta al centro en cuadrado y devuelve JPEG en base64 del tamaño pedido. */
export function squareJpeg(source, size, quality = 0.82, mirror = false) {
  const w = source.videoWidth || source.naturalWidth || source.width;
  const h = source.videoHeight || source.naturalHeight || source.height;
  const side = Math.min(w, h);
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (mirror) {
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
  return c.toDataURL('image/jpeg', quality);
}

export async function photoFromFile(file) {
  const img = await loadImage(file);
  return {
    photo: squareJpeg(img, 256, 0.85),
    photoSmall: squareJpeg(img, 96, 0.78),
  };
}

export function photoFromVideo(video, mirror) {
  return {
    photo: squareJpeg(video, 256, 0.85, mirror),
    photoSmall: squareJpeg(video, 96, 0.78, mirror),
  };
}

/** Captura un fotograma del vídeo (para el modo lectura). */
export function frameFromVideo(video, maxSide = 1800) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return c;
}

export async function canvasFromFile(file, maxSide = 1800) {
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
