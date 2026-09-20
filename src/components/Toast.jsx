// src/components/Toast.jsx — the app's way of saying something happened.
//
// Replaces window.alert for anything that is not a question: a confirmation, a
// failure, or an action you might want to take back. An alert blocks the page,
// cannot be styled for dark mode, and has nowhere to put an Undo button.
//
// Usage, from anywhere:
//   const toast = useToast();
//   toast.success('Task deleted', { undo: () => restore(id) });
//   toast.error('Could not save that.');
//
// One provider is mounted in App.jsx. Toasts stack, auto-dismiss, and pause
// while the pointer is over them.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';

const ToastContext = createContext(null);

export const TOAST_MS = 6000;
export const UNDO_MS = 10_000;     // longer: you have to notice, then decide

let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const arm = useCallback((id, ms) => {
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    timers.current.set(id, setTimeout(() => dismiss(id), ms));
  }, [dismiss]);

  const push = useCallback((text, { tone = 'info', undo = null, duration } = {}) => {
    const id = ++nextId;
    const ms = duration ?? (undo ? UNDO_MS : TOAST_MS);
    setToasts((list) => [...list.slice(-3), { id, text, tone, undo, ms }]);
    arm(id, ms);
    return id;
  }, [arm]);

  // Clear every timer on unmount so a dismissed toast cannot fire later.
  useEffect(() => {
    const map = timers.current;
    return () => { map.forEach(clearTimeout); map.clear(); };
  }, []);

  const api = useMemo(() => ({
    show: push,
    info: (text, opts) => push(text, { ...opts, tone: 'info' }),
    success: (text, opts) => push(text, { ...opts, tone: 'success' }),
    error: (text, opts) => push(text, { ...opts, tone: 'error', duration: opts?.duration ?? 8000 }),
    dismiss,
  }), [push, dismiss]);

  const runUndo = async (toast) => {
    dismiss(toast.id);
    try { await toast.undo(); }
    catch (err) { console.error('[toast] undo failed:', err); push('That could not be undone.', { tone: 'error' }); }
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="region" aria-label="Notifications">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.tone}`}
            role={t.tone === 'error' ? 'alert' : 'status'}
            onMouseEnter={() => { const x = timers.current.get(t.id); if (x) clearTimeout(x); }}
            onMouseLeave={() => arm(t.id, t.ms)}
          >
            <span className="toast-text">{t.text}</span>
            {t.undo && (
              <button type="button" className="toast-undo" onClick={() => runUndo(t)}>
                Undo
              </button>
            )}
            <button
              type="button"
              className="toast-close"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Never throws when no provider is mounted — a component under test, or a dev
 * harness, should not crash because it said something.
 */
const NOOP = {
  show: () => {}, info: () => {}, success: () => {}, error: () => {}, dismiss: () => {},
};

export function useToast() {
  return useContext(ToastContext) || NOOP;
}

export default ToastProvider;
