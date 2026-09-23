# Porting a Claude Design mockup into Task Monitor

**Read this before touching a `.dc.html` file.** It is the process we settled on
while doing Board → Gantt, written down so it does not have to be explained
again for the next Explorer.

The short version: **render the mockup, copy it panel for panel, wire the real
data to it, delete what it replaced, guard it, and verify in the harness.** In
that order. Skipping step 1 is what caused three rounds of rework on the Board.

---

## 0. The standing rules

- **The mockup wins on look; the app wins on coverage.** If the mockup draws a
  thing the app has (a card, a chip, a band), copy its geometry, colour, size
  and weight exactly. If the app has a feature the mockup does not draw (a
  column picker, drag-to-reschedule, an export menu), the feature stays — do
  not delete a capability to match a screenshot.
- **Never invent a number.** If the mockup shows something the data cannot
  support, point the panel at the nearest real thing or do not build it, and
  write down which in CLAUDE.md's "what happened to each mockup tab" table.
- **One definition, many surfaces.** Anything the mockup shows in two places —
  a status, a person, a count — becomes one exported function or component, or
  the two places will disagree. See `services/boardScope.js` and
  `components/Avatar.jsx`.
- **Nothing is "removed" — things are re-homed.** A control taken off the
  chrome and not given a new home is a feature nobody can reach. Every removal
  needs a row in the chrome table saying where it went.

---

## 1. Put the mockup on screen. Do not read it.

Reading the HTML and building from the reading is how you end up with an
approximation. Serve it and look at it:

```bash
SP=/tmp/mock && mkdir -p "$SP" \
  && cp "/path/to/task-monitor 3/support.js" "$SP/" \
  && cp "/path/to/task-monitor 3/<Name> Explorer.dc.html" "$SP/page.html" \
  && (cd "$SP" && python3 -m http.server 5199)
```

Open `http://localhost:5199/page.html`, set the viewport to 1400×1000, and
**click every tab**. Screenshot each one. Those screenshots are the spec.

Then read the `<script type="text/x-dc">` block at the bottom for the exact
values — the style objects there are the source of truth for sizes, weights
and colours, and they are easier to copy than to measure off a picture.

## 2. Write down the inventory before writing code

For each tab: what panels it has, and for each panel which module already
produces that data. Decide up front, and record the three outcomes:

| Outcome | What to do |
| --- | --- |
| The app has this page | Restyle it to the mockup, keep its features |
| The app has the data but no page | New component, registered in `services/views.js` |
| The app cannot support it | Do not build it; add a row to the "what happened" table with the reason |

## 3. Tokens before markup

Take the mockup's hexes and add them to `:root` in `App.css` as `--c-*`
tokens **with dark-mode values in both dark blocks** — the
`@media (prefers-color-scheme: dark)` one *and* `:root[data-theme="dark"]`.
Editing one is the single most common mistake in this codebase.

Text on a soft tint uses an **ink** token (`--c-danger-ink` …), never the fill.

## 4. Copy the markup, then wire the logic

Build the panel's DOM and CSS to the mockup first, with the real component's
data plugged in as you go. Two things to hold on to:

- **Keep the feature, restyle the frame.** The Gantt kept draggable bars and
  dependency arrows while every pixel around them changed.
- **Presentation goes in the component; meaning goes in a pure service.**
  `services/tableViews.js` still decides what a cell *says*; the component
  decides whether it is a chip, a face or red text.

## 5. Delete what it replaced — in the same pass

This is the step that gets skipped. When the new panel works:

- remove the old JSX, the old CSS rules, and any now-dead constants;
- `grep` for the old class names across `src/`, `dev/` and `tests/` — other
  pages borrow each other's CSS (the WBS was using `.gantt-day-grid`);
- retarget anything that pointed at them: `TutorialGuide`'s step selectors,
  `data-tutorial` attributes, test regexes.

A guard that the old names are gone is worth writing; see
`tests/ui/boardHub.test.mjs` → "the old day grid is gone".

## 6. Update the registry, not a list

A new page is **one entry in `services/views.js`** plus a route in `App.jsx`.
`VIEW_REGISTRY` feeds the rail, the tab strips, the bottom bar, the page
title, the not-found check and ⌘K. Never add a second list.

`tests/ui/hubs.test.mjs` fails the build if a view belongs to no hub or to two.

## 7. Guard it

Add source-inspection tests in `tests/ui/`. The ones that have earned their
keep:

- every page of the hub is registered, routed, code-split and hubbed;
- a shared control is drawn **once** (`tests/ui/chrome.test.mjs`);
- every page honours the filter it is shown under;
- the mockup's own metrics survive (label width, row height, font size);
- the old classes are gone;
- any honesty rule the panel needs (no rate off an empty denominator, no age
  from `createdAt`, "not estimated" is not zero).

## 8. Verify in `dev/shell.html`

The app is behind Google sign-in, so the harness is how a page gets looked at.
Add a static sample for each new panel in `dev/shell.jsx`, then:

```bash
npm run dev -- --port 5175 --strictPort   # or the "dev-alt" launch config
```

Check **1280px and 375px, light and dark**. Things that have actually broken
here before:

- a `1fr` grid column whose content does not shrink → horizontal scroll on a
  phone (use `minmax(0, 1fr)`);
- `.tone-red` and friends carry a **fill**; for coloured text use `.tone-ink-*`;
- `background: var(--c-text)` with `color: #fff` inverts to white-on-white in
  dark mode — use `color: var(--c-bg)`;
- a `useRef` + `useEffect(…, [])` measurement on a component that returns early
  while loading never attaches — use a callback ref.

## 9. Finish the paperwork

- `npm test` and `npx vite build` both clean.
- CLAUDE.md: the panel table, the "what happened to each mockup tab" table,
  the file map, and a pitfall for anything that bit you.
- Say plainly what could not be verified. The signed-in app cannot be checked
  from here — always end with "click through it before deploying".

---

## The checklist

```
[ ] mockup served and every tab screenshotted
[ ] inventory written: restyle / build / not building (+ reason)
[ ] tokens added, BOTH dark blocks
[ ] panels copied to the mockup's metrics, real data wired
[ ] features kept (drag, pickers, exports, filters)
[ ] old JSX + CSS + constants deleted, class names grepped app-wide
[ ] registry + route updated, no second list
[ ] guards written, including "the old thing is gone"
[ ] harness sample added; 1280 + 375, light + dark
[ ] npm test clean, vite build clean
[ ] CLAUDE.md updated
[ ] caveats stated
```
