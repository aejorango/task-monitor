// src/components/FilterMenu.jsx — a filter drawn as a dropdown in the tab row.
//
// The trigger is styled like the Find item box beside it (`.fbx`, the same
// cream field, border and 32px height as `.findbox`), so the tab row's right
// end reads as one set of filters rather than a box, two pills and a crowd of
// faces. The menu underneath is the app's ordinary `.dropdown-menu`.
//
// `label` is the name of the filter ("Status") and stays muted; the value is
// the part that changes, so it is the part in ink. A filter whose values name
// themselves — a person — can drop the visible label and keep `name`, which is
// what a screen reader hears ("Assigned to: Rob").

import { useEffect, useRef, useState } from 'react';

/**
 * @param {string}   label     muted prefix on the trigger (optional)
 * @param {string}   name      what the filter is called, for a screen reader;
 *                             defaults to `label`
 * @param {string}   value     id of the selected option
 * @param {Array}    options   [{ id, label, hint?, icon? }]
 * @param {Function} onChange  called with the chosen id
 * @param {ReactNode} icon     optional leading glyph on the trigger
 */
export default function FilterMenu({ label = '', name = label, value, options, onChange, icon = null, className = '' }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const selected = options.find((o) => o.id === value) || options[0];

  // Closes on a click outside or on Escape — and only listens while open, so
  // a closed menu costs nothing and cannot swallow anybody else's Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`dropdown fmenu ${className}`.trim()} ref={boxRef}>
      <button
        type="button"
        className={`fbx${value !== options[0]?.id ? ' is-set' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${name}: ${selected?.label}`}
        title={selected?.hint || `${name}: ${selected?.label}`}
      >
        {/* The trigger's own glyph gives way to the chosen option's — a
            face, say — rather than showing two icons side by side. */}
        {icon && !selected?.icon && <span className="fbx-icon" aria-hidden="true">{icon}</span>}
        {label && <span className="fbx-k">{label}</span>}
        <span className="fbx-v">{selected?.icon}{selected?.label}</span>
        <span className="fbx-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="dropdown-menu" role="menu" aria-label={name}>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitemradio"
              aria-checked={o.id === value}
              className={`dropdown-item${o.id === value ? ' selected' : ''}`}
              title={o.hint || o.label}
              onClick={() => { onChange(o.id); setOpen(false); }}
            >
              {o.icon}
              <span className="fmenu-name">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
