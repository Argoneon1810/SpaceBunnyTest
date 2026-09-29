# Cadence

A calm focus timer with tasks, insights, and a command palette. No build step, no
dependencies, no network calls — just HTML, CSS, and ES modules.

```
┌──────────────────────────────────────────────┐
│  Cadence  focus studio          ⌘K  ☾  ⚙    │
├───────────────────────┬──────────────────────┤
│      Focus │ Short │ Long                    │
│            ╭─────╮                          │
│            │25:00│   ← SVG progress ring    │
│            ╰─────╯                          │
│        ↺  [ Start focus ]  ⏭                │
│                       ● ● ○ ○               │
├───────────────────────┼──────────────────────┤
│ Tasks      3     All  Active  Done          │
│ [ What are you working on?      ] + Add     │
│ ○ Ship the new onboarding flow               │
│ ○ Review PR #412                             │
│                       ┌──────────────────────┤
│ Insights   last 7 days│                      │
│ 0    0m    0          │                      │
│ min  week  sessions   │                      │
│ ▁ ▂ ▃ ▅ ▂ ▁ ▇  ← 7-day chart              │
└───────────────────────┴──────────────────────┘
```

## Quick start

```bash
node server.js          # → http://localhost:4321
PORT=5000 node server.js   # if 4321 is taken
```

Node 18+. That is the entire setup — `server.js` is a ~70-line static file server
with no dependencies. Any static host works too; the only requirement is that
`.js` files are served with a JavaScript MIME type, since the app uses ES modules.

## Features

**Timer** — Pomodoro cycles (focus → short break → long break every *N* sessions).
Counts down from an absolute timestamp, so it stays accurate when the tab is
backgrounded and it survives a reload — close the tab mid-session and pick it
back up. If an interval elapses while you are away it is logged and you are moved
to the next one.

**Tasks** — Add, complete, delete, and pick a session target. Filtering by
all/active/done. Deleting and bulk-clearing are undoable via toast.

**Insights** — Focus minutes today, this week, all-time session count, current
streak, and a seven-day bar chart. Day boundaries use local time, not UTC.

**Command palette** — `Ctrl`/`⌘`+`K` or `/`. Fuzzy-subsequence matching, grouped
results, full keyboard control, type-ahead.

**Also** — dark/light/system themes, zen mode (dims the UI to just the timer),
keyboard shortcuts, `localStorage` persistence, JSON export/import, and
WebAudio-synthesised chimes (no audio files).

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Start / pause |
| `R` | Reset the current interval |
| `S` | Skip to the next interval |
| `T` | Toggle theme |
| `Z` | Zen mode |
| `,` | Open settings |
| `N` | Jump to the new-task input |
| `1` `2` `3` | Focus / short break / long break |
| `Ctrl`/`⌘`+`K`, `/` | Command palette |
| `Esc` | Close an overlay, clear the task input |

Shortcuts are suppressed while typing in a field and while a dialog is open.

## Project layout

```
index.html        markup + inline SVG icon sprite
styles.css        design system, single stylesheet
server.js         dependency-free static server
js/
  app.js          timer engine, wiring, keyboard, toasts
  store.js        state, persistence, pub/sub
  menu.js         custom listbox popup (task picker)
  palette.js      command palette
  chart.js        seven-day bar chart
  audio.js        WebAudio synth
  util.js         small shared helpers
```

`store.js` is the only module that touches `localStorage`; everything else reads
state and calls `commit()`. Writes are batched onto a ~120 ms timer so rapid
edits don't thrash storage, and a single `subscribe` re-render keeps the DOM in
sync.

## Design notes

- **Colour** is authored in `oklch()` and derived with `color-mix()`, so the
  accent can shift hue with the current interval and every tint stays in-gamut.
  Themes are a single block of custom-property overrides under
  `:root[data-theme]`.
- **Cascade layers** (`reset → tokens → base → primitives → layout → components →
  motion → utils`) keep specificity low and predictable.
- **Type** is a fluid `clamp()` scale; the countdown uses `JetBrains Mono` with
  tabular numerals so digits don't jitter.
- **Motion** respects `prefers-reduced-motion`, and `prefers-contrast: more`
  strengthens borders.
- **Overlays** use native `<dialog>` plus `@starting-style` and
  `transition-behavior: allow-discrete` for entry/exit animations.

Three things worth knowing if you edit the CSS:

- `[hidden] { display: none !important }` is load-bearing. Author `display` rules
  outrank the UA's `[hidden]` rule, so any element toggled via the `hidden`
  attribute needs it to actually hide.
- `dialog { margin: auto }` is restored explicitly in the reset layer. The
  universal `* { margin: 0 }` would otherwise override it, and modal dialogs stop
  centring.
- Key labels are **generated content**, not text. `<kbd data-kbd="palette">` is
  empty in the markup; its label comes from `kbd[data-kbd="palette"]::after`,
  which is `Ctrl K` by default and overridden to `⌘K` under
  `:root[data-os="apple"]`. The head script sets `data-os` from
  `navigator.userAgentData.platform` (falling back to `navigator.platform`, then
  the UA string), which keeps the label correct on the *first* paint. Setting the
  text from `app.js` instead worked, but flashed `⌘K` at Windows and Linux users
  before correcting itself. Don't hardcode a modifier glyph in the markup.

The task picker is a hand-built popup rather than a native `<select>`: a select's
dropdown is drawn by the OS and ignores CSS, so it cannot be themed. The popup is
portalled to `<body>` to escape the timer card's `overflow: hidden`.

## Data

Everything stays in `localStorage` under `cadence.state`, `cadence.session`, and
`cadence.theme`. Nothing is sent anywhere. Settings → Data exports the whole
document as JSON and imports it back.

## Browser support

Current Chrome, Edge, Safari and Firefox. The app degrades gracefully rather than
breaking: `oklch()`/`color-mix()` and `@layer` need a 2023+ browser,
`@starting-style` and `allow-discrete` only affect whether overlays *animate* —
they still open and close without them. The font is a progressive enhancement
over a system font stack.

## Known gaps

- The settings sheet's Appearance control is still a native `<select>`. It is
  keyboard- and screen-reader-accessible for free and isn't visually prominent,
  but it is OS-drawn and will not match the custom task picker.
- Interval changes only affect the current timer when it is stopped; a running
  interval keeps its remaining time.
- Verified by static analysis and headless screenshots of the initial render,
  both themes, the task picker, the command palette, and the reported layout
  bugs. The countdown, shortcuts, persistence round-trip, and import/export have
  not been exercised end-to-end in a browser. In particular the command-palette
  fix and the `,` shortcut were traced by inspection and a Node harness modelling
  the WebIDL receiver check, not by clicking them — a browser pass over the
  palette is still worth doing.

## Prompts

The four prompts that shaped this app, verbatim.

**1 — the brief**

> make a nice little web app that follows de facto modern aesthetic standard at
> your best.

**2 — the debugging direction**

> 1. legacy dropdown
> 2. improper icon shape
> 3. wrong command pannel position

**3 — the reported symptom**

> command toggle theme not working

**4 — the platform inconsistency**

> keyboard shortcut icons are inconsistent. some are windows, some are mac. make
> it depends on the os

Prompts 2 and 4 arrived with a screenshot showing the defect; the other two were
text only. Spelling is reproduced as given.

The second prompt found three real bugs, all confirmed by inspection rather than
guesswork:

1. **Legacy dropdown** — the task picker was a native `<select>`, whose dropdown
   is drawn by the OS and ignores CSS, so `appearance: none` could never fix it.
   Replaced with a portalled custom popup.
2. **Improper icon shape** — `i-reset`'s arc ended in an "L" that read as a
   slash, and `i-play`/`i-skip` mixed `fill` *and* `stroke` into muddy outlines.
   Replaced with clean single-technique geometry.
3. **Wrong command palette position** — the reset layer's `* { margin: 0 }`
   overrode the UA's `dialog { margin: auto }`, so the modal lost its centring.

Fixing them surfaced two further bugs that weren't reported: the `hidden`
attribute was being defeated by author `display` rules (the "Nothing here yet"
state rendered *below* three real tasks), and the segmented control's indicator
was never sized in JS, leaving the selected tab with a 2px sliver instead of a
pill.

The third prompt reported one symptom and turned up two bugs, only one of which
was the reported one. The scope mattered: "toggle theme" turned out to work
perfectly via the header button and the `T` key, so the defect had to be
localised to the command palette rather than to theming.

1. **Silent palette failure** — two registry entries stored a bare method
   reference:

   ```js
   { group: 'View', title: 'Toggle theme', run: el.themeBtn.click }
   ```

   The palette dispatches with a plain call (`cmd.run()` in `palette.js`), so
   `this` was the command descriptor, not the button. `HTMLElement.prototype.click`
   is a WebIDL operation that validates its receiver, so it threw
   `TypeError: Illegal invocation`. Because the palette closed *before* invoking,
   the visible result was the dialog dismissing itself and nothing else happening
   — a dead menu item with no error surfaced to the user. Wrapped in arrow
   functions like every other entry in the registry.
2. **Phantom shortcut hint** — the adjacent "Open settings" entry advertised a `,`
   hint that no key handler ever implemented. The handler was added rather than
   the hint removed, so the UI stopped lying.

Neither bug was reachable by reading the theme code alone, and the first is
invisible in normal use unless you open the palette and pick the item. Both were
confirmed by inspection plus a Node harness modelling the WebIDL receiver check;
neither was reproduced in a browser (see *Known gaps*).

One thing worth knowing before you add a command: never store a DOM method
reference directly in `commands()`. It reads as shorthand and quietly loses the
receiver. Use `run: () => el.foo.click()`.

The fourth prompt arrived with a screenshot of the footer, and it was accurate.
The cause was duplicated state: the header button's `<kbd>` carried an `id` that
`app.js` rewrote per platform, while the footer hint strip's `<kbd>⌘K</kbd>` was
hardcoded and never touched. Two renderings of one label, one of which was simply
wrong on every non-Mac machine — a bug no amount of reading the theming code
would reveal, since the theme layer was entirely innocent.

Fixed by collapsing both to a single source of truth:

- `<head>` sets `data-os="apple" | "other"` from `navigator.userAgentData.platform`
  (falling back to `navigator.platform`, then the UA string).
- The `<kbd>` is now empty in the markup and its label is generated content:
  `kbd[data-kbd="palette"]::after`, `Ctrl K` by default and `⌘K` under
  `:root[data-os="apple"]`.

Generating the label in CSS rather than assigning `textContent` from `app.js` is
the load-bearing part. `app.js` is a deferred module, so a JS swap would paint
`⌘K` at Windows and Linux users first and correct itself a moment later — the
same flash the head script already prevents for the theme. CSS resolves it
before the first frame. Detection was also tightened at the same time: the old
check was a bare `/mac|iphone|ipad/` against `navigator.userAgent`, and it now
prefers the structured `userAgentData.platform` where the browser exposes it.

`Ctrl K` is the base rule with no `data-os` override, so if the head script ever
fails the label degrades to something sane rather than to empty.

Verified against 11 real platform strings (Windows/macOS/Linux/Android/Chrome OS
across Chrome, Firefox, Safari and Edge, plus iPadOS and iPhone) — but not seen
in a browser; see *Known gaps*.

## Licence

Unlicensed — do whatever you want with it.
