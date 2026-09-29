/* Persistent app state: one localStorage key, in-memory mirror, tiny pub/sub. */

import { dayKey, uid } from './util.js';

const KEY = 'cadence.state';
const SESSION_KEY = 'cadence.session';

const DEFAULTS = {
  version: 1,
  tasks: [],
  activeTaskId: null,
  settings: {
    focus: 25,
    short: 5,
    long: 15,
    interval: 4,
    sound: true,
    autoStart: false,
  },
  /** { "2026-09-29": { focus: 4, short: 1, long: 0 } } */
  days: {},
  createdAt: dayKey(),
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Merge saved data over defaults so older payloads keep working. */
function hydrate(saved) {
  const state = structuredClone(DEFAULTS);
  if (!saved || typeof saved !== 'object') return state;
  if (Array.isArray(saved.tasks)) {
    state.tasks = saved.tasks
      .filter((t) => t && typeof t.title === 'string')
      .map((t) => ({
        id: t.id || uid(),
        title: t.title.slice(0, 140),
        done: Boolean(t.done),
        createdAt: t.createdAt || Date.now(),
        completedAt: t.completedAt || null,
      }));
  }
  state.activeTaskId = saved.activeTaskId ?? null;
  if (saved.settings) Object.assign(state.settings, saved.settings);
  if (saved.days && typeof saved.days === 'object') state.days = saved.days;
  return state;
}

export const state = hydrate(read(KEY, null));

const listeners = new Set();
let flushHandle = 0;

/** Batch writes to one paint-aligned save so rapid edits don't thrash storage. */
function flush() {
  flushHandle = 0;
  if (!write(KEY, state)) console.warn('[cadence] could not persist state');
}

export function commit() {
  if (!flushHandle) flushHandle = setTimeout(flush, 120);
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ── volatile session (not part of the saved document) ─────────────────── */

export function loadSession() {
  return read(SESSION_KEY, null);
}

export function saveSession(session) {
  write(SESSION_KEY, session);
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}

/* ── data operations ──────────────────────────────────────────────────── */

export function addTask(title) {
  const clean = title.trim().replace(/\s+/g, ' ').slice(0, 140);
  if (!clean) return null;
  const task = { id: uid(), title: clean, done: false, createdAt: Date.now(), completedAt: null };
  state.tasks.unshift(task);
  state.activeTaskId ??= task.id;
  commit();
  return task;
}

export function updateTask(id, patch) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return null;
  Object.assign(task, patch);
  if (patch.done === true) task.completedAt = Date.now();
  if (patch.done === false) task.completedAt = null;
  commit();
  return task;
}

export function removeTask(id) {
  const index = state.tasks.findIndex((t) => t.id === id);
  if (index < 0) return null;
  const [task] = state.tasks.splice(index, 1);
  if (state.activeTaskId === id) state.activeTaskId = state.tasks[0]?.id ?? null;
  commit();
  return task;
}

export function restoreTask(task, index = 0) {
  if (!task) return;
  state.tasks.splice(Math.min(index, state.tasks.length), 0, task);
  commit();
}

export function clearDone() {
  const removed = state.tasks.filter((t) => t.done);
  if (!removed.length) return [];
  state.tasks = state.tasks.filter((t) => !t.done);
  if (state.activeTaskId && removed.some((t) => t.id === state.activeTaskId)) {
    state.activeTaskId = state.tasks[0]?.id ?? null;
  }
  commit();
  return removed;
}

export function setSetting(key, value) {
  state.settings[key] = value;
  commit();
}

export function recordSession(mode, minutes) {
  const key = dayKey();
  const day = (state.days[key] ??= { focus: 0, short: 0, long: 0 });
  day[mode] = (day[mode] ?? 0) + 1;
  commit();
}

export function dayStats(key) {
  return state.days[key] ?? { focus: 0, short: 0, long: 0 };
}

export function focusMinutes(key) {
  return dayStats(key).focus * state.settings.focus;
}

export function resetAll() {
  Object.assign(state, structuredClone(DEFAULTS));
  commit();
}

export function exportJSON() {
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('Not a Cadence export.');
  Object.assign(state, hydrate(parsed));
  commit();
}
