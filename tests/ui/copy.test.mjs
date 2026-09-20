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

test('no screen names a repository file at the user', () => {
  const offenders = [];
  for (const file of componentFiles()) {
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

test('the webhooks panel is honest that nothing is delivered yet', () => {
  const settings = fs.readFileSync(path.join(componentsDir, 'SettingsView.jsx'), 'utf8');
  const section = settings.slice(settings.indexOf('function WebhooksSection'));
  const head = section.slice(0, 2000);
  assert.match(head, /Not sending yet/, 'a stored-only feature must say so');
  assert.doesNotMatch(head, /Cloud Function/, 'that is an implementation detail');
});
