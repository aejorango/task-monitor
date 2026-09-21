// T-0055 / MISS-006 — ⌘K creates as well as searches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const shell = fs.readFileSync(path.join(root, 'src', 'components', 'AppShell.jsx'), 'utf8');
const search = shell.slice(shell.indexOf('function GlobalSearch'));

test('the palette asks the command module what to offer', () => {
  assert.match(search, /const commands = buildCommands\(q\)/);
  assert.match(search, /commandsFirst\(q\)/);
});

test('an explicit command leads; otherwise search results do', () => {
  assert.match(search, /const lead = commandsFirst\(q\);/);
  assert.match(search, /results\.lead\s*\?/s);
});

test('keyboard navigation covers the action rows too', () => {
  assert.match(search, /kind: 'command'/);
  assert.match(search, /if \(item\.kind === 'command'\) runCommand\(item\.c\)/);
  assert.match(search, /const taskOffset = results\.lead \? results\.commands\.length : 0;/,
    'without the offset, arrow keys would highlight the wrong row');
});

test('each "New …" lands on the page that owns that thing', async () => {
  // Since T-0093 the destinations live beside the vocabulary in
  // commandPalette.js rather than in a second table inside the component.
  const { CREATE_VIEW } = await import('../../src/services/commandPalette.js');
  assert.deepEqual(CREATE_VIEW, {
    task: 'board', project: 'projects', minute: 'minutes',
    goal: 'goals', activity: 'work-performed',
  });
  const run = search.slice(search.indexOf('const runCommand'), search.indexOf('const activateResult'));
  assert.match(run, /requestQuickCreate\(cmd\.entity, text\)/);
});

test('navigation commands just navigate', () => {
  const run = search.slice(search.indexOf('const runCommand'), search.indexOf('const activateResult'));
  assert.match(run, /if \(cmd\.kind === 'navigate'\) \{ navigate\(\{ view: cmd\.payload\.view \}\); return; \}/);
});

test('the placeholder tells people the box does more than search', () => {
  assert.match(search, /Search or type “new task…”/);
});

// ─── the receiving end ──────────────────────────────────────────────────────

for (const [file, entity] of [
  ['Board.jsx', 'task'],
  ['ProjectsView.jsx', 'project'],
  ['MinutesView.jsx', 'minute'],
  ['GoalsView.jsx', 'goal'],
]) {
  test(`${file} opens its create flow when the palette asks for a ${entity}`, () => {
    const src = fs.readFileSync(path.join(root, 'src', 'components', file), 'utf8');
    assert.match(src, /useQuickCreate\(/, `${file} does not listen`);
    assert.match(src, new RegExp(`useQuickCreate\\('${entity}'`), `${file} listens for the wrong thing`);
  });
}

test('the event name lives in one place', () => {
  const hook = fs.readFileSync(path.join(root, 'src', 'hooks', 'useQuickCreate.js'), 'utf8');
  assert.match(hook, /export const QUICK_CREATE_EVENT = 'task-monitor:quick-create'/);

  // Nobody may spell it out by hand.
  const dir = path.join(root, 'src');
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(js|jsx)$/.test(e.name) || full.endsWith('useQuickCreate.js')) continue;
      const src = fs.readFileSync(full, 'utf8');
      if (src.includes("'task-monitor:quick-create'")) offenders.push(path.relative(root, full));
    }
  };
  walk(dir);
  assert.deepEqual(offenders, []);
});

test('a new task arrives in the quick-add box with its text', () => {
  const board = fs.readFileSync(path.join(root, 'src', 'components', 'Board.jsx'), 'utf8');
  assert.match(board, /setQuickAddSeed\(\{ text, at: Date\.now\(\) \}\)/,
    'timestamped so asking twice with the same words still refills the box');
  assert.match(board, /seed=\{quickAddSeed\}/);

  const form = fs.readFileSync(path.join(root, 'src', 'components', 'TaskForm.jsx'), 'utf8');
  assert.match(form, /if \(seed && seenSeed !== seed\)/);
  assert.match(form, /setTitle\(seed\.text \|\| ''\)/);
});

// ─── Recents (T-0062 / NEW-009) ─────────────────────────────────────────────

test('an empty palette offers what you were just looking at', () => {
  const memo = search.slice(search.indexOf('const results = useMemo'), search.indexOf('useEffect(() => { setHighlight(0)'));
  assert.match(memo, /if \(!q\.trim\(\)\) \{/);
  assert.match(memo, /recentCommands\(\)/);
  assert.match(memo, /recents: true/);
  assert.doesNotMatch(memo, /if \(!q\.trim\(\)\) return \{ tasks: \[\], activities: \[\], commands: \[\], lead: false/,
    'an empty box used to show nothing at all');
});

test('opening something records it as recent', () => {
  assert.match(search, /rememberRecent\(\{ kind: 'task', id: t\.id, label: t\.title/);
});

test('a recent row reopens the thing it names', () => {
  const run = search.slice(search.indexOf('const runCommand'), search.indexOf('const activateResult'));
  assert.match(run, /if \(cmd\.kind === 'recent'\)/);
  assert.match(run, /tasks\.find\(\(x\) => x\.id === payload\.id\)/);
});

test('the recents group is labelled as such, not as "Actions"', () => {
  assert.match(search, /label=\{results\.recents \? 'Recently opened' : 'Actions'\}/);
});

test('the panel opens for recents even with nothing typed', () => {
  assert.match(search, /\{open && \(q\.trim\(\) \|\| results\.flat\.length > 0\) && \(/);
});

// ─── T-0093 / BUG-016: every "New …" command has somewhere to land ──────────
//
// The palette's create vocabulary and the pages' listeners were two separate
// lists, and nothing failed the build when an entity had no receiver. "Log an
// activity" navigated to Work Performed and then nothing opened.

test('every entity the palette can create has a receiver', async () => {
  const { CREATE_ORDER } = await import('../../src/services/commandPalette.js');
  const dir = path.join(root, 'src', 'components');
  const sources = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsx'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');

  const orphans = CREATE_ORDER.filter((entity) => !sources.includes(`useQuickCreate('${entity}'`));
  assert.deepEqual(orphans, [],
    'a command with no useQuickCreate listener navigates somewhere and then does nothing');
});

test('the Work Performed page listens for the activity command', () => {
  const view = fs.readFileSync(path.join(root, 'src', 'components', 'WorkPerformedView.jsx'), 'utf8');
  assert.match(view, /useQuickCreate\('activity', useCallback\(\(\) => setPickerOpen\(true\), \[\]\)\)/);
});

test('the palette still offers the command, and sends it to the page that listens', async () => {
  const { buildCommands, CREATE_VIEW } = await import('../../src/services/commandPalette.js');
  const logIt = buildCommands('log hours').find((c) => c.label === 'Log an activity');
  assert.ok(logIt, '⌘K → "log hours" must offer it');
  assert.equal(logIt.entity, 'activity');
  assert.equal(CREATE_VIEW.activity, 'work-performed', 'and it goes where the listener is');
});

test('every create command has a destination, named in one place', async () => {
  const { CREATE_ORDER, CREATE_VIEW } = await import('../../src/services/commandPalette.js');
  assert.deepEqual(CREATE_ORDER.slice().sort(), Object.keys(CREATE_VIEW).sort(),
    'an entity with no destination navigates to the board and confuses everybody');
  const shell = fs.readFileSync(path.join(root, 'src', 'components', 'AppShell.jsx'), 'utf8');
  assert.match(shell, /navigate\(\{ view: CREATE_VIEW\[cmd\.entity\] \|\| 'board' \}\);/);
  assert.doesNotMatch(shell, /const VIEW_FOR = \{/,
    'the component must not keep its own copy of the destinations');
});
