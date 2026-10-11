// The phone app (src/mobile), built to "Mobile App v7.dc.html".
//
// It is a second shell, so the ways it can go wrong are the ways a port goes
// wrong, plus one: it can quietly stop being the thing a phone gets. These
// guards read the source; the screens themselves are exercised by hand in
// dev/mobile.html, which renders the real components over sample data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const MOBILE = fs.readdirSync(path.join(root, 'src/mobile')).filter((f) => f.endsWith('.jsx'));
const sources = Object.fromEntries(MOBILE.map((f) => [f, read(`src/mobile/${f}`)]));
const allMobile = Object.values(sources).join('\n');
// What a reader can see: the source with its comments taken out, so a comment
// explaining why a mockup word was NOT shipped does not count as shipping it.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\}/g, '');
const shipped = stripComments(allMobile);
const css = read('src/App.css');

/** The body of the first block that opens with `head`. */
function block(text, head) {
  const i = text.indexOf(head);
  assert.ok(i >= 0, `missing ${head}`);
  let depth = 0;
  for (let j = text.indexOf('{', i); j < text.length; j += 1) {
    if (text[j] === '{') depth += 1;
    if (text[j] === '}') { depth -= 1; if (depth === 0) return text.slice(i, j + 1); }
  }
  return '';
}
const tokensIn = (t) => new Set([...t.matchAll(/(--m-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

test('a phone gets the phone app, lazily, at the 720px the desktop shell already broke at', () => {
  const app = read('src/App.jsx');
  assert.match(app, /const MobileApp = lazy\(\(\) => import\('\.\/mobile\/MobileApp'\)\)/);
  assert.match(app, /\{isPhone \? \(/);
  assert.match(app, /<MobileApp userId=\{userId\} profile=\{profile\} route=\{route\} \/>/);
  // The due-task alert and the providers are app-wide: mounted once, above
  // the fork, so a phone keeps them without a second copy.
  const fork = app.indexOf('{isPhone ? (');
  assert.ok(app.lastIndexOf('<DueTaskAlertModal', fork) > app.lastIndexOf('<ToastProvider>', fork));
  assert.match(read('src/hooks/useIsPhone.js'), /max-width: 720px/);
});

test('every --m- token is defined for light AND redefined in both dark blocks alike', () => {
  const light = tokensIn(block(css, ':root {'));
  const media = tokensIn(block(css.slice(css.indexOf('@media (prefers-color-scheme: dark)')), ':root:not([data-theme="light"])'));
  const forced = tokensIn(block(css, ':root[data-theme="dark"] {'));
  assert.ok(light.size > 30, 'the light palette is there');
  assert.deepEqual([...media].sort(), [...forced].sort(), 'System-dark and chosen-dark must be the same palette');
  for (const t of media) assert.ok(light.has(t), `${t} is dark-only`);
  // Every token the CSS uses exists.
  for (const [, t] of css.matchAll(/var\((--m-[a-z0-9-]+)/g)) {
    if (t === '--m-proj' || t === '--m-top' || t === '--m-safe-b') continue; // set per element
    assert.ok(light.has(t), `${t} is used but never defined`);
  }
});

test('every class the phone app writes has a rule', () => {
  const used = new Set();
  for (const src of Object.values(sources)) {
    // Not preceded by "-": var(--m-orange) is a token, not a class.
    for (const m of src.matchAll(/(?<![-\w])m-[a-z0-9]+(?:-[a-z0-9]+)*\b(?!-)/g)) used.add(m[0]);
  }
  // Built from a value at runtime (m-tone-${tone}, m-rail-${st}, m-ink-${tone});
  // their concrete members are checked below.
  for (const dyn of ['m-tone', 'm-rail', 'm-ink']) used.delete(dyn);
  const missing = [...used].filter((c) => !new RegExp(`\\.${c}(?![a-z0-9-])`).test(css));
  assert.deepEqual(missing, [], `unstyled: ${missing.join(', ')}`);
  for (const t of ['grey', 'amber', 'blue', 'red', 'green']) assert.match(css, new RegExp(`\\.m-tone-${t}\\s`));
  for (const s of ['todo', 'doing', 'review', 'stuck', 'done']) assert.match(css, new RegExp(`\\.m-rail-${s}\\s`));
});

test('no stock photo stands in for a real person', () => {
  // The mockup draws people as photos (mobile/diana.png and friends). Here a
  // person is their own photo or their coloured initial — never a stranger.
  assert.doesNotMatch(allMobile, /\.png['")]/);
  const images = [...allMobile.matchAll(/["'`](\/mobile\/[^"'`]+)["'`]/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(images)].sort(), ['/mobile/ai-robo.jpg', '/mobile/celebrate.jpg']);
  for (const img of images) assert.ok(fs.existsSync(path.join(root, 'public', img)), `${img} is shipped`);
});

test('nothing on the phone promises what the app cannot do', () => {
  // No backend sends a digest (CLAUDE.md, Out of Scope): that switch became Dark mode.
  assert.doesNotMatch(shipped, /Daily digest/i);
  assert.match(sources['MobileMore.jsx'], /label: 'Dark mode'/);
  // "Share usage data" toggled nothing in the mockup and nothing here would collect it.
  assert.doesNotMatch(shipped, /Share usage data/i);
  // A lesson is measured in steps; nothing times a tour.
  assert.doesNotMatch(sources['MobilePush.jsx'], /\bmins?\b['`]/);
});

test('Stuck is never written as a status — it opens the log with the blocker chosen', () => {
  assert.doesNotMatch(allMobile, /setTaskStatus\([^)]*'stuck'/);
  assert.match(sources['MobileApp.jsx'], /if \(k === 'stuck'\) \{[\s\S]*?bott: 'Blocked'/);
  // A new task cannot be created Stuck either.
  assert.match(sources['MobileApp.jsx'], /status: nt\.status === 'stuck' \? 'doing' : nt\.status/);
});

test('the phone writes through the same functions the desktop does', () => {
  assert.doesNotMatch(allMobile, /from 'firebase\//, 'no direct Firestore access');
  for (const fn of ['addTask', 'updateTask', 'setTaskStatus', 'addActivity', 'uploadFile', 'notifyAssignment']) {
    assert.match(sources['MobileApp.jsx'], new RegExp(`\\b${fn}\\b`), `${fn} is the write path`);
  }
  assert.match(sources['MobileTaskDetail.jsx'], /addTaskComment\(/);
  assert.match(sources['MobilePush.jsx'], /updateMinute\(/);
  assert.match(sources['MobilePush.jsx'], /updateWorkspaceMemberRole\(/);
  // Bulk edits keep the deleted bulk bar's rules: in series, each with an inverse.
  assert.match(sources['MobileApp.jsx'], /for \(const t of chosen\)/);
  assert.match(sources['MobileApp.jsx'], /undo\.push\(/);
});

test('a div that acts as a button is the full pattern, and switches are not nested', () => {
  assert.doesNotMatch(allMobile, /role="button"/, 'use activateProps(), not a hand-written role');
  assert.match(sources['MobileRows.jsx'], /activateProps\(/);
  // The row is the switch; the drawn toggle inside it is decoration.
  assert.doesNotMatch(sources['mobileUi.jsx'], /m-toggle[^>]*role="switch"/);
  assert.match(sources['MobileMore.jsx'], /role: 'switch', 'aria-checked'/);
});

test('an embedded desktop page fails inside its own screen, not the whole app', () => {
  assert.match(sources['MobilePush.jsx'], /<ErrorBoundary scope="view"[\s\S]*?<SettingsView/);
});

test('the harness twin renders the real shell, not a copy of it', () => {
  const harness = read('dev/mobile.jsx');
  assert.match(harness, /import MobileApp from '\.\.\/src\/mobile\/MobileApp'/);
  const cfg = read('dev/mobile.vite.config.js');
  for (const m of ['services/firebase.js', 'hooks/useTasks.js', 'hooks/useWorkspace.js', 'hooks/useInbox.js']) {
    assert.ok(cfg.includes(m), `${m} is stubbed in the harness`);
  }
  // The stubs belong to the harness config only.
  assert.doesNotMatch(read('vite.config.js'), /mobile-harness-stubs/);
});
