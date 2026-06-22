// src/components/AnalyticsView.jsx — operational + organizational insights.
// All charts are SVG/CSS, no library.
//
// Originals:
//   Cumulative flow:  stacked area of task counts by status across time.
//   Burndown:         remaining open tasks per day within a window.
//   Velocity:         tasks completed per ISO-week.
//   Workload:         planned hours per project per week (stacked bars).
//
// Org-strengthening additions:
//   Project Health (RAG):     traffic-light card per project.
//   Aging "Doing":            in-flight tasks ranked by days in progress.
//   Bottlenecks & themes:     blocker frequency + top recurring words.
//   Capacity vs commitment:   planned hours per assignee per week vs capacity.
//   Dependency network:       node-edge graph of dependsOn relationships.
//   Workspace activity pulse: sparkline per workspace from last 30 days.

import { useState, useMemo, useEffect } from 'react';
import { useTasks, useProjects, useAllActivities } from '../hooks/useTasks';
import { useWorkspaces, useActiveWorkspaceId } from '../hooks/useWorkspace';
import { todayLocal, subscribeToActivitiesAcrossWorkspaces, auth } from '../services/firebase';

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
  const { activities } = useAllActivities();
  const { workspaces } = useWorkspaces();
  const activeWorkspaceId = useActiveWorkspaceId();
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

  // ───── Project Health (RAG) ────────────────────────────────────────────
  // For each project, derive a single traffic-light status from:
  //   - completion ratio vs. time elapsed in plan window
  //   - count of overdue tasks
  //   - recency of last activity
  const projectHealth = useMemo(() => {
    const projsToScore = projectFilter === 'all'
      ? projects
      : projects.filter((p) => p.id === projectFilter);
    return projsToScore.map((p) => {
      const projTasks = tasks.filter((t) => t.projectId === p.id);
      const total    = projTasks.length;
      const doneN    = projTasks.filter((t) => t.status === 'done').length;
      const overdue  = projTasks.filter((t) =>
        t.status !== 'done' && t.plan?.endDate && t.plan.endDate < todayStr
      ).length;
      const doing    = projTasks.filter((t) => t.status === 'doing').length;
      const completion = total === 0 ? 0 : doneN / total;

      // Time-elapsed estimate: span between earliest plan start and latest plan end
      const planStarts = projTasks.map((t) => t.plan?.startDate).filter(Boolean).sort();
      const planEnds   = projTasks.map((t) => t.plan?.endDate).filter(Boolean).sort();
      const projStart  = planStarts[0] || null;
      const projEnd    = planEnds[planEnds.length - 1] || null;
      let timeElapsed = null;
      if (projStart && projEnd) {
        const startMs = parseISO(projStart).getTime();
        const endMs   = parseISO(projEnd).getTime();
        const nowMs   = today.getTime();
        if (endMs <= startMs) timeElapsed = nowMs >= endMs ? 1 : 0;
        else timeElapsed = Math.min(1, Math.max(0, (nowMs - startMs) / (endMs - startMs)));
      }

      // Days since last activity on any task in this project
      const lastActivityMs = projTasks.reduce((acc, t) => {
        const m = t.lastActivityAt?.toDate?.()?.getTime() || 0;
        return m > acc ? m : acc;
      }, 0);
      const daysSinceActivity = lastActivityMs
        ? Math.floor((Date.now() - lastActivityMs) / 86400000)
        : null;

      // Pace = completion / timeElapsed (>1 means ahead). null if no dates.
      const pace = timeElapsed === null || timeElapsed === 0
        ? null
        : completion / timeElapsed;

      // Score: Green / Amber / Red
      let rag = 'green';
      const reasons = [];
      if (timeElapsed !== null && pace !== null) {
        if (pace < 0.6) { rag = 'red';   reasons.push(`pace ${(pace * 100).toFixed(0)}% of plan`); }
        else if (pace < 0.85) { rag = 'amber'; reasons.push(`pace ${(pace * 100).toFixed(0)}% of plan`); }
        else { reasons.push(`pace ${(pace * 100).toFixed(0)}% of plan`); }
      }
      if (overdue >= 5) { rag = 'red'; reasons.push(`${overdue} overdue`); }
      else if (overdue >= 2 && rag === 'green') { rag = 'amber'; reasons.push(`${overdue} overdue`); }
      else if (overdue > 0) reasons.push(`${overdue} overdue`);
      if (daysSinceActivity !== null) {
        if (daysSinceActivity > 30) { rag = 'red'; reasons.push(`${daysSinceActivity}d stale`); }
        else if (daysSinceActivity > 14 && rag === 'green') { rag = 'amber'; reasons.push(`${daysSinceActivity}d stale`); }
        else if (daysSinceActivity > 0) reasons.push(`${daysSinceActivity}d since activity`);
      } else if (total > 0) {
        reasons.push('no activity yet');
        if (rag === 'green') rag = 'amber';
      }
      if (total === 0) { rag = 'amber'; reasons.length = 0; reasons.push('no tasks'); }

      return {
        project: p,
        total, doneN, overdue, doing,
        completion, timeElapsed, pace,
        daysSinceActivity,
        projStart, projEnd,
        rag,
        reasons,
      };
    }).sort((a, b) => {
      const order = { red: 0, amber: 1, green: 2 };
      return order[a.rag] - order[b.rag];
    });
  }, [projects, tasks, projectFilter, todayStr]);

  // ───── Aging "Doing" tasks ──────────────────────────────────────────────
  // In-flight tasks ranked by days since they entered "doing".
  const agingDoing = useMemo(() => {
    return filtered
      .filter((t) => t.status === 'doing')
      .map((t) => {
        const start = t.actual?.startDate
          ? parseISO(t.actual.startDate)
          : (t.updatedAt?.toDate?.() || null);
        const ageDays = start
          ? Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000))
          : 0;
        const dueDate = t.plan?.endDate || null;
        const overdueDays = dueDate && dueDate < todayStr
          ? Math.floor((Date.now() - parseISO(dueDate).getTime()) / 86400000)
          : 0;
        return { task: t, ageDays, overdueDays };
      })
      .sort((a, b) => b.ageDays - a.ageDays);
  }, [filtered, todayStr]);
  const maxAge = Math.max(1, ...agingDoing.map((x) => x.ageDays));

  // ───── Bottlenecks & themes ─────────────────────────────────────────────
  // Activities flagged "blocked", per-project counts, plus word frequencies
  // from bottleneckRemarks (after a basic stop-word filter).
  const bottlenecks = useMemo(() => {
    const periodStart = dates[0];
    const blocked = activities.filter((a) => {
      if (projectFilter !== 'all' && a.projectId !== projectFilter) return false;
      if (!a.date || a.date < periodStart) return false;
      return a.completionStatus === 'blocked' || (a.bottleneckRemarks || '').trim().length > 0;
    });
    // Per-project counts
    const perProject = {};
    blocked.forEach((a) => {
      const key = a.projectId || 'unassigned';
      perProject[key] = (perProject[key] || 0) + 1;
    });
    const perProjectArr = Object.entries(perProject)
      .map(([pid, count]) => ({
        project: projectById[pid] || { id: pid, name: 'Unassigned', color: '#94a3b8' },
        count,
      }))
      .sort((a, b) => b.count - a.count);

    // Word frequency
    const STOP = new Set([
      'the','a','an','and','or','but','if','then','of','to','in','on','at','for','with','by','from','as',
      'is','it','this','that','these','those','was','were','be','been','being','have','has','had','do',
      'does','did','will','would','can','could','should','may','might','must','i','you','he','she','we',
      'they','my','your','our','their','its','am','our','us','them','not','no','yes','so','too','very',
      'just','also','still','already','only','more','most','some','any','all','than','because','about',
      'into','out','up','down','over','under','again','further','here','there','when','where','why','how',
    ]);
    const wordCounts = {};
    blocked.forEach((a) => {
      const text = (a.bottleneckRemarks || a.comment || '').toLowerCase();
      const words = text.match(/[a-z][a-z\-]{2,}/g) || [];
      words.forEach((w) => {
        if (STOP.has(w)) return;
        if (w.length < 3) return;
        wordCounts[w] = (wordCounts[w] || 0) + 1;
      });
    });
    const topWords = Object.entries(wordCounts)
      .map(([w, n]) => ({ w, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 18);

    // Per-day series for trend (in date window)
    const perDay = {};
    dates.forEach((d) => { perDay[d] = 0; });
    blocked.forEach((a) => { if (perDay[a.date] !== undefined) perDay[a.date]++; });
    const series = dates.map((d) => ({ date: d, count: perDay[d] }));

    return {
      total: blocked.length,
      perProjectArr,
      topWords,
      series,
      maxSeries: Math.max(1, ...series.map((s) => s.count)),
    };
  }, [activities, projectFilter, projectById, dates]);

  // ───── Capacity vs commitment ───────────────────────────────────────────
  // Per assignee, planned hours per ISO-week from tasks they're on. Compare
  // against a default capacity of 35h/week. We split a task's hours evenly
  // across its assignees (or attribute fully to "unassigned" if none).
  const capacity = useMemo(() => {
    const CAPACITY_PER_WEEK = 35;
    // Build week list in order
    const seen = new Set();
    const order = [];
    dates.forEach((ds) => {
      const k = isoWeekKey(parseISO(ds));
      if (!seen.has(k)) { seen.add(k); order.push(k); }
    });

    // Resolve display names via the active workspace's memberProfiles. Falls
    // back to user.displayName for the signed-in user, then short UID.
    const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);
    const memberProfiles = activeWs?.memberProfiles || {};
    const me = auth.currentUser?.uid;
    const meName = auth.currentUser?.displayName || auth.currentUser?.email || null;
    const resolveLabel = (key) => {
      if (key === '(unassigned)') return 'Unassigned';
      if (key.startsWith('ext:')) return `✎ ${key.slice(4)}`;
      const p = memberProfiles[key];
      if (p?.displayName) return p.displayName;
      if (p?.email) return p.email;
      if (key === me && meName) return meName;
      return `${key.slice(0, 6)}…`;
    };

    // assignee → week → hours.
    // We key both system users (raw UID) and external names (prefixed "ext:")
    // into the same map so the chart treats them uniformly.
    const byPerson = {};
    filtered.forEach((t) => {
      const start = parseISO(t.plan?.startDate);
      const end   = parseISO(t.plan?.endDate);
      if (!start || !end) return;
      const totalDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
      const totalHours = Math.max(1, t.totalHoursLogged || totalDays);
      const perDay = totalHours / totalDays;
      const uidAssignees = t.assignedTo || [];
      const extAssignees = (t.assignedToExternal || []).map((n) => `ext:${n}`);
      const allAssignees = [...uidAssignees, ...extAssignees];
      const assignees = allAssignees.length > 0 ? allAssignees : ['(unassigned)'];
      const perAssigneeDay = perDay / assignees.length;
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const ds = isoOf(d);
        if (ds < dates[0] || ds > dates[dates.length - 1]) continue;
        const wk = isoWeekKey(d);
        assignees.forEach((key) => {
          byPerson[key] = byPerson[key] || {};
          byPerson[key][wk] = (byPerson[key][wk] || 0) + perAssigneeDay;
        });
      }
    });

    const people = Object.keys(byPerson).map((key) => {
      const weeks = order.map((wk) => ({
        wk,
        hours: byPerson[key][wk] || 0,
        over: (byPerson[key][wk] || 0) > CAPACITY_PER_WEEK,
      }));
      const peak = Math.max(0, ...weeks.map((w) => w.hours));
      const avg  = weeks.reduce((s, w) => s + w.hours, 0) / Math.max(1, weeks.length);
      const overWeeks = weeks.filter((w) => w.over).length;
      return {
        uid: key,
        label: resolveLabel(key),
        weeks, peak, avg, overWeeks,
        isMe: key === me,
        isExternal: key.startsWith('ext:'),
      };
    }).sort((a, b) => b.peak - a.peak);

    return {
      people,
      weeks: order,
      capacityPerWeek: CAPACITY_PER_WEEK,
      maxHours: Math.max(CAPACITY_PER_WEEK, ...people.flatMap((p) => p.weeks.map((w) => w.hours))),
    };
  }, [filtered, dates, workspaces, activeWorkspaceId]);

  // ───── Dependency network ───────────────────────────────────────────────
  // Build a layered DAG: tasks with dependsOn → edges. Compute depth via
  // longest-path BFS (assumes no cycles; if there are, depth caps at MAX).
  const network = useMemo(() => {
    const involved = filtered.filter((t) => {
      const hasDep = (t.dependsOn || []).length > 0;
      const isDepOf = filtered.some((u) => (u.dependsOn || []).includes(t.id));
      return hasDep || isDepOf;
    });
    if (involved.length === 0) return { nodes: [], edges: [], maxLayer: 0 };

    // Build adjacency
    const byId = new Map(involved.map((t) => [t.id, t]));
    const depth = new Map();
    const MAX = 10;
    const computeDepth = (id, seen = new Set()) => {
      if (depth.has(id)) return depth.get(id);
      if (seen.has(id)) return 0;
      seen.add(id);
      const t = byId.get(id);
      if (!t) return 0;
      const deps = (t.dependsOn || []).filter((d) => byId.has(d));
      if (deps.length === 0) { depth.set(id, 0); return 0; }
      const d = Math.min(MAX, 1 + Math.max(...deps.map((d) => computeDepth(d, seen))));
      depth.set(id, d);
      return d;
    };
    involved.forEach((t) => computeDepth(t.id));

    // Bucket by layer
    const layers = {};
    involved.forEach((t) => {
      const d = depth.get(t.id) || 0;
      (layers[d] = layers[d] || []).push(t);
    });
    const layerKeys = Object.keys(layers).map(Number).sort((a, b) => a - b);
    const maxLayer = layerKeys.length === 0 ? 0 : layerKeys[layerKeys.length - 1];

    // Layout positions
    const W = 720, H = 420;
    const padX = 40, padY = 30;
    const stepX = layerKeys.length > 1 ? (W - padX * 2) / (layerKeys.length - 1) : 0;
    const positions = new Map();
    layerKeys.forEach((d, ix) => {
      const nodes = layers[d];
      const stepY = nodes.length > 1 ? (H - padY * 2) / (nodes.length - 1) : 0;
      nodes.forEach((t, iy) => {
        positions.set(t.id, {
          x: padX + ix * stepX,
          y: nodes.length === 1 ? H / 2 : padY + iy * stepY,
        });
      });
    });

    const nodes = involved.map((t) => ({
      id: t.id,
      task: t,
      ...positions.get(t.id),
      color: projectById[t.projectId]?.color || '#94a3b8',
    }));
    const edges = [];
    involved.forEach((t) => {
      (t.dependsOn || []).forEach((dId) => {
        if (positions.has(dId) && positions.has(t.id)) {
          edges.push({
            from: positions.get(dId),
            to:   positions.get(t.id),
            blocked: t.status !== 'done' && byId.get(dId)?.status !== 'done',
          });
        }
      });
    });

    return { nodes, edges, maxLayer, W, H };
  }, [filtered, projectById]);

  // ───── Workspace activity pulse ─────────────────────────────────────────
  // Cross-workspace: subscribe to last 30 days of activities across every
  // workspace the user belongs to. Compute count per day per workspace.
  const [pulseActs, setPulseActs] = useState([]);
  const [pulseLoading, setPulseLoading] = useState(true);
  useEffect(() => {
    if (!workspaces || workspaces.length === 0) {
      setPulseActs([]);
      setPulseLoading(false);
      return;
    }
    setPulseLoading(true);
    const since30 = isoOf(new Date(Date.now() - 30 * 86400000));
    const ids = workspaces.map((w) => w.id);
    const unsub = subscribeToActivitiesAcrossWorkspaces(ids, since30, (data) => {
      setPulseActs(data);
      setPulseLoading(false);
    });
    return () => unsub();
  }, [workspaces]);

  const pulse = useMemo(() => {
    const since30 = isoOf(new Date(Date.now() - 30 * 86400000));
    const days = [];
    for (let i = 29; i >= 0; i--) {
      days.push(isoOf(new Date(Date.now() - i * 86400000)));
    }
    return (workspaces || []).map((w) => {
      const wsActs = pulseActs.filter((a) => a.workspaceId === w.id);
      const byDay = {};
      days.forEach((d) => { byDay[d] = 0; });
      wsActs.forEach((a) => { if (byDay[a.date] !== undefined) byDay[a.date]++; });
      const series = days.map((d) => ({ d, n: byDay[d] || 0 }));
      const total = series.reduce((s, x) => s + x.n, 0);
      const last7 = series.slice(-7).reduce((s, x) => s + x.n, 0);
      const prev7 = series.slice(-14, -7).reduce((s, x) => s + x.n, 0);
      const lastActiveDay = [...series].reverse().find((x) => x.n > 0);
      const daysSince = lastActiveDay
        ? Math.floor((parseISO(days[days.length - 1]) - parseISO(lastActiveDay.d)) / 86400000)
        : null;
      // Trend: comparing last 7 vs prev 7
      let trend = 'flat';
      if (prev7 === 0 && last7 > 0) trend = 'up';
      else if (prev7 > 0 && last7 === 0) trend = 'down';
      else if (prev7 > 0) {
        const ratio = last7 / prev7;
        if (ratio >= 1.2) trend = 'up';
        else if (ratio <= 0.8) trend = 'down';
      }
      return { workspace: w, series, total, last7, prev7, daysSince, trend };
    }).sort((a, b) => b.last7 - a.last7);
  }, [workspaces, pulseActs]);

  if (tasksLoading) return <p className="muted">Loading analytics…</p>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">
            Operational charts + organizational insights.
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

      {/* Hero: total work performed (hours logged) per day, stacked by project */}
      <WorkPerformedHero
        activities={activities}
        projectById={projectById}
        projectFilter={projectFilter}
      />

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

      {/* ──────────────────────────────────────────────────────────────── */}
      {/*  Organizational-strength section                                  */}
      {/* ──────────────────────────────────────────────────────────────── */}

      <div className="analytics-section-divider">
        <span>Organizational insights</span>
      </div>

      {/* Project health (RAG) */}
      <section className="review-section">
        <h2 className="review-h2">Project health — RAG scorecard</h2>
        <p className="muted small" style={{ marginTop: 0, marginBottom: 12 }}>
          One traffic-light per project, based on pace (completion vs. time elapsed), overdue counts, and recency of activity.
          {projectHealth.length > 0 && (
            <>  · <strong>{projectHealth.filter((p) => p.rag === 'red').length}</strong> at risk,
              {' '}<strong>{projectHealth.filter((p) => p.rag === 'amber').length}</strong> warning,
              {' '}<strong>{projectHealth.filter((p) => p.rag === 'green').length}</strong> on track.</>
          )}
        </p>
        <ProjectHealthGrid health={projectHealth} />
      </section>

      {/* Aging Doing */}
      <section className="review-section">
        <h2 className="review-h2">Aging — in-flight tasks ranked by days in "Doing"</h2>
        <p className="muted small" style={{ marginTop: 0, marginBottom: 12 }}>
          The silent stalls. Anything red (&gt;7 days) deserves a check-in: ship it, hand it off, or move it back to Todo.
        </p>
        <AgingChart items={agingDoing} maxAge={maxAge} projectById={projectById} />
      </section>

      {/* Bottlenecks */}
      <section className="review-section">
        <h2 className="review-h2">Bottlenecks — what blocks us, and how often</h2>
        <p className="muted small" style={{ marginTop: 0, marginBottom: 12 }}>
          Activities flagged <code>blocked</code> or with bottleneck remarks in the last {range.label}.
          {bottlenecks.total > 0 && <>  · <strong>{bottlenecks.total}</strong> blocker activities.</>}
        </p>
        <BottleneckPanel data={bottlenecks} />
      </section>

      {/* Capacity vs commitment */}
      <section className="review-section">
        <h2 className="review-h2">Capacity vs. commitment — planned hours per person per week</h2>
        <p className="muted small" style={{ marginTop: 0, marginBottom: 12 }}>
          Hours from tasks with plan dates, split evenly across assignees. Bars over the capacity line ({capacity.capacityPerWeek}h/week) signal overload.
        </p>
        <CapacityChart data={capacity} />
      </section>

      {/* Dependency network */}
      <section className="review-section">
        <h2 className="review-h2">Dependency network — what blocks what</h2>
        <p className="muted small" style={{ marginTop: 0, marginBottom: 12 }}>
          Each arrow: <em>blocked-by → blocked</em>. Tasks furthest right unblock the most work when shipped.
        </p>
        <DependencyNetwork network={network} />
      </section>

      {/* Workspace pulse */}
      <section className="review-section">
        <h2 className="review-h2">Workspace pulse — activity across all your workspaces (last 30 days)</h2>
        <p className="muted small" style={{ marginTop: 0, marginBottom: 12 }}>
          Sparkline = daily activity count. Which workspaces are alive? Which are dormant and ripe for archive or consolidation?
        </p>
        <WorkspacePulse rows={pulse} activeId={activeWorkspaceId} loading={pulseLoading} />
      </section>
    </>
  );
}

// ─── Hero: Work performed (logged hours/day, stacked by project) ───────────

const HERO_RANGES = [
  { id: 7,  label: '7 days' },
  { id: 15, label: '15 days' },
  { id: 30, label: '30 days' },
];

function niceCeil(v) {
  if (v <= 1) return 1;
  if (v <= 2) return 2;
  if (v <= 5) return Math.ceil(v);
  if (v <= 10) return Math.ceil(v / 2) * 2;
  return Math.ceil(v / 5) * 5;
}
function fmtHours(v) {
  return `${Number.isInteger(v) ? v : v.toFixed(1)}h`;
}

function WorkPerformedHero({ activities, projectById, projectFilter }) {
  const [days, setDays] = useState(7);

  const todayStr = todayLocal();
  const dates = useMemo(() => {
    const today = parseISO(todayStr);
    const arr = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      arr.push(isoOf(d));
    }
    return arr;
  }, [days, todayStr]);

  const scoped = projectFilter === 'all'
    ? activities
    : activities.filter((a) => a.projectId === projectFilter);

  const { perDate, projOrder, projColor, projTotal, niceMax, grandTotal } = useMemo(() => {
    const dateSet = new Set(dates);
    const perDate = {};
    dates.forEach((d) => { perDate[d] = {}; });
    const projColor = {};
    const projTotal = {};
    scoped.forEach((a) => {
      if (!a.date || !dateSet.has(a.date)) return;
      const h = Number(a.hoursSpent) || 0;
      if (h <= 0) return;
      const proj = projectById[a.projectId];
      const name = proj?.name || a.taskCategory || 'No project';
      projColor[name] = proj?.color || '#a1a1aa';
      perDate[a.date][name] = (perDate[a.date][name] || 0) + h;
      projTotal[name] = (projTotal[name] || 0) + h;
    });
    const projOrder = Object.keys(projTotal).sort((a, b) => projTotal[b] - projTotal[a]);
    const maxTotal = Math.max(0, ...dates.map((d) => Object.values(perDate[d]).reduce((s, x) => s + x, 0)));
    const grandTotal = Object.values(projTotal).reduce((s, x) => s + x, 0);
    return { perDate, projOrder, projColor, projTotal, niceMax: niceCeil(maxTotal), grandTotal };
  }, [scoped, dates, projectById]);

  // Y-axis ticks (top→bottom).
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => +(niceMax * f).toFixed(2));
  // Thin out x labels when the window is wide.
  const labelStep = days <= 15 ? 1 : 3;

  return (
    <section className="review-section wp-hero">
      <div className="wp-hero-head">
        <div>
          <h2 className="review-h2" style={{ margin: 0 }}>Work performed</h2>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            Hours logged per day, stacked by project · <strong>{fmtHours(+grandTotal.toFixed(1))}</strong> in {days} days
          </p>
        </div>
        <div className="page-actions">
          {HERO_RANGES.map((r) => (
            <button
              key={r.id}
              className={`chip ${days === r.id ? 'active' : ''}`}
              onClick={() => setDays(r.id)}
            >{r.label}</button>
          ))}
        </div>
      </div>

      {grandTotal <= 0 ? (
        <div className="empty-state" style={{ padding: '36px 16px' }}>
          <div className="empty-state-icon">◢</div>
          <p>No hours logged in the last {days} days.</p>
          <p className="small muted">Log activities with hours on your tasks to see them here.</p>
        </div>
      ) : (
        <>
          <div className="wp-hero-chart">
            <div className="wp-hero-yaxis">
              {ticks.map((t, i) => (
                <div key={i} className="wp-hero-ytick"><span>{fmtHours(t)}</span></div>
              ))}
            </div>
            <div className="wp-hero-plot-wrap">
              <div className="wp-hero-plot">
                {ticks.map((t, i) => <div key={i} className="wp-hero-grid" />)}
                <div className="wp-hero-bars">
                  {dates.map((d) => {
                    const segs = perDate[d];
                    const total = Object.values(segs).reduce((s, x) => s + x, 0);
                    return (
                      <div key={d} className="wp-hero-col" title={`${d} · ${fmtHours(+total.toFixed(1))}`}>
                        <div className="wp-hero-bar-wrap" style={{ height: `${(total / niceMax) * 100}%` }}>
                          {total > 0 && (
                            <span className="wp-hero-bar-total">{fmtHours(+total.toFixed(1))}</span>
                          )}
                          <div className="wp-hero-bar">
                            {projOrder.filter((p) => segs[p]).map((p) => (
                              <div
                                key={p}
                                className="wp-hero-seg"
                                style={{ height: `${(segs[p] / total) * 100}%`, background: projColor[p] }}
                                title={`${p} · ${fmtHours(+segs[p].toFixed(2))} · ${d}`}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="wp-hero-xaxis">
                {dates.map((d, i) => (
                  <div key={d} className="wp-hero-xtick">
                    {(i % labelStep === 0 || i === dates.length - 1) ? d.slice(5) : ''}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="wp-hero-legend">
            {projOrder.map((p) => (
              <span key={p} className="wp-hero-legend-item" title={`${p}: ${fmtHours(+projTotal[p].toFixed(1))}`}>
                <span className="legend-swatch" style={{ background: projColor[p] }} />
                {p}
                <span className="muted">{fmtHours(+projTotal[p].toFixed(1))}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </section>
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

// ─── Organizational charts ─────────────────────────────────────────────────

function ProjectHealthGrid({ health }) {
  if (health.length === 0) return <p className="muted small">No projects to score.</p>;
  return (
    <div className="rag-grid">
      {health.map((h) => (
        <div key={h.project.id} className={`rag-card rag-${h.rag}`}>
          <div className="rag-head">
            <span className="proj-dot" style={{ background: h.project.color }} />
            <span className="rag-name">{h.project.name}</span>
            <span className={`rag-badge rag-${h.rag}`}>{h.rag.toUpperCase()}</span>
          </div>
          <div className="rag-bar-wrap" title={`Completion ${(h.completion * 100).toFixed(0)}%${h.timeElapsed !== null ? ` · Time elapsed ${(h.timeElapsed * 100).toFixed(0)}%` : ''}`}>
            <div className="rag-bar-track">
              <div className="rag-bar-fill" style={{ width: `${h.completion * 100}%`, background: h.project.color }} />
              {h.timeElapsed !== null && (
                <div className="rag-bar-marker" style={{ left: `${h.timeElapsed * 100}%` }} />
              )}
            </div>
            <div className="rag-bar-labels">
              <span>{(h.completion * 100).toFixed(0)}% done</span>
              {h.timeElapsed !== null && <span className="muted">{(h.timeElapsed * 100).toFixed(0)}% time</span>}
            </div>
          </div>
          <div className="rag-stats">
            <div className="rag-stat"><span className="rag-stat-num">{h.doneN}/{h.total}</span><span className="rag-stat-lbl">tasks</span></div>
            <div className="rag-stat"><span className={`rag-stat-num ${h.overdue > 0 ? 'danger' : ''}`}>{h.overdue}</span><span className="rag-stat-lbl">overdue</span></div>
            <div className="rag-stat"><span className="rag-stat-num">{h.doing}</span><span className="rag-stat-lbl">doing</span></div>
          </div>
          {h.reasons.length > 0 && (
            <div className="rag-reasons">
              {h.reasons.map((r, i) => <span key={i} className="rag-chip">{r}</span>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AgingChart({ items, maxAge, projectById }) {
  if (items.length === 0) {
    return <p className="muted small">No tasks currently in "Doing".</p>;
  }
  return (
    <div className="aging-list">
      {items.slice(0, 20).map(({ task, ageDays, overdueDays }) => {
        const proj = projectById[task.projectId];
        const ageClass = ageDays >= 14 ? 'red' : ageDays >= 7 ? 'amber' : 'green';
        const widthPct = (ageDays / maxAge) * 100;
        return (
          <div key={task.id} className="aging-row" title={`${ageDays} day${ageDays === 1 ? '' : 's'} in Doing${overdueDays > 0 ? ` · overdue ${overdueDays}d` : ''}`}>
            <div className="aging-label">
              {proj && <span className="proj-dot" style={{ background: proj.color }} />}
              <span className="aging-title">{task.title}</span>
            </div>
            <div className="aging-bar-wrap">
              <div className={`aging-bar aging-${ageClass}`} style={{ width: `${Math.max(2, widthPct)}%` }}>
                <span className="aging-bar-num">{ageDays}d</span>
              </div>
              {overdueDays > 0 && (
                <span className="aging-overdue">⚠ {overdueDays}d overdue</span>
              )}
            </div>
          </div>
        );
      })}
      {items.length > 20 && (
        <div className="muted small" style={{ marginTop: 6 }}>… and {items.length - 20} more.</div>
      )}
    </div>
  );
}

function BottleneckPanel({ data }) {
  if (data.total === 0) {
    return <p className="muted small">No bottlenecks reported in this window. Nice.</p>;
  }
  const maxWord = Math.max(1, ...data.topWords.map((w) => w.n));
  const maxProj = Math.max(1, ...data.perProjectArr.map((p) => p.count));
  return (
    <div className="bottleneck-panel">
      {/* Trend strip */}
      <div className="bottleneck-trend">
        <div className="bottleneck-trend-label">Daily blocker volume</div>
        <div className="bottleneck-trend-strip">
          {data.series.map((s) => (
            <div
              key={s.date}
              className="bottleneck-trend-cell"
              title={`${s.date}: ${s.count}`}
              style={{
                background: s.count === 0
                  ? 'var(--c-surface-3)'
                  : `color-mix(in srgb, var(--c-danger) ${20 + (s.count / data.maxSeries) * 70}%, var(--c-surface))`,
              }}
            />
          ))}
        </div>
      </div>

      <div className="bottleneck-twocol">
        {/* Per project */}
        <div>
          <div className="bottleneck-h3">By project</div>
          <div className="bar-list">
            {data.perProjectArr.map((row) => (
              <div key={row.project.id} className="bar-row">
                <div className="bar-row-label">
                  <span className="proj-dot" style={{ background: row.project.color }} />
                  {row.project.name}
                </div>
                <div className="bar-row-track">
                  <div
                    className="bar-row-fill"
                    style={{ width: `${(row.count / maxProj) * 100}%`, background: 'var(--c-danger)' }}
                  />
                </div>
                <div className="bar-row-value">{row.count}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Top words */}
        <div>
          <div className="bottleneck-h3">Recurring themes</div>
          {data.topWords.length === 0 ? (
            <p className="muted small">No remark text to analyze.</p>
          ) : (
            <div className="bottleneck-cloud">
              {data.topWords.map((w) => (
                <span
                  key={w.w}
                  className="bottleneck-word"
                  style={{
                    fontSize: 11 + Math.round((w.n / maxWord) * 12),
                    opacity: 0.55 + (w.n / maxWord) * 0.45,
                  }}
                  title={`${w.w} · ${w.n} mention${w.n === 1 ? '' : 's'}`}
                >
                  {w.w} <span className="muted small mono">×{w.n}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CapacityChart({ data }) {
  const { people, weeks, capacityPerWeek, maxHours } = data;
  if (people.length === 0 || weeks.length === 0) {
    return <p className="muted small">No assigned tasks with plan dates in this window.</p>;
  }
  const capPct = (capacityPerWeek / maxHours) * 100;
  return (
    <div className="capacity-wrap">
      {people.map((p) => (
        <div key={p.uid} className={`capacity-row ${p.isMe ? 'is-me' : ''} ${p.isExternal ? 'is-external' : ''}`}>
          <div className="capacity-label">
            <div className="capacity-name">
              {p.label}
              {p.isMe && <span className="muted small"> (you)</span>}
              {p.isExternal && <span className="muted small" title="External — not in the system"> · external</span>}
            </div>
            <div className="capacity-meta muted small">
              peak <strong className={p.peak > capacityPerWeek ? 'danger' : ''}>{p.peak.toFixed(0)}h</strong>
              {' '}· avg {p.avg.toFixed(0)}h
              {p.overWeeks > 0 && <> · <span className="danger">{p.overWeeks} over-cap</span></>}
            </div>
          </div>
          <div className="capacity-bars" title={`Capacity line = ${capacityPerWeek}h/week`}>
            <div className="capacity-cap-line" style={{ bottom: `${capPct}%` }} />
            {p.weeks.map((w) => (
              <div
                key={w.wk}
                className={`capacity-bar ${w.over ? 'over' : ''}`}
                style={{ height: `${(w.hours / maxHours) * 100}%` }}
                title={`${w.wk}: ${w.hours.toFixed(1)}h${w.over ? ' (over capacity)' : ''}`}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="capacity-axis muted small">
        Weeks: {weeks.map((w) => w.slice(5)).join(' · ')}
      </div>
    </div>
  );
}

function DependencyNetwork({ network }) {
  if (network.nodes.length === 0) {
    return <p className="muted small">No dependency relationships in this scope. (Add <em>Depends on</em> from any task editor.)</p>;
  }
  const { nodes, edges, W, H } = network;
  // Build an id→pos map for the marker collision check
  return (
    <div className="depnet-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="depnet-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--c-text-3)" />
          </marker>
          <marker id="depnet-arrow-blocked" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--c-danger)" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const dx = e.to.x - e.from.x;
          const dy = e.to.y - e.from.y;
          // Bezier control points for a gentle curve
          const c1x = e.from.x + dx * 0.5;
          const c1y = e.from.y;
          const c2x = e.from.x + dx * 0.5;
          const c2y = e.to.y;
          return (
            <path
              key={i}
              d={`M ${e.from.x} ${e.from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${e.to.x} ${e.to.y}`}
              fill="none"
              stroke={e.blocked ? 'var(--c-danger)' : 'var(--c-text-3)'}
              strokeWidth={e.blocked ? 1.6 : 1.1}
              opacity={e.blocked ? 0.85 : 0.55}
              markerEnd={e.blocked ? 'url(#depnet-arrow-blocked)' : 'url(#depnet-arrow)'}
            />
          );
        })}
        {nodes.map((n) => {
          const r = 10;
          const status = n.task.status;
          const ringColor =
            status === 'done'  ? 'var(--c-done)'  :
            status === 'doing' ? 'var(--c-doing)' :
                                 'var(--c-todo)';
          return (
            <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
              <circle r={r + 2} fill="var(--c-surface)" stroke={ringColor} strokeWidth="2.5" />
              <circle r={r} fill={n.color} opacity="0.85" />
              <text
                x={0}
                y={r + 14}
                textAnchor="middle"
                fontSize="10"
                fill="var(--c-text-2)"
                style={{ fontFamily: 'inherit' }}
              >
                {n.task.title.length > 22 ? n.task.title.slice(0, 21) + '…' : n.task.title}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span><span className="legend-swatch" style={{ background: 'var(--c-todo)' }} /> Todo</span>
        <span><span className="legend-swatch" style={{ background: 'var(--c-doing)' }} /> Doing</span>
        <span><span className="legend-swatch" style={{ background: 'var(--c-done)' }} /> Done</span>
        <span><span className="legend-swatch" style={{ background: 'var(--c-danger)' }} /> Open blocker</span>
      </div>
    </div>
  );
}

function WorkspacePulse({ rows, activeId, loading }) {
  if (loading) return <p className="muted small">Loading cross-workspace data…</p>;
  if (rows.length === 0) return <p className="muted small">No workspaces.</p>;
  return (
    <div className="pulse-list">
      {rows.map((r) => {
        const max = Math.max(1, ...r.series.map((s) => s.n));
        const trendIcon = r.trend === 'up' ? '↗' : r.trend === 'down' ? '↘' : '→';
        const trendClass = r.trend === 'up' ? 'good' : r.trend === 'down' ? 'bad' : 'flat';
        return (
          <div key={r.workspace.id} className={`pulse-row ${r.workspace.id === activeId ? 'active' : ''}`}>
            <div className="pulse-meta">
              <div className="pulse-name">
                <span className="proj-dot" style={{ background: r.workspace.color || '#7c3aed' }} />
                {r.workspace.name}
                {r.workspace.id === activeId && <span className="muted small"> · active</span>}
              </div>
              <div className="pulse-sub muted small">
                {r.total} act{r.total === 1 ? '' : 's'} · last 7: <strong>{r.last7}</strong>
                {' '}<span className={`pulse-trend ${trendClass}`}>{trendIcon}</span>
                {r.daysSince !== null
                  ? <> · last active {r.daysSince === 0 ? 'today' : `${r.daysSince}d ago`}</>
                  : <> · <span className="muted">dormant 30d+</span></>}
              </div>
            </div>
            <Sparkline series={r.series} max={max} />
          </div>
        );
      })}
    </div>
  );
}

function Sparkline({ series, max }) {
  const W = 200, H = 36;
  if (!series || series.length === 0) return null;
  const stepX = W / Math.max(1, series.length - 1);
  const pts = series.map((s, i) => `${i * stepX},${H - (s.n / max) * H}`).join(' ');
  const area = `M 0,${H} L ${pts} L ${W},${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} preserveAspectRatio="none" className="sparkline">
      <path d={area} fill="var(--c-accent-soft)" opacity="0.8" />
      <polyline points={pts} fill="none" stroke="var(--c-accent)" strokeWidth="1.5" />
    </svg>
  );
}
