// src/components/Dialog.jsx — asking a question, and the modal shell that does
// it properly.
//
// `window.confirm` and `window.prompt` block the page, cannot be themed,
// cannot be styled for dark mode, and on mobile look like a browser warning
// rather than part of the app. They also give a screen-reader user nothing:
// no title, no focus management, no way back.
//
// Three things live here:
//   Modal          — the shell: role=dialog, focus trap, Escape, focus restore
//   ConfirmDialog  — a yes/no question
//   PromptDialog   — a question with one text answer
//   useDialog()    — `const ask = useDialog(); if (await ask.confirm({...}))`
//
// The hook returns a PROMISE, so a call site reads almost exactly as the
// `confirm()` it replaces.

import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
} from 'react';

/* ── the shell ─────────────────────────────────────────────────────────── */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * @param {{ title, onClose, children, footer?, labelledBy?, wide? }} props
 */
export function Modal({ title, onClose, children, footer, wide = false, className = '' }) {
  const ref = useRef(null);
  const titleId = useId();
  const restoreTo = useRef(null);

  useEffect(() => {
    restoreTo.current = document.activeElement;

    // Focus the first thing inside, so a keyboard user is already there.
    const first = ref.current?.querySelector(FOCUSABLE);
    (first || ref.current)?.focus?.();

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== 'Tab') return;

      // Trap: Tab must not reach the page behind the dialog.
      const items = [...(ref.current?.querySelectorAll(FOCUSABLE) || [])];
      if (items.length === 0) { e.preventDefault(); return; }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault(); lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault(); firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // Put focus back where it was, so the page does not jump to the top.
      restoreTo.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div
        ref={ref}
        className={`modal ${wide ? 'modal-wide' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="modal-title" id={titleId}>{title}</h3>
        {children}
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>
  );
}

/* ── the two questions ─────────────────────────────────────────────────── */

export function ConfirmDialog({
  title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false,
  onResolve,
}) {
  return (
    <Modal
      title={title}
      onClose={() => onResolve(false)}
      footer={
        <>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={() => onResolve(false)}>{cancelLabel}</button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => onResolve(true)}
          >{confirmLabel}</button>
        </>
      }
    >
      {message && <p className="modal-sub" style={{ marginBottom: 0 }}>{message}</p>}
    </Modal>
  );
}

export function PromptDialog({
  title, message, label, defaultValue = '', placeholder = '',
  confirmLabel = 'Save', cancelLabel = 'Cancel', required = true, onResolve,
}) {
  const [value, setValue] = useState(defaultValue);
  const trimmed = value.trim();
  const ok = !required || trimmed.length > 0;

  const submit = (e) => {
    e?.preventDefault?.();
    if (ok) onResolve(trimmed);
  };

  return (
    <Modal
      title={title}
      onClose={() => onResolve(null)}
      footer={
        <>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={() => onResolve(null)}>{cancelLabel}</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!ok}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {message && <p className="modal-sub">{message}</p>}
      <form onSubmit={submit}>
        <label className="field">
          {label && <span className="label">{label}</span>}
          <input
            className="input"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </label>
      </form>
    </Modal>
  );
}

/* ── the hook ──────────────────────────────────────────────────────────── */

const DialogContext = createContext(null);

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);

  const ask = useCallback((kind, options) => new Promise((resolve) => {
    setDialog({
      kind,
      options,
      resolve: (value) => { setDialog(null); resolve(value); },
    });
  }), []);

  const api = useMemo(() => ({
    /** @returns {Promise<boolean>} */
    confirm: (options) => ask('confirm', options),
    /** @returns {Promise<string|null>} null when cancelled */
    prompt: (options) => ask('prompt', options),
  }), [ask]);

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog?.kind === 'confirm' && <ConfirmDialog {...dialog.options} onResolve={dialog.resolve} />}
      {dialog?.kind === 'prompt' && <PromptDialog {...dialog.options} onResolve={dialog.resolve} />}
    </DialogContext.Provider>
  );
}

// Without a provider — a test, a dev harness — fall back to the browser's own
// dialogs rather than hanging on a promise that never resolves.
const FALLBACK = {
  confirm: async ({ title, message }) =>
    (typeof window === 'undefined' ? false : window.confirm([title, message].filter(Boolean).join('\n\n'))),
  prompt: async ({ title, message, defaultValue = '' }) =>
    (typeof window === 'undefined' ? null : window.prompt([title, message].filter(Boolean).join('\n\n'), defaultValue)),
};

export function useDialog() {
  return useContext(DialogContext) || FALLBACK;
}

export default DialogProvider;
