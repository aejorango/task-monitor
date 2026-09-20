// T-0008 / IMP-004 — a crashing view must not blank the app.
//
// Renders the real component into a real DOM (jsdom) and throws for real, so
// this exercises getDerivedStateFromError, the Retry button and the
// navigation reset — none of which string rendering can reach.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { setupDom, teardownDom, mount, clickText, text, muteConsoleError } from './dom.mjs';

setupDom();
const { default: ErrorBoundary } = await import('../../src/components/ErrorBoundary.jsx');

const h = React.createElement;

function Boom({ broken, message = "Cannot read properties of undefined (reading 'map')" }) {
  if (broken) throw new TypeError(message);
  return h('p', null, 'The Gantt chart is fine.');
}

let quiet;
beforeEach(() => { quiet = muteConsoleError(); });
after(() => { quiet?.restore(); teardownDom(); });

const boundary = (props, child) =>
  h(ErrorBoundary, { scope: 'view', viewName: 'Gantt', resetKey: 'gantt', ...props }, child);

test('a healthy view renders normally', async () => {
  const ui = await mount(boundary({}, h(Boom, { broken: false })));
  assert.match(text(ui.container), /Gantt chart is fine/);
  ui.unmount();
});

test('a crashing view shows a recovery card instead of nothing', async () => {
  const ui = await mount(boundary({}, h(Boom, { broken: true })));
  const shown = text(ui.container);
  assert.ok(shown.length > 0, 'the boundary must render something, not a blank page');
  assert.match(shown, /could not show the Gantt page/i);
  assert.match(shown, /Try again/);
  assert.match(shown, /nothing you saved is lost/i);
  ui.unmount();
});

test('the recovery card never shows a stack trace or a raw type name', async () => {
  const ui = await mount(boundary({}, h(Boom, { broken: true })));
  const shown = text(ui.container);
  assert.doesNotMatch(shown, /TypeError/, 'jargon before the user opens the details');
  assert.doesNotMatch(shown, /at Object|\.jsx:\d+/);
  ui.unmount();
});

test('Technical details is there for a bug report, and is one line', async () => {
  const ui = await mount(boundary({}, h(Boom, { broken: true })));
  await clickText(ui.container, 'Technical details');
  const shown = text(ui.container);
  assert.match(shown, /TypeError: Cannot read properties of undefined/);
  assert.ok(shown.length < 2000);
  ui.unmount();
});

test('Try again re-renders the view once the cause is gone', async () => {
  const ui = await mount(boundary({}, h(Boom, { broken: true })));
  assert.match(text(ui.container), /could not show/i);

  // The cause is fixed (data arrived, the user went back online…).
  await ui.render(boundary({}, h(Boom, { broken: false })));
  await clickText(ui.container, 'Try again');
  assert.match(text(ui.container), /Gantt chart is fine/);
  assert.doesNotMatch(text(ui.container), /could not show/i);
  ui.unmount();
});

test('navigating to another page clears the error by itself', async () => {
  const ui = await mount(boundary({}, h(Boom, { broken: true })));
  assert.match(text(ui.container), /could not show the Gantt page/i);

  await ui.render(boundary(
    { viewName: 'Board', resetKey: 'board' },
    h(Boom, { broken: false }),
  ));
  assert.match(text(ui.container), /Gantt chart is fine/,
    'the sidebar took the user elsewhere; that page must render');
  ui.unmount();
});

test('a stale-deploy failure offers Reload rather than Try again', async () => {
  const ui = await mount(boundary({}, h(Boom, {
    broken: true,
    message: 'Failed to fetch dynamically imported module: /assets/GanttView-abc.js',
  })));
  const shown = text(ui.container);
  assert.match(shown, /new version is available/i);
  assert.match(shown, /Reload the app/);
  assert.doesNotMatch(shown, /Try again/);
  ui.unmount();
});

test('the app-level boundary offers Reload and does not name a page', async () => {
  const ui = await mount(boundary(
    { scope: 'app', viewName: '', resetKey: 'app' },
    h(Boom, { broken: true }),
  ));
  const shown = text(ui.container);
  assert.match(shown, /Something went wrong/);
  assert.match(shown, /Reload the app/);
  assert.doesNotMatch(shown, /Gantt/);
  ui.unmount();
});

test('the card is announced to screen readers', async () => {
  const ui = await mount(boundary({}, h(Boom, { broken: true })));
  assert.ok(ui.container.querySelector('[role="alert"]'), 'needs role="alert"');
  ui.unmount();
});

test('the crash is logged to the console for a bug report', async () => {
  quiet.restore();
  const q = muteConsoleError();
  const ui = await mount(boundary({}, h(Boom, { broken: true })));
  const ours = q.seen.filter((args) => String(args[0]).includes('[error-boundary'));
  assert.equal(ours.length >= 1, true, 'componentDidCatch must log');
  q.restore();
  quiet = muteConsoleError();
  ui.unmount();
});
