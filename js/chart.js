/* Weekly focus-minutes bar chart. Pure DOM + CSS so it themes for free. */

import { recentDays, prefersReducedMotion } from './util.js';
import { focusMinutes } from './store.js';

const DAY_INITIALS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function renderChart(root) {
  const days = recentDays(7);
  const values = days.map((d) => focusMinutes(d.key));
  const peak = Math.max(30, ...values);
  const total = values.reduce((a, b) => a + b, 0);

  root.replaceChildren(
    ...days.map(({ key, date, today }, i) => {
      const minutes = values[i];
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.dataset.today = String(today);
      bar.dataset.empty = String(minutes === 0);
      bar.style.setProperty('--v', (minutes / peak).toFixed(4));
      if (!prefersReducedMotion()) bar.style.animationDelay = `${i * 45}ms`;

      const col = document.createElement('div');
      col.className = 'bar__col';

      const val = document.createElement('span');
      val.className = 'bar__val';
      val.textContent = minutes ? `${minutes}m` : '—';

      const fill = document.createElement('span');
      fill.className = 'bar__fill';

      col.append(val, fill);

      const label = document.createElement('span');
      label.className = 'bar__label';
      label.textContent = today ? 'Today' : DAY_INITIALS[date.getDay()];

      bar.append(col, label);
      bar.setAttribute('aria-hidden', 'true');
      return bar;
    }),
  );

  const summary = total
    ? `${Math.round(total)} focus minutes across the last 7 days, best day ${Math.max(...values)} minutes.`
    : 'No focus sessions recorded in the last 7 days yet.';
  root.setAttribute('aria-label', summary);
  return { total, peak, best: Math.max(...values) };
}
