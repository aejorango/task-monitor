// src/hooks/useModalDialog.js — make an existing modal a real dialog.
//
// Most modals in this app were written as a styled div inside a backdrop: they
// close on a backdrop click and nothing else. For somebody using a keyboard or
// a screen reader that means no announcement, no way out with Escape, and Tab
// walking straight out of the dialog into the page behind it.
//
// The Modal component in components/Dialog.jsx is the right answer for a NEW
// modal. This hook is for the ones that already exist: it hands back the props
// to spread onto the backdrop and onto the panel, so adopting it is two lines
// rather than a rewrite.
//
//   const modal = useModalDialog({ onClose, title: 'Edit task' });
//   <div className="modal-backdrop" {...modal.backdropProps}>
//     <div className="modal" {...modal.dialogProps}>
//       <h3 id={modal.titleId}>Edit task</h3>
//
// A component that keeps its own "is the modal showing?" state must say so:
//
//   const modal = useModalDialog({ onClose: close, open: confirmOpen });
//
// Without that flag the hook would install its document-capture key handler the
// moment the COMPONENT mounts, and its Escape branch calls stopPropagation() —
// which at the document, in the capture phase, kills the event before anything
// else in the app ever sees it. One always-mounted component calling the hook
// above an early return was enough to make Escape dead everywhere: the search
// dropdown, the Export menu, the inbox, the column picker, the tutorial tour
// and the due-task alert all listen on window or on document-bubble.

import { useCallback, useEffect, useId, useMemo, useRef } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * @param {{
 *   onClose: () => void,
 *   title?: string,          used as aria-label when there is no title element
 *   open?: boolean,          false = the modal is not on screen; do nothing at all
 *   closeOnBackdrop?: boolean,
 *   closeOnEscape?: boolean,
 *   autoFocus?: boolean,
 * }} options
 */
export function useModalDialog({
  onClose,
  title,
  open = true,
  closeOnBackdrop = true,
  closeOnEscape = true,
  autoFocus = true,
} = {}) {
  const ref = useRef(null);
  const restoreTo = useRef(null);
  const titleId = useId();

  useEffect(() => {
    // Closed means closed: no listener, no focus moved in, no focus restored.
    if (!open) return undefined;

    restoreTo.current = typeof document === 'undefined' ? null : document.activeElement;

    if (autoFocus) {
      // Focus the first control, so a keyboard user is already inside.
      const first = ref.current?.querySelector(FOCUSABLE);
      (first || ref.current)?.focus?.({ preventScroll: true });
    }

    const onKey = (e) => {
      if (e.key === 'Escape' && closeOnEscape) {
        // Belt and braces for a call site that forgot `open`: if the panel is
        // not actually in the document there is nothing to close, and taking
        // the key would silence every other Escape handler in the app.
        if (!ref.current) return;
        // Stop here: a modal inside a modal must close only the top one.
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;

      // No visibility filter: `offsetParent` is null for anything
      // position:fixed, which would silently drop real controls from the trap.
      const items = [...ref.current.querySelectorAll(FOCUSABLE)];
      if (items.length === 0) { e.preventDefault(); return; }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (!ref.current.contains(active)) {
        // Focus escaped somehow — bring it back rather than letting Tab wander.
        e.preventDefault(); first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // Put focus back where it came from, so the page does not jump to the top.
      restoreTo.current?.focus?.({ preventScroll: true });
    };
  }, [open, onClose, closeOnEscape, autoFocus]);

  // Close on the backdrop itself, never on a click that started inside the
  // panel and happened to finish on the backdrop (a drag-select, say).
  const onBackdropMouseDown = useCallback((e) => {
    if (!closeOnBackdrop) return;
    if (e.target === e.currentTarget) onClose?.();
  }, [closeOnBackdrop, onClose]);

  return useMemo(() => ({
    titleId,
    backdropProps: { onMouseDown: onBackdropMouseDown },
    dialogProps: {
      ref,
      role: 'dialog',
      'aria-modal': 'true',
      ...(title ? { 'aria-label': title } : { 'aria-labelledby': titleId }),
      tabIndex: -1,
      onMouseDown: (e) => e.stopPropagation(),
    },
  }), [titleId, title, onBackdropMouseDown]);
}

export default useModalDialog;
