// src/components/ReviewView.jsx — weekly review with KPIs, charts, and lists.

import { useState, useMemo } from 'react';
import { useTasks, useProjects, useAllActivities, useAuth } from '../hooks/useTasks';
import { todayLocal } from '../services/firebase';
import {
  summarizeWeek,
  suggestNextTask,
  draftStatusUpdate,
} from '../services/anthropic';
import Markdown from './Markdown';
import ExportButton from './ExportButton';
import { PageActions, PageSubtitle } from './PageHeader';
import { Tile } from './DashboardView';
import {
  bullets, heading, keyValues, paragraph, sheetFromRows, table,
} from '../services/exporters';
import { useAiStatus } from '../hooks/useAiStatus';
import { formatVariance, totalVariance } from '../services/effort';
import { rateProjects, RAG_MEANING } from '../services/portfolio';
import { useIsOperator } from '../hooks/useUserProfile';
import { describeAiFailure } from '../services/errorMessages';

const RAG_LABEL = { RED: 'Red', AMBER: 'Amber', GREEN: 'Green', IDLE: 'Idle' };

const RANGES = [
  { id: '7',  label: 'This week (7d)',  days: 7 },
  { id: '14', label: 'Last 14 days',    days: 14 },
  { id: '30', label: 'This month (30d)', days: 30 },
  { id: '90', label: 'Last 90 days',    days: 90 },
];

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "Jul 14 – Jul 20" — month-first, matching fmtDay everywhere else. */
function fmtRange(fromIso, toIso) {
  const show = (iso) => {
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return iso;
    return new Date(y, m - 1, d).toLocaleDateString('en', { month: 'short', day: 'numeric' });
  };
  return `${show(fromIso)} – ${show(toIso)}`;
}

export default function ReviewView() {
  const { tasks, loading: tasksLoading } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const { activities, loading: activitiesLoading } = useAllActivities();
  const [rangeId, setRangeId] = useState('7');
  const range = RANGES.find((r) => r.id === rangeId);

  const today = todayLocal();
  const sinceStr = daysAgo(range.days - 1);

  const periodActivities = useMemo(() => {
    return activities.filter((a) => a.date >= sinceStr && a.date <= today);
  }, [activities, sinceStr, today]);

  // KPIs
  const totalHours = periodActivities.reduce((s, a) => s + (a.hoursSpent || 0), 0);
  const completedActivities = periodActivities.filter((a) => a.completionStatus === 'completed').length;
  const blockedActivities   = periodActivities.filter((a) => a.completionStatus === 'blocked').length;

  // Tasks completed in period (actual.endDate within range)
  const tasksCompleted = tasks.filter((t) =>
    t.status === 'done' && t.actual?.endDate && t.actual.endDate >= sinceStr && t.actual.endDate <= today
  );
  // Tasks added in period — approximated by createdAt timestamp
  const tasksAdded = tasks.filter((t) => {
    const created = t.createdAt?.toDate?.();
    if (!created) return false;
    return created >= new Date(`${sinceStr}T00:00:00`);
  });
  // Overdue
  const overdueTasks = tasks.filter((t) =>
    t.status !== 'done' && t.plan?.endDate && t.plan.endDate < today
  );

  // Hours by project
  const hoursByProject = useMemo(() => {
    const map = {};
    periodActivities.forEach((a) => {
      const key = a.projectId || '__other__';
      if (!map[key]) {
        const proj = projectById[a.projectId];
        map[key] = {
          name: proj?.name || a.taskCategory || 'Other',
          color: proj?.color || '#a1a1aa',
          hours: 0,
        };
      }
      map[key].hours += a.hoursSpent || 0;
    });
    return Object.values(map).sort((a, b) => b.hours - a.hours);
  }, [periodActivities, projectById]);
  const maxHours = Math.max(1, ...hoursByProject.map((p) => p.hours));

  // Hours by day (for the bar strip)
  const hoursByDay = useMemo(() => {
    const map = {};
    for (let i = range.days - 1; i >= 0; i--) {
      const d = daysAgo(i);
      map[d] = 0;
    }
    periodActivities.forEach((a) => {
      if (a.date in map) map[a.date] += a.hoursSpent || 0;
    });
    return Object.entries(map).map(([date, hours]) => ({ date, hours }));
  }, [periodActivities, range.days]);
  const maxDayHours = Math.max(1, ...hoursByDay.map((d) => d.hours));

  // ───── Hours by day, stacked by project ────────────────────────────────
  // The legend is capped and everything past it folds into "Other": eight
  // colours in a stack is a chart nobody can read back to a project.
  const stack = useMemo(() => {
    const totalsBy = new Map();
    periodActivities.forEach((a) => {
      const key = a.projectId || '__other__';
      totalsBy.set(key, (totalsBy.get(key) || 0) + (a.hoursSpent || 0));
    });
    const ranked = [...totalsBy.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, 5).map(([key]) => key);
    const keyOf = (a) => {
      const k = a.projectId || '__other__';
      return top.includes(k) ? k : '__rest__';
    };
    const nameOf = (key) => (key === '__rest__' ? 'Other' : projectById[key]?.name || 'No project');
    const colorOf = (key) => (key === '__rest__' ? 'var(--c-text-muted)' : projectById[key]?.color || '#a1a1aa');

    const legendKeys = [...top, ...(ranked.length > 5 ? ['__rest__'] : [])];
    const byDay = new Map();
    for (let i = range.days - 1; i >= 0; i--) byDay.set(daysAgo(i), new Map());
    periodActivities.forEach((a) => {
      const day = byDay.get(a.date);
      if (!day) return;
      const k = keyOf(a);
      day.set(k, (day.get(k) || 0) + (a.hoursSpent || 0));
    });

    const days = [...byDay.entries()].map(([date, parts]) => {
      const list = legendKeys
        .map((key) => ({ key, name: nameOf(key), color: colorOf(key), hours: parts.get(key) || 0 }))
        .filter((pt) => pt.hours > 0);
      return {
        date,
        label: new Date(`${date}T00:00:00`).toLocaleDateString('en',
          range.days > 31 ? { month: 'short' } : { day: 'numeric' }),
        parts: list,
        total: list.reduce((n, pt) => n + pt.hours, 0),
      };
    });
    return {
      days,
      max: Math.max(0, ...days.map((d) => d.total)),
      legend: legendKeys.map((key) => ({ key, name: nameOf(key), color: colorOf(key) })),
    };
  }, [periodActivities, projectById, range.days]);

  // ───── Status mix ──────────────────────────────────────────────────────
  // Every task in scope, not only the ones touched in the period: "what state
  // is the work in" is a question about the work, not about the last 7 days.
  const mix = useMemo(() => {
    const live = tasks.filter((t) => !t.deleted && !t.archived);
    const late = live.filter((t) => t.status !== 'done' && t.plan?.endDate && t.plan.endDate < today).length;
    const rows = [
      { id: 'done',  label: 'Done',        color: 'var(--c-done)',   count: live.filter((t) => t.status === 'done').length },
      { id: 'doing', label: 'In progress', color: 'var(--c-doing)',  count: live.filter((t) => t.status === 'doing').length },
      { id: 'late',  label: 'Overdue',     color: 'var(--c-danger)', count: late },
      { id: 'todo',  label: 'Not started', color: 'var(--c-todo)',
        count: live.filter((t) => t.status === 'todo' && !(t.plan?.endDate && t.plan.endDate < today)).length },
    ];
    return { rows, total: rows.reduce((n, r) => n + r.count, 0) };
  }, [tasks, today]);

  // ───── By project — planned against logged ─────────────────────────────
  // Planned is the sum of the ESTIMATES somebody actually wrote down, via
  // services/effort.js. A project nobody estimated shows a dash, not a zero:
  // "0h planned against 40h logged" is a 4000% overrun that never happened.
  const rated = useMemo(() => rateProjects(projects, tasks, today), [projects, tasks, today]);
  const byProject = useMemo(() => rated.map((h) => {
    const own = tasks.filter((t) => t.projectId === h.project.id && !t.deleted);
    const v = totalVariance(own);
    return {
      id: h.project.id,
      name: h.project.name,
      color: h.project.color,
      planned: v.state === 'none' ? '—' : `${v.estimate.toFixed(1)}h`,
      logged: `${v.logged.toFixed(1)}h`,
      varText: formatVariance(v),
      varTone: v.state === 'over' ? 'red' : v.state === 'under' ? 'green' : v.state === 'on' ? 'navy' : 'none',
      pct: h.pct,
      rag: h.rag,
      ragLabel: RAG_LABEL[h.rag],
    };
  }), [rated, tasks]);

  const totals = useMemo(
    () => totalVariance(tasks.filter((t) => !t.deleted && t.projectId)),
    [tasks],
  );

  // Bottleneck remarks in the period
  const bottlenecks = periodActivities
    .filter((a) => a.bottleneckRemarks?.trim())
    .sort((a, b) => b.date.localeCompare(a.date));

  // What "Export" hands over: the same numbers on the page, in a form a manager
  // can file. Built on demand — see components/ExportButton.
  const buildReport = () => ({
    title: `Review — ${range.label}`,
    subtitle: `${sinceStr} to ${today} · Task Monitor`,
    blocks: [
      keyValues([
        ['Hours logged', `${totalHours.toFixed(1)}h`],
        ['Tasks completed', tasksCompleted.length],
        ['Tasks added', tasksAdded.length],
        ['Activities logged', periodActivities.length],
        ['Completed entries', completedActivities],
        ['Blocked entries', blockedActivities],
        ['Overdue now', overdueTasks.length],
      ]),

      heading('Hours by project', 1),
      hoursByProject.length
        ? table(['Project', 'Hours', 'Share'], hoursByProject.map((p) => [
          p.name,
          p.hours.toFixed(1),
          totalHours ? `${Math.round((p.hours / totalHours) * 100)}%` : '0%',
        ]))
        : paragraph('No hours logged in this period.'),

      heading('Completed in this period', 1),
      tasksCompleted.length
        ? table(['Task', 'Project', 'Completed'], tasksCompleted.map((t) => [
          t.title,
          projectById[t.projectId]?.name || '—',
          t.actual?.endDate || '',
        ]))
        : paragraph('Nothing was completed in this period.'),

      heading('Overdue', 1),
      overdueTasks.length
        ? table(['Task', 'Project', 'Was due', 'Status'], overdueTasks.map((t) => [
          t.title,
          projectById[t.projectId]?.name || '—',
          t.plan?.endDate || '',
          t.status,
        ]))
        : paragraph('Nothing is overdue.'),

      heading('Blockers raised', 1),
      bottlenecks.length
        ? bullets(bottlenecks.map((a) => `${a.date} — ${a.taskTitle || 'Task'}: ${a.bottleneckRemarks.trim()}`))
        : paragraph('No blockers were raised in this period.'),
    ],
    // So "Excel" gives a usable sheet rather than a flattened report.
    sheets: [
      sheetFromRows('Hours by project', ['Project', 'Hours'],
        hoursByProject.map((p) => [p.name, p.hours])),
      sheetFromRows('Completed', ['Task', 'Project', 'Completed'],
        tasksCompleted.map((t) => [t.title, projectById[t.projectId]?.name || '', t.actual?.endDate || ''])),
      sheetFromRows('Overdue', ['Task', 'Project', 'Was due', 'Status'],
        overdueTasks.map((t) => [t.title, projectById[t.projectId]?.name || '', t.plan?.endDate || '', t.status])),
    ],
  });

  if (tasksLoading || activitiesLoading) return <p className="muted">Loading review…</p>;

  return (
    <>
      <PageSubtitle>{range.label} · {fmtRange(sinceStr, today)}</PageSubtitle>
      <PageActions>
        <ExportButton
          build={buildReport}
          baseName={`review-${range.id}`}
          kind="document"
          className="cmd"
          title="Save this review as a Word, PDF, Markdown or web-page file"
        />
      </PageActions>

      {/* The period is a band of its own, as the Report Explorer has it. It was
          four chips crowded in beside Export, where the thing that decides what
          every number below means looked like one more command. */}
      <div className="period-bar">
        {RANGES.map((r) => (
          <button
            key={r.id}
            className={`pill${rangeId === r.id ? ' active' : ''}`}
            aria-pressed={rangeId === r.id}
            onClick={() => setRangeId(r.id)}
          >{r.label}</button>
        ))}
        <span className="period-note">{fmtRange(sinceStr, today)} · {range.days} days</span>
      </div>

      <div className="tiles">
        <Tile tone="navy"  label="Hours logged"     value={`${totalHours.toFixed(1)}h`}
              sub={`${periodActivities.length} ${periodActivities.length === 1 ? 'entry' : 'entries'} logged`} />
        <Tile tone="green" label="Tasks completed"  value={tasksCompleted.length}
              sub={`${completedActivities} entries marked complete`} />
        <Tile tone="teal"  label="Tasks created"    value={tasksAdded.length}
              sub="new in this period" />
        <Tile tone="red"   label="Overdue"          value={overdueTasks.length}
              sub={overdueTasks.length ? 'past their plan date' : 'nothing is late'} />
        <Tile tone="amber" label="Blocked entries"  value={blockedActivities}
              sub={blockedActivities ? 'entries logged as blocked' : 'nothing logged as blocked'} />
      </div>

      {/* ══ Hours by day, stacked by project · Status mix ═════════════════
          One chart where there were two lists. "Hours by project" and "Daily
          hours" each answered half of the same question — how the period's
          hours were spent — and neither could answer it on its own: the first
          had no dates, the second had no projects. */}
      <div className="rep-split">
        <section className="dcard">
          <div className="dcard-head">
            <h2 className="dcard-title">Hours by day</h2>
            <span className="rep-total">{totalHours.toFixed(1)}h logged</span>
          </div>
          {stack.days.length === 0 || stack.max === 0 ? (
            <p className="db-empty">No hours logged in this period.</p>
          ) : (
            <>
              <div className="stack" style={{ '--stack-max': stack.max }}>
                {stack.days.map((d) => (
                  <div key={d.date} className="stack-col" title={`${d.label}: ${d.total.toFixed(1)}h`}>
                    <div className="stack-bar">
                      {d.parts.map((part) => (
                        <span
                          key={part.key}
                          className="stack-seg"
                          style={{ height: `${(part.hours / stack.max) * 100}%`, background: part.color }}
                          title={`${part.name}: ${part.hours.toFixed(1)}h`}
                        />
                      ))}
                    </div>
                    <div className="stack-label">{d.label}</div>
                  </div>
                ))}
              </div>
              <div className="stack-legend">
                {stack.legend.map((l) => (
                  <span key={l.key} className="stack-legend-item">
                    <span className="stack-swatch" style={{ background: l.color }} />
                    {l.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="dcard">
          <h2 className="dcard-title">Status mix</h2>
          {mix.total === 0 ? (
            <p className="db-empty">No tasks yet.</p>
          ) : (
            <>
              <div className="mix-bar">
                {mix.rows.filter((m) => m.count > 0).map((m) => (
                  <span
                    key={m.id}
                    className="mix-seg"
                    style={{ width: `${(m.count / mix.total) * 100}%`, background: m.color }}
                    title={`${m.label}: ${m.count}`}
                  />
                ))}
              </div>
              <div className="mix-list">
                {mix.rows.map((m) => (
                  <div key={m.id} className="mix-row">
                    <span className="mix-dot" style={{ background: m.color }} />
                    <span className="mix-label">{m.label}</span>
                    <span className="mix-count">{m.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {/* ══ By project — planned against logged ═══════════════════════════ */}
      <section className="rtable">
        <div className="rtable-head">
          <h2 className="rtable-title">By project</h2>
          <span className="rtable-note">planned vs. logged</span>
        </div>
        <div className="rtable-cols">
          <span>Project</span><span>Planned</span><span>Logged</span>
          <span>Var.</span><span>Completion</span><span>Health</span>
        </div>
        {byProject.length === 0 ? (
          <p className="db-empty" style={{ padding: '24px 18px' }}>Nothing to compare yet.</p>
        ) : byProject.map((r, i) => (
          <div key={r.id} className={`rtable-row${i % 2 ? ' alt' : ''}`}>
            <span className="rtable-rail" style={{ background: r.color }} aria-hidden="true" />
            <span className="rtable-name">
              <span className="mix-dot" style={{ background: r.color }} />
              <span className="rtable-name-text">{r.name}</span>
            </span>
            <span className="rtable-num">{r.planned}</span>
            <span className="rtable-num strong">{r.logged}</span>
            <span className="rtable-cell">
              <span className={`vchip vchip-${r.varTone}`}>{r.varText}</span>
            </span>
            <span className="rtable-cell rtable-prog">
              <span className="rtable-track">
                <span className="rtable-fill" style={{ width: `${r.pct}%`, background: r.color }} />
              </span>
              <span className="rtable-pct">{r.pct}%</span>
            </span>
            <span className="rtable-cell">
              <span className={`ragchip ragchip-${r.rag.toLowerCase()}`} title={RAG_MEANING[r.rag]}>{r.ragLabel}</span>
            </span>
          </div>
        ))}
        {byProject.length > 0 && (
          <div className="rtable-totals">
            <span className="rtable-totals-label">Totals</span>
            <span><strong>{totals.estimate.toFixed(1)}h</strong> planned</span>
            <span><strong>{totals.logged.toFixed(1)}h</strong> logged</span>
            <span className={`tone-ink-${totals.state === 'over' ? 'red' : totals.state === 'under' ? 'green' : 'navy'}`}>
              <strong>{formatVariance(totals)}</strong>
              {totals.unestimated > 0 && (
                <span className="rtable-caveat"> · {totals.unestimated} not estimated</span>
              )}
            </span>
          </div>
        )}
      </section>

      <div className="review-2col">
        <section className="review-section">
          <h2 className="review-h2">Overdue tasks ({overdueTasks.length})</h2>
          {overdueTasks.length === 0 ? (
            <p className="muted small">Nothing overdue. ✨</p>
          ) : (
            <ul className="review-list">
              {overdueTasks.map((t) => {
                const proj = projectById[t.projectId];
                return (
                  <li key={t.id}>
                    {proj && <span className="proj-dot" style={{ background: proj.color }} />}
                    <span className="review-list-title">{t.title}</span>
                    <span className="muted small">due {t.plan?.endDate}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="review-section">
          <h2 className="review-h2">Completed in period ({tasksCompleted.length})</h2>
          {tasksCompleted.length === 0 ? (
            <p className="muted small">No tasks completed yet in this period.</p>
          ) : (
            <ul className="review-list">
              {tasksCompleted.map((t) => {
                const proj = projectById[t.projectId];
                const onTime = !t.plan?.endDate || t.actual?.endDate <= t.plan.endDate;
                return (
                  <li key={t.id}>
                    {proj && <span className="proj-dot" style={{ background: proj.color }} />}
                    <span className="review-list-title">{t.title}</span>
                    <span className={`badge badge-soft-${onTime ? 'success' : 'warn'}`}>
                      {onTime ? 'on time' : 'late'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="review-section">
        <h2 className="review-h2">Bottlenecks & remarks ({bottlenecks.length})</h2>
        {bottlenecks.length === 0 ? (
          <p className="muted small">No bottlenecks recorded. ✨</p>
        ) : (
          <ul className="review-bottlenecks">
            {bottlenecks.map((a) => (
              <li key={a.id}>
                <div className="bot-head">
                  <span className="mono small">{a.date}</span>
                  <span className="proj-tag">
                    <span className="proj-dot" style={{ background: projectById[a.projectId]?.color || '#a1a1aa' }} />
                    {projectById[a.projectId]?.name || a.taskCategory || 'Other'}
                  </span>
                  <strong className="small">{a.taskTitle}</strong>
                </div>
                <p className="bot-body">⚠ {a.bottleneckRemarks}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ReviewAiPanel
        activities={periodActivities}
        tasks={tasks}
        projects={projects}
      />
    </>
  );
}

function ReviewAiPanel({ activities, tasks, projects }) {
  const { userId } = useAuth();
  const { isOperator } = useIsOperator(userId);
  const { available: aiAvailable } = useAiStatus();
  const [busy, setBusy] = useState(null);
  const [output, setOutput] = useState('');
  const [audience, setAudience] = useState('a teammate');
  const [error, setError] = useState(null);
  const [copyOk, setCopyOk] = useState(false);

  if (!aiAvailable) {
    return (
      <section className="review-section">
        <h2 className="review-h2">✨ AI assist</h2>
        <p className="muted small">
          The AI feature is not available on your end. To enable, contact your
          company admin or reach out to{' '}
          <a className="table-link" href="mailto:hello@blueinnovation.ph">hello@blueinnovation.ph</a>.
        </p>
      </section>
    );
  }

  const run = async (kind) => {
    setBusy(kind);
    setError(null);
    setOutput('');
    try {
      let text = '';
      if (kind === 'summary') {
        text = await summarizeWeek({ activities, tasks, projects });
      } else if (kind === 'today') {
        text = await suggestNextTask({ tasks, projects, today: todayLocal() });
      } else if (kind === 'status') {
        text = await draftStatusUpdate({ activities, audience });
      }
      setOutput(text);
    } catch (err) {
      // One plain sentence on screen; the bridge address, the shell command and
      // the raw upstream body stay in the console (BUG-020).
      const { message, detail } = describeAiFailure(err, 'Could not write that just now. Try again in a moment.', { isOperator });
      console.error('[ai] draft-review failed:', detail);
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1500);
    } catch (err) { console.error(err); }
  };

  return (
    <section className="review-section">
      <h2 className="review-h2">✨ AI assist</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <button className="btn btn-sm" onClick={() => run('summary')} disabled={busy === 'summary'}>
          {busy === 'summary' ? 'Thinking…' : 'Summarize this period'}
        </button>
        <button className="btn btn-sm" onClick={() => run('today')} disabled={busy === 'today'}>
          {busy === 'today' ? 'Thinking…' : 'What should I tackle today?'}
        </button>
        <span style={{ width: 1, height: 16, background: 'var(--c-border)' }} />
        <span className="muted small">Status update for</span>
        <input
          className="input input-sm"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="e.g. Mark"
          style={{ width: 140 }}
        />
        <button className="btn btn-sm" onClick={() => run('status')} disabled={busy === 'status' || !audience.trim()}>
          {busy === 'status' ? 'Thinking…' : 'Draft update'}
        </button>
      </div>

      {error && (
        <div className="auth-error">
          <div className="auth-error-head"><span className="badge badge-soft-danger">AI error</span></div>
          <p className="auth-error-msg">{error}</p>
        </div>
      )}

      {output && (
        <div className="ai-output">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
            <button className="btn btn-sm" onClick={copy}>{copyOk ? '✓ Copied' : '⎘ Copy'}</button>
          </div>
          <div className="markdown-preview" style={{ background: 'var(--c-surface-2)', borderRadius: 6, padding: 12 }}>
            <Markdown src={output} />
          </div>
        </div>
      )}
    </section>
  );
}
