// src/mobile/MobileTasks.jsx — Tasks: List (grouped by due, project or owner),
// Week (seven days from today) and Team (remaining hours against a week).
// Search, the filter sheet, the project menu and multi-select all narrow the
// same list, through `filterTasks` in services/mobileModel.js.

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useMobile, Ico, ICON, Face } from './mobileUi';
import { TaskRow, TaskCard } from './MobileRows';
import {
  filterTasks, groupTasks, weekStrip, weekDayLabel, workloadRows, BUCKETS, M_STATUS,
  GROUP_CYCLE, GROUP_LABEL, WEEKLY_CAPACITY,
} from '../services/mobileModel';

const CAP = 5;

export default function MobileTasks() {
  const m = useMobile();
  const { tv, patchTv, tasks, blockedIds, today } = m;

  const visible = useMemo(() => filterTasks(tasks, {
    projects: tv.fProj, people: tv.fWho, statuses: tv.fSt, q: tv.q, blockedIds, today,
  }), [tasks, tv.fProj, tv.fWho, tv.fSt, tv.q, blockedIds, today]);

  const groups = useMemo(() => groupTasks(visible, {
    by: tv.groupBy, projects: m.projects, members: m.members, blockedIds, today,
  }), [visible, tv.groupBy, m.projects, m.members, blockedIds, today]);

  const openCount = visible.filter((t) => t.status !== 'done').length;
  const one = tv.fProj.length === 1 ? tv.fProj[0] : null;
  const chips = [
    ...tv.fWho.map((uid) => ({ label: uid === m.userId ? 'Me' : m.firstOf(uid), rm: () => patchTv((s) => ({ fWho: s.fWho.filter((x) => x !== uid) })) })),
    ...tv.fProj.filter((pid) => pid !== one).map((pid) => ({ label: m.projectById[pid]?.name || 'Project', rm: () => patchTv((s) => ({ fProj: s.fProj.filter((x) => x !== pid) })) })),
    ...tv.fSt.map((k) => ({ label: M_STATUS[k]?.label || k, rm: () => patchTv((s) => ({ fSt: s.fSt.filter((x) => x !== k) })) })),
  ];
  const filterCount = tv.fProj.length + tv.fWho.length + tv.fSt.length;
  const clear = () => patchTv({ fProj: [], fWho: [], fSt: [], q: '' });

  const projOpts = [{ id: 'all', name: 'All', color: 'var(--m-ink)' }, ...m.projects].map((p) => ({
    ...p,
    on: p.id === 'all' ? !tv.fProj.length : one === p.id,
    count: tasks.filter((t) => t.status !== 'done' && (p.id === 'all' || t.projectId === p.id)).length,
  }));
  const projSel = projOpts.find((o) => o.on) || projOpts[0];

  return (
    <div className="m-stack">
      <div className="m-tasks-top">
        <div className="m-tasks-head">
          <span className="m-h1">Tasks</span>
          <span className="m-tasks-count">{openCount} open</span>
          <div className="m-tasks-tools">
            <button type="button" className={`m-icon-btn${tv.searchOpen || tv.q ? ' is-on' : ''}`} aria-label="Search"
              onClick={() => patchTv((s) => ({ searchOpen: !s.searchOpen, q: s.searchOpen ? '' : s.q }))}>
              <Ico d={ICON.search} size={19} stroke={2.3} />
            </button>
            <button type="button" className={`m-icon-btn${filterCount ? ' is-on' : ''}`} aria-label="Filter"
              onClick={() => m.setSheet('filter')}>
              <Ico d={ICON.filter} size={19} stroke={2.3} />
              {chips.length > 0 && <span className="m-badge">{filterCount}</span>}
            </button>
            <button type="button" className={`m-icon-btn${tv.selecting ? ' is-on' : ''}`} aria-label="Select"
              aria-pressed={tv.selecting} onClick={() => patchTv((s) => ({ selecting: !s.selecting, sel: [] }))}>
              <Ico d={ICON.select} size={19} stroke={2.3} />
            </button>
          </div>
        </div>

        {tv.searchOpen && (
          <div className="m-search">
            <Ico d={ICON.search} size={16} stroke={2.6} className="m-ink-2" />
            <input autoFocus value={tv.q} onChange={(e) => patchTv({ q: e.target.value })}
              placeholder={`Search ${tasks.length} tasks`} aria-label="Search tasks" />
          </div>
        )}

        <div className="m-tasks-views">
          <div className="m-seg">
            {['List', 'Week', 'Team'].map((v) => (
              <button key={v} type="button" className={`m-seg-btn${tv.view === v ? ' is-on' : ''}`}
                aria-pressed={tv.view === v} onClick={() => patchTv({ view: v })}>{v}</button>
            ))}
          </div>
          {tv.view === 'List' && (
            <button type="button" className="m-group-btn" onClick={() => patchTv((s) => ({ groupBy: GROUP_CYCLE[s.groupBy], more: {} }))}
              aria-label={`Group by ${GROUP_LABEL[tv.groupBy]}`}>
              <Ico d={ICON.layers} size={16} stroke={2.3} />{GROUP_LABEL[tv.groupBy]}
            </button>
          )}
        </div>

        <div className="m-proj-menu">
          <button type="button" className="m-proj-btn" aria-expanded={tv.projMenu}
            onClick={() => patchTv((s) => ({ projMenu: !s.projMenu }))}>
            <span className="m-proj-k">PROJECT</span>
            <span className="m-dot is-10" style={{ background: projSel.color }} />
            <span className="m-proj-name">{projSel.name}</span>
            <span className="m-proj-count">{projSel.count} open</span>
            <span className={`m-chev${tv.projMenu ? ' is-up' : ''}`}>⌄</span>
          </button>
          {tv.projMenu && (
            <div className="m-proj-pop" role="menu">
              {projOpts.map((o) => (
                <button key={o.id} type="button" role="menuitemradio" aria-checked={o.on}
                  className={`m-proj-opt${o.on ? ' is-on' : ''}`}
                  onClick={() => patchTv({ fProj: o.id === 'all' ? [] : [o.id], more: {}, projMenu: false })}>
                  <span className="m-dot is-10" style={{ background: o.color }} />
                  <span className="m-proj-opt-name">{o.name}</span>
                  <span className="m-proj-opt-n">{o.count}</span>
                  <span className={`m-proj-check${o.on ? ' is-on' : ''}`}>✓</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {chips.length > 0 && (
          <div className="m-chips">
            {chips.map((c) => (
              <button key={c.label} type="button" className="m-fchip" onClick={c.rm} aria-label={`Remove ${c.label}`}>
                {c.label}<span className="m-fchip-x">✕</span>
              </button>
            ))}
            <button type="button" className="m-chip-clear" onClick={clear}>Clear</button>
          </div>
        )}
      </div>

      {tv.view === 'List' && (
        <div className="m-groups">
          {groups.map((g) => {
            const open = g.key in tv.open ? tv.open[g.key] : g.defaultOpen;
            const all = !!tv.more[g.key];
            const shown = all ? g.items : g.items.slice(0, CAP);
            return (
              <div key={g.key} className="m-panel">
                <button type="button" className="m-group-head" aria-expanded={open}
                  onClick={() => patchTv((s) => ({ open: { ...s.open, [g.key]: !open } }))}>
                  <GroupIcon g={g} />
                  <span className="m-group-label">{groupLabel(g, m)}</span>
                  <span className={`m-count${g.key === 'over' ? ' is-red' : ''}`}>{g.items.length}</span>
                  <span className="m-group-hours">{g.hoursLabel}</span>
                  <span className={`m-chev${open ? '' : ' is-side'}`}>⌄</span>
                </button>
                {open && (
                  <div>
                    {shown.map((t) => <TaskRow key={t.id} task={t} mode={tv.groupBy} />)}
                    {g.items.length > CAP && (
                      <button type="button" className="m-more-btn"
                        onClick={() => patchTv((s) => ({ more: { ...s.more, [g.key]: !all } }))}>
                        {all ? 'Show less' : `Show ${g.items.length - CAP} more`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {visible.length === 0 && (
            <div className="m-nothing">
              <div className="m-nothing-title">{tasks.length ? 'Nothing matches' : 'No tasks yet'}</div>
              {tasks.length
                ? <button type="button" className="m-pill-btn" onClick={clear}>Clear filters</button>
                : <button type="button" className="m-pill-btn" onClick={() => m.setSheet('plus')}>Create one</button>}
            </div>
          )}
        </div>
      )}

      {tv.view === 'Week' && <WeekView visible={visible} />}
      {tv.view === 'Team' && <TeamView visible={visible} />}
    </div>
  );
}

function groupLabel(g, m) {
  if (g.kind === 'bucket') return BUCKETS[g.bucket].label;
  if (g.kind === 'project') return g.project?.name || 'No project';
  return g.uid ? m.nameOf(g.uid) : 'Unassigned';
}

function GroupIcon({ g }) {
  if (g.kind === 'owner') return g.uid ? <Face uid={g.uid} size={28} /> : <span className="m-group-icon m-tone-grey">?</span>;
  if (g.kind === 'project') {
    return (
      <span className="m-group-icon is-project" style={{ background: g.project?.color || 'var(--m-faint)' }}>
        {String(g.project?.name || '–').charAt(0).toUpperCase()}
      </span>
    );
  }
  const b = BUCKETS[g.bucket];
  return <span className={`m-group-icon m-tone-${b.tone}`}>{b.icon}</span>;
}

// Five weeks back and thirteen on: enough to look at last month and the
// quarter ahead without the strip turning into a calendar.
const STRIP_BEFORE = 35;
const STRIP_AFTER = 90;

function WeekView({ visible }) {
  const m = useMobile();
  const strip = useMemo(() => weekStrip(visible, m.today, { before: STRIP_BEFORE, after: STRIP_AFTER }), [visible, m.today]);
  const day = strip.some((d) => d.ymd === m.tv.wday) ? m.tv.wday : m.today;
  const due = visible.filter((t) => t.status !== 'done' && t.plan?.endDate === day);
  const rail = useRef(null);

  // Bring a day into the middle of the strip: the chosen one when the view
  // opens, today when "Today" is pressed.
  const centre = useCallback((ymd, smooth) => {
    const el = rail.current?.querySelector(`[data-ymd="${ymd}"]`);
    if (!el) return;
    const left = el.offsetLeft - (rail.current.clientWidth - el.offsetWidth) / 2;
    rail.current.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  }, []);
  // Once, on open — not on every selection, or a tap would yank the strip.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { centre(day, false); }, [centre]);

  const goToday = () => { m.patchTv({ wday: m.today }); centre(m.today, true); };

  return (
    <div className="m-stack is-14">
      <div className="m-strip" ref={rail} role="listbox" aria-label="Days">
        {strip.map((d) => (
          <button key={d.ymd} type="button" data-ymd={d.ymd} role="option" aria-selected={day === d.ymd}
            className={`m-strip-day${day === d.ymd ? ' is-on' : ''}${d.ymd === m.today ? ' is-today' : ''}${d.ymd < m.today ? ' is-past' : ''}`}
            onClick={() => m.patchTv({ wday: d.ymd })}>
            <span className="m-strip-month">{d.month || ''}</span>
            <span className="m-strip-dow">{d.dow}</span>
            <span className="m-strip-n">{d.n}</span>
            <span className={`m-strip-cnt${d.count ? ' has' : ''}`}>{d.count || ''}</span>
          </button>
        ))}
      </div>
      <div className="m-kicker-row is-flush">
        <span className="m-kicker">{weekDayLabel(day, m.today)}</span>
        {day !== m.today && <button type="button" className="m-link" onClick={goToday}>Today</button>}
      </div>
      <div className="m-stack is-9">
        {due.map((t) => <TaskCard key={t.id} task={t} />)}
        {due.length === 0 && <div className="m-quiet">Nothing due this day</div>}
      </div>
    </div>
  );
}

function TeamView({ visible }) {
  const m = useMobile();
  const rows = useMemo(() => workloadRows(visible, m.members), [visible, m.members]);
  return (
    <div className="m-stack is-10">
      {rows.map((r) => (
        <div key={r.uid} className="m-team">
          <div className="m-team-top">
            <Face uid={r.uid} size={38} />
            <span className="m-team-who">
              <span className="m-team-name">{m.nameOf(r.uid)}</span>
              <span className="m-team-meta">
                {r.open} open · {r.hours}h remaining{r.unestimated ? ` · ${r.unestimated} not estimated` : ''}
              </span>
            </span>
            <span className={`m-team-pct${r.pct > 100 ? ' m-ink-red' : ''}`}>{r.pct}%</span>
          </div>
          <div className="m-team-track"><span className={`m-team-fill is-${r.tone}`} style={{ width: `${Math.min(100, r.pct)}%` }} /></div>
        </div>
      ))}
      {rows.length === 0 && <div className="m-quiet">Nobody is in this workspace yet.</div>}
      <div className="m-caption">Remaining hours against {WEEKLY_CAPACITY}h weekly capacity. A task nobody estimated adds nothing and is counted.</div>
    </div>
  );
}
