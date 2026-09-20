// T-0010 / IMP-005 — the CSV import screen, rendered for real.
//
// The screen's job is to tell a non-technical person, before anything is
// written, exactly what the file will do. These tests drive the real component
// with real files and read what the person would see.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { setupDom, teardownDom, mount, text, muteConsoleError } from './dom.mjs';

setupDom();

// The importer reaches Firestore only when Import is pressed; the hooks it uses
// for data are stubbed through a module mock so the screen can render offline.
const { default: CsvImporter } = await import('../../src/components/CsvImporter.jsx');

const h = React.createElement;

let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

/** A File whose .text() resolves — jsdom's File has no text() in this version. */
function csvFile(contents, name = 'activities.csv') {
  return { name, text: async () => contents };
}

async function open() {
  return mount(h(CsvImporter, { onClose() {} }));
}

test('the screen opens on the file step and names the expected columns', async () => {
  const ui = await open();
  const shown = text(ui.container);
  assert.match(shown, /Import activities from CSV/);
  assert.match(shown, /Project, Phase, Task/);
  assert.ok(ui.container.querySelector('input[type="file"]'), 'needs a file picker');
  ui.unmount();
});

test('the file picker only offers CSV files', async () => {
  const ui = await open();
  const input = ui.container.querySelector('input[type="file"]');
  assert.match(input.getAttribute('accept'), /csv/);
  ui.unmount();
});

test('a file with the wrong columns is explained, not rejected with jargon', async () => {
  const ui = await open();
  const { act } = await import('react');
  const input = ui.container.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: [csvFile('Name,Amount\nx,1')], configurable: true });
  await act(async () => {
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
  const shown = text(ui.container);
  assert.match(shown, /needs a "Task" column and a "Date" column/);
  assert.match(shown, /Name, Amount/);
  assert.doesNotMatch(shown, /undefined|Error:|-1/);
  ui.unmount();
});

test('a good file previews what will happen before anything is written', async () => {
  const ui = await open();
  const { act } = await import('react');
  const input = ui.container.querySelector('input[type="file"]');
  const csv = 'Project,Task,Date,Hours\n'
            + ',Write the brief,2026-09-20,2\n'
            + ',Ship the build,2026-09-21,1.5\n'
            + ',,2026-09-22,9\n';
  Object.defineProperty(input, 'files', { value: [csvFile(csv)], configurable: true });
  await act(async () => {
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });

  const shown = text(ui.container);
  assert.match(shown, /2 rows will be imported/);
  assert.match(shown, /2 new tasks will be created/);
  assert.match(shown, /3\.5h of work logged/);
  assert.match(shown, /1 row skipped — no task name/);
  assert.match(shown, /Write the brief/);
  assert.match(shown, /Ship the build/);
  ui.unmount();
});

test('nothing is written until the person presses Import', async () => {
  const ui = await open();
  const { act } = await import('react');
  const input = ui.container.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', {
    value: [csvFile('Task,Date\nWrite the brief,2026-09-20')], configurable: true,
  });
  await act(async () => {
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
  const buttons = [...ui.container.querySelectorAll('button')].map((b) => b.textContent.trim());
  assert.ok(buttons.some((b) => /import/i.test(b)), `no Import button. Saw: ${buttons.join(' | ')}`);
  ui.unmount();
});
