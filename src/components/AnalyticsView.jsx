// src/components/AnalyticsView.jsx — burndown, velocity, cumulative flow,
// workload, and Member analytics (age, continent, industry, profession,
// gender, tenure) with AI insights. All charts are SVG/CSS, no library.
//
// Cumulative flow: stacked area of task counts by status across time.
// Burndown:        remaining open tasks per day within a window.
// Velocity:        tasks completed per ISO-week.
// Workload:        planned hours per project per week (stacked bars).
// Members:         org-wide demographic breakdowns + AI strategic insights.

import { useState, useMemo, useEffect } from 'react';
import { useTasks, useProjects, useAllActivities } from '../hooks/useTasks';
import { todayLocal, subscribeToApprovedUsers, subscribeToAllUsers } from '../services/firebase';
import {
  continentOf, countryName, CONTINENT_COLORS, CONTINENTS,
  tzOffsetMinutes, formatTzBucket,
} from '../services/countries';
import { generateMemberInsights, getApiKey } from '../services/anthropic';
import { useUserProfile } from '../hooks/useUserProfile';
import { useAuth } from '../hooks/useTasks';
import Markdown from './Markdown';
import Icon from './Icon';

const RANGES = [
  { id: '14', label: '14 days', days: 14 },
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
];

function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseISO(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function isoWeekKey(d) {
  // YYYY-Wnn (ISO week). Good enough for grouping.
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = (date - firstThursday) / 86400000;
  const wk = 1 + Math.floor(diff / 7);
  return `${date.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

export default function AnalyticsView({ projectFilter }) {
  const { tasks, loading: tasksLoading } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const [rangeId, setRangeId] = useState('30');
  const range = RANGES.find((r) => r.id === rangeId);

  // Build the date series for the window.
  const todayStr = todayLocal();
  const today    = parseISO(todayStr);
  const dates    = useMemo(() => {
    const arr = [];
    for (let i = range.days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      arr.push(isoOf(d));
    }
    return arr;
  }, [range.days, todayStr]);

  const filtered = projectFilter === 'all'
    ? tasks
    : tasks.filter((t) => t.projectId === projectFilter);

  // Helper: status of a task as of a given date (best approximation from
  // createdAt + actual.startDate + actual.endDate).
  const statusOn = (task, dateStr) => {
    const created = task.createdAt?.toDate?.() ? isoOf(task.createdAt.toDate()) : null;
    if (created && dateStr < created) return null;  // task didn't exist yet
    if (task.actual?.endDate && dateStr >= task.actual.endDate) return 'done';
    if (task.actual?.startDate && dateStr >= task.actual.startDate) return 'doing';
    return 'todo';
  };

  // Cumulative-flow + burndown data.
  const cflow = useMemo(() => {
    return dates.map((d) => {
      let todoCount = 0, doingCount = 0, doneCount = 0;
      filtered.forEach((t) => {
        const s = statusOn(t, d);
        if (s === 'todo')  todoCount++;
        else if (s === 'doing') doingCount++;
        else if (s === 'done')  doneCount++;
      });
      return { date: d, todo: todoCount, doing: doingCount, done: doneCount };
    });
  }, [dates, filtered]);

  const maxStack = Math.max(1, ...cflow.map((c) => c.todo + c.doing + c.done));

  // Velocity: tasks completed per ISO-week within the window.
  const velocityByWeek = useMemo(() => {
    const m = {};
    filtered.forEach((t) => {
      if (!t.actual?.endDate) return;
      const d = parseISO(t.actual.endDate);
      if (!d) return;
      if (isoOf(d) < dates[0] || isoOf(d) > dates[dates.length - 1]) return;
      const key = isoWeekKey(d);
      m[key] = (m[key] || 0) + 1;
    });
    // Build ordered list of weeks present in the window
    const seen = new Set();
    const order = [];
    dates.forEach((ds) => {
      const k = isoWeekKey(parseISO(ds));
      if (!seen.has(k)) { seen.add(k); order.push(k); }
    });
    return order.map((k) => ({ week: k, count: m[k] || 0 }));
  }, [filtered, dates]);
  const maxVelocity = Math.max(1, ...velocityByWeek.map((v) => v.count));

  // Workload: planned hours per project per week (stacked bars).
  // We approximate task duration as (planEnd - planStart + 1) days × 1h
  // unless task already has a totalHoursLogged > 0 (use that instead).
  // Allocation: spread the hours evenly across days the task spans, then
  // bucket by ISO-week.
  const workload = useMemo(() => {
    const byWeek = {};   // { weekKey: { projectId: hours } }
    const projHits = {}; // project name set for legend

    filtered.forEach((t) => {
      const planStart = parseISO(t.plan?.startDate);
      const planEnd   = parseISO(t.plan?.endDate);
      if (!planStart || !planEnd) return;
      const totalDays = Math.max(1, Math.round((planEnd - planStart) / 86400000) + 1);
      const totalHours = Math.max(1, t.totalHoursLogged || 1);  // floor at 1h
      const perDay = totalHours / totalDays;
      const proj = projectById[t.projectId];
      const name = proj?.name || t.category || 'Other';
      const color = proj?.color || '#a1a1aa';
      projHits[name] = color;

      for (let i = 0; i < totalDays; i++) {
        const d = new Date(planStart);
        d.setDate(d.getDate() + i);
        const ds = isoOf(d);
        if (ds < dates[0] || ds > dates[dates.length - 1]) continue;
        const wk = isoWeekKey(d);
        byWeek[wk] = byWeek[wk] || {};
        byWeek[wk][name] = (byWeek[wk][name] || 0) + perDay;
      }
    });

    // Build weeks in order
    const seen = new Set();
    const order = [];
    dates.forEach((ds) => {
      const k = isoWeekKey(parseISO(ds));
      if (!seen.has(k)) { seen.add(k); order.push(k); }
    });

    const projectNames = Object.keys(projHits);
    const rows = order.map((wk) => ({
      week: wk,
      total: projectNames.reduce((s, n) => s + (byWeek[wk]?.[n] || 0), 0),
      byProject: projectNames.map((n) => ({
        name: n, color: projHits[n], hours: byWeek[wk]?.[n] || 0,
      })),
    }));
    const maxHours = Math.max(1, ...rows.map((r) => r.total));
    return { rows, projectNames, projColor: projHits, maxHours };
  }, [filtered, dates, projectById]);

  if (tasksLoading) return <p className="muted">Loading analytics…</p>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">
            Burndown, velocity, cumulative flow, and workload.
            {projectFilter !== 'all' && projectById[projectFilter] && (
              <> Filtered to <strong>{projectById[projectFilter].name}</strong>.</>
            )}
          </p>
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

      {/* Burndown */}
      <section className="review-section">
        <h2 className="review-h2">Burndown — open tasks remaining</h2>
        <BurndownChart cflow={cflow} />
      </section>

      {/* Cumulative flow */}
      <section className="review-section">
        <h2 className="review-h2">Cumulative flow</h2>
        <CumulativeFlow cflow={cflow} maxStack={maxStack} />
        <div className="chart-legend">
          <span><span className="legend-swatch" style={{ background: 'var(--c-todo)' }} /> To do</span>
          <span><span className="legend-swatch" style={{ background: 'var(--c-doing)' }} /> Doing</span>
          <span><span className="legend-swatch" style={{ background: 'var(--c-done)' }} /> Done</span>
        </div>
      </section>

      {/* Velocity */}
      <section className="review-section">
        <h2 className="review-h2">Velocity — tasks done per week</h2>
        <VelocityChart velocity={velocityByWeek} maxVelocity={maxVelocity} />
      </section>

      {/* Workload */}
      <section className="review-section">
        <h2 className="review-h2">Workload — planned hours per week</h2>
        <WorkloadChart workload={workload} />
        {workload.projectNames.length > 0 && (
          <div className="chart-legend">
            {workload.projectNames.map((n) => (
              <span key={n}>
                <span className="legend-swatch" style={{ background: workload.projColor[n] }} /> {n}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Member analytics — demographic breakdowns + AI insights */}
      <MemberAnalyticsSection />
    </>
  );
}

// ─── Charts ──────────────────────────────────────────────────────────────

function CumulativeFlow({ cflow, maxStack }) {
  const w = 720, h = 200, pad = 24;
  const innerW = w - pad * 2, innerH = h - pad * 2;
  const stepX = innerW / Math.max(1, cflow.length - 1);
  // We build three area paths: done (bottom), doing (mid), todo (top).
  const ys = cflow.map((c) => ({
    done:  c.done,
    doing: c.done + c.doing,
    todo:  c.done + c.doing + c.todo,
  }));
  const yScale = (v) => innerH - (v / maxStack) * innerH;
  const pathFromTop = (key) => {
    const top  = cflow.map((_, i) => `${pad + i * stepX},${pad + yScale(ys[i][key])}`);
    return `M${top.join(' L')} L${pad + innerW},${pad + innerH} L${pad},${pad + innerH} Z`;
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="200" preserveAspectRatio="none" style={{ display: 'block' }}>
      <path d={pathFromTop('todo')}  fill="var(--c-todo)"  opacity="0.55" />
      <path d={pathFromTop('doing')} fill="var(--c-doing)" opacity="0.85" />
      <path d={pathFromTop('done')}  fill="var(--c-done)" />
      <rect x={pad} y={pad} width={innerW} height={innerH} fill="none" stroke="var(--c-border)" />
    </svg>
  );
}

function BurndownChart({ cflow }) {
  const w = 720, h = 180, pad = 24;
  const innerW = w - pad * 2, innerH = h - pad * 2;
  const open = cflow.map((c) => c.todo + c.doing);
  const max = Math.max(1, ...open);
  const stepX = innerW / Math.max(1, cflow.length - 1);
  const points = open.map((o, i) => `${pad + i * stepX},${pad + innerH - (o / max) * innerH}`).join(' ');
  // Ideal burndown reference line from start → end
  const startV = open[0] || 0;
  const idealStart = `${pad},${pad + innerH - (startV / max) * innerH}`;
  const idealEnd   = `${pad + innerW},${pad + innerH}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="180" preserveAspectRatio="none" style={{ display: 'block' }}>
      <rect x={pad} y={pad} width={innerW} height={innerH} fill="none" stroke="var(--c-border)" />
      <polyline points={`${idealStart} ${idealEnd}`} fill="none" stroke="var(--c-text-3)" strokeDasharray="3 3" />
      <polyline points={points} fill="none" stroke="var(--c-accent)" strokeWidth="2" />
    </svg>
  );
}

function VelocityChart({ velocity, maxVelocity }) {
  if (velocity.length === 0) {
    return <p className="muted small">No completed tasks in this window.</p>;
  }
  const barW = 100 / velocity.length;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', height: 160, gap: 2, padding: '4px 0' }}>
      {velocity.map((v) => (
        <div key={v.week} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="muted small mono" style={{ marginBottom: 4 }}>{v.count}</div>
          <div
            style={{
              width: '70%',
              height: `${(v.count / maxVelocity) * 100}%`,
              background: 'var(--c-done)',
              borderRadius: 3,
              minHeight: v.count > 0 ? 2 : 0,
            }}
            title={`${v.week}: ${v.count} done`}
          />
          <div className="muted small mono" style={{ marginTop: 4, fontSize: 10 }}>
            {v.week.slice(5)}
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkloadChart({ workload }) {
  const { rows, maxHours } = workload;
  if (rows.length === 0) {
    return <p className="muted small">No tasks with plan dates in this window.</p>;
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', height: 180, gap: 2 }}>
      {rows.map((r) => {
        const totalH = (r.total / maxHours) * 100;
        return (
          <div key={r.week} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div className="muted small mono" style={{ marginBottom: 4 }}>{r.total.toFixed(0)}h</div>
            <div
              style={{
                width: '70%',
                height: `${totalH}%`,
                display: 'flex',
                flexDirection: 'column-reverse',
                borderRadius: 3,
                overflow: 'hidden',
                minHeight: r.total > 0 ? 4 : 0,
              }}
              title={r.byProject.map((p) => `${p.name}: ${p.hours.toFixed(1)}h`).join('\n')}
            >
              {r.byProject.map((p) => (
                p.hours > 0 ? (
                  <div key={p.name} style={{
                    background: p.color,
                    height: `${(p.hours / r.total) * 100}%`,
                  }} />
                ) : null
              ))}
            </div>
            <div className="muted small mono" style={{ marginTop: 4, fontSize: 10 }}>
              {r.week.slice(5)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Member analytics ───────────────────────────────────────────────────────

const AGE_BUCKETS = [
  { id: 'under-18', label: 'Under 18',  min: 0,   max: 17 },
  { id: '18-24',    label: '18 – 24',   min: 18,  max: 24 },
  { id: '25-34',    label: '25 – 34',   min: 25,  max: 34 },
  { id: '35-44',    label: '35 – 44',   min: 35,  max: 44 },
  { id: '45-54',    label: '45 – 54',   min: 45,  max: 54 },
  { id: '55-64',    label: '55 – 64',   min: 55,  max: 64 },
  { id: '65+',      label: '65+',       min: 65,  max: 200 },
  { id: 'unknown',  label: 'Undisclosed', min: null, max: null },
];

const AGE_BAR_COLOR = '#6366f1';
const INDUSTRY_BAR_COLOR = '#10b981';
const PROFESSION_BAR_COLOR = '#f59e0b';
const GENDER_COLORS = {
  female: '#ec4899',
  male: '#3b82f6',
  'non-binary': '#a855f7',
  other: '#64748b',
  undisclosed: '#94a3b8',
};

function ageFromBirthdate(birthdate) {
  if (!birthdate) return null;
  const [y, m, d] = String(birthdate).split('-').map(Number);
  if (!y || !m || !d) return null;
  const today = new Date();
  let age = today.getFullYear() - y;
  const mDiff = today.getMonth() + 1 - m;
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < d)) age--;
  return age >= 0 && age < 130 ? age : null;
}

function bucketForAge(age) {
  if (age == null) return 'unknown';
  for (const b of AGE_BUCKETS) {
    if (b.min == null) continue;
    if (age >= b.min && age <= b.max) return b.id;
  }
  return 'unknown';
}

// Generic horizontal bar chart, takes rows: [{ label, value, color?, sub? }]
function HorizontalBarChart({ rows, color = AGE_BAR_COLOR, total, formatValue, labelWidth = 130 }) {
  if (!rows.length) return <p className="muted small">No data yet.</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbar-chart">
      {rows.map((r) => {
        const pct = (r.value / max) * 100;
        const pctOfTotal = total ? Math.round((r.value / total) * 100) : null;
        return (
          <div key={r.label} className="hbar-row">
            <div className="hbar-label" style={{ width: labelWidth }} title={r.label}>{r.label}</div>
            <div className="hbar-track">
              <div
                className="hbar-fill"
                style={{ width: `${pct}%`, background: r.color || color }}
                title={`${r.label}: ${r.value}${pctOfTotal != null ? ` (${pctOfTotal}%)` : ''}`}
              />
              <span className="hbar-value">
                {formatValue ? formatValue(r.value) : r.value}
                {pctOfTotal != null && r.value > 0 && (
                  <span className="muted small" style={{ marginLeft: 6 }}>({pctOfTotal}%)</span>
                )}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MemberAnalyticsSection() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [permError, setPermError] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const { activities } = useAllActivities();
  const { userId } = useAuth();
  const { profile } = useUserProfile(userId);
  const isSuperadmin = profile?.role === 'superadmin' && profile?.status === 'approved';

  useEffect(() => {
    setLoading(true);
    let cleared = false;
    const unsub = subscribeToApprovedUsers((list) => {
      if (cleared) return;
      setMembers(list);
      setLoading(false);
      setPermError(list.length === 0 ? false : false);
    });
    return () => { cleared = true; unsub?.(); };
  }, []);

  // Superadmin-only: subscribe to the full user list so we can show the
  // pending/approved/rejected funnel.
  useEffect(() => {
    if (!isSuperadmin) return;
    const unsub = subscribeToAllUsers((list) => setAllUsers(list));
    return () => unsub?.();
  }, [isSuperadmin]);

  // ── Aggregate demographics
  const stats = useMemo(() => {
    const totalMembers = members.length;

    // Age buckets
    const ageBucketCounts = Object.fromEntries(AGE_BUCKETS.map((b) => [b.id, 0]));
    const ages = [];
    members.forEach((m) => {
      const age = ageFromBirthdate(m.birthdate);
      if (age != null) ages.push(age);
      ageBucketCounts[bucketForAge(age)]++;
    });
    const avgAge = ages.length
      ? Math.round((ages.reduce((s, n) => s + n, 0) / ages.length) * 10) / 10
      : null;
    const minAge = ages.length ? Math.min(...ages) : null;
    const maxAge = ages.length ? Math.max(...ages) : null;
    const ageRows = AGE_BUCKETS.map((b) => ({
      label: b.label,
      value: ageBucketCounts[b.id],
    }));

    // Continents
    const continentCounts = {};
    const countryCounts = {};
    members.forEach((m) => {
      const cont = continentOf(m.country);
      continentCounts[cont] = (continentCounts[cont] || 0) + 1;
      if (m.country) {
        const nm = countryName(m.country);
        countryCounts[nm] = (countryCounts[nm] || 0) + 1;
      }
    });
    const continentRows = [...CONTINENTS, 'Unknown']
      .map((c) => ({
        label: c,
        value: continentCounts[c] || 0,
        color: CONTINENT_COLORS[c] || CONTINENT_COLORS.Unknown,
      }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);

    const countryRows = Object.entries(countryCounts)
      .map(([name, value]) => ({ label: name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);

    // Industry
    const industryCounts = {};
    members.forEach((m) => {
      const v = (m.industry || '').trim();
      if (!v) return;
      const k = v.toLowerCase();
      industryCounts[k] = industryCounts[k] || { label: v, value: 0 };
      industryCounts[k].value++;
    });
    const industryRows = Object.values(industryCounts)
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);

    // Profession
    const professionCounts = {};
    members.forEach((m) => {
      const v = (m.profession || '').trim();
      if (!v) return;
      const k = v.toLowerCase();
      professionCounts[k] = professionCounts[k] || { label: v, value: 0 };
      professionCounts[k].value++;
    });
    const professionRows = Object.values(professionCounts)
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);

    // Gender
    const genderCounts = {};
    members.forEach((m) => {
      const g = (m.gender || 'undisclosed').toLowerCase();
      genderCounts[g] = (genderCounts[g] || 0) + 1;
    });
    const genderRows = Object.entries(genderCounts)
      .map(([k, v]) => ({
        label: k.replace(/^./, (c) => c.toUpperCase()),
        value: v,
        color: GENDER_COLORS[k] || GENDER_COLORS.undisclosed,
      }))
      .sort((a, b) => b.value - a.value);

    // Tenure (months since createdAt) — bucketed
    const tenureBuckets = {
      '< 3 mo': 0,
      '3 – 6 mo': 0,
      '6 – 12 mo': 0,
      '1 – 2 yr': 0,
      '2+ yr': 0,
      'Unknown': 0,
    };
    members.forEach((m) => {
      const d = m.createdAt?.toDate?.();
      if (!d) { tenureBuckets['Unknown']++; return; }
      const months = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
      if      (months < 3)   tenureBuckets['< 3 mo']++;
      else if (months < 6)   tenureBuckets['3 – 6 mo']++;
      else if (months < 12)  tenureBuckets['6 – 12 mo']++;
      else if (months < 24)  tenureBuckets['1 – 2 yr']++;
      else                   tenureBuckets['2+ yr']++;
    });
    const tenureRows = Object.entries(tenureBuckets)
      .map(([label, value]) => ({ label, value }));

    // Profile completeness
    const profileFields = ['birthdate', 'country', 'profession', 'industry'];
    const completeness = members.length === 0 ? 0 : Math.round(
      (members.reduce((s, m) => s + profileFields.filter((f) => !!m[f]).length, 0) /
        (members.length * profileFields.length)) * 100
    );

    // Timezone clustering (derived from country)
    const tzCounts = {};
    members.forEach((m) => {
      const off = tzOffsetMinutes(m.country);
      const k = off == null ? 'Unknown' : String(off);
      tzCounts[k] = (tzCounts[k] || 0) + 1;
    });
    const tzRows = Object.entries(tzCounts)
      .map(([k, v]) => ({
        label: k === 'Unknown' ? 'Unknown' : formatTzBucket(Number(k)),
        offset: k === 'Unknown' ? null : Number(k),
        value: v,
      }))
      .sort((a, b) => (a.offset == null ? 1 : b.offset == null ? -1 : a.offset - b.offset));

    // Monthly member growth — joins per month, last 12 months
    const monthsBack = 12;
    const now = new Date();
    const monthBuckets = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthBuckets.push({
        key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en', { month: 'short', year: '2-digit' }),
        count: 0,
        cumulative: 0,
      });
    }
    const bucketByKey = Object.fromEntries(monthBuckets.map((b) => [b.key, b]));
    members.forEach((m) => {
      const d = m.createdAt?.toDate?.();
      if (!d) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const b = bucketByKey[key];
      if (b) b.count++;
    });
    // Cumulative: start from (totalMembers - sum of recent months)
    const recentTotal = monthBuckets.reduce((s, b) => s + b.count, 0);
    let running = members.length - recentTotal;
    monthBuckets.forEach((b) => { running += b.count; b.cumulative = running; });

    // Active vs dormant (using current-workspace activities — meaningful enough)
    const memberIds = new Set(members.map((m) => m.id));
    const cutoff30 = new Date(); cutoff30.setDate(cutoff30.getDate() - 30);
    const cutoff60 = new Date(); cutoff60.setDate(cutoff60.getDate() - 60);
    const cutoff90 = new Date(); cutoff90.setDate(cutoff90.getDate() - 90);
    const lastActivityByUser = {};
    activities.forEach((a) => {
      if (!a.userId || !memberIds.has(a.userId)) return;
      const ts = a.loggedAt?.toDate?.() || (a.date ? new Date(`${a.date}T00:00:00`) : null);
      if (!ts) return;
      if (!lastActivityByUser[a.userId] || ts > lastActivityByUser[a.userId]) {
        lastActivityByUser[a.userId] = ts;
      }
    });
    let active30 = 0, active60 = 0, active90 = 0, dormant = 0, never = 0;
    members.forEach((m) => {
      const last = lastActivityByUser[m.id];
      if (!last) { never++; return; }
      if (last >= cutoff30) active30++;
      else if (last >= cutoff60) active60++;
      else if (last >= cutoff90) active90++;
      else dormant++;
    });
    const activityRows = [
      { label: 'Active (≤ 30 d)',  value: active30, color: '#10b981' },
      { label: 'Active (31–60 d)', value: active60, color: '#84cc16' },
      { label: 'Active (61–90 d)', value: active90, color: '#f59e0b' },
      { label: 'Dormant (90+ d)',  value: dormant,  color: '#ef4444' },
      { label: 'No activity yet',  value: never,    color: '#94a3b8' },
    ];

    // Top contributors — sum hoursSpent per user, last 30 days
    const hoursByUser30 = {};
    activities.forEach((a) => {
      if (!a.userId) return;
      const ts = a.loggedAt?.toDate?.() || (a.date ? new Date(`${a.date}T00:00:00`) : null);
      if (!ts || ts < cutoff30) return;
      hoursByUser30[a.userId] = (hoursByUser30[a.userId] || 0) + (a.hoursSpent || 0);
    });
    const userById = Object.fromEntries(members.map((m) => [m.id, m]));
    const topContributorRows = Object.entries(hoursByUser30)
      .filter(([id]) => userById[id])
      .map(([id, hours]) => ({
        label: userById[id].displayName || userById[id].email || id.slice(0, 6),
        value: Math.round(hours * 10) / 10,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    // Seniority pyramid — bucketed by yearsOfExperience
    const seniorityBuckets = [
      { id: 'junior',  label: 'Junior (0–2 yr)',  min: 0,  max: 2  },
      { id: 'mid',     label: 'Mid (3–5 yr)',     min: 3,  max: 5  },
      { id: 'senior',  label: 'Senior (6–10 yr)', min: 6,  max: 10 },
      { id: 'lead',    label: 'Lead (11–15 yr)',  min: 11, max: 15 },
      { id: 'expert',  label: 'Expert (16+ yr)',  min: 16, max: 200 },
      { id: 'unknown', label: 'Undisclosed',      min: null, max: null },
    ];
    const seniorityCounts = Object.fromEntries(seniorityBuckets.map((b) => [b.id, 0]));
    members.forEach((m) => {
      const yoe = typeof m.yearsOfExperience === 'number' ? m.yearsOfExperience : null;
      if (yoe == null) { seniorityCounts.unknown++; return; }
      const b = seniorityBuckets.find((x) => x.min != null && yoe >= x.min && yoe <= x.max);
      if (b) seniorityCounts[b.id]++; else seniorityCounts.unknown++;
    });
    const seniorityRows = seniorityBuckets.map((b) => ({
      label: b.label,
      value: seniorityCounts[b.id],
    }));

    // Skill coverage — flatten skills[]
    const skillCounts = {};
    members.forEach((m) => {
      (m.skills || []).forEach((s) => {
        const k = String(s).toLowerCase();
        skillCounts[k] = skillCounts[k] || { label: s, value: 0, members: 0 };
        skillCounts[k].members++;
        skillCounts[k].value = skillCounts[k].members;
      });
    });
    const skillRows = Object.values(skillCounts)
      .sort((a, b) => b.value - a.value)
      .slice(0, 15);
    // Skills only one person knows = single point of failure
    const sopfSkills = Object.values(skillCounts).filter((s) => s.value === 1);

    // Languages spoken
    const languageCounts = {};
    members.forEach((m) => {
      (m.languages || []).forEach((l) => {
        const k = String(l).toLowerCase();
        languageCounts[k] = languageCounts[k] || { label: l, value: 0 };
        languageCounts[k].value++;
      });
    });
    const languageRows = Object.values(languageCounts)
      .sort((a, b) => b.value - a.value);

    // Profession × Continent cross-tab (matrix)
    const topProfessions = professionRows.slice(0, 6).map((r) => r.label);
    const topContinents = continentRows.filter((r) => r.label !== 'Unknown').map((r) => r.label);
    const crossTab = topProfessions.map((prof) => ({
      profession: prof,
      cells: topContinents.map((cont) => {
        const count = members.filter((m) =>
          (m.profession || '').toLowerCase() === prof.toLowerCase()
          && continentOf(m.country) === cont
        ).length;
        return { continent: cont, count };
      }),
    }));
    const crossTabMax = Math.max(1, ...crossTab.flatMap((r) => r.cells.map((c) => c.count)));

    return {
      totalMembers,
      ages, avgAge, minAge, maxAge,
      ageRows,
      continentRows, countryRows,
      industryRows, professionRows,
      genderRows,
      tenureRows,
      completeness,
      tzRows,
      monthlyGrowth: monthBuckets,
      activityRows, dormant, never, active30,
      topContributorRows,
      seniorityRows, sopfSkillsCount: sopfSkills.length,
      skillRows, totalSkills: Object.keys(skillCounts).length,
      languageRows,
      crossTab, crossTabMax, topProfessions, topContinents,
    };
  }, [members, activities]);

  // Status funnel (superadmin only — needs allUsers)
  const statusFunnel = useMemo(() => {
    if (!isSuperadmin) return null;
    const counts = { pending: 0, approved: 0, rejected: 0 };
    allUsers.forEach((u) => { if (counts[u.status] != null) counts[u.status]++; });
    return [
      { label: 'Pending',  value: counts.pending,  color: '#f59e0b' },
      { label: 'Approved', value: counts.approved, color: '#10b981' },
      { label: 'Rejected', value: counts.rejected, color: '#ef4444' },
    ];
  }, [allUsers, isSuperadmin]);

  if (loading) {
    return (
      <section className="review-section">
        <h2 className="review-h2">Member analytics</h2>
        <p className="muted small">Loading member data…</p>
      </section>
    );
  }

  if (permError || members.length === 0) {
    return (
      <section className="review-section">
        <h2 className="review-h2">Member analytics</h2>
        <p className="muted small">
          No approved members found yet — or you don't have permission to read
          member profiles. Once members fill in their profile in Settings, their
          age, country, industry, and profession will appear here.
        </p>
      </section>
    );
  }

  return (
    <>
      <div className="page-header" style={{ marginTop: 32 }}>
        <div>
          <h1 className="page-title">Member analytics</h1>
          <p className="page-subtitle">
            Demographic and skill breakdowns across all approved members of the
            organisation. {' '}
            <strong>{stats.totalMembers}</strong> approved member{stats.totalMembers === 1 ? '' : 's'}.
            {' '}Profile data completeness: <strong>{stats.completeness}%</strong>.
          </p>
        </div>
      </div>

      <div className="dash-kpi-grid" style={{ marginBottom: 16 }}>
        <KpiCard label="Members"       value={stats.totalMembers} />
        <KpiCard label="Average age"   value={stats.avgAge != null ? stats.avgAge : '—'} suffix={stats.avgAge != null ? ' yrs' : ''} />
        <KpiCard label="Age range"     value={stats.minAge != null && stats.maxAge != null ? `${stats.minAge}–${stats.maxAge}` : '—'} />
        <KpiCard label="Continents"    value={stats.continentRows.filter((r) => r.label !== 'Unknown').length} />
        <KpiCard label="Industries"    value={stats.industryRows.length} />
      </div>

      <div className="analytics-grid">
        <section className="review-section">
          <h2 className="review-h2">Age distribution</h2>
          <p className="muted small" style={{ marginTop: -8 }}>
            Computed from birthdate vs today. Members without a birthdate are grouped as "Undisclosed".
          </p>
          <HorizontalBarChart
            rows={stats.ageRows}
            color={AGE_BAR_COLOR}
            total={stats.totalMembers}
          />
        </section>

        <section className="review-section">
          <h2 className="review-h2">Members per continent</h2>
          <p className="muted small" style={{ marginTop: -8 }}>
            Where the team is in the world. Colors are continent-specific.
          </p>
          <HorizontalBarChart
            rows={stats.continentRows}
            total={stats.totalMembers}
          />
          {stats.countryRows.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="muted small" style={{ cursor: 'pointer' }}>
                Show top countries ({stats.countryRows.length})
              </summary>
              <div style={{ marginTop: 8 }}>
                <HorizontalBarChart
                  rows={stats.countryRows}
                  total={stats.totalMembers}
                  color="#0ea5e9"
                />
              </div>
            </details>
          )}
        </section>

        <section className="review-section">
          <h2 className="review-h2">Industries represented</h2>
          {stats.industryRows.length === 0 ? (
            <p className="muted small">No members have filled in their industry yet.</p>
          ) : (
            <HorizontalBarChart
              rows={stats.industryRows}
              color={INDUSTRY_BAR_COLOR}
              total={stats.totalMembers}
            />
          )}
        </section>

        <section className="review-section">
          <h2 className="review-h2">Professions represented</h2>
          {stats.professionRows.length === 0 ? (
            <p className="muted small">No members have filled in their profession yet.</p>
          ) : (
            <HorizontalBarChart
              rows={stats.professionRows}
              color={PROFESSION_BAR_COLOR}
              total={stats.totalMembers}
            />
          )}
        </section>

        <section className="review-section">
          <h2 className="review-h2">Gender breakdown</h2>
          <HorizontalBarChart
            rows={stats.genderRows}
            total={stats.totalMembers}
          />
        </section>

        <section className="review-section">
          <h2 className="review-h2">Tenure in the organisation</h2>
          <p className="muted small" style={{ marginTop: -8 }}>
            Time since the member's first approved sign-in.
          </p>
          <HorizontalBarChart
            rows={stats.tenureRows}
            color="#8b5cf6"
            total={stats.totalMembers}
          />
        </section>

        <section className="review-section">
          <h2 className="review-h2">Timezone clustering</h2>
          <p className="muted small" style={{ marginTop: -8 }}>
            Derived from each member's country. Useful for picking sync windows.
          </p>
          <HorizontalBarChart
            rows={stats.tzRows}
            color="#0ea5e9"
            total={stats.totalMembers}
          />
        </section>

        <section className="review-section">
          <h2 className="review-h2">Seniority pyramid</h2>
          <p className="muted small" style={{ marginTop: -8 }}>
            Bucketed by years of professional experience.
          </p>
          <HorizontalBarChart
            rows={stats.seniorityRows}
            color="#7c3aed"
            total={stats.totalMembers}
          />
        </section>

        <section className="review-section">
          <h2 className="review-h2">Languages spoken</h2>
          {stats.languageRows.length === 0 ? (
            <p className="muted small">No members have filled in languages yet.</p>
          ) : (
            <HorizontalBarChart
              rows={stats.languageRows}
              color="#14b8a6"
              total={stats.totalMembers}
            />
          )}
        </section>

        <section className="review-section">
          <h2 className="review-h2">Activity status</h2>
          <p className="muted small" style={{ marginTop: -8 }}>
            Based on the latest activity each member logged in this workspace.
          </p>
          <HorizontalBarChart
            rows={stats.activityRows}
            total={stats.totalMembers}
          />
        </section>
      </div>

      {/* Wider charts that look better full-bleed */}
      <section className="review-section">
        <h2 className="review-h2">Monthly member growth — last 12 months</h2>
        <p className="muted small" style={{ marginTop: -8 }}>
          New approvals per month and running total of approved members.
        </p>
        <GrowthChart data={stats.monthlyGrowth} totalMembers={stats.totalMembers} />
      </section>

      <section className="review-section">
        <h2 className="review-h2">Skill coverage</h2>
        <p className="muted small" style={{ marginTop: -8 }}>
          {stats.totalSkills} unique skills tagged across the team.
          {stats.sopfSkillsCount > 0 && (
            <> <strong style={{ color: 'var(--c-warn)' }}>{stats.sopfSkillsCount}</strong> skill{stats.sopfSkillsCount === 1 ? ' is' : 's are'} held by only one person (single-point-of-failure risk).</>
          )}
        </p>
        {stats.skillRows.length === 0 ? (
          <p className="muted small">No members have filled in skills yet.</p>
        ) : (
          <HorizontalBarChart
            rows={stats.skillRows}
            color="#f97316"
            total={stats.totalMembers}
            labelWidth={160}
          />
        )}
      </section>

      {stats.topContributorRows.length > 0 && (
        <section className="review-section">
          <h2 className="review-h2">Top contributors — hours logged (last 30 days)</h2>
          <p className="muted small" style={{ marginTop: -8 }}>
            Activity in the current workspace.
          </p>
          <HorizontalBarChart
            rows={stats.topContributorRows}
            color="#22c55e"
            total={null}
            labelWidth={170}
            formatValue={(v) => `${v}h`}
          />
        </section>
      )}

      {stats.topProfessions.length > 0 && stats.topContinents.length > 0 && (
        <section className="review-section">
          <h2 className="review-h2">Profession × Continent — capability map</h2>
          <p className="muted small" style={{ marginTop: -8 }}>
            Spot geographic blind spots: cells with zero count are continents
            where a profession isn't represented.
          </p>
          <CrossTabHeatmap
            rows={stats.crossTab}
            continents={stats.topContinents}
            max={stats.crossTabMax}
          />
        </section>
      )}

      {isSuperadmin && statusFunnel && (
        <section className="review-section">
          <h2 className="review-h2">User-status funnel <span className="muted small">(superadmin only)</span></h2>
          <p className="muted small" style={{ marginTop: -8 }}>
            Pending requests still waiting on approval, plus rejected accounts.
          </p>
          <HorizontalBarChart
            rows={statusFunnel}
            total={statusFunnel.reduce((s, r) => s + r.value, 0)}
          />
        </section>
      )}

      <MemberInsightsPanel stats={stats} members={members} />
    </>
  );
}

function KpiCard({ label, value, suffix }) {
  return (
    <div className="dash-kpi">
      <div className="dash-kpi-label">{label}</div>
      <div className="dash-kpi-value">
        {value}
        {suffix && <span className="dash-kpi-suffix">{suffix}</span>}
      </div>
    </div>
  );
}

function MemberInsightsPanel({ stats, members }) {
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('');
  const [error, setError] = useState(null);

  const buildSummary = () => ({
    organisation: 'Blue Innovation',
    totalApprovedMembers: stats.totalMembers,
    profileDataCompletenessPct: stats.completeness,
    age: {
      averageYears: stats.avgAge,
      minYears: stats.minAge,
      maxYears: stats.maxAge,
      distribution: stats.ageRows.map((r) => ({ bucket: r.label, count: r.value })),
    },
    geography: {
      byContinent: stats.continentRows.map((r) => ({ continent: r.label, count: r.value })),
      topCountries: stats.countryRows.map((r) => ({ country: r.label, count: r.value })),
      byTimezone: stats.tzRows.map((r) => ({ tz: r.label, count: r.value })),
    },
    industries: stats.industryRows.map((r) => ({ industry: r.label, count: r.value })),
    professions: stats.professionRows.map((r) => ({ profession: r.label, count: r.value })),
    gender: stats.genderRows.map((r) => ({ label: r.label, count: r.value })),
    tenure: stats.tenureRows.map((r) => ({ bucket: r.label, count: r.value })),
    seniority: stats.seniorityRows.map((r) => ({ band: r.label, count: r.value })),
    skills: {
      uniqueSkillCount: stats.totalSkills,
      singlePointOfFailureCount: stats.sopfSkillsCount,
      topSkills: stats.skillRows.map((r) => ({ skill: r.label, members: r.value })),
    },
    languages: stats.languageRows.map((r) => ({ language: r.label, speakers: r.value })),
    activity: {
      activeLast30d: stats.active30,
      dormant90Plus: stats.dormant,
      neverLoggedActivity: stats.never,
    },
    professionContinentMatrix: stats.crossTab.map((r) => ({
      profession: r.profession,
      byContinent: Object.fromEntries(r.cells.map((c) => [c.continent, c.count])),
    })),
  });

  const runInsights = async () => {
    setBusy(true);
    setError(null);
    setOutput('');
    try {
      const text = await generateMemberInsights({ summary: buildSummary() });
      setOutput(text);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const hasApiKey = !!getApiKey();

  return (
    <section className="review-section ai-insights-section">
      <div className="dash-card-head" style={{ marginBottom: 8 }}>
        <h2 className="review-h2" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="sparkles" size={18} />
          AI member insights
        </h2>
        {hasApiKey && (
          <button
            className="btn btn-primary"
            onClick={runInsights}
            disabled={busy || stats.totalMembers === 0}
          >
            {busy ? 'Analysing…' : output ? 'Re-run analysis' : 'Generate insights'}
          </button>
        )}
      </div>

      <p className="muted small" style={{ marginTop: 0 }}>
        Get a candid assessment of the organisation's strengths and weaknesses
        by industry, profession, age, and geography — plus concrete
        recommendations on how to strengthen the team.
      </p>

      {!hasApiKey && (
        <div className="ai-output-empty">
          <p className="muted small">
            Set up an Anthropic API key in <strong>Settings → AI</strong> to enable
            AI insights. The summary sent to the model is fully anonymised — only
            aggregate counts are transmitted, never names, emails, or birthdates.
          </p>
        </div>
      )}

      {error && (
        <div className="auth-error" style={{ marginBottom: 12 }}>
          <p className="auth-error-msg">{error}</p>
        </div>
      )}

      {output && (
        <div className="ai-output" style={{ marginTop: 12 }}>
          <div className="markdown-preview" style={{ background: 'var(--c-surface-2)', borderRadius: 6, padding: 16 }}>
            <Markdown src={output} />
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>
            Generated from aggregate counts only. Re-run any time to refresh.
          </p>
        </div>
      )}

      {!output && !error && hasApiKey && (
        <div className="ai-output-empty muted small" style={{ marginTop: 8 }}>
          Click <strong>Generate insights</strong> to analyse the team and get
          recommendations.
        </div>
      )}
    </section>
  );
}

// ─── Member-growth line + bar combo chart ───────────────────────────────────

function GrowthChart({ data, totalMembers }) {
  if (!data || data.length === 0) {
    return <p className="muted small">No growth data yet.</p>;
  }
  const W = 720, H = 220, PAD = 32;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const maxCount = Math.max(1, ...data.map((d) => d.count));
  const maxCumulative = Math.max(totalMembers || 1, ...data.map((d) => d.cumulative));
  const barSlot = innerW / data.length;
  const barW = barSlot * 0.6;
  // Line points use the cumulative scale on the right axis
  const points = data.map((d, i) => {
    const x = PAD + barSlot * i + barSlot / 2;
    const y = PAD + innerH - (d.cumulative / maxCumulative) * innerH;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="growth-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="220" preserveAspectRatio="none" style={{ display: 'block' }}>
        <rect x={PAD} y={PAD} width={innerW} height={innerH} fill="none" stroke="var(--c-border)" />
        {/* gridlines */}
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={PAD} y1={PAD + innerH * g} x2={PAD + innerW} y2={PAD + innerH * g} stroke="var(--c-border)" strokeDasharray="2 3" opacity={0.5} />
        ))}
        {/* bars — new approvals per month */}
        {data.map((d, i) => {
          const x = PAD + barSlot * i + (barSlot - barW) / 2;
          const h = (d.count / maxCount) * innerH;
          const y = PAD + innerH - h;
          return (
            <g key={d.key}>
              <rect x={x} y={y} width={barW} height={h} fill="var(--c-accent)" opacity={0.75}>
                <title>{d.label}: +{d.count} new · total {d.cumulative}</title>
              </rect>
              {d.count > 0 && (
                <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize="10" fill="var(--c-text-3)">
                  {d.count}
                </text>
              )}
            </g>
          );
        })}
        {/* cumulative line */}
        <polyline points={points} fill="none" stroke="#10b981" strokeWidth="2.5" />
        {data.map((d, i) => {
          const x = PAD + barSlot * i + barSlot / 2;
          const y = PAD + innerH - (d.cumulative / maxCumulative) * innerH;
          return <circle key={d.key} cx={x} cy={y} r={3.5} fill="#10b981" stroke="var(--c-surface)" strokeWidth="1.5" />;
        })}
        {/* x-axis labels */}
        {data.map((d, i) => (
          <text
            key={d.key}
            x={PAD + barSlot * i + barSlot / 2}
            y={H - 8}
            textAnchor="middle"
            fontSize="10"
            fill="var(--c-text-3)"
          >
            {d.label}
          </text>
        ))}
      </svg>
      <div className="chart-legend">
        <span><span className="legend-swatch" style={{ background: 'var(--c-accent)' }} /> New approvals (bars)</span>
        <span><span className="legend-swatch" style={{ background: '#10b981' }} /> Cumulative total (line)</span>
      </div>
    </div>
  );
}

// ─── Profession × Continent cross-tab heatmap ───────────────────────────────

function CrossTabHeatmap({ rows, continents, max }) {
  if (!rows.length || !continents.length) return null;
  const intensity = (n) => {
    if (!n) return 0;
    return 0.12 + (n / max) * 0.78;  // 12% – 90% opacity
  };
  return (
    <div className="crosstab-wrap">
      <table className="crosstab">
        <thead>
          <tr>
            <th></th>
            {continents.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.profession}>
              <th>{r.profession}</th>
              {r.cells.map((cell) => (
                <td
                  key={cell.continent}
                  style={{
                    background: `color-mix(in srgb, var(--c-accent) ${Math.round(intensity(cell.count) * 100)}%, transparent)`,
                  }}
                  title={`${r.profession} in ${cell.continent}: ${cell.count}`}
                >
                  {cell.count || ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
