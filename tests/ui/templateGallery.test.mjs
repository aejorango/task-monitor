// T-0060 / NEW-007 — the first project should not be an empty box.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, text, clickText, muteConsoleError } from './dom.mjs';

setupDom();
const { default: TemplateGallery } = await import('../../src/components/TemplateGallery.jsx');
const { TEMPLATE_GALLERY } = await import('../../src/templates/gallery.js');

const h = React.createElement;
const root = path.resolve(import.meta.dirname, '..', '..');
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

test('every template is offered, with what it contains and who it is for', async () => {
  const ui = await mount(h(TemplateGallery, { onClose() {} }));
  const shown = text(ui.container);
  for (const t of TEMPLATE_GALLERY) {
    assert.match(shown, new RegExp(t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), t.id);
  }
  assert.match(shown, /5 phases · 9 tasks/);
  assert.match(shown, /Agencies and consultants/);
  ui.unmount();
});

test('nothing is created until a template is picked', async () => {
  const ui = await mount(h(TemplateGallery, { onClose() {} }));
  const create = [...ui.container.querySelectorAll('button')].find((b) => /Pick a template/.test(b.textContent));
  assert.ok(create);
  assert.equal(create.disabled, true);
  ui.unmount();
});

test('picking one names it and shows the phases you will get', async () => {
  const ui = await mount(h(TemplateGallery, { onClose() {} }));
  await clickText(ui.container, 'Client project');
  const shown = text(ui.container);
  assert.match(shown, /Phases: Discovery → Proposal → Delivery → Review → Handover/);
  const input = ui.container.querySelector('input.input');
  assert.equal(input.value, 'Client project', 'prefilled, so Enter just works');
  assert.match(shown, /Create “Client project”/);
  ui.unmount();
});

test('"start from scratch" leaves the name empty for you to fill', async () => {
  const ui = await mount(h(TemplateGallery, { onClose() {} }));
  await clickText(ui.container, 'Start from scratch');
  assert.equal(ui.container.querySelector('input.input').value, '');
  ui.unmount();
});

test('the chosen card is announced, not only outlined', async () => {
  const ui = await mount(h(TemplateGallery, { onClose() {} }));
  await clickText(ui.container, 'Product launch');
  const pressed = [...ui.container.querySelectorAll('[aria-pressed="true"]')];
  assert.equal(pressed.length, 1);
  assert.match(pressed[0].textContent, /Product launch/);
  ui.unmount();
});

test('Enter in the name box creates it', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'components', 'TemplateGallery.jsx'), 'utf8');
  assert.match(src, /if \(e\.key === 'Enter'\) create\(\)/);
});

test('Projects offers the gallery, and leads with it on an empty account', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'components', 'ProjectsView.jsx'), 'utf8');
  assert.match(src, /<TemplateGallery/);
  assert.match(src, /◈ From a template/);
  const empty = src.slice(src.indexOf('No projects yet'), src.indexOf('No projects yet') + 900);
  assert.match(empty, /◈ Start from a template/);
  assert.match(empty, /Start from scratch/);
  assert.match(empty, /client project, product launch, audit/);
});

test('the tasks are created under the project, one per template task', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'components', 'TemplateGallery.jsx'), 'utf8');
  assert.match(src, /const \{ project, tasks \} = templateToProject/);
  assert.match(src, /for \(const task of tasks\)/);
  assert.match(src, /addTask\(userId, \{ workspaceId, projectId: ref\.id, \.\.\.task \}\)/);
});
