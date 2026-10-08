// Ajustes de publicación. WEB_BASE y APK_URL se rellenan al compilar cuando la web esté publicada.
import { isApp } from './native.js';

/* global __WEB_BASE__, __APK_URL__, __APP_VERSION__ */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const BUILD_WEB_BASE = typeof __WEB_BASE__ !== 'undefined' ? __WEB_BASE__ : '';
export const APK_URL = typeof __APK_URL__ !== 'undefined' ? __APK_URL__ : '';

export function webBase() {
  if (BUILD_WEB_BASE) return BUILD_WEB_BASE;
  if (!isApp && typeof location !== 'undefined' && /^https?:/.test(location.protocol)) {
    return location.origin + location.pathname;
  }
  return '';
}

/** Enlace de invitación: abre la web (o la app) directamente en la sesión. */
export function inviteLink(code, purpose = 'j') {
  const base = webBase();
  if (base) return `${base}#${purpose}=${code}`;
  return `parla://${purpose}/${code}`;
}
