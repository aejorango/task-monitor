// "All workspaces" on the workspace switcher: read every workspace at once,
// while every write keeps a real home. These guards fail the build if a piece
// of that falls away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('the switcher offers All workspaces, and picking a workspace turns it off', () => {
  const sw = read('src/components/WorkspaceSwitcher.jsx');
  assert.match(sw, /All workspaces/);
  assert.match(sw, /new items go here/, 'it says where new things land');
  const shell = read('src/components/AppShell.jsx');
  assert.match(shell, /onAll=\{\(\) => \{ setAllWorkspaces\(true\)/);
  assert.match(shell, /onSwitch=\{\(id\) => \{ setAllWorkspaces\(false\)/);
  assert.match(shell, /workspaceName=\{allWorkspaces \? 'All workspaces'/);
});

test('the active workspace stays real: All is a flag, never a sentinel id', () => {
  const ws = read('src/hooks/useWorkspace.js');
  assert.match(ws, /export function setAllWorkspaces/);
  assert.doesNotMatch(ws, /setActiveWorkspaceId\(['"](all|\*|__all__)/);
});

test('the data hooks read every workspace in view', () => {
  const src = read('src/hooks/useTasks.js');
  for (const hook of ['useProjects', 'useTasks', 'useAllActivities', 'useGoals', 'useMinutes', 'useTemplates', 'useRecentActivities']) {
    const body = src.slice(src.indexOf(`export function ${hook}(`));
    assert.match(body.slice(0, 900), /useScope\(\)/, `${hook} reads the workspaces in view`);
  }
});

test('a task’s own log is asked of the task’s own workspace', () => {
  for (const [file, call] of [
    ['src/components/TaskEditor.jsx', 'useActivities(task.id, task.workspaceId)'],
    ['src/components/TaskActivitiesModal.jsx', 'useActivities(task.id, task.workspaceId)'],
    ['src/components/Board.jsx', 'useActivities(taskId, workspaceId)'],
    ['src/mobile/MobileTaskDetail.jsx', 'useActivities(t.id, t.workspaceId)'],
  ]) assert.ok(read(file).includes(call), `${file}: ${call}`);
});

test('names on cards come from every workspace, not only the active one', () => {
  for (const file of ['Board', 'GanttView', 'WBSView', 'TimesheetView']) {
    assert.match(read(`src/components/${file}.jsx`), /useMemberProfiles\(\)/, file);
  }
  // The assignee picker offers the TASK's workspace's people.
  assert.match(read('src/components/TaskEditor.jsx'), /project\?\.workspaceId \|\| workspaceId \|\| activeWorkspaceId/);
});
