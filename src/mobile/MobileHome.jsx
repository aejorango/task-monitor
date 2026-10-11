// src/mobile/MobileHome.jsx — Home: who you are, what is on fire, the one
// task to do next, everything else that needs you, and your week in hours.

import { useMemo } from 'react';
import { useInbox } from '../hooks/useInbox';
import { useSettings } from '../hooks/useSettings';
import { useMobile, Ico, ICON, Face } from './mobileUi';
import { TaskRow } from './MobileRows';
import {
  triageCounts, priorityTask, needsYou, lateLabel, longDate, greetingFor, ownerOf,
  hoursSince, addDays, BUCKET_ORDER,
} from '../services/mobileModel';
import { estimateOf } from '../services/effort';

// The Home ring is measured against a 40-hour week, as the mockup draws it.
// It is a yardstick, not data, and the card says "of 40h" so nobody reads it
// as a target somebody set.
const WEEK_HOURS = 40;

export default function MobileHome() {
  const m = useMobile();
  const { unread } = useInbox();
  const { settings } = useSettings();
  const { tasks, blockedIds, today } = m;

  const counts = useMemo(() => triageCounts(tasks, { blockedIds, today }), [tasks, blockedIds, today]);
  const hero = useMemo(() => priorityTask(tasks, { blockedIds, today }), [tasks, blockedIds, today]);
  const needs = useMemo(() => needsYou(tasks, { blockedIds, today, exclude: hero?.id }), [tasks, blockedIds, today, hero]);

  // Your hours since the start of this week (the week-start preference).
  const weekStart = useMemo(() => {
    const ws = settings.weekStart ?? 1;
    const dow = new Date(`${today}T00:00:00`).getDay();
    return addDays(today, -((dow - ws + 7) % 7));
  }, [settings.weekStart, today]);
  const byUser = useMemo(() => hoursSince(m.activities, weekStart), [m.activities, weekStart]);
  const mine = Math.round((byUser[m.userId] || 0) * 10) / 10;
  const crew = useMemo(
    () => [...m.members].sort((a, b) => (byUser[b] || 0) - (byUser[a] || 0)).slice(0, 5),
    [m.members, byUser],
  );

  const openOnly = (keys, fSt = []) => {
    const open = {};
    BUCKET_ORDER.forEach((k) => { open[k] = keys.includes(k); });
    m.setTab('board');
    m.patchTv({ view: 'List', groupBy: 'due', open, more: {}, fSt });
  };

  const first = String(m.profile?.displayName || m.nameOf(m.userId) || '').split(/[\s@]/)[0];
  const tiles = [
    ['Overdue', counts.over, 'red', ICON.overdue, () => openOnly(['over'])],
    ['Today', counts.today, 'amber', ICON.sun, () => openOnly(['today'])],
    ['Stuck', counts.stuck, 'red', ICON.warn, () => openOnly(['over', 'today', 'week', 'later'], ['stuck'])],
    ['Week', counts.week, 'blue', ICON.cal, () => openOnly(['week'])],
  ];

  const heroOwner = hero ? ownerOf(hero) : null;
  const heroEst = hero ? estimateOf(hero) : null;
  const heroLog = hero ? Math.round((Number(hero.totalHoursLogged) || 0) * 10) / 10 : 0;
  const ringPct = Math.min(100, (mine / WEEK_HOURS) * 100);

  return (
    <div className="m-stack">
      <div className="m-home-head">
        <Face uid={m.userId} size={40} />
        <div className="m-home-hi">
          <div className="m-home-date">{longDate(today)}</div>
          <div className="m-home-greet">{greetingFor(new Date().getHours())}, <span className="m-accent-ink">{first || 'there'}</span></div>
        </div>
        <button type="button" className="m-round-btn" aria-label="Search"
          onClick={() => { m.setTab('board'); m.patchTv({ searchOpen: true }); }}>
          <Ico d={ICON.search} />
        </button>
        <button type="button" className="m-round-btn" aria-label={unread ? `Alerts, ${unread} unread` : 'Alerts'}
          onClick={() => m.setPush({ kind: 'notif' })}>
          <Ico d={ICON.bell} />
          {unread > 0 && <span className="m-bell-dot" />}
        </button>
      </div>

      <div className="m-triage">
        {tiles.map(([label, n, tone, d, go]) => (
          <button key={label} type="button" className="m-triage-tile" onClick={go}>
            <span className={`m-triage-icon m-tone-${tone}`}><Ico d={d} size={15} stroke={2.5} /></span>
            <span className={`m-triage-n${n ? ` m-ink-${tone}` : ''}`}>{n}</span>
            <span className="m-triage-label">{label}</span>
          </button>
        ))}
      </div>

      <button type="button" className="m-hero" onClick={() => (hero ? m.openTask(hero.id) : m.setTab('board'))}>
        <span className="m-hero-glow" aria-hidden="true" />
        <span className="m-hero-top">
          <Ico d={ICON.flag} size={15} stroke={2.4} className="m-gold" />
          <span className="m-gold">Priority</span>
          {hero && <span className="m-hero-late">{lateLabel(hero, today)}</span>}
        </span>
        <span className="m-hero-title">{hero ? (hero.title || 'Untitled task') : 'Nothing urgent'}</span>
        {hero && (
          <span className="m-hero-foot">
            {heroOwner ? <Face uid={heroOwner.uid} name={heroOwner.name || ''} size={22} /> : <span className="m-row-noav" />}
            <span className="m-hero-proj">{m.projectById[hero.projectId]?.name || 'No project'}</span>
            <span className="m-hero-bar"><span style={{ width: `${heroEst ? Math.min(100, (heroLog / heroEst) * 100) : 0}%` }} /></span>
            <span className="m-hero-hrs">{heroEst == null ? `${heroLog}h` : `${heroLog}h/${heroEst}h`}</span>
          </span>
        )}
      </button>

      <div className="m-panel">
        <div className="m-panel-head">
          <span className="m-panel-title">Needs you</span>
          <span className="m-count is-red">{needs.length}</span>
          <button type="button" className="m-link" onClick={() => openOnly(['over', 'today'])}>All</button>
        </div>
        {needs.slice(0, 3).map((t) => <TaskRow key={t.id} task={t} mode="due" />)}
        {needs.length === 0 && <div className="m-empty-row">Nothing overdue or due today.</div>}
        {needs.length > 3 && (
          <button type="button" className="m-more-btn" onClick={() => openOnly(['over', 'today'])}>+{needs.length - 3} more</button>
        )}
      </div>

      <div className="m-week-card">
        <span className="m-ring" style={{ background: `conic-gradient(var(--m-orange) ${ringPct}%, var(--m-rule) 0)` }}>
          <span className="m-ring-in">{Math.round((mine / WEEK_HOURS) * 100)}%</span>
        </span>
        <div className="m-week-text">
          <div className="m-week-k">This week</div>
          <div className="m-week-v">{mine}h <span className="m-week-of">of {WEEK_HOURS}h</span></div>
        </div>
        <div className="m-stackfaces">
          {crew.map((uid) => <Face key={uid} uid={uid} size={28} className="is-stacked" />)}
        </div>
      </div>
    </div>
  );
}
