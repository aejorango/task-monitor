// tests/ui/dom.mjs — a real DOM for component tests, with no test framework.
//
// node --test + jsdom + react-dom/client is enough to render a component, click
// a button and read the result. Error boundaries, effects and event handlers
// all behave as they do in the browser, which string-rendering cannot give us.
import { JSDOM } from 'jsdom';

let dom = null;

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

/** Silence expected console.error noise (React logs every caught boundary error). */
export function muteConsoleError() {
  const original = console.error;
  const seen = [];
  console.error = (...args) => { seen.push(args); };
  return { seen, restore() { console.error = original; } };
}
