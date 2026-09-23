// src/services/goalProgress.js — how far a goal has got, and how far each of
// its deliverables has (T-0154).
//
// Pure: no Firebase, no clock of its own. The Goals page renders what this
// returns, so the part that can be wrong without looking wrong is checkable.
//
// The one rule worth stating up front: **a deliverable nobody has linked to a
// project has no percentage.** It is not 0% — 0% means "started, got nowhere",
// and printing that against something nobody has wired up is the single most
// misleading number this page could carry. `pct` is null and the card shows a
// dash.

/** Tone thresholds, taken from the mockup's own data: 83→green, 64→amber, 42→red. */
export const GOAL_GREEN = 80;
export const GOAL_AMBER = 50;

/** Which colour a percentage earns. `null` (nothing measured) is never green. */
export function toneOf(pct) {
  if (pct == null) return 'navy';
  if (pct >= GOAL_GREEN) return 'green';
  if (pct >= GOAL_AMBER) return 'amber';
  return 'red';
}

/** A deliverable's linked projects, accepting the legacy single `projectId`. */
export function deliverableProjectIds(d) {
  if (Array.isArray(d?.projectIds)) return d.projectIds.filter(Boolean);
  return d?.projectId ? [d.projectId] : [];
}

/**
 * One deliverable: its percentage, or null when there is nothing to measure.
 *
 * The number is the average completion of the projects it is linked to, which
 * is the same figure the Portfolio and the WBS print for those projects — one
 * definition, so the goal and the project cannot disagree about the same work.
 */
export function deliverableProgress(deliverable, projectStats = {}) {
  const ids = deliverableProjectIds(deliverable).filter((id) => projectStats[id]);
  if (ids.length === 0) return { pct: null, projects: [], tone: 'navy' };
  const pct = Math.round(ids.reduce((n, id) => n + (projectStats[id].pct || 0), 0) / ids.length);
  return { pct, projects: ids.map((id) => projectStats[id]), tone: toneOf(pct) };
}

/**
 * The goal: its ring percentage, its deliverables, its projects and its date.
 *
 * The ring averages only the deliverables that HAVE a percentage. Counting an
 * unlinked deliverable as zero would drag the ring down for work nobody has
 * said anything about — and a goal that reads 20% because half of it is
 * unwired is a goal people stop believing.
 */
export function goalProgress(goal, projectStats = {}) {
  const deliverables = (goal?.deliverables || []).map((d) => ({
    ...d,
    ...deliverableProgress(d, projectStats),
  }));
  const measured = deliverables.filter((d) => d.pct != null);
  const pct = measured.length
    ? Math.round(measured.reduce((n, d) => n + d.pct, 0) / measured.length)
    : null;

  // Every project any deliverable points at, once, in the order first seen.
  const seen = new Set();
  const projects = [];
  for (const d of deliverables) {
    for (const p of d.projects) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      projects.push(p);
    }
  }

  // The goal's own deadline is the last date anything in it is due by.
  const dates = deliverables.map((d) => d.targetDate).filter(Boolean).sort();
  const due = dates.length ? dates[dates.length - 1] : null;

  return {
    pct,
    tone: toneOf(pct),
    deliverables,
    projects,
    due,
    measured: measured.length,
    unmeasured: deliverables.length - measured.length,
    done: deliverables.filter((d) => d.pct === 100).length,
    total: deliverables.length,
  };
}

/** A goal is at risk when its tone is red — the mockup's own "1 at risk". */
export function atRiskCount(goals = [], projectStats = {}) {
  return goals.filter((g) => goalProgress(g, projectStats).tone === 'red').length;
}
