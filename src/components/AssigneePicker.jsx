// src/components/AssigneePicker.jsx — shared assignee picker for tasks AND
// projects. Supports two kinds of assignees:
//   1. Existing system users (picked from a candidate pool — usually the
//      workspace's members + project members). Stored as UIDs.
//   2. Free-form external names (people not yet in the system). Stored as
//      strings. Doesn't grant any access; purely display.
//
// Display names for UIDs come from the workspace's `memberProfiles` map
// (denormalized so non-superadmin members can read them).

import { useState, useMemo } from 'react';

export default function AssigneePicker({
  // Candidate UIDs the user can pick from — typically workspace.members
  // (and/or project.members). Used to render the suggestion chips.
  candidates = [],
  // Map of uid → { displayName, email, photoURL } from workspace.memberProfiles
  memberProfiles = {},
  // Currently selected UIDs
  assignedTo = [],
  // Currently selected external (free-form) names
  assignedToExternal = [],
  // Called with the full new state: { assignedTo, assignedToExternal }
  onChange,
  // Pre-computed labels for candidates that aren't in memberProfiles (e.g.
  // your own auth user). Optional.
  fallbackLabels = {},
  // Display options
  label = 'Assigned to',
  helpText = null,
  size = 'normal',  // 'normal' | 'compact'
}) {
  const [extInput, setExtInput] = useState('');

  // Build a label lookup for any UID: prefers memberProfiles, then fallback,
  // then the truncated UID itself.
  const labelFor = (uid) => {
    const p = memberProfiles[uid];
    if (p?.displayName) return p.displayName;
    if (p?.email) return p.email;
    if (fallbackLabels[uid]) return fallbackLabels[uid];
    return `${uid.slice(0, 6)}…`;
  };

  const initialFor = (uid) => {
    const name = labelFor(uid);
    return (name?.[0] || '?').toUpperCase();
  };

  const photoFor = (uid) => memberProfiles[uid]?.photoURL || null;

  // Selected (rendered as filled chips) — UIDs first, then external names.
  const selectedUids = assignedTo;
  const selectedExt  = assignedToExternal;

  // Unselected candidates (rendered as outline chips for one-click add).
  const unselectedCandidates = useMemo(
    () => candidates.filter((uid) => !selectedUids.includes(uid)),
    [candidates, selectedUids],
  );

  const toggleUid = (uid) => {
    const next = selectedUids.includes(uid)
      ? selectedUids.filter((x) => x !== uid)
      : [...selectedUids, uid];
    onChange({ assignedTo: next, assignedToExternal: selectedExt });
  };

  const addExternal = (raw) => {
    const name = raw.trim();
    if (!name) return;
    // Case-insensitive dedupe
    const already = selectedExt.some((n) => n.toLowerCase() === name.toLowerCase());
    if (already) { setExtInput(''); return; }
    onChange({ assignedTo: selectedUids, assignedToExternal: [...selectedExt, name] });
    setExtInput('');
  };

  const removeExternal = (name) => {
    onChange({
      assignedTo: selectedUids,
      assignedToExternal: selectedExt.filter((n) => n !== name),
    });
  };

  const totalCount = selectedUids.length + selectedExt.length;
  const isCompact = size === 'compact';

  return (
    <div className={`assignee-picker ${isCompact ? 'compact' : ''}`}>
      <div className="assignee-header">
        <label className="label">{label} ({totalCount})</label>
        {totalCount > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => onChange({ assignedTo: [], assignedToExternal: [] })}
          >Clear all</button>
        )}
      </div>
      {helpText && <p className="muted small" style={{ marginTop: -2 }}>{helpText}</p>}

      {/* Selected chips */}
      {totalCount > 0 && (
        <div className="assignee-chips selected">
          {selectedUids.map((uid) => (
            <div key={`u-${uid}`} className="assignee-chip selected user" title={uid}>
              <Avatar src={photoFor(uid)} fallback={initialFor(uid)} />
              <span className="assignee-name">{labelFor(uid)}</span>
              <button
                type="button"
                className="assignee-x"
                onClick={() => toggleUid(uid)}
                aria-label={`Remove ${labelFor(uid)}`}
              >×</button>
            </div>
          ))}
          {selectedExt.map((name) => (
            <div key={`e-${name}`} className="assignee-chip selected external" title="External (not in system)">
              <span className="assignee-ext-mark" aria-hidden="true">✎</span>
              <span className="assignee-name">{name}</span>
              <button
                type="button"
                className="assignee-x"
                onClick={() => removeExternal(name)}
                aria-label={`Remove ${name}`}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* Suggestions for in-system users */}
      {unselectedCandidates.length > 0 && (
        <div className="assignee-suggest">
          <div className="assignee-suggest-label">From team</div>
          <div className="assignee-chips suggest">
            {unselectedCandidates.map((uid) => (
              <button
                key={uid}
                type="button"
                className="assignee-chip suggest user"
                onClick={() => toggleUid(uid)}
                title={uid}
              >
                <Avatar src={photoFor(uid)} fallback={initialFor(uid)} />
                <span className="assignee-name">{labelFor(uid)}</span>
                <span className="assignee-add">+</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* External name input */}
      <div className="assignee-ext-row">
        <input
          type="text"
          className="input input-sm"
          value={extInput}
          onChange={(e) => setExtInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); addExternal(extInput); }
            if (e.key === 'Backspace' && !extInput && selectedExt.length > 0) {
              e.preventDefault();
              removeExternal(selectedExt[selectedExt.length - 1]);
            }
          }}
          placeholder="Add a name not in the system (press Enter)"
        />
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => addExternal(extInput)}
          disabled={!extInput.trim()}
        >Add</button>
      </div>
    </div>
  );
}

function Avatar({ src, fallback }) {
  if (src) return <img className="assignee-avatar" src={src} alt="" />;
  return <span className="assignee-avatar fallback">{fallback}</span>;
}
