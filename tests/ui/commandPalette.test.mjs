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

test('each "New …" lands on the page that owns that thing', () => {
  const run = search.slice(search.indexOf('const runCommand'), search.indexOf('const activateResult'));
  assert.match(run, /task: 'board'/);
  assert.match(run, /project: 'projects'/);
  assert.match(run, /minute: 'minutes'/);
  assert.match(run, /goal: 'goals'/);
  assert.match(run, /activity: 'work-performed'/);
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
