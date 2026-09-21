// src/components/DueAlertBell.jsx — topbar on/off switch for the due-task alert.
// The alert is an interrupting modal that also spends AI budget on a prompt, so
// it is opt-in: this switch is how it gets turned on, and it shows how many
// alerts are waiting while it is on.
//
// It renders in BOTH states on purpose. The old bell hid itself when the
// feature was off, which was fine when the default was on — with an opt-in
// default it would mean there is no way left to switch it on.

import { useDueAlertQueue } from '../hooks/useDueAlertQueue';
import { useSettings } from '../hooks/useSettings';
import { DEFAULT_DUE_ALERT_SETTINGS } from '../services/dueAlerts';

export default function DueAlertBell() {
  const { remaining, muted, enabled, unmute } = useDueAlertQueue();
  const { settings, update } = useSettings();

  const toggle = () => {
    const prefs = { ...DEFAULT_DUE_ALERT_SETTINGS, ...(settings.dueAlerts || {}) };
    update({ dueAlerts: { ...prefs, enabled: !enabled } });
    // Turning it on has to actually produce alerts. If "close all" muted today
    // earlier, clear that too — otherwise the switch reads on and stays silent.
    if (!enabled && muted) unmute();
  };

  const waiting = remaining ? ` (${remaining} waiting)` : '';
  const title = enabled
    ? muted
      ? `Due-task alerts on, paused for today${waiting} — click to turn off`
      : `Due-task alerts on${waiting} — click to turn off`
    : 'Due-task alerts off — click to turn on';

  return (
    <button
      type="button"
      role="switch"
      className={`due-alert-toggle ${enabled ? 'is-on' : ''} ${enabled && muted ? 'is-muted' : ''}`}
      onClick={toggle}
      aria-checked={enabled}
      aria-label={title}
      title={title}
    >
      <span className="due-alert-toggle-track" aria-hidden="true">
        <span className="due-alert-toggle-knob" />
      </span>
      {enabled && remaining > 0 && (
        <span className="due-alert-toggle-count">{remaining > 99 ? '99+' : remaining}</span>
      )}
    </button>
  );
}
