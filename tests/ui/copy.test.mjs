// T-0022 / IMP-006 + standing requirement 1 — a non-technical user must never
// be shown a source filename, a config key, or anything that only means
// something to a developer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const componentsDir = path.resolve(import.meta.dirname, '..', '..', 'src', 'components');

function componentFiles() {
  return fs.readdirSync(componentsDir)
    .filter((f) => f.endsWith('.jsx'))
    .map((f) => ({ name: f, src: fs.readFileSync(path.join(componentsDir, f), 'utf8') }));
}

/** Lines of JSX text, with comments and imports stripped out. */
function userFacingLines({ src }) {
  return src.split('\n')
    .map((l, i) => ({ n: i + 1, l }))
    .filter(({ l }) => {
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
      if (t.startsWith('import ') || t.startsWith('export ')) return false;
      return true;
    });
}

// The one screen whose audience IS the person setting the repository up. It is
// only reachable when the app has no Firebase configuration at all, so naming
// README.md there is the most useful thing it can do.
const DEVELOPER_FACING = new Set(['SetupRequiredView.jsx']);

test('no screen names a repository file at the user', () => {
  const offenders = [];
  for (const file of componentFiles()) {
    if (DEVELOPER_FACING.has(file.name)) continue;
    for (const { n, l } of userFacingLines(file)) {
      if (/\b(FEATURE_ROADMAP|CLAUDE|README|BUILD-GUIDE)\.md\b/.test(l)) {
        offenders.push(`${file.name}:${n}: ${l.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'say what the user can do, not which file to read');
});

test('no screen tells the user to open the developer console', () => {
  const offenders = [];
  for (const file of componentFiles()) {
    for (const { n, l } of userFacingLines(file)) {
      // Prose telling a person to look at the console — not a console.* call.
      if (/(check|open|see|look at)\s+(the\s+)?(browser\s+)?console/i.test(l)
          && !/console\.(log|warn|error|info|debug)/.test(l)) {
        offenders.push(`${file.name}:${n}: ${l.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'nobody outside this repo has a console open');
});

test('the webhooks panel describes what it does without naming the plumbing', () => {
  // It used to say "Not sending yet", which was true until T-0043 made
  // delivery real. What must never come back is the implementation detail.
  const settings = fs.readFileSync(path.join(componentsDir, 'SettingsView.jsx'), 'utf8');
  const section = settings.slice(settings.indexOf('function WebhooksSection'));
  const head = section.slice(0, 2500);
  assert.match(head, /Send an automatic message to another tool/);
  assert.doesNotMatch(head, /Cloud Function|Firestore trigger|HMAC/,
    'that is an implementation detail');
});

// ─── T-0095 / BUG-020: an inline error is copy too ──────────────────────────
//
// The toast guard only ever inspected toasts. Inline error rendering —
// `setError(err.message)` then `<p className="auth-error-msg">{error}</p>` —
// slipped past it, and put "Start it with `npm run bridge`" on the Dashboard.

/** Components that set an error from a caught value without cleaning it up. */
test('no component puts a raw thrown message into its own error state', () => {
  // `err` alone is fine — it is going to friendlyError or describeAiFailure.
  // What is not fine is reaching into it for `.message` and rendering that.
  const RAW = /set[A-Za-z]*(Error|Err)\s*\(\s*(err|e|error)\b[^)]*\.(message|toString)\b/;
  const offenders = [];
  for (const file of componentFiles()) {
    for (const { n, l } of userFacingLines(file)) {
      if (RAW.test(l)) offenders.push(`${file.name}:${n}: ${l.trim()}`);
    }
  }
  assert.deepEqual(offenders, [],
    'route it through friendlyError() or describeAiFailure() — an SDK message is not copy');
});

test('no component renders a caught error object directly into JSX', () => {
  const RAW_JSX = /\{\s*(err|error)(\?)?\.(message|toString\(\))\s*\}/;
  const offenders = [];
  for (const file of componentFiles()) {
    for (const { n, l } of userFacingLines(file)) {
      if (RAW_JSX.test(l)) offenders.push(`${file.name}:${n}: ${l.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the two AI surfaces go through describeAiFailure', () => {
  for (const name of ['DashboardView.jsx', 'AiHelper.jsx']) {
    const src = fs.readFileSync(path.join(componentsDir, name), 'utf8');
    assert.match(src, /describeAiFailure\(/, `${name} still shows the raw message`);
    assert.match(src, /isOperator/, `${name} must know who it is talking to`);
    assert.match(src, /console\.error\([^)]*detail/,
      `${name} must still put the operator's version in the console`);
  }
});

test('nobody writes the operator test out by hand any more', () => {
  const offenders = [];
  for (const file of componentFiles()) {
    for (const { n, l } of userFacingLines(file)) {
      if (/role === 'superadmin' && .*status === 'approved'/.test(l)) {
        offenders.push(`${file.name}:${n}: ${l.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'use isOperatorProfile() / useIsOperator() from hooks/useUserProfile');
});

// ─── T-0105 / BUG-019: a success is not an error ────────────────────────────

test('no toast carries a diagnostic trail', () => {
  const offenders = [];
  for (const file of componentFiles()) {
    for (const { n, l } of userFacingLines(file)) {
      if (/toast\.(error|success|info)\(/.test(l) && /Diagnostic|scope=|— trail —/i.test(l)) {
        offenders.push(`${file.name}:${n}: ${l.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'a trail is for console.debug, not for a toast');
});

test('no component assembles a toast out of an internals log', () => {
  const offenders = [];
  for (const file of componentFiles()) {
    const src = file.src;
    // `toast.error(... log.join ...)` — the exact shape of BUG-019.
    if (/toast\.(error|success|info)\([^;]*\blog\.join\(/s.test(src)) offenders.push(file.name);
    if (/const tellUser = \(msg\) => toast\.error\(msg \+/.test(src)) offenders.push(file.name);
  }
  assert.deepEqual(offenders, [], 'split the user sentence from the developer trail');
});

test('the notification test reports success as a success', () => {
  const src = fs.readFileSync(path.join(componentsDir, 'SettingsView.jsx'), 'utf8');
  const handler = src.slice(
    src.indexOf('const handleTestNotification'),
    src.indexOf('\n  return (', src.indexOf('const handleTestNotification')),
  );
  assert.match(handler, /toast\.success\('Test notification sent\./,
    'the happy path must be green, not a red role="alert"');
  assert.match(handler, /console\.debug\('\[notifications\] test trail:'/,
    'the trail still exists — for whoever is debugging it');
  assert.doesNotMatch(handler, /Diagnostic trail/);
  assert.doesNotMatch(handler, /System Settings → Notifications/,
    'the OS advice belongs under the badge, not inside a toast that disappears');

  // Every remaining message in the handler is one plain sentence.
  for (const m of handler.matchAll(/toast\.(?:error|success)\('([^']+)'/g)) {
    assert.ok(!m[1].includes('\\n'), `"${m[1]}" is a paragraph, not a sentence`);
    assert.ok(/[.!]$/.test(m[1]), `"${m[1]}" should end as a sentence`);
  }
});

// ─── T-0106 / BUG-021: nobody is asked to share an account id ───────────────
//
// Invite-by-email moved the only control that CONSUMES a raw id behind a
// superadmin toggle, but left the Account section telling every user to copy
// theirs and hand it to a workspace owner — down a path that does not exist.

test('no screen tells a user to share an account ID', () => {
  const offenders = [];
  for (const file of componentFiles()) {
    for (const { n, l } of userFacingLines(file)) {
      if (/(share|send|give)[^.]{0,40}\b(account\s*id|your\s*id|uid)\b/i.test(l)) {
        offenders.push(`${file.name}:${n}: ${l.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    'joining a workspace is by email — the id field is superadmin-only');
});

test('the Account section points at the email invite instead', () => {
  const src = fs.readFileSync(path.join(componentsDir, 'SettingsView.jsx'), 'utf8');
  assert.match(src, /ask an owner to invite/i);
  assert.match(src, /nothing to copy or send/i);
});

test('the Account ID is superadmin-only, and behind a disclosure', () => {
  const src = fs.readFileSync(path.join(componentsDir, 'SettingsView.jsx'), 'utf8');
  assert.match(src, /\{userId && isSuperadmin && \(/,
    'an ordinary user has nowhere to paste it, so they must not be handed it');
  const block = src.slice(src.indexOf('{userId && isSuperadmin && ('));
  assert.match(block.slice(0, 400), /<details/, 'and it stays out of the way');
  assert.match(block.slice(0, 700), /aria-label="Account ID"/);
});

// ─── T-0108 / BUG-023: two buttons called Log ───────────────────────────────

test('exactly one control on a board card is called Log', () => {
  const src = fs.readFileSync(path.join(componentsDir, 'Board.jsx'), 'utf8');
  const footer = src.slice(src.indexOf('<div className="task-card-actions">'));
  const end = footer.indexOf('</div>');
  const labels = [...footer.slice(0, end).matchAll(/>\{?([^<>{}]*Log[^<>{}]*)\}?</g)].map((m) => m[1].trim());
  assert.deepEqual(labels, ['+ Log'], `saw ${JSON.stringify(labels)}`);
});

test('the history toggle is named after what it does, and says so', () => {
  const src = fs.readFileSync(path.join(componentsDir, 'Board.jsx'), 'utf8');
  assert.match(src, /\{expanded \? 'Hide history' : `History\$\{task\.activityCount \? ` · \$\{task\.activityCount\}` : ''\}`\}/);
  assert.match(src, /aria-expanded=\{!!expanded\}/, 'a disclosure has to announce its state');
  assert.match(src, /Show activity history for \$\{task\.title\}/,
    'a screen-reader user heard "plus Log" and "Log" with nothing to tell them apart');
  assert.match(src, /aria-label=\{`Log activity on \$\{task\.title\}`\}/);
});

// ─── T-0124 / POL-014: a note that described half the feature ───────────────
//
// The recurrence note named only the on-completion path — "auto-created when
// this task is marked done" — for as long as there have been two. Read
// literally it says a weekly ritual nobody ticks off simply stops, which is the
// opposite of what a schedule is for, and it is the sentence somebody reads
// while deciding whether to trust recurrence at all.

const recurrenceNote = () => {
  const src = fs.readFileSync(path.join(componentsDir, 'TaskEditor.jsx'), 'utf8');
  // Anchor on the component, not on `{enabled && (` — RecurrenceEditor has two
  // of those, and taking the first one swallowed the controls as well as the
  // note, so this guard would have passed on words the user never sees.
  const fn = src.indexOf('function RecurrenceEditor(');
  assert.ok(fn > 0, 'RecurrenceEditor moved — this guard needs its new home');
  const open = src.indexOf('<p className="muted small"', fn);
  assert.ok(open > 0, 'the recurrence note is no longer a paragraph');
  const close = src.indexOf('</p>', open);
  return src.slice(src.indexOf('>', open) + 1, close)
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

test('the guard reads the note itself, not the controls above it', () => {
  const note = recurrenceNote();
  // If the extraction ever widens again, these leak in and say so.
  for (const control of ['select', 'option', 'onChange', 'className']) {
    assert.ok(!note.includes(control), `the guard is reading markup: "${note.slice(0, 120)}"`);
  }
  assert.ok(note.length > 40 && note.length < 400, `unexpected note: ${JSON.stringify(note)}`);
});

test('the recurrence note describes both ways an occurrence appears', () => {
  const note = recurrenceNote();
  assert.match(note, /mark this done/i,
    'the on-completion path: ticking one off creates the next');
  assert.match(note, /if it is missed/i,
    'the catch-up path: useRecurrenceCatchUp materialises what has come due');
});

test('the recurrence note states the limit rather than leaving it to be discovered', () => {
  const note = recurrenceNote();
  // The catch-up runs in the app, not on a cloud schedule: a workspace nobody
  // opens for a month catches up when somebody opens it, not before. README
  // and useRecurrenceCatchUp both say so; the user should not have to read
  // either to find out.
  assert.match(note, /next time somebody opens the app/i);
  // HORIZON_DAYS is 0 — an occurrence appears on its own day, not a week early.
  assert.match(note, /on the day it is next due/i);
});

test('the note no longer claims completion is the only path', () => {
  const note = recurrenceNote();
  assert.doesNotMatch(note, /The next instance is auto-created when this task is marked done\./);
  assert.doesNotMatch(note, /\binstance\b/i, 'a user has tasks, not instances');
});

test('the catch-up path the note promises is actually wired up', () => {
  // A promise in copy is only as good as the code behind it. Both halves of
  // the sentence must have a caller.
  const app = fs.readFileSync(path.join(componentsDir, '..', 'App.jsx'), 'utf8');
  const hook = fs.readFileSync(
    path.join(componentsDir, '..', 'hooks', 'useRecurrenceCatchUp.js'), 'utf8');
  assert.match(app, /useRecurrenceCatchUp\(/, 'nothing runs the catch-up');
  assert.match(hook, /materialiseRecurrences/);
});
