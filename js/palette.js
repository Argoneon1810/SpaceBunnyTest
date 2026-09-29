/* ⌘K command palette: fuzzy filter, grouped list, full keyboard control. */

import { $ } from './util.js';

/** Match if the needle is a substring or a subsequence of the haystack. */
function matches(needle, haystack) {
  if (!needle) return true;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  if (h.includes(n)) return true;
  let hi = 0;
  for (const ch of n) {
    const found = h.indexOf(ch, hi);
    if (found === -1) return false;
    hi = found + 1;
  }
  return true;
}

export function createPalette(dialog) {
  const input = $('#paletteInput', dialog);
  const list = $('#paletteList', dialog);
  let commands = [];
  let rows = [];
  let cursor = 0;

  function build() {
    const q = input.value.trim();
    // Filter in registry order and keep groups intact — sorting globally would
    // interleave categories and repeat the same header several times.
    const groups = [];
    for (const cmd of commands) {
      if (!matches(q, `${cmd.group} ${cmd.title} ${cmd.keywords ?? ''}`)) continue;
      let group = groups.at(-1);
      if (!group || group.name !== cmd.group) {
        group = { name: cmd.group, items: [] };
        groups.push(group);
      }
      group.items.push(cmd);
    }

    if (!groups.length) {
      list.replaceChildren(
        Object.assign(document.createElement('li'), {
          className: 'palette__empty',
          textContent: 'No matching command',
        }),
      );
      rows = [];
      return;
    }

    const frag = document.createDocumentFragment();
    rows = [];
    for (const group of groups) {
      const head = document.createElement('li');
      head.className = 'palette__group';
      head.setAttribute('role', 'presentation');
      head.textContent = group.name;
      frag.append(head);

      for (const cmd of group.items) {
        const item = document.createElement('li');
        item.setAttribute('role', 'presentation');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'palette__item';
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', 'false');
        if (cmd.icon) {
          const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          icon.setAttribute('class', 'i');
          icon.setAttribute('aria-hidden', 'true');
          const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
          use.setAttribute('href', `#${cmd.icon}`);
          icon.append(use);
          btn.append(icon);
        }
        const label = document.createElement('span');
        label.textContent = cmd.title;
        btn.append(label);
        if (cmd.hint) {
          const kbd = document.createElement('kbd');
          kbd.textContent = cmd.hint;
          btn.append(kbd);
        }
        btn.addEventListener('click', () => run(cmd));
        item.append(btn);
        frag.append(item);
        rows.push({ btn, cmd });
      }
    }
    list.replaceChildren(frag);
    cursor = 0;
    highlight(0);
  }

  function highlight(next) {
    if (!rows.length) return;
    cursor = (next + rows.length) % rows.length;
    rows.forEach((row, i) => row.btn.setAttribute('aria-selected', String(i === cursor)));
    rows[cursor].btn.scrollIntoView({ block: 'nearest' });
  }

  function run(cmd) {
    close();
    cmd.run();
  }

  function open(registry) {
    commands = registry;
    input.value = '';
    build();
    dialog.showModal();
    input.focus();
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  input.addEventListener('input', build);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlight(cursor + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight(cursor - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[cursor]) run(rows[cursor].cmd);
    } else if (e.key === 'Home') {
      e.preventDefault();
      highlight(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      highlight(rows.length - 1);
    }
  });

  // Clicking the backdrop (outside the panel) closes it.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });

  return { open, close, toggle: (registry) => (dialog.open ? close() : open(registry)) };
}
