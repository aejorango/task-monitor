// src/components/ReviewView.jsx — weekly review with KPIs, charts, and lists.

import { useState, useMemo } from 'react';
import { useTasks, useProjects, useAllActivities } from '../hooks/useTasks';
import { todayLocal } from '../services/firebase';
import {
  summarizeWeek,
  suggestNextTask,
  draftStatusUpdate,
  getApiKey,
} from '../services/anthropic';
import Markdown from './Markdown';

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

  // Bottleneck remarks in the period
  const bottlenecks = periodActivities
    .filter((a) => a.bottleneckRemarks?.trim())
    .sort((a, b) => b.date.localeCompare(a.date));

  if (tasksLoading || activitiesLoading) return <p className="muted">Loading review…</p>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Review</h1>
          <p className="page-subtitle">Summary of your work in the selected period.</p>
        </div>
        <div className="page-actions">
          {RANGES.map((r) => (
            <button
              key={r.id}
              className={`chip ${rangeId === r.id ? 'active' : ''}`}
              onClick={() => setRangeId(r.id)}
            >{r.label}</button>
          ))}
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard label="Hours logged" value={totalHours.toFixed(1)} suffix="h" />
        <KpiCard label="Tasks completed" value={tasksCompleted.length} />
        <KpiCard label="Tasks created" value={tasksAdded.length} />
        <KpiCard label="Overdue" value={overdueTasks.length} accent={overdueTasks.length > 0 ? 'danger' : 'muted'} />
        <KpiCard label="Activities logged" value={periodActivities.length} />
        <KpiCard label="Completed entries" value={completedActivities} accent="success" />
        <KpiCard label="Blocked entries" value={blockedActivities} accent={blockedActivities > 0 ? 'warn' : 'muted'} />
      </div>

      <section className="review-section">
        <h2 className="review-h2">Hours by project</h2>
        {hoursByProject.length === 0 ? (
          <p className="muted small">No activities in this period.</p>
        ) : (
          <div className="bar-list">
            {hoursByProject.map((p) => (
              <div key={p.name} className="bar-row">
                <div className="bar-row-label">
                  <span className="proj-dot" style={{ background: p.color }} />
                  <span>{p.name}</span>
                </div>
                <div className="bar-row-track">
                  <div
                    className="bar-row-fill"
                    style={{ width: `${(p.hours / maxHours) * 100}%`, background: p.color }}
                  />
                </div>
                <div className="bar-row-value">{p.hours.toFixed(1)}h</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="review-section">
        <h2 className="review-h2">Daily hours</h2>
        <div className="day-strip">
          {hoursByDay.map(({ date, hours }) => {
            const dayName = new Date(`${date}T00:00:00`).toLocaleDateString('en', { weekday: 'short' });
            const dayNum  = new Date(`${date}T00:00:00`).getDate();
            const isToday = date === today;
            return (
              <div key={date} className={`day-cell ${isToday ? 'today' : ''}`}>
                <div className="day-bar-wrap" title={`${date}: ${hours.toFixed(1)}h`}>
                  <div
                    className="day-bar-fill"
                    style={{ height: `${(hours / maxDayHours) * 100}%` }}
                  />
                </div>
                <div className="day-label">{dayName}</div>
                <div className="day-num">{dayNum}</div>
                <div className="day-hours">{hours > 0 ? hours.toFixed(1) : '·'}</div>
              </div>
            );
          })}
        </div>
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

function KpiCard({ label, value, suffix, accent }) {
  return (
    <div className={`kpi-card kpi-${accent || 'default'}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}{suffix && <span className="kpi-suffix">{suffix}</span>}</div>
    </div>
  );
}

function ReviewAiPanel({ activities, tasks, projects }) {
  const apiKey = getApiKey();
  const [busy, setBusy] = useState(null);
  const [output, setOutput] = useState('');
  const [audience, setAudience] = useState('a teammate');
  const [error, setError] = useState(null);
  const [copyOk, setCopyOk] = useState(false);

  if (!apiKey) {
    return (
      <section className="review-section">
        <h2 className="review-h2">✨ AI assist</h2>
        <p className="muted small">
          Set your Anthropic API key in <strong>Settings → AI</strong> to enable:
          summarize this period, suggest what to tackle today, or draft a status
          update for a teammate.
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
      console.error(err);
      setError(err.message || String(err));
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
