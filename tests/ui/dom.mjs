// tests/ui/dom.mjs — a real DOM for component tests, with no test framework.
//
// node --test + jsdom + react-dom/client is enough to render a component, click
// a button and read the result. Error boundaries, effects and event handlers
// all behave as they do in the browser, which string-rendering cannot give us.
import { JSDOM } from 'jsdom';

let dom = null;

// Stand-in for Vite's `import.meta.env`, which tests/ui/jsx-hooks.mjs rewrites
// every app module to read. The values are deliberately obvious fakes: nothing
// in a unit test may reach a real Firebase project.
globalThis.__VITE_ENV__ = {
  DEV: true,
  PROD: false,
  MODE: 'test',
  BASE_URL: '/',
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'task-monitor-test',
  VITE_FIREBASE_STORAGE_BUCKET: 'test.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '0',
  VITE_FIREBASE_APP_ID: 'test-app-id',
};

/** Install a fresh window/document on globalThis. Call once per test file. */
export function setupDom() {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  // Node 22 defines `navigator` as a getter-only global, so it has to be
  // redefined rather than assigned.
  Object.defineProperty(globalThis, 'navigator', {
    value: window.navigator, configurable: true, writable: true,
  });
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.Event = window.Event;
  globalThis.MouseEvent = window.MouseEvent;
  // App code builds CustomEvents (the quick-create request, task:done, the
  // open-task request). Node has its own CustomEvent, and jsdom refuses one
  // that is not its own — so the window's must win.
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.PointerEvent = window.PointerEvent || window.MouseEvent;
  globalThis.getComputedStyle = window.getComputedStyle;
  globalThis.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => window.clearTimeout(id);
  globalThis.localStorage = window.localStorage;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return window;
}

export function teardownDom() {
  dom?.window?.close();
  dom = null;
}

/** Mount a fresh container. Returns { container, root }. */
export async function mount(element) {
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return {
    container,
    root,
    async render(next) { await act(async () => { root.render(next); }); },
    unmount() { root.unmount(); container.remove(); },
  };
}

/** Click the first element whose text matches. Throws if there isn't one. */
export async function clickText(container, text) {
  const { act } = await import('react');
  const match = [...container.querySelectorAll('button, a, [role="button"]')]
    .find((el) => el.textContent.trim().toLowerCase().includes(String(text).toLowerCase()));
  if (!match) {
    throw new Error(
      `No clickable element matching ${JSON.stringify(text)}. Saw: ` +
      [...container.querySelectorAll('button, a')].map((el) => el.textContent.trim()).join(' | '),
    );
  }
  await act(async () => {
    match.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  return match;
}

export function text(container) {
  return container.textContent.replace(/\s+/g, ' ').trim();
}

/**
 * Type into a controlled React input. Assigning `.value` directly does not
 * work: React tracks the previous value on the node and skips the change
 * event, so the component never hears about it.
 */
export async function typeInto(input, value) {
  const { act } = await import('react');
  const setter = Object.getOwnPropertyDescriptor(
    input.constructor.prototype, 'value',
  )?.set;
  await act(async () => {
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

/** Silence expected console.error noise (React logs every caught boundary error). */
export function muteConsoleError() {
  const original = console.error;
  const seen = [];
  console.error = (...args) => { seen.push(args); };
  return { seen, restore() { console.error = original; } };
}
