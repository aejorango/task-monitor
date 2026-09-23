// src/components/Avatar.jsx — a person, as a coloured circle with their initial.
//
// The Board Explorer puts one of these on the kanban card, in the Table's
// Owner column, on a Gantt row, beside every WBS task, down the side of the
// Workload and against each subitem. Six surfaces, one component — because
// the whole point of an avatar is that the same person is the same circle
// wherever you meet them, and six hand-rolled spans drift.
//
// The colour is derived from the account id, not stored, so it is stable
// across devices and needs no migration. `photoURL` wins when there is one.

import { memo } from 'react';

// The mockup's own five, in its own order.
const COLORS = [
  '#e2892e',  // orange
  '#1D7CC7',  // blue
  '#1DA449',  // green
  '#7B2D8F',  // purple
  '#16324d',  // navy
  '#0051BA',  // deep blue
];

/** A stable colour for one person. Same id, same circle, every screen. */
export function avatarColor(personId) {
  const s = String(personId || '');
  let n = 0;
  for (let i = 0; i < s.length; i += 1) n = (n * 31 + s.charCodeAt(i)) % 99991;
  return COLORS[n % COLORS.length];
}

/** The letter in the circle: the first one of a name, never of an account id. */
export function avatarInitial(name) {
  const clean = String(name || '').trim();
  if (!clean) return '?';
  // An email is a name here too — take the letter before the @, not the @.
  return clean.replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase() || '?';
}

function AvatarBase({ id, name, photo = null, size = 22, title, className = '' }) {
  const label = title || name || 'Unassigned';
  return (
    <span
      className={`av${className ? ` ${className}` : ''}`}
      style={{
        width: size,
        height: size,
        background: photo ? 'transparent' : avatarColor(id || name),
        fontSize: size > 24 ? 11 : 10,
      }}
      title={label}
      aria-label={label}
      role="img"
    >
      {photo
        ? <img src={photo} alt="" />
        : avatarInitial(name)}
    </span>
  );
}

const Avatar = memo(AvatarBase);
export default Avatar;

/**
 * Several people, overlapping, as the toolbar and a shared card draw them.
 * `max` is where it stops and starts counting instead.
 */
export function AvatarStack({ people = [], size = 22, max = 3 }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  if (people.length === 0) return null;
  return (
    <span className="av-stack">
      {shown.map((p) => (
        <Avatar key={p.id || p.name} id={p.id} name={p.name} photo={p.photo} size={size} />
      ))}
      {extra > 0 && (
        <span className="av av-more" style={{ width: size, height: size }} title={`${people.length} people`}>
          +{extra}
        </span>
      )}
    </span>
  );
}
