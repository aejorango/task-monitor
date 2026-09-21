// T-0122 / POL-012 — the Dashboard's "Log time" button opens a logging form.
//
//   1. Given the Dashboard
//   2. When the user clicks Log time
//   3. Then a form to record hours opens immediately, showing which task it
//      will be logged against and offering a way to change it
//
// What used to happen: the click opened TaskActivitiesModal — a read-only
// table of entries already logged — against a task the button had chosen
// silently, naming it only in a `title` attribute a touch user never sees.
//
// The flow is LogTimeButton, which the Dashboard renders as one element; the
// pure pick is covered in src/services/logTime.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { setupDom, teardownDom, mount, clickText, typeInto, muteConsoleError, text } from './dom.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

setupDom();

const { default: LogTimeButton } = await import('../../src/components/LogTimeButton.jsx');
const { ToastProvider } = await import('../../src/components/Toast.jsx');

const h = React.createElement;

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const LATE  = { id: 't1', title: 'Disbursement report', projectId: 'p1' };
const DOING = { id: 't2', title: 'Policy review',       projectId: 'p1' };
const IDLE  = { id: 't3', title: 'Archive old files',   projectId: 'p1' };
const projectById = { p1: { id: 'p1', name: 'BRIDGED' } };

const render = (props) => mount(h(ToastProvider, null, h(LogTimeButton, {
  projectById, projectFilter: 'all', userId: 'u-ace', ...props,
})));

const dialogs = (ui) => [...ui.container.querySelectorAll('[role="dialog"]')];
const heroButton = (ui) => [...ui.container.querySelectorAll('button')]
  .find((b) => /Log time/.test(b.textContent));

/** A logging FORM has fields to fill; the old modal was a table of rows. */
function isLoggingForm(el) {
  const labels = [...el.querySelectorAll('label')].map((l) => l.textContent.trim().toLowerCase());
  return labels.includes('hours spent') || labels.some((l) => l.startsWith('hours'));
}

test('the button names the task it will log against, on its face', async () => {
  const ui = await render({
    tasks: [LATE, DOING], actionQueue: [{ task: LATE, isLate: true }], inProgress: [DOING],
  });
  const btn = heroButton(ui);
  assert.match(btn.textContent, /Disbursement report/,
    'a touch device has no hover — the title cannot live only in a tooltip');
  assert.match(btn.getAttribute('title'), /most overdue/);
  assert.equal(btn.disabled, false);
  ui.unmount();
});

test('clicking it opens the logging form, not a list of past entries', async () => {
  const ui = await render({
    tasks: [LATE, DOING], actionQueue: [{ task: LATE, isLate: true }], inProgress: [DOING],
  });
  assert.equal(dialogs(ui).length, 0, 'nothing is open before the click');

  await clickText(ui.container, 'Log time');

  const open = dialogs(ui);
  assert.equal(open.length, 1);
  const [form] = open;
  assert.ok(isLoggingForm(form),
    `expected a form with an Hours field; got: ${text(form).slice(0, 200)}`);
  assert.match(text(form), /Disbursement report/, 'the form says which task it is for');
  assert.doesNotMatch(text(form), /Activity log|No activities logged/i,
    'this is where the read-only table used to appear');
  ui.unmount();
});

test('the form offers a way to change the task', async () => {
  const ui = await render({
    tasks: [LATE, DOING, IDLE], actionQueue: [{ task: LATE, isLate: true }],
  });
  await clickText(ui.container, 'Log time');
  assert.ok(
    [...dialogs(ui)[0].querySelectorAll('button')].some((b) => /change task/i.test(b.textContent)),
    'the pre-chosen task must not be a trap',
  );

  await clickText(ui.container, 'Change task');
  const form = dialogs(ui)[0];
  assert.equal(dialogs(ui).length, 1,
    'the switcher is inline — a second modal would stack a second focus trap');
  const select = form.querySelector('#al-switch-task');
  assert.ok(select, 'a plain dropdown, not a dialog');
  assert.equal(select.value, LATE.id, 'it starts on the task the form is already on');
  assert.deepEqual(
    [...select.options].map((o) => o.textContent),
    ['Disbursement report', 'Policy review', 'Archive old files'],
  );
  ui.unmount();
});

const chooseTask = async (select, id) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(select.constructor.prototype, 'value').set;
    setter.call(select, id);
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
};

test('changing the task keeps the form, on the new task', async () => {
  const ui = await render({
    tasks: [LATE, DOING, IDLE], actionQueue: [{ task: LATE, isLate: true }],
  });
  await clickText(ui.container, 'Log time');
  await clickText(ui.container, 'Change task');
  await chooseTask(dialogs(ui)[0].querySelector('#al-switch-task'), IDLE.id);

  const form = dialogs(ui)[0];
  assert.ok(isLoggingForm(form));
  assert.match(text(form), /Archive old files/);
  assert.doesNotMatch(text(form), /Disbursement report/);
  assert.equal(form.querySelector('#al-switch-task'), null, 'the switcher closes again');
  ui.unmount();
});

// The reason the switcher is inline. A picker modal unmounts this form, and
// everything typed into it goes with it — so a user who reaches for "Change
// task" after entering their hours loses them, whether they go through with
// the change or not.
test('what was typed survives changing the task, and survives cancelling it', async () => {
  const ui = await render({
    tasks: [LATE, DOING, IDLE], actionQueue: [{ task: LATE, isLate: true }],
  });
  await clickText(ui.container, 'Log time');

  const hoursField = () => [...dialogs(ui)[0].querySelectorAll('input')].find((i) => i.type === 'number');
  assert.ok(hoursField(), 'the form has an hours field');
  await typeInto(hoursField(), '2.5');

  await clickText(ui.container, 'Change task');
  await clickText(ui.container, 'Cancel');
  assert.ok(isLoggingForm(dialogs(ui)[0]), 'cancelling a change must not close the form');
  assert.match(text(dialogs(ui)[0]), /Disbursement report/);
  assert.equal(hoursField().value, '2.5', 'the hours were still there to be saved');

  await clickText(ui.container, 'Change task');
  await chooseTask(dialogs(ui)[0].querySelector('#al-switch-task'), IDLE.id);
  assert.match(text(dialogs(ui)[0]), /Archive old files/);
  assert.equal(hoursField().value, '2.5', 'you changed the task, not your mind about the hours');
  ui.unmount();
});

test('with only one task there is nothing to change to, and no control for it', async () => {
  const ui = await render({ tasks: [LATE], actionQueue: [{ task: LATE, isLate: true }] });
  await clickText(ui.container, 'Log time');
  assert.ok(
    ![...dialogs(ui)[0].querySelectorAll('button')].some((b) => /change task/i.test(b.textContent)),
    'a dropdown with one option is not a choice',
  );
  ui.unmount();
});

// The old handler ended in `|| filtered[0]`: with nothing overdue and nothing
// in progress it logged against whichever task happened to sort first.
test('with nothing overdue or in progress it asks instead of guessing', async () => {
  const ui = await render({ tasks: [IDLE, DOING], actionQueue: [], inProgress: [] });
  const btn = heroButton(ui);
  assert.equal(btn.textContent.trim(), 'Log time', 'no task is named, because none was chosen');
  assert.equal(btn.disabled, false);

  await clickText(ui.container, 'Log time');
  const open = dialogs(ui)[0];
  assert.match(text(open), /Pick the task you worked on/,
    'the user chooses — the app does not pick one for them');
  ui.unmount();
});

test('with no tasks at all the button is disabled and says why', async () => {
  const ui = await render({ tasks: [], actionQueue: [], inProgress: [] });
  const btn = heroButton(ui);
  assert.equal(btn.disabled, true);
  assert.match(btn.getAttribute('title'), /Add a task first/);
  ui.unmount();
});

test('the picker exists once, not once per page', () => {
  // It was private to WorkPerformedView; the Dashboard needed the same
  // question. Two copies is how two pages come to disagree about what counts
  // as a candidate task.
  const shared = read('src', 'components', 'LogActivityPicker.jsx');
  assert.match(shared, /export default function LogActivityPicker/);
  for (const f of ['WorkPerformedView.jsx', 'LogTimeButton.jsx']) {
    const src = read('src', 'components', f);
    assert.match(src, /import LogActivityPicker from '\.\/LogActivityPicker'/, f);
    assert.doesNotMatch(src, /function LogActivityPicker/, `${f} kept its own copy`);
  }
});

test('the Dashboard hero opens the form, and no longer the activities table', () => {
  const src = read('src', 'components', 'DashboardView.jsx');
  assert.match(src, /<LogTimeButton/, 'the hero action is the real flow');
  // The read-only modal still has a home — clicking a task ROW opens it, which
  // is what it is for. What it must not be is the answer to "Log time".
  assert.doesNotMatch(src, /setViewingTask\(actionQueue\[0\]/,
    'this is the bug: "Log time" opened the read-only list');
  assert.doesNotMatch(src, /\|\| filtered\[0\]\)/, 'and picked an arbitrary task to open it on');
});
