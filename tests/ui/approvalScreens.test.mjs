// T-0030 / POL-004 — the three screens that describe the account.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { setupDom, teardownDom, mount, text, muteConsoleError } from './dom.mjs';

setupDom();
const { default: PendingApprovalView } = await import('../../src/components/PendingApprovalView.jsx');
const { default: LandingView } = await import('../../src/components/LandingView.jsx');

const h = React.createElement;
let quiet;
before(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const PROMISES_EMAIL = /notify you by email|we'?ll email|email you (once|when)|notified.*email/i;

test('the waiting screen does not promise an email', async () => {
  const ui = await mount(h(PendingApprovalView, { profile: { status: 'pending' } }));
  const shown = text(ui.container);
  assert.doesNotMatch(shown, PROMISES_EMAIL, shown);
  assert.match(shown, /Waiting for approval/);
  assert.match(shown, /No email is sent/);
  ui.unmount();
});

test('the waiting screen says the page lets you in by itself', async () => {
  const ui = await mount(h(PendingApprovalView, { profile: { status: 'pending' } }));
  assert.match(text(ui.container), /Leave this page open/);
  ui.unmount();
});

test('a declined account is not told to keep waiting', async () => {
  const ui = await mount(h(PendingApprovalView, { profile: { status: 'rejected' } }));
  const shown = text(ui.container);
  assert.match(shown, /Access declined/);
  assert.doesNotMatch(shown, /Leave this page open/);
  assert.doesNotMatch(shown, PROMISES_EMAIL);
  ui.unmount();
});

test('a profile still arriving is not reported as a rejection', async () => {
  const ui = await mount(h(PendingApprovalView, { profile: null }));
  const shown = text(ui.container);
  assert.match(shown, /Setting up your account/);
  assert.doesNotMatch(shown, /declined|denied/i);
  ui.unmount();
});

test('the waiting screen still names who can approve you', async () => {
  const ui = await mount(h(PendingApprovalView, { profile: { status: 'pending' } }));
  assert.match(text(ui.container), /@/, 'an email address to contact');
  ui.unmount();
});

test('the sign-in screen does not promise a notification either', async () => {
  const ui = await mount(h(LandingView, {}));
  const shown = text(ui.container);
  assert.doesNotMatch(shown, PROMISES_EMAIL, shown);
  assert.match(shown, /approve/i);
  ui.unmount();
});

// ─── Settings copy ──────────────────────────────────────────────────────────

const settingsSrc = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', '..', 'src', 'components', 'SettingsView.jsx'), 'utf8',
);

test('Settings no longer calls the session anonymous', () => {
  assert.doesNotMatch(settingsSrc, /Anonymous session/,
    'anonymous auth was removed; everyone signs in with Google');
  assert.match(settingsSrc, /sessionLine\(profile, auth\.currentUser\)/);
});

test('the Settings subtitle no longer claims the page is only preferences', () => {
  assert.doesNotMatch(settingsSrc, /Per-device preferences\. Stored in local storage\./);
  assert.match(settingsSrc, /SETTINGS_SUBTITLE/);
});

test('no screen anywhere promises an approval email', () => {
  const dir = path.resolve(import.meta.dirname, '..', '..', 'src', 'components');
  const offenders = [];
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.jsx'))) {
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (line.trim().startsWith('//')) return;
      if (PROMISES_EMAIL.test(line)) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], 'there is no backend to send one');
});
