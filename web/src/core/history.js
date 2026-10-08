// Historial de conversaciones, guardado solo en este dispositivo.
import { log } from './log.js';

const KEY = 'parla.history';
const MAX_SESSIONS = 150;
const MAX_MESSAGES = 1500;
let cache = null;
const listeners = new Set();

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { cache = []; }
  if (!Array.isArray(cache)) cache = [];
  return cache;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch (e) {
    // Si no cabe, se eliminan las más antiguas
    log('history persist failed, trimming', e && e.message);
    cache = cache.slice(0, Math.max(10, Math.floor(cache.length * 0.7)));
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* */ }
  }
  for (const l of listeners) { try { l(); } catch { /* */ } }
}

export function onHistory(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function listHistory() {
  return load().slice().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function getHistory(id) {
  return load().find((h) => h.id === id) || null;
}

let saveTimer = null;
export function upsertHistory(rec) {
  load();
  const i = cache.findIndex((h) => h.id === rec.id);
  const clean = { ...rec, messages: (rec.messages || []).slice(-MAX_MESSAGES) };
  if (i >= 0) cache[i] = clean; else cache.unshift(clean);
  if (cache.length > MAX_SESSIONS) cache = cache.slice(0, MAX_SESSIONS);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 400);
}

export function flushHistory() {
  clearTimeout(saveTimer);
  if (cache) persist();
}

export function deleteHistory(id) {
  load();
  cache = cache.filter((h) => h.id !== id);
  persist();
}

export function clearHistory() {
  cache = [];
  persist();
}

export function replaceHistory(list) {
  cache = Array.isArray(list) ? list : [];
  persist();
}

export function mergeHistory(list) {
  load();
  const ids = new Set(cache.map((h) => h.id));
  for (const h of list || []) if (!ids.has(h.id)) cache.push(h);
  cache.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  if (cache.length > MAX_SESSIONS) cache = cache.slice(0, MAX_SESSIONS);
  persist();
}
