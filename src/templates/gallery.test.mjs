// T-0060 / NEW-007 — ready-made processes for a blank account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATE_GALLERY, describeTemplate, templateById, templateToProject,
} from './gallery.js';

let n = 0;
const uid = () => `id-${++n}`;

test('every template is a real process, described for a person', () => {
  assert.ok(TEMPLATE_GALLERY.length >= 5);
  for (const t of TEMPLATE_GALLERY) {
    assert.ok(t.id && t.name && t.icon, t.id);
    assert.match(t.summary, /^[A-Z].*[.…]$/, `${t.id}: ${t.summary}`);
    assert.ok(t.audience, `${t.id} does not say who it is for`);
    assert.ok(Array.isArray(t.phases) && Array.isArray(t.tasks), t.id);
  }
});

test('ids are unique, so picking one is unambiguous', () => {
  const ids = TEMPLATE_GALLERY.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every task belongs to a phase the template declares', () => {
  for (const t of TEMPLATE_GALLERY) {
    const phases = new Set(t.phases);
    for (const task of t.tasks) {
      assert.ok(phases.has(task.phase), `${t.id}: task "${task.title}" is in unknown phase "${task.phase}"`);
    }
  }
});

test('task titles read as instructions, not as labels', () => {
  for (const t of TEMPLATE_GALLERY) {
    for (const task of t.tasks) {
      // A capital or a number ("30-day check-in") — never a lower-case label.
      assert.match(task.title, /^[A-Z0-9]/, `${t.id}: ${task.title}`);
      assert.ok(task.title.length > 6, `${t.id}: "${task.title}" is too terse to act on`);
      assert.doesNotMatch(task.title, /TODO|TBD|xxx/i, `${t.id}: ${task.title}`);
    }
  }
});

test('"start from scratch" is offered, and really is empty', () => {
  const blank = templateById('blank');
  assert.ok(blank);
  assert.deepEqual(blank.phases, []);
  assert.deepEqual(blank.tasks, []);
});

test('an unknown id yields null rather than a broken project', () => {
  assert.equal(templateById('nope'), null);
  assert.equal(templateToProject(null, { uid }), null);
});

test('a template becomes a project with its phases in order', () => {
  const { project } = templateToProject(templateById('client-project'), { uid });
  assert.equal(project.name, 'Client project');
  assert.equal(project.phases[0].name, 'Discovery');
  assert.deepEqual(project.phases.map((p) => p.order), [0, 1, 2, 3, 4]);
  assert.ok(project.phases.every((p) => p.id), 'every phase needs an id');
  assert.ok(project.icon, 'the project takes the template’s mark');
});

test('every task lands in the right phase', () => {
  const { project, tasks } = templateToProject(templateById('product-launch'), { uid });
  const phaseName = Object.fromEntries(project.phases.map((p) => [p.id, p.name]));
  const source = templateById('product-launch').tasks;
  tasks.forEach((task, i) => {
    assert.equal(phaseName[task.phaseId], source[i].phase, task.title);
  });
});

test('a name the user typed wins over the template’s own', () => {
  const { project } = templateToProject(templateById('event'), { uid, name: '  Annual conference ' });
  assert.equal(project.name, 'Annual conference');
});

test('an empty name falls back to the template name', () => {
  const { project } = templateToProject(templateById('event'), { uid, name: '   ' });
  assert.equal(project.name, 'Event');
});

test('the blank template produces an empty project, not a broken one', () => {
  const { project, tasks } = templateToProject(templateById('blank'), { uid, name: 'My project' });
  assert.equal(project.name, 'My project');
  assert.deepEqual(project.phases, []);
  assert.deepEqual(tasks, []);
});

test('nothing carries an id, a date or a counter across from the template', () => {
  const { tasks } = templateToProject(templateById('audit'), { uid });
  for (const t of tasks) {
    assert.equal('id' in t, false);
    assert.equal('plan' in t, false);
    assert.equal('activityCount' in t, false);
  }
});

test('each card says what you are about to get', () => {
  assert.equal(describeTemplate(templateById('client-project')), '5 phases · 9 tasks');
  assert.equal(describeTemplate(templateById('blank')), 'Empty');
  assert.equal(describeTemplate(null), '');
});
