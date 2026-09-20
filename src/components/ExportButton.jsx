// src/components/ExportButton.jsx — "Export ▾" wherever something is worth
// keeping: a menu of formats, a spinner while the file is built, and the
// filename afterwards so the person knows what to look for in Downloads.
//
// The caller supplies a `build()` that returns the document (see
// services/exporters.js). It is called only when a format is picked, so a page
// never pays to prepare an export nobody asks for.

import { useEffect, useRef, useState } from 'react';
import { exportDocument, formatsFor } from '../services/exporters';
import { friendlyError } from '../services/access';

export default function ExportButton({
  build,
  baseName,
  kind = 'document',
  label = 'Export',
  className = 'btn',
  disabled = false,
  title,
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);      // the format being written
  const [note, setNote] = useState(null);      // { ok, text }
  const wrapRef = useRef(null);

  // Click outside, or Escape, closes the menu.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = async (format) => {
    setOpen(false);
    setBusy(format);
    setNote(null);
    try {
      const doc = await build();
      const filename = await exportDocument(format, baseName, doc);
      setNote({ ok: true, text: `Saved ${filename}` });
    } catch (err) {
      console.error('[export] failed:', err);
      // Only a message we wrote on purpose is fit to show; anything else is a
      // library's internal complaint.
      setNote({
        ok: false,
        text: err?.code === 'export'
          ? err.message
          : friendlyError({ code: 'unknown' }, 'Could not create that file. Try another format.'),
      });
    } finally {
      setBusy(null);
      setTimeout(() => setNote(null), 6000);
    }
  };

  const formats = formatsFor(kind);

  return (
    <span className="export-button" ref={wrapRef}>
      <button
        type="button"
        className={className}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || !!busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title || 'Save this as a file'}
      >
        {busy ? 'Preparing…' : `${label} ▾`}
      </button>

      {open && (
        <div className="export-menu" role="menu">
          {formats.map((f) => (
            <button
              key={f.value}
              type="button"
              role="menuitem"
              className="export-menu-item"
              onClick={() => run(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {note && (
        <span className={`export-note small ${note.ok ? 'ok-text' : 'link-danger'}`} role="status">
          {note.text}
        </span>
      )}
    </span>
  );
}
