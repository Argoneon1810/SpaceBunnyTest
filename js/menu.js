/* Custom listbox popup for the session task picker.
   A native <select> was the wrong tool: its dropdown is drawn by the OS and
   ignores CSS, so it can't be themed. This is a portalled, fully styleable
   menu with light-dismiss, Escape, arrow-key and type-ahead support. */

const GAP = 8;
const EDGE = 8;

export function createMenu(button, { getOptions, onSelect }) {
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.id = 'taskPickMenu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Task this session counts toward');
  menu.hidden = true;
  document.body.append(menu);

  let open = false;
  let rows = [];
  let cursor = -1;
  let typeahead = '';
  let typeaheadTimer = 0;

  /* ── positioning ────────────────────────────────────────────────────── */
  function place() {
    const anchor = button.getBoundingClientRect();
    // Match the trigger's width, but never wider than the viewport.
    menu.style.minWidth = `${anchor.width}px`;
    menu.style.maxWidth = `${Math.min(anchor.width, window.innerWidth - EDGE * 2)}px`;

    // Measure, then decide which side has room.
    const height = menu.offsetHeight;
    const roomBelow = window.innerHeight - anchor.bottom - GAP;
    const openDown = roomBelow >= height || roomBelow >= anchor.top;
    menu.style.maxHeight = `${Math.max(120, openDown ? roomBelow : anchor.top - GAP)}px`;
    menu.style.top = openDown
      ? `${anchor.bottom + GAP}px`
      : `${Math.max(EDGE, anchor.top - height - GAP)}px`;

    const width = menu.offsetWidth;
    const left = Math.min(Math.max(EDGE, anchor.left), window.innerWidth - width - EDGE);
    menu.style.left = `${left}px`;
  }

  /* ── rendering ──────────────────────────────────────────────────────── */
  function render() {
    const options = getOptions();
    rows = [];
    cursor = -1;

    const frag = document.createDocumentFragment();
    for (const option of options) {
      const item = document.createElement('div');
      item.className = 'menu__item';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(Boolean(option.selected)));
      item.dataset.value = option.value;

      const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      check.setAttribute('class', 'i menu__check');
      check.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#i-check');
      check.append(use);

      const text = document.createElement('span');
      text.className = 'menu__text';
      text.textContent = option.label;
      text.title = option.label;

      item.append(check, text);
      item.addEventListener('click', () => {
        hide();
        onSelect(option.value);
      });
      item.addEventListener('pointermove', () => setCursor(rows.indexOf(item), false));

      frag.append(item);
      rows.push(item);
    }

    if (!rows.length) {
      const none = document.createElement('p');
      none.className = 'menu__empty';
      none.textContent = 'No open tasks — add one on the right.';
      frag.append(none);
    }

    menu.replaceChildren(frag);
  }

  function setCursor(index, scroll = true) {
    if (index < 0 || !rows.length) return;
    cursor = index;
    rows.forEach((row, i) => row.classList.toggle('is-cursor', i === cursor));
    if (scroll) rows[cursor].scrollIntoView({ block: 'nearest' });
  }

  /* ── open / close ───────────────────────────────────────────────────── */
  function show() {
    if (open) return;
    render();
    menu.hidden = false;
    open = true;
    button.setAttribute('aria-expanded', 'true');
    place();
    const selected = rows.findIndex((r) => r.getAttribute('aria-selected') === 'true');
    setCursor(selected === -1 ? 0 : selected);
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKeydown, true);
    addEventListener('scroll', place, true);
    addEventListener('resize', place);
  }

  function hide() {
    if (!open) return;
    menu.hidden = true;
    open = false;
    cursor = -1;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKeydown, true);
    removeEventListener('scroll', place, true);
    removeEventListener('resize', place);
  }

  function onOutside(event) {
    if (!menu.contains(event.target) && !button.contains(event.target)) hide();
  }

  function onKeydown(event) {
    if (!open) return;
    const { key } = event;

    if (key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      hide();
      button.focus();
    } else if (key === 'ArrowDown') {
      event.preventDefault();
      setCursor((cursor + 1) % rows.length);
    } else if (key === 'ArrowUp') {
      event.preventDefault();
      setCursor((cursor - 1 + rows.length) % rows.length);
    } else if (key === 'Home') {
      event.preventDefault();
      setCursor(0);
    } else if (key === 'End') {
      event.preventDefault();
      setCursor(rows.length - 1);
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (rows[cursor]) rows[cursor].click();
    } else if (key === 'Tab') {
      hide();
    } else if (key.length === 1 && /\S/.test(key)) {
      // type-ahead: jump to the next option starting with these characters
      event.preventDefault();
      clearTimeout(typeaheadTimer);
      typeahead += key.toLowerCase();
      typeaheadTimer = setTimeout(() => (typeahead = ''), 600);
      const needle = typeahead;
      const start = cursor + 1;
      const order = [...rows.slice(start), ...rows.slice(0, start)];
      const hit = order.find((r) => r.textContent.toLowerCase().startsWith(needle));
      if (hit) setCursor(rows.indexOf(hit));
    }
  }

  button.addEventListener('click', () => (open ? hide() : show()));
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) show();
    }
  });

  return {
    hide,
    toggle: () => (open ? hide() : show()),
    get isOpen() {
      return open;
    },
    refresh() {
      if (open) {
        render();
        place();
      }
    },
    destroy() {
      hide();
      menu.remove();
    },
    elements: { menu },
  };
}
