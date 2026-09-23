// The task editor's primary-block fields and its left column.
//
//   1. The invisible-overlay rule applies to a field's OWN control only. As a
//      descendant selector it caught the assignee picker's inputs inside the
//      Accountable popover and laid them over every teammate button.
//   2. A hidden date input opens its calendar when the field is clicked.
//   3. Comments are read with workspaceId AND taskId — taskId alone is refused
//      by the rules, and the thread stayed empty whatever was posted.
//   4. Description and comments are bare text boxes: no Write/Preview, no crib.
//   5. The relations card carries no empty-state sentences.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const css = read('src', 'App.css');
const editor = read('src', 'components', 'TaskEditor.jsx');
const firebase = read('src', 'services', 'firebase.js');
const hooks = read('src', 'hooks', 'useTasks.js');

test('the overlay rule targets direct children only', () => {
  assert.match(css, /\.te-ef > select, \.te-ef > input \{/);
  assert.doesNotMatch(css, /\.te-ef select, \.te-ef input \{/);
});

test('the Due from / Due to fields open the date picker on click', () => {
  assert.match(editor, /aria-label="Planned start"/);
  assert.equal((editor.match(/onClick=\{openDatePicker\}/g) || []).length, 2);
  assert.match(editor, /showPicker\?\.\(\)/);
});

test('comments are subscribed by workspace AND task', () => {
  assert.match(firebase, /export function subscribeToTaskComments\(workspaceId, taskId, callback\)/);
  assert.match(firebase, /taskCommentsRef,\s*\n\s*where\('workspaceId', '==', workspaceId\),\s*\n\s*where\('taskId', '==', taskId\)/);
  assert.match(hooks, /subscribeToTaskComments\(workspaceId, taskId,/);
  assert.match(editor, /useTaskComments\(task\.workspaceId, taskId\)/);
});

test('description and comment boxes are bare', () => {
  const editors = editor.match(/<MarkdownEditor\s+bare\b/g) || [];
  assert.equal(editors.length, 3, 'description, comment composer, comment edit');
  assert.doesNotMatch(editor, /<MarkdownEditor(?![^>]*\bbare\b)[\s\S]{0,40}value=\{(description|body|editingBody)\}/);
});

test('the relations card has no empty-state copy', () => {
  assert.doesNotMatch(editor, /Nothing linked yet\./);
  assert.doesNotMatch(editor, /No relations\. Use these for/);
});
