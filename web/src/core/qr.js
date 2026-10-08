// Generar y leer códigos QR.
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';

qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));

/** Devuelve { size, path } para dibujar el QR en un <svg>. */
export function qrPath(text, level = 'M') {
  const qr = qrcode(0, level);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (qr.isDark(y, x)) {
        let w = 1;
        while (x + w < n && qr.isDark(y, x + w)) w++;
        d += `M${x} ${y}h${w}v1h-${w}z`;
        x += w;
      } else {
        x++;
      }
    }
  }
  return { size: n, path: d };
}

/**
 * Lee QR de un <video> en bucle. Llama a onCode(texto) cuando encuentra uno.
 * Devuelve una función para parar.
 */
export function scanVideo(video, onCode) {
  let stopped = false;
  let detector = null;
  try {
    if ('BarcodeDetector' in window) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
  } catch { detector = null; }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const loop = async () => {
    if (stopped) return;
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        let found = null;
        if (detector) {
          try {
            const res = await detector.detect(video);
            if (res && res[0]) found = res[0].rawValue;
          } catch { detector = null; }
        }
        if (!found) {
          const scale = Math.min(1, 640 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
          if (r && r.data) found = r.data;
        }
        if (found && !stopped) {
          onCode(found);
        }
      }
    } catch { /* se reintenta */ }
    if (!stopped) setTimeout(loop, 180);
  };
  loop();
  return () => { stopped = true; };
}

/** Lee un QR de una imagen (por ejemplo, una captura elegida de la galería). */
export async function scanImageFile(file) {
  const bmp = await loadImage(file);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
  return r ? r.data : null;
}

export function loadImage(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
  });
}
