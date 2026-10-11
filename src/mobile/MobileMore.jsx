// src/mobile/MobileMore.jsx — More: who you are, the screens that do not get
// a tab (Minutes, Projects, Reports, Goals, Settings, How to use), two
// switches and Sign out.
//
// The mockup's second switch is "Daily digest". There is no digest — no
// backend and no SMTP (CLAUDE.md, Out of Scope) — so that row is the theme
// switch the mockup's own state defines but never draws. A switch that
// changes nothing would be read as a promise.

import { useMinutes, useGoals } from '../hooks/useTasks';
import { useSettings } from '../hooks/useSettings';
import { requestNotificationPermission } from '../hooks/useNotifications';
import { signOutUser } from '../services/firebase';
import { useDialog } from '../components/Dialog';
import { useMobile, Ico, ICON, Toggle } from './mobileUi';
import Avatar from '../components/Avatar';

const ROLE_WORD = { owner: 'Owner', admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };

function isDark(theme) {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export default function MobileMore() {
  const m = useMobile();
  const ask = useDialog();
  const { minutes } = useMinutes();
  const { goals } = useGoals();
  const { settings, update } = useSettings();

  const role = m.profile?.role === 'superadmin' ? 'Superadmin'
    : ROLE_WORD[m.workspace?.acl?.[m.userId]] || 'Member';
  const name = m.profile?.displayName || m.nameOf(m.userId);
  const alertsOn = !!settings.dueAlerts?.enabled;
  const darkOn = isDark(settings.theme);

  const toggleAlerts = async () => {
    const next = !alertsOn;
    update({ dueAlerts: { enabled: next } });
    if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { await requestNotificationPermission(); } catch { /* the in-app alert still works */ }
    }
    m.flash(next ? 'Alerts on' : 'Alerts off');
  };

  const groups = [
    [
      { d: ICON.doc, label: 'Minutes', badge: minutes.length, tone: 'orange', go: () => m.setPush({ kind: 'minutes' }) },
      { d: ICON.folder, label: 'Projects', badge: m.projects.length, tone: 'blue', go: () => m.setPush({ kind: 'projects' }) },
      { d: ICON.chart, label: 'Reports', tone: 'gold', go: () => m.setPush({ kind: 'report' }) },
      { d: ICON.target, label: 'Goals', badge: goals.length, tone: 'slate', go: () => m.setPush({ kind: 'goals' }) },
    ],
    [
      { d: ICON.bell, label: 'Push alerts', toggle: alertsOn, tone: 'red', go: toggleAlerts },
      { d: ICON.moon, label: 'Dark mode', toggle: darkOn, tone: 'slate', go: () => update({ theme: darkOn ? 'light' : 'dark' }) },
    ],
    [
      { d: ICON.gear, label: 'Settings', tone: 'plain', go: () => m.setPush({ kind: 'settings' }) },
      { d: ICON.help, label: 'How to use', tone: 'plain', go: () => m.setPush({ kind: 'help' }) },
      {
        d: ICON.out, label: 'Sign out', tone: 'plain', danger: true,
        go: async () => {
          if (await ask.confirm({ title: 'Sign out of Task Monitor?', confirmLabel: 'Sign out', danger: true })) signOutUser();
        },
      },
    ],
  ];

  return (
    <div className="m-stack is-18">
      <div className="m-me">
        <Avatar id={m.userId} name={name} photo={m.photoOf(m.userId)} size={72} className="m-me-photo" />
        <div className="m-me-text">
          <div className="m-me-name">{name}</div>
          <div className="m-me-role">{role}{m.workspace?.name ? ` · ${m.workspace.name}` : ''}</div>
        </div>
      </div>

      {groups.map((rows, gi) => (
        <div key={gi} className="m-group">
          {rows.map((r) => {
            const isToggle = r.toggle !== undefined;
            return (
              <button key={r.label} type="button" className="m-group-row" onClick={r.go}
                {...(isToggle ? { role: 'switch', 'aria-checked': !!r.toggle } : {})}>
                <span className={`m-group-ico is-${r.tone}`}><Ico d={r.d} size={18} /></span>
                <span className={`m-group-name${r.danger ? ' is-danger' : ''}`}>{r.label}</span>
                {r.badge !== undefined && <span className="m-group-badge">{r.badge}</span>}
                {isToggle && <Toggle on={r.toggle} label={r.label} />}
                {!isToggle && !r.danger && <Ico d={ICON.chev} size={16} stroke={2.6} className="m-ink" />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
