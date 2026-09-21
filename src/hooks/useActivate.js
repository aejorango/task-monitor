// src/hooks/useActivate.js — a div that behaves like a button.
//
// Sometimes a whole row is the control: a task in the Dashboard's action queue,
// a project health line, a subtask. Those get `role="button"` and `tabIndex={0}`
// — and then have to earn it, because the ARIA button pattern is a contract:
// Enter AND Space both activate, and Space must not scroll the page instead.
//
// They were each made keyboard-reachable by hand and most handled only Enter,
// so a screen-reader user pressing the spacebar got a page scroll and no action
// (BUG-032). One helper, so there is nothing to get half-right.
//
//   <div {...activateProps(() => openTask(t))}>…</div>

/**
 * Every prop a div needs to be a button.
 *
 * @param {(event: Event) => void} onActivate
 * @param {{ disabled?: boolean, label?: string }} opts
 *   `label` becomes aria-label — a row whose text is a bare number or an icon
 *   needs one; a row that reads as a sentence does not.
 */
export function activateProps(onActivate, { disabled = false, label } = {}) {
  if (disabled) {
    // Still announced, still not operable — the same as a disabled button.
    return { role: 'button', 'aria-disabled': 'true', tabIndex: -1, ...(label ? { 'aria-label': label } : {}) };
  }
  return {
    role: 'button',
    tabIndex: 0,
    ...(label ? { 'aria-label': label } : {}),
    onClick: (e) => onActivate?.(e),
    onKeyDown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      // Space scrolls the page by default, and Enter inside a form submits it.
      e.preventDefault();
      // A row often sits inside something else clickable; the key press belongs
      // to whatever has focus, not to its ancestors.
      e.stopPropagation();
      onActivate?.(e);
    },
  };
}

export default activateProps;
