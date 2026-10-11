// src/mobile/mobileUi.jsx — the small pieces every mobile screen is built from:
// the mockup's icon paths, a person's face, a status pill and a toggle.
/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext } from 'react';
import Avatar from '../components/Avatar';
import { M_STATUS } from '../services/mobileModel';

/** Everything the screens read and every action they take. Built by MobileApp. */
export const MobileCtx = createContext(null);
export const useMobile = () => useContext(MobileCtx);

/** The mockup's own icon paths (its ICONS table), drawn the way it draws them. */
export const ICON = {
  home:   'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  board:  'M4 4h5v16H4zM10.5 4h5v11h-5zM17 4h3v14h-3z',
  plus:   'M12 5v14M5 12h14',
  ai:     'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  more:   'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  doc:    'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  chart:  'M6 20v-4M12 20V10M18 20V4',
  bell:   'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  moon:   'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  out:    'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  target: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z',
  gear:   'M12 15a3 3 0 1 0 0-6a3 3 0 1 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4',
  help:   'M12 21a9 9 0 1 0 0-18a9 9 0 1 0 0 18zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-4-4',
  filter: 'M4 6h16M7 12h10M10 18h4',
  select: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  back:   'M15 18l-6-6 6-6',
  chev:   'M9 6l6 6-6 6',
  flag:   'M4 21V4M4 4h12l-2.5 4L16 12H4',
  send:   'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  clip:   'M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7',
  updown: 'M7 15l5 5 5-5M7 9l5-5 5 5',
  check:  'M5 12l5 5L20 7',
  // The Home triage tiles.
  overdue: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18a9 9 0 1 0 0 18z',
  sun:     'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  warn:    'M12 8v5M12 16.5h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  cal:     'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
};

export function Ico({ d, size = 20, stroke = 2.2, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/**
 * A person. The mockup draws a photo; a member who has one gets it, everybody
 * else gets the app's one coloured initial (`Avatar`), never a stock photo of
 * somebody else.
 */
export function Face({ uid = null, name = '', size = 28, className = '' }) {
  const m = useMobile();
  const photo = uid ? m?.photoOf(uid) : null;
  const label = name || (uid ? m?.nameOf(uid) : '') || 'Unassigned';
  return <Avatar id={uid || label} name={label} photo={photo} size={size} className={`m-face ${className}`.trim()} />;
}

/** A status as the mockup prints it: navy ink on a bright fill. */
export function StatusPill({ status, big = false, onClick = null, suffix = '' }) {
  const s = M_STATUS[status] || M_STATUS.todo;
  const cls = `m-pill m-tone-${s.tone}${big ? ' is-big' : ''}`;
  if (onClick) return <button type="button" className={`${cls} is-btn`} onClick={onClick}>{s.label}{suffix}</button>;
  return <span className={cls}>{s.label}</span>;
}

/** The switch's picture. The row it sits in is the real `role="switch"`. */
export function Toggle({ on }) {
  return (
    <span className={`m-toggle${on ? ' is-on' : ''}`} aria-hidden="true">
      <span className="m-toggle-knob" />
    </span>
  );
}

/** A sheet's grab handle and title row. */
export function SheetHead({ title, onClose = null, action = null }) {
  return (
    <>
      <div className="m-sheet-handle" aria-hidden="true" />
      <div className="m-sheet-head">
        <span className="m-sheet-title">{title}</span>
        {action}
        {onClose && (
          <button type="button" className="m-sheet-x" onClick={onClose} aria-label="Close">✕</button>
        )}
      </div>
    </>
  );
}
