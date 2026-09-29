import { $, $$, clamp, formatClock, dayKey, recentDays, streakOf, prefersReducedMotion } from './util.js';
import {
  state, commit, subscribe, loadSession, saveSession, clearSession,
  addTask, updateTask, removeTask, restoreTask, clearDone, setSetting,
  recordSession, dayStats, resetAll, exportJSON, importJSON,
} from './store.js';
import { renderChart } from './chart.js';
import { createPalette } from './palette.js';
import { createMenu } from './menu.js';
import { chimeFocus, chimeBreak, blip } from './audio.js';

/* ── element handles ─────────────────────────────────────────────────── */
const el = {
  body: document.body,
  card: $('#timerCard'),
  clock: $('#clock'),
  ring: $('#ring'),
  ringBar: $('#ringBar'),
  modeLabel: $('#modeLabel'),
  toggleBtn: $('#toggleBtn'),
  toggleLabel: $('#toggleLabel'),
  resetBtn: $('#resetBtn'),
  skipBtn: $('#skipBtn'),
  dots: $('#dots'),
  live: $('#live'),
  taskPickBtn: $('#taskPickBtn'),
  taskPickLabel: $('#taskPickLabel'),
  taskPickWrap: $('#taskPickWrap'),
  segments: $$('[data-set-mode]'),
  thumb: $('.segmented__thumb'),
  zenBtn: $('#zenBtn'),
  themeBtn: $('#themeBtn'),
  settingsBtn: $('#settingsBtn'),
  settings: $('#settings'),
  cmdBtn: $('#cmdBtn'),
  cmdKbd: $('#cmdKbd'),
  streak: $('#streakPill'),
  taskForm: $('#taskForm'),
  taskInput: $('#taskInput'),
  taskList: $('#taskList'),
  taskEmpty: $('#taskEmpty'),
  taskCount: $('#taskCount'),
  tasksFoot: $('#tasksFoot'),
  tasksFootText: $('#tasksFootText'),
  clearDone: $('#clearDone'),
  filters: $('#filters'),
  chart: $('#chart'),
  weekLabel: $('#weekLabel'),
  toasts: $('#toasts'),
};

const MODE_LABEL = { focus: 'Focus', short: 'Short break', long: 'Long break' };
const RADIUS = 110;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const TICK_MS = 200;

/* ── timer engine ────────────────────────────────────────────────────── */
const timer = {
  mode: 'focus',
  running: false,
  endAt: 0,
  remaining: 0,
  cycle: 0,
  lastWholeSecond: -1,
};

const durationOf = (mode) => state.settings[mode] * 60_000;
const isBreak = () => timer.mode !== 'focus';

function setRemaining(ms) {
  timer.remaining = Math.max(0, ms);
  if (!timer.running) paint();
}

function nextMode() {
  if (!isBreak()) {
    timer.cycle = (timer.cycle + 1) % state.settings.interval;
    return timer.cycle === 0 ? 'long' : 'short';
  }
  return 'focus';
}

function setMode(mode, { announce = true } = {}) {
  timer.mode = MODE_LABEL[mode] ? mode : 'focus';
  timer.running = false;
  timer.remaining = durationOf(timer.mode);
  timer.lastWholeSecond = -1;
  el.card.dataset.mode = timer.mode;
  el.body.dataset.mode = timer.mode;
  selectMode(timer.mode);
  persist();
  paint();
  if (announce) say(`${MODE_LABEL[timer.mode]} set to ${state.settings[timer.mode]} minutes.`);
}

/** Move the segmented-control pill under the active tab. */
function selectMode(mode) {
  let active = null;
  for (const btn of el.segments) {
    const on = btn.dataset.setMode === mode;
    btn.setAttribute('aria-selected', String(on));
    if (on) active = btn;
  }
  if (!active || !el.thumb) return;
  // offsetLeft is measured from the container's border edge; the thumb sits at 4px.
  el.thumb.style.width = `${active.offsetWidth}px`;
  el.thumb.style.translate = `${active.offsetLeft - 4}px 0`;
}

function start() {
  if (timer.running) return;
  if (timer.remaining <= 0) timer.remaining = durationOf(timer.mode);
  timer.endAt = Date.now() + timer.remaining;
  timer.running = true;
  persist();
  paint();
  say(timer.mode === 'focus' ? 'Focus session started.' : `${MODE_LABEL[timer.mode]} started.`);
}

function pause() {
  if (!timer.running) return;
  timer.remaining = Math.max(0, timer.endAt - Date.now());
  timer.running = false;
  persist();
  paint();
  say('Paused.');
}

function toggle() {
  timer.running ? pause() : start();
}

function reset({ announce = true } = {}) {
  timer.running = false;
  timer.remaining = durationOf(timer.mode);
  timer.lastWholeSecond = -1;
  persist();
  paint();
  if (announce) say('Timer reset.');
}

function skip() {
  const from = timer.mode;
  const next = nextMode();
  const wasRunning = timer.running;
  timer.running = false;
  timer.remaining = durationOf(next);
  timer.mode = next;
  el.card.dataset.mode = next;
  el.body.dataset.mode = next;
  selectMode(next);
  persist();
  paint();
  if (state.settings.sound) blip(true);
  toast({ title: `Skipped ${MODE_LABEL[from].toLowerCase()}`, icon: 'i-skip' });
  if (wasRunning || state.settings.autoStart) start();
}

/** An interval ran all the way down. */
function complete() {
  const finished = timer.mode;
  const wasFocus = finished === 'focus';

  recordSession(finished, state.settings[finished]);
  if (state.settings.sound) wasFocus ? chimeFocus() : chimeBreak();

  // Auto-complete the focused task if this was its only remaining one.
  if (wasFocus && state.activeTaskId) {
    const task = state.tasks.find((t) => t.id === state.activeTaskId);
    if (task && !task.done) {
      updateTask(task.id, { done: true });
      toast({ title: 'Task complete', message: task.title, icon: 'i-check', accent: 'var(--ok)' });
    }
  }

  const next = nextMode();
  timer.mode = next;
  timer.running = false;
  timer.remaining = durationOf(next);
  el.card.dataset.mode = next;
  el.body.dataset.mode = next;
  selectMode(next);

  if (wasFocus) {
    celebrate();
    toast({
      title: 'Focus session complete',
      message: `Next up: ${MODE_LABEL[next].toLowerCase()}.`,
      icon: 'i-bolt',
    });
  } else {
    toast({ title: `${MODE_LABEL[finished]} over`, message: 'Time to focus.', icon: 'i-target' });
  }

  persist();
  paint();
  if (state.settings.autoStart) setTimeout(start, 600);
  renderInsights();
}

function tick() {
  if (!timer.running) return;
  const left = timer.endAt - Date.now();
  timer.remaining = Math.max(0, left);
  if (left <= 0) {
    complete();
    return;
  }
  const whole = Math.ceil(left / 1000);
  if (whole !== timer.lastWholeSecond) {
    timer.lastWholeSecond = whole;
    paint();
  }
}

function persist() {
  saveSession({
    mode: timer.mode,
    running: timer.running,
    endAt: timer.running ? timer.endAt : 0,
    remaining: timer.remaining,
    cycle: timer.cycle,
  });
}

/* ── rendering ───────────────────────────────────────────────────────── */
function paint() {
  const total = durationOf(timer.mode);
  const left = timer.remaining > 0 ? timer.remaining : total;
  el.clock.textContent = formatClock(left);

  const progress = clamp(1 - left / total, 0, 1);
  el.ringBar.style.strokeDashoffset = (CIRCUMFERENCE * (1 - progress)).toFixed(2);

  el.card.dataset.running = String(timer.running);
  el.toggleLabel.textContent = timer.running
    ? 'Pause'
    : `Start ${isBreak() ? MODE_LABEL[timer.mode].toLowerCase() : 'focus'}`;
  el.toggleBtn.querySelector('use').setAttribute('href', timer.running ? '#i-pause' : '#i-play');

  el.modeLabel.innerHTML = `<span class="timer__dot" aria-hidden="true"></span>${MODE_LABEL[timer.mode]}`;

  renderDots();
  renderTaskPick();

  const base = 'Cadence — focus studio';
  document.title = timer.running ? `${formatClock(left)} · ${MODE_LABEL[timer.mode]} — Cadence` : base;
}
function renderDots() {
  const interval = state.settings.interval;
  if (el.dots.childElementCount !== interval) {
    el.dots.replaceChildren(
      ...Array.from({ length: interval }, () => {
        const d = document.createElement('span');
        d.className = 'dots__dot';
        return d;
      }),
    );
  }
  [...el.dots.children].forEach((dot, i) => {
    dot.dataset.on = String(i < timer.cycle);
  });
  el.dots.setAttribute(
    'aria-label',
    `${timer.cycle} of ${interval} sessions completed this round`,
  );
}

function renderTaskPick() {
  const open = state.tasks.filter((t) => !t.done);
  const current = state.activeTaskId && open.some((t) => t.id === state.activeTaskId);
  el.taskPickLabel.textContent = current
    ? state.tasks.find((t) => t.id === state.activeTaskId).title
    : open.length
      ? 'No task selected'
      : 'No open tasks';
  el.taskPickWrap.dataset.active = String(Boolean(current));
  el.taskPickBtn.disabled = open.length === 0;
  taskMenu.refresh();
}

const escapeHTML = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* Session task picker — a real popup instead of an OS-drawn <select>. */
const taskMenu = createMenu(el.taskPickBtn, {
  getOptions: () => [
    { value: '', label: 'No task selected', selected: !state.activeTaskId },
    ...state.tasks
      .filter((t) => !t.done)
      .map((t) => ({ value: t.id, label: t.title, selected: t.id === state.activeTaskId })),
  ],
  onSelect: (value) => {
    state.activeTaskId = value || null;
    commit();
    const task = state.tasks.find((t) => t.id === state.activeTaskId);
    say(task ? `Session target: ${task.title}` : 'Session target cleared.');
  },
});

/* ── tasks ───────────────────────────────────────────────────────────── */
let filter = 'all';

function visibleTasks() {
  if (filter === 'active') return state.tasks.filter((t) => !t.done);
  if (filter === 'done') return state.tasks.filter((t) => t.done);
  return state.tasks;
}

function renderTasks() {
  const list = visibleTasks();
  const open = state.tasks.filter((t) => !t.done).length;
  el.taskCount.textContent = String(open);

  el.taskList.replaceChildren(
    ...list.map((task) => {
      const li = document.createElement('li');
      li.className = 'task';
      li.dataset.done = String(task.done);
      li.dataset.active = String(task.id === state.activeTaskId);
      li.dataset.id = task.id;

      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'task__check';
      check.setAttribute('aria-pressed', String(task.done));
      check.setAttribute('aria-label', `${task.done ? 'Reopen' : 'Complete'} “${task.title}”`);
      check.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-check"/></svg>';

      const label = document.createElement('span');
      label.className = 'task__label';
      label.textContent = task.title;
      label.title = task.title;

      const actions = document.createElement('div');
      actions.className = 'task__actions';

      const focusBtn = document.createElement('button');
      focusBtn.type = 'button';
      focusBtn.className = 'iconbtn';
      focusBtn.dataset.kind = 'focus';
      focusBtn.setAttribute('aria-label', `Focus this session on “${task.title}”`);
      focusBtn.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-target"/></svg>';

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'iconbtn';
      delBtn.dataset.kind = 'del';
      delBtn.setAttribute('aria-label', `Delete “${task.title}”`);
      delBtn.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-trash"/></svg>';

      actions.append(focusBtn, delBtn);
      li.append(check, label, actions);
      return li;
    }),
  );

  el.taskEmpty.hidden = list.length > 0;
  el.taskList.hidden = list.length === 0;
  el.tasksFoot.hidden = !state.tasks.some((t) => t.done);
  el.tasksFootText.textContent = `${state.tasks.filter((t) => t.done).length} done · ${open} open`;
}

el.taskList.addEventListener('click', (e) => {
  const li = e.target.closest('.task');
  if (!li) return;
  const id = li.dataset.id;
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;

  if (e.target.closest('[data-kind="del"]')) {
    const index = state.tasks.indexOf(task);
    removeTask(id);
    toast({
      title: 'Task deleted',
      message: task.title,
      icon: 'i-trash',
      action: { label: 'Undo', run: () => restoreTask(task, index) },
    });
    return;
  }

  if (e.target.closest('[data-kind="focus"]')) {
    state.activeTaskId = id;
    commit();
    if (state.settings.sound) blip(true);
    toast({ title: 'Session target set', message: task.title, icon: 'i-target' });
    return;
  }

  if (e.target.closest('.task__check') || e.target.closest('.task__label')) {
    const nowDone = !task.done;
    updateTask(id, { done: nowDone });
    if (nowDone && state.activeTaskId === id) {
      state.activeTaskId = state.tasks.find((t) => !t.done)?.id ?? null;
      commit();
    }
    if (state.settings.sound) blip(nowDone);
  }
});

el.taskForm.addEventListener('submit', (e) => {
  e.preventDefault();
  filter = 'all';
  syncFilters();
  const task = addTask(el.taskInput.value);
  if (!task) return el.taskInput.focus();
  el.taskInput.value = '';
  el.taskInput.focus();
  if (state.settings.sound) blip(true);
});

el.taskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    el.taskInput.value = '';
    el.taskInput.blur();
  }
});

el.filters.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  filter = btn.dataset.filter;
  syncFilters();
  renderTasks();
});

function syncFilters() {
  $$('#filters [data-filter]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.filter === filter)),
  );
}

el.clearDone.addEventListener('click', () => {
  const removed = clearDone();
  if (!removed.length) return;
  toast({
    title: `Cleared ${removed.length} completed task${removed.length > 1 ? 's' : ''}`,
    icon: 'i-check',
    action: { label: 'Undo', run: () => removed.forEach((t) => restoreTask(t, state.tasks.length)) },
  });
});

/* ── insights ────────────────────────────────────────────────────────── */
function renderInsights() {
  const { best, total } = renderChart(el.chart);

  const week = recentDays(7);
  const weekMinutes = week.reduce((n, d) => n + dayStats(d.key).focus * state.settings.focus, 0);
  const totalSessions = Object.values(state.days).reduce((n, d) => n + (d.focus ?? 0), 0);
  const todayMinutes = dayStats(dayKey()).focus * state.settings.focus;

  $('[data-today]').textContent = String(todayMinutes);
  $('[data-week]').textContent = weekMinutes >= 60 ? `${(weekMinutes / 60).toFixed(1)}h` : `${weekMinutes}m`;
  $('[data-sessions]').textContent = String(totalSessions);

  el.weekLabel.textContent = best ? `last 7 days · best ${best}m` : 'last 7 days';

  const streak = streakOf((key) => dayStats(key).focus);
  el.streak.querySelector('[data-streak]').textContent = String(streak);
  el.streak.dataset.hot = String(streak > 0);

  return { weekMinutes, total, best };
}

/* ── toasts ──────────────────────────────────────────────────────────── */
function toast({ title, message = '', icon = 'i-check', accent, action }) {
  const node = document.createElement('div');
  node.className = 'toast';
  if (accent) node.style.setProperty('--toast-accent', accent);

  const glyph = document.createElement('span');
  glyph.className = 'toast__icon';
  glyph.innerHTML = `<svg class="i" aria-hidden="true"><use href="#${icon}"/></svg>`;

  const text = document.createElement('span');
  text.className = 'toast__text';
  text.innerHTML = `<b></b>${message ? ` ${escapeHTML(message)}` : ''}`;
  text.querySelector('b').textContent = title;

  node.append(glyph, text);

  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      action.run();
      dismiss();
    });
    node.append(btn);
  }

  el.toasts.append(node);
  const life = action ? 7000 : 3800;
  const timerId = setTimeout(dismiss, life);

  function dismiss() {
    clearTimeout(timerId);
    if (node.dataset.closing) return;
    node.dataset.closing = 'true';
    node.addEventListener('transitionend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 600);
  }

  while (el.toasts.childElementCount > 3) el.toasts.firstElementChild.remove();
  return dismiss;
}

function say(message) {
  el.live.textContent = message;
}

/** A quick confetti-ish burst for finished focus sessions. */
function celebrate() {
  if (prefersReducedMotion()) return;
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:70;overflow:hidden';
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('i');
    const hue = Math.round(Math.random() * 60 + 250);
    p.style.cssText = `position:absolute;top:42%;left:50%;width:7px;height:11px;border-radius:2px;background:hsl(${hue} 85% 62%);opacity:0;transform:translate(-50%,-50%)`;
    layer.append(p);
    const angle = (i / 26) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 90 + Math.random() * 190;
    p.animate(
      [
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1) rotate(0deg)' },
        {
          opacity: 0,
          transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist + 140}px)) scale(0.4) rotate(${(Math.random() * 720 - 360) | 0}deg)`,
        },
      ],
      { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.16,1,.3,1)' },
    );
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 1600);
}

/* ── theme ───────────────────────────────────────────────────────────── */
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function resolveTheme(pref) {
  return pref === 'system' ? (darkQuery.matches ? 'dark' : 'light') : pref;
}

function applyTheme(pref = currentThemePref()) {
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  try {
    localStorage.setItem('cadence.theme', pref);
  } catch {}
  el.themeBtn.querySelector('use').setAttribute(
    'href',
    resolved === 'dark' ? '#i-sun' : '#i-moon',
  );
  el.themeBtn.setAttribute('aria-label', `Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`);
}

const currentThemePref = () => {
  try {
    return localStorage.getItem('cadence.theme') || 'system';
  } catch {
    return 'system';
  }
};

el.themeBtn.addEventListener('click', () => {
  applyTheme(resolveTheme(currentThemePref()) === 'dark' ? 'light' : 'dark');
});
darkQuery.addEventListener('change', () => {
  if (currentThemePref() === 'system') applyTheme('system');
});

/* ── settings ────────────────────────────────────────────────────────── */
const fields = {
  setFocus: { key: 'focus', min: 1, max: 180 },
  setShort: { key: 'short', min: 1, max: 60 },
  setLong: { key: 'long', min: 1, max: 90 },
  setInterval: { key: 'interval', min: 2, max: 8 },
};

function syncSettings() {
  for (const [id, { key }] of Object.entries(fields)) {
    document.getElementById(id).value = state.settings[key];
  }
  $('#setSound').setAttribute('aria-checked', String(state.settings.sound));
  $('#setAuto').setAttribute('aria-checked', String(state.settings.autoStart));
  $('#setTheme').value = currentThemePref();
}

for (const [id, { key, min, max }] of Object.entries(fields)) {
  const input = document.getElementById(id);
  input.addEventListener('change', () => {
    const value = clamp(Math.round(Number(input.value) || min), min, max);
    setSetting(key, value);
    syncSettings();
    // A running interval keeps its remaining time; only the shape changes.
    if (!timer.running) {
      timer.remaining = durationOf(timer.mode);
      timer.cycle = Math.min(timer.cycle, state.settings.interval - 1);
      persist();
      paint();
    }
    say(`${key} set to ${value}.`);
  });
}

el.settings.addEventListener('click', (e) => {
  const step = e.target.closest('[data-step]');
  if (!step) return;
  const { key, min, max } = fields[step.dataset.step];
  const input = document.getElementById(step.dataset.step);
  const next = clamp((Number(input.value) || min) + Number(step.dataset.dir), min, max);
  input.value = next;
  input.dispatchEvent(new Event('change'));
});

$('#setSound').addEventListener('click', (e) => {
  const on = !state.settings.sound;
  setSetting('sound', on);
  e.currentTarget.setAttribute('aria-checked', String(on));
  if (on) blip(true);
});

$('#setAuto').addEventListener('click', (e) => {
  const on = !state.settings.autoStart;
  setSetting('autoStart', on);
  e.currentTarget.setAttribute('aria-checked', String(on));
});

$('#setTheme').addEventListener('change', (e) => applyTheme(e.target.value));

el.settingsBtn.addEventListener('click', () => {
  syncSettings();
  el.settings.showModal();
});
$('#settingsClose').addEventListener('click', () => el.settings.close());
el.settings.addEventListener('click', (e) => {
  if (e.target === el.settings) el.settings.close();
});

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cadence-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast({ title: 'Exported', message: 'Your data was saved as JSON.', icon: 'i-download' });
});

$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    importJSON(await file.text());
    syncSettings();
    commitAndRender();
    toast({ title: 'Imported', message: 'Data replaced from file.', icon: 'i-upload', accent: 'var(--ok)' });
  } catch (err) {
    toast({ title: 'Import failed', message: err.message, icon: 'i-close', accent: 'var(--danger)' });
  }
});

$('#resetDataBtn').addEventListener('click', () => {
  const snapshot = exportJSON();
  resetAll();
  clearSession();
  setMode('focus');
  syncSettings();
  commitAndRender();
  toast({
    title: 'Everything reset',
    icon: 'i-trash',
    action: { label: 'Undo', run: () => { importJSON(snapshot); syncSettings(); commitAndRender(); } },
  });
});

/* ── zen mode ────────────────────────────────────────────────────────── */
function toggleZen(force) {
  const on = force ?? el.body.dataset.zen !== 'true';
  el.body.dataset.zen = String(on);
  el.zenBtn.setAttribute('aria-pressed', String(on));
  say(on ? 'Zen mode on.' : 'Zen mode off.');
}
el.zenBtn.addEventListener('click', () => toggleZen());

/* ── command palette ─────────────────────────────────────────────────── */
const palette = createPalette($('#palette'));

function commands() {
  return [
    { group: 'Timer', title: timer.running ? 'Pause timer' : 'Start focus session', icon: 'i-play', hint: 'Space', run: toggle },
    { group: 'Timer', title: 'Reset current interval', icon: 'i-reset', hint: 'R', run: () => reset() },
    { group: 'Timer', title: 'Skip to the next interval', icon: 'i-skip', hint: 'S', run: skip },
    { group: 'Timer', title: 'Focus mode', icon: 'i-target', run: () => setMode('focus') },
    { group: 'Timer', title: 'Short break', icon: 'i-target', run: () => setMode('short') },
    { group: 'Timer', title: 'Long break', icon: 'i-target', run: () => setMode('long') },
    { group: 'Timer', title: `${el.body.dataset.zen === 'true' ? 'Exit' : 'Enter'} zen mode`, icon: 'i-expand', hint: 'Z', run: () => toggleZen() },
    { group: 'Tasks', title: 'Add a new task', icon: 'i-plus', hint: 'N', run: () => { el.taskInput.focus(); } },
    { group: 'Tasks', title: 'Focus the next open task', icon: 'i-target', keywords: 'start session', run: () => {
        const next = state.tasks.find((t) => !t.done);
        if (!next) return toast({ title: 'No open tasks', icon: 'i-close' });
        state.activeTaskId = next.id;
        commit();
        toast({ title: 'Session target set', message: next.title, icon: 'i-target' });
      } },
    { group: 'Tasks', title: 'Clear completed tasks', icon: 'i-trash', run: () => {
        const removed = clearDone();
        toast({ title: removed.length ? `Cleared ${removed.length} task${removed.length > 1 ? 's' : ''}` : 'Nothing to clear', icon: 'i-check' });
      } },
    { group: 'View', title: 'Toggle theme', icon: 'i-moon', hint: 'T', keywords: 'dark light appearance', run: () => el.themeBtn.click() },
    { group: 'View', title: 'Open settings', icon: 'i-sliders', hint: ',', run: () => el.settingsBtn.click() },
    { group: 'Data', title: 'Export data as JSON', icon: 'i-download', run: () => $('#exportBtn').click() },
    { group: 'Data', title: 'Import data from JSON', icon: 'i-upload', run: () => $('#importBtn').click() },
    { group: 'Data', title: 'Reset all data', icon: 'i-trash', keywords: 'danger delete', run: () => $('#resetDataBtn').click() },
  ];
}

el.cmdBtn.addEventListener('click', () => palette.open(commands()));

/* ── keyboard ────────────────────────────────────────────────────────── */
const isTyping = (target) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    palette.toggle(commands());
    return;
  }
  if (e.key === '/' && !isTyping(e.target)) {
    e.preventDefault();
    palette.open(commands());
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
  if (document.querySelector('dialog[open]')) return;

  switch (e.key.toLowerCase()) {
    case ' ':
      e.preventDefault();
      toggle();
      break;
    case 'r':
      reset();
      break;
    case 's':
      skip();
      break;
    case 't':
      el.themeBtn.click();
      break;
    case 'z':
      toggleZen();
      break;
    case ',':
      el.settingsBtn.click();
      break;
    case 'n':
      e.preventDefault();
      el.taskInput.focus();
      break;
    case '1':
      setMode('focus');
      break;
    case '2':
      setMode('short');
      break;
    case '3':
      setMode('long');
      break;
    default:
      return;
  }
});

/* ── wiring ──────────────────────────────────────────────────────────── */
el.ring.style.setProperty('--circ', CIRCUMFERENCE.toFixed(3));
el.toggleBtn.addEventListener('click', toggle);
el.resetBtn.addEventListener('click', () => reset());
el.skipBtn.addEventListener('click', skip);
el.segments.forEach((btn) =>
  btn.addEventListener('click', () => setMode(btn.dataset.setMode)),
);

function commitAndRender() {
  renderTasks();
  renderTaskPick();
  renderInsights();
  paint();
}
subscribe(commitAndRender);

const isApple = /mac|iphone|ipad/i.test(navigator.userAgent);
el.cmdKbd.textContent = isApple ? '⌘K' : 'Ctrl K';

/* ── boot ────────────────────────────────────────────────────────────── */
function restore() {
  const saved = loadSession();
  if (!saved) return setMode('focus', { announce: false });

  timer.mode = MODE_LABEL[saved.mode] ? saved.mode : 'focus';
  timer.cycle = Math.max(0, Math.min(saved.cycle | 0, state.settings.interval - 1));
  timer.remaining = Number(saved.remaining) || durationOf(timer.mode);
  el.card.dataset.mode = timer.mode;
  el.body.dataset.mode = timer.mode;
  selectMode(timer.mode);

  if (saved.running && saved.endAt) {
    if (saved.endAt > Date.now()) {
      timer.running = true;
      timer.endAt = saved.endAt;
      timer.remaining = saved.endAt - Date.now();
    } else {
      // The interval elapsed while the tab was away — credit it and move on.
      timer.remaining = 0;
      complete();
      toast({
        title: 'Welcome back',
        message: 'A session finished while you were away — it was logged.',
        icon: 'i-bolt',
      });
    }
  }
  paint();
}

applyTheme();
restore();
syncSettings();
syncFilters();
commitAndRender();

setInterval(tick, TICK_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tick();
});

// The pill is measured in JS, so re-measure when the box or fonts change.
addEventListener('resize', () => selectMode(timer.mode));
new ResizeObserver(() => selectMode(timer.mode)).observe(el.segments[0].parentElement);
document.fonts?.ready.then(() => selectMode(timer.mode));

/* Roll the day over without a reload. */
let lastDay = new Date().getDate();
setInterval(() => {
  const now = new Date().getDate();
  if (now !== lastDay) {
    lastDay = now;
    commitAndRender();
  }
}, 60_000);
