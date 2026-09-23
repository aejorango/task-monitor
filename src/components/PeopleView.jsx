// src/components/PeopleView.jsx — Reports → People (T-0144, Report Explorer).
//
// Who logged what, against what they can actually carry. Three panels, exactly
// as the mockup lays them out: the member table with a utilization bar and a
// cap notch, throughput beside it, and the flags that fall out of both.
//
// Every number is real. The cap is `WEEKLY_CAPACITY_H` scaled to the period —
// the same yardstick the Dashboard's utilization rail uses — and "on-time" is
// measured from the tasks people actually finished, not assumed.

import { useMemo, useState } from 'react';
import { useTasks, useAllActivities } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { todayLocal } from '../services/firebase';
import { addDaysISO } from '../services/dueAlerts';
import { PageActions, PageSubtitle } from './PageHeader';
import ExportButton from './ExportButton';
import { heading, paragraph, table } from '../services/exporters';

/** Hours one person is expected to have in a period of this many days. */
const WEEKLY_CAPACITY_H = 35;
const capacityFor = (days) => Math.round((WEEKLY_CAPACITY_H / 7) * days);

const RANGES = [
  { id: '7',  label: 'This week (7d)',   days: 7 },
  { id: '30', label: 'This month (30d)', days: 30 },
  { id: '90', label: 'This quarter (90d)', days: 90 },
];

function nameFor(profile, uid) {
  return profile?.displayName || profile?.email || `Member ${String(uid).slice(0, 4)}`;
}
function initialsFor(profile, uid) {
  const parts = String(nameFor(profile, uid)).trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return String(parts[0] || '?').slice(0, 2).toUpperCase();
}
function avatarColorFor(uid) {
  const palette = ['#0051BA', '#e2892e', '#7B2D8F', '#1DA449', '#1D7CC7', '#c0392b'];
  let h = 0;
  for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

export default function PeopleView() {
  const { tasks, loading: tasksLoading } = useTasks();
  const { activities, loading: actsLoading } = useAllActivities();
  const { workspaces } = useWorkspaces();
  const activeWsId = useActiveWorkspaceId();
  const workspace = workspaces.find((w) => w.id === activeWsId);
  const [rangeId, setRangeId] = useState('7');
  const range = RANGES.find((r) => r.id === rangeId);

  const today = todayLocal();
  const since = addDaysISO(today, -(range.days - 1));
  const cap = capacityFor(range.days);

  const memberProfiles = workspace?.memberProfiles || {};
  const memberUids = workspace?.members || [];

  const people = useMemo(() => {
    const inPeriod = activities.filter((a) => (a.date || '') >= since && (a.date || '') <= today);
    return memberUids
      .map((uid) => {
        const mine = inPeriod.filter((a) => a.userId === uid);
        const hours = mine.reduce((n, a) => n + (a.hoursSpent || 0), 0);
        const items = new Set(mine.map((a) => a.taskId).filter(Boolean)).size;

        // On-time is measured, not assumed: of the tasks this person finished
        // in the period that HAD a due date, how many landed on or before it.
        // A task with no due date cannot be late, so it is left out of the
        // denominator entirely rather than counted as a win.
        const finished = tasks.filter((t) => t.status === 'done'
          && (t.assignedTo || []).includes(uid)
          && t.actual?.endDate && t.actual.endDate >= since && t.actual.endDate <= today
          && t.plan?.endDate);
        const onTimeN = finished.filter((t) => t.actual.endDate <= t.plan.endDate).length;
        const onTime = finished.length ? Math.round((onTimeN / finished.length) * 100) : null;

        const pct = cap > 0 ? Math.round((hours / cap) * 100) : 0;
        const tone = pct > 100 ? 'red' : pct >= 86 ? 'amber' : 'green';
        const otTone = onTime === null ? 'navy' : onTime >= 90 ? 'green' : onTime >= 70 ? 'amber' : 'red';
        const done = tasks.filter((t) => t.status === 'done'
          && (t.assignedTo || []).includes(uid)
          && t.actual?.endDate && t.actual.endDate >= since && t.actual.endDate <= today).length;

        return {
          uid,
          name: nameFor(memberProfiles[uid], uid),
          first: String(nameFor(memberProfiles[uid], uid)).split(' ')[0],
          initials: initialsFor(memberProfiles[uid], uid),
          color: avatarColorFor(uid),
          hours, items, pct, tone, done,
          onTime, otTone,
          // "—" rather than "100%" when nobody finished a dated task: a
          // perfect score off zero attempts is the most misleading number a
          // report can print.
          onTimeText: onTime === null ? '—' : `${onTime}%`,
        };
      })
      .sort((a, b) => b.hours - a.hours);
  }, [memberUids, memberProfiles, activities, tasks, since, today, cap]);

  const throughput = useMemo(
    () => [...people].sort((a, b) => b.done - a.done),
    [people],
  );
  const topDone = Math.max(1, ...throughput.map((m) => m.done));

  const flags = useMemo(() => {
    const out = [];
    const over = people.filter((m) => m.pct > 100);
    if (over.length) {
      out.push({
        id: 'over', tag: 'OVER', tone: 'red',
        text: over.length > 1
          ? `${over.length} people over ${cap}h · ${over[0].first} ${over[0].hours.toFixed(1)}h`
          : `${over[0].first} · ${over[0].hours.toFixed(1)}h of ${cap}h`,
      });
    }
    const late = people
      .map((m) => ({
        m,
        n: tasks.filter((t) => t.status !== 'done' && (t.assignedTo || []).includes(m.uid)
          && t.plan?.endDate && t.plan.endDate < today).length,
      }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)[0];
    if (late) {
      out.push({
        id: 'late', tag: 'LATE', tone: 'amber',
        text: `${late.m.first} · ${late.n} item${late.n === 1 ? '' : 's'} past due`,
      });
    }
    const idle = people.filter((m) => m.pct < 40 && m.hours >= 0);
    if (idle.length && !out.some((f) => f.id === 'idle')) {
      const q = idle[idle.length - 1];
      out.push({
        id: 'idle', tag: 'IDLE', tone: 'amber',
        text: `${q.first} · ${q.hours.toFixed(1)}h of ${cap}h`,
      });
    }
    return out;
  }, [people, tasks, today, cap]);

  const buildExport = () => ({
    title: `People · ${range.label}`,
    blocks: [
      heading('People', 1),
      paragraph(`${since} to ${today} · capacity ${cap}h per person`),
      table(
        ['Member', 'Logged', 'Items', 'Utilization', 'On-time', 'Completed'],
        people.map((m) => [m.name, `${m.hours.toFixed(1)}h`, m.items, `${m.pct}%`, m.onTimeText, m.done]),
      ),
    ],
  });

  if (tasksLoading || actsLoading) return <p className="muted">Loading people…</p>;

  return (
    <>
      <PageSubtitle>
        {range.label} · capacity {cap}h each · {people.length} {people.length === 1 ? 'member' : 'members'}
      </PageSubtitle>
      <PageActions>
        <ExportButton build={buildExport} baseName="people" kind="table" className="cmd"
          title="Save this as a spreadsheet, CSV or PDF" />
      </PageActions>

      <div className="period-bar">
        {RANGES.map((r) => (
          <button
            key={r.id}
            className={`pill${rangeId === r.id ? ' active' : ''}`}
            aria-pressed={rangeId === r.id}
            onClick={() => setRangeId(r.id)}
          >{r.label}</button>
        ))}
        <span className="period-note">{since} – {today}</span>
      </div>

      {people.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">◍</div>
          <p>Nobody to report on yet.</p>
          <p className="small">Invite people to this workspace in Settings → Members.</p>
        </div>
      ) : (
        <div className="rep-split">
          <section className="rtable">
            <div className="ppl-cols">
              <span>Member</span><span>Logged</span><span>Items</span>
              <span>Utilization</span><span>On-time</span>
            </div>
            {people.map((m, i) => (
              <div key={m.uid} className={`ppl-row${i % 2 ? ' alt' : ''}`}>
                <span className="ppl-who">
                  <span className="ppl-av" style={{ background: m.color }}>{m.initials}</span>
                  <span className="ppl-name">{m.name}</span>
                </span>
                <span className="rtable-num strong">{m.hours.toFixed(1)}h</span>
                <span className="rtable-num">{m.items}</span>
                <span className="rtable-cell ppl-util">
                  <span className="ppl-track">
                    {/* The bar is scaled to 1.4× the cap so going over is
                        visible as overshoot rather than a bar that just stops
                        at full. The notch is the cap itself. */}
                    <span
                      className={`ppl-fill tone-${m.tone}`}
                      style={{ width: `${Math.min((m.pct / 140) * 100, 100)}%` }}
                    />
                    <span className="ppl-cap" title={`capacity ${cap}h`} />
                  </span>
                  <span className={`ppl-pct tone-ink-${m.tone}`}>{m.pct}%</span>
                </span>
                <span className="rtable-cell">
                  <span className={`vchip vchip-${m.otTone}`} title={m.onTime === null
                    ? 'Nothing with a due date was finished in this period'
                    : 'Finished on or before the plan date'}>{m.onTimeText}</span>
                </span>
              </div>
            ))}
            <div className="ppl-key">
              <span className="ptable-key-item"><span className="ptable-key-notch" />cap {cap}h</span>
              <span className="ptable-key-item tone-ink-red"><span className="ppl-swatch" />Over cap</span>
            </div>
          </section>

          <div className="db-rail">
            <section className="dcard">
              <h2 className="dcard-title">Throughput</h2>
              <p className="dcard-sub">Tasks completed in this period</p>
              <div className="util">
                {throughput.map((m) => (
                  <div key={m.uid} className="util-row">
                    <span className="util-av" style={{ background: m.color }}>{m.initials}</span>
                    <span className="util-name">{m.first}</span>
                    <span className="util-track">
                      <span className="util-fill" style={{ width: `${(m.done / topDone) * 100}%`, background: m.color }} />
                    </span>
                    <span className="util-pct">{m.done}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="dcard">
              <h2 className="dcard-title">Flags</h2>
              {flags.length === 0 ? (
                <p className="db-empty">Everybody is inside capacity and on time.</p>
              ) : (
                <div className="alerts">
                  {flags.map((f) => (
                    <div key={f.id} className={`alert alert-${f.tone}`}>
                      <div className="alert-top">
                        <span className={`alert-sev tone-${f.tone}`}>{f.tag}</span>
                        <span className="alert-title">{f.text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
