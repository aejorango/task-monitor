// src/components/DueAlertBell.jsx — topbar toggle for the due-task alert.
// Shows how many due alerts are waiting; click pauses them for today or
// resumes them after the modal's × ("close all") was used.

import { useDueAlertQueue } from '../hooks/useDueAlertQueue';

export default function DueAlertBell() {
  const { remaining, muted, enabled, muteAll, unmute } = useDueAlertQueue();
  if (!enabled) return null;

  const title = muted
    ? `Due-task alerts paused for today${remaining ? ` (${remaining} waiting)` : ''} — click to resume`
    : remaining
      ? `${remaining} due-task alert${remaining === 1 ? '' : 's'} on — click to pause for today`
      : 'Due-task alerts on — click to pause for today';

  return (
    <button
      type="button"
      className={`topbar-bell ${muted ? 'is-muted' : ''}`}
      onClick={muted ? unmute : muteAll}
      aria-pressed={!muted}
      aria-label={title}
      title={title}
    >
      <span aria-hidden="true">{muted ? '🔕' : '🔔'}</span>
      {remaining > 0 && <span className="topbar-bell-count">{remaining}</span>}
    </button>
  );
}
