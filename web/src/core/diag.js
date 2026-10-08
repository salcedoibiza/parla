// Texto de diagnóstico para enviar si algo falla.
import { getLogs } from './log.js';
import { isApp, nativeInfo } from './native.js';
import { APP_VERSION } from './config.js';

export function diagText() {
  const info = nativeInfo();
  return [
    `Parla ${APP_VERSION} ${isApp ? 'app' : 'web'}`,
    info ? `Android SDK ${info.sdk} · ${info.model} · voz:${info.speech} · mic:${info.mic}` : navigator.userAgent,
    `online:${navigator.onLine}`,
    ...getLogs(),
  ].join('\n');
}
