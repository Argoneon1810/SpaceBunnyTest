/* Small shared helpers. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`);

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** "25:07" from milliseconds. */
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Local-time YYYY-MM-DD (never UTC — days are the user's days). */
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The last `n` day keys, oldest first, ending today. */
export function recentDays(n = 7) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    out.push({ key: dayKey(d), date: d, today: i === 0 });
  }
  return out;
}

/** Consecutive days (ending today, or yesterday if today is empty) with data. */
export function streakOf(countFor) {
  let streak = 0;
  const cursor = new Date();
  if (!countFor(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (countFor(dayKey(cursor)) > 0) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const prefersReducedMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches;
