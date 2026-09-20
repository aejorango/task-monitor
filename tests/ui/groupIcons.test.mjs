// T-0056 / MISS-007 — a project is recognisable by more than a coloured dot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const projects = fs.readFileSync(path.join(root, 'src', 'components', 'ProjectsView.jsx'), 'utf8');
const firebase = fs.readFileSync(path.join(root, 'src', 'services', 'firebase.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'App.css'), 'utf8');

test('the project editor offers an icon, picked from the set', () => {
  assert.match(projects, /<span className="pe-lbl">Icon<\/span>/);
  assert.match(projects, /GROUP_ICONS\.map/);
  assert.match(projects, /aria-pressed=\{icon === g\}/, 'the chosen one must be announced');
});

test('the icon is a choice, never a text box', () => {
  const block = projects.slice(projects.indexOf('pe-lbl">Icon'), projects.indexOf('pe-lbl">Icon') + 900);
  assert.doesNotMatch(block, /<input/, 'a free-text icon field is a way to break the UI');
  assert.match(block, /<button/);
});

test('the icon is saved with the project', () => {
  assert.match(projects, /await addProject\(userId, \{[^}]*icon,/s);
  assert.match(projects, /await updateProject\(project\.id, \{[^}]*icon,/s);
});

test('only an icon from the set is ever stored', () => {
  assert.match(firebase, /icon: normalizeIcon\(project\.icon\)/);
  assert.match(firebase, /import \{ normalizeIcon \} from '\.\/icons'/);
});

test('a segment can carry one too', () => {
  assert.match(firebase, /addSegmentToWorkspace\(workspaceId, segmentName, icon = null\)/);
  assert.match(firebase, /name: segmentName\.trim\(\), icon: normalizeIcon\(icon\)/);
});

test('project lists show the icon in the project’s own colour', () => {
  assert.match(projects, /className="proj-icon" style=\{\{ color: p\.color \}\}/);
  assert.match(projects, /className="proj-icon" style=\{\{ color: project\.color \}\}/);
});

test('a project that has never been given an icon still gets a distinct one', () => {
  assert.match(projects, /suggestIcon\(p\.id\)/);
  assert.match(projects, /suggestIcon\(project\.id\)/);
});

test('the icon is decorative — a screen reader reads the project name', () => {
  const uses = projects.split('\n').filter((l) => l.includes('className="proj-icon"'));
  assert.ok(uses.length >= 2);
  for (const line of uses) assert.match(line, /aria-hidden="true"/);
});

test('the icon has a style that keeps it aligned with the text', () => {
  assert.match(css, /\.proj-icon \{/);
  assert.match(css, /\.pe-icon-btn\.is-on/);
});
