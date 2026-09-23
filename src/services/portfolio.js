// src/services/portfolio.js — how every project is doing, across every
// workspace (T-0142 / NEW-026).
//
// The Dashboard's project-health table — done percentage against schedule
// elapsed, RAG-rated, worst first — could only ever see one workspace. An owner
// with three of them had to switch between and hold the comparison in their
// head.
//
// The arithmetic was inline in DashboardView. It is here now, unchanged, so the
// same rating can be computed for one workspace or for all of them and the two
// can never disagree. Pure: no Firestore, and `today` is passed in.

/** Worst first. IDLE last: a project with no tasks is not "healthy". */
export const RAG_RANK = { RED: 0, AMBER: 1, GREEN: 2, IDLE: 3 };

export const RAG_MEANING = {
  RED:   'Needs attention now',
  AMBER: 'Watch it',
  GREEN: 'On track',
  IDLE:  'Nothing scheduled yet',
};

const DAY = 86_400_000;

/** Whole days from a to b, or null when either is missing. */
export function daysBetween(a, b) {
  if (!a || !b) return null;
  const [ay, am, ad] = String(a).split('-').map(Number);
  const [by, bm, bd] = String(b).split('-').map(Number);
  if (!ay || !am || !ad || !by || !bm || !bd) return null;
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / DAY);
}

/**
 * One project's health, from its own tasks.
 *
 * The rule, exactly as the Dashboard has always computed it:
 *   · elapsed = how far through its own span today is (100 if it ended already)
 *   · pct     = how many of its tasks are done
 *   · gap     = elapsed − pct, so a positive gap is time gone without work done
 *   · RED     at three overdue tasks, or a gap of 20 points
 *   · AMBER   at one overdue task, or a gap of 10
 *   · IDLE    when it has no tasks at all
 */
export function projectHealth(project, tasks = [], today) {
  const own = tasks.filter((t) => t && t.projectId === project?.id && !t.deleted && !t.archived);
  const done = own.filter((t) => t.status === 'done').length;
  const late = own.filter((t) => t.status !== 'done' && t.plan?.endDate && t.plan.endDate < today).length;

  const starts = own.map((t) => t.plan?.startDate).filter(Boolean).sort();
  const ends   = own.map((t) => t.plan?.endDate).filter(Boolean).sort();
  const start  = starts[0] || null;
  const end    = ends[ends.length - 1] || null;

  const span = start && end ? daysBetween(start, end) : null;
  const gone = start ? daysBetween(start, today) : null;
  const elapsed = span && span > 0 && gone != null
    ? Math.max(0, Math.min(100, Math.round((gone / span) * 100)))
    : end && end < today ? 100 : null;

  const pct = own.length ? Math.round((done / own.length) * 100) : 0;
  const gap = elapsed == null ? null : elapsed - pct;

  let rag = 'GREEN';
  if (!own.length)                                  rag = 'IDLE';
  else if (late >= 3 || (gap != null && gap >= 20)) rag = 'RED';
  else if (late >= 1 || (gap != null && gap >= 10)) rag = 'AMBER';

  return { project, total: own.length, done, late, pct, elapsed, gap, rag, start, end };
}

/** Worst first, then by the widest gap between time gone and work done. */
export function compareHealth(a, b) {
  return (RAG_RANK[a.rag] ?? 9) - (RAG_RANK[b.rag] ?? 9)
    || (b.gap ?? -99) - (a.gap ?? -99)
    || String(a.project?.name || '').localeCompare(String(b.project?.name || ''));
}

/** Every project in one list, rated and ranked. */
export function rateProjects(projects = [], tasks = [], today) {
  return projects
    .filter((p) => p && !p.deleted && !p.archived)
    .map((p) => projectHealth(p, tasks, today))
    .sort(compareHealth);
}

/**
 * The portfolio: every project the user can see, grouped by workspace, with a
 * roll-up per workspace and one across the lot.
 *
 * A workspace with no projects is still listed — "nothing here yet" is an
 * answer, and silently dropping it would leave somebody wondering where their
 * third workspace went.
 *
 * @returns {{ rows, groups, totals }}
 *   `rows` is the flat ranking (what the export uses, so the two agree).
 */
export function buildPortfolio({ workspaces = [], projects = [], tasks = [], today } = {}) {
  const rows = rateProjects(projects, tasks, today);

  const groups = workspaces
    .filter((w) => w && !w.deleted && !w.archived)
    .map((w) => {
      const own = rows.filter((r) => r.project?.workspaceId === w.id);
      return { workspace: w, rows: own, totals: summarise(own) };
    })
    // Worst workspace first, on the same rule: the one with the most red.
    .sort((a, b) => (b.totals.red - a.totals.red)
      || (b.totals.amber - a.totals.amber)
      || String(a.workspace.name || '').localeCompare(String(b.workspace.name || '')));

  // A project whose workspace is not in the list still has to go somewhere.
  const known = new Set(groups.map((g) => g.workspace.id));
  const orphans = rows.filter((r) => !known.has(r.project?.workspaceId));
  if (orphans.length) {
    groups.push({
      workspace: { id: '__other__', name: 'Elsewhere' },
      rows: orphans,
      totals: summarise(orphans),
    });
  }

  return { rows, groups, totals: summarise(rows) };
}

function summarise(rows = []) {
  const count = (rag) => rows.filter((r) => r.rag === rag).length;
  const tasks = rows.reduce((n, r) => n + r.total, 0);
  const done  = rows.reduce((n, r) => n + r.done, 0);
  return {
    projects: rows.length,
    red: count('RED'), amber: count('AMBER'), green: count('GREEN'), idle: count('IDLE'),
    tasks,
    done,
    late: rows.reduce((n, r) => n + r.late, 0),
    pct: tasks ? Math.round((done / tasks) * 100) : 0,
  };
}

/** One sentence about a whole portfolio, for a heading. */
export function describePortfolio(totals, groupCount) {
  if (!totals?.projects) return 'No projects yet.';
  const bits = [`${totals.projects} project${totals.projects === 1 ? '' : 's'}`];
  if (groupCount > 1) bits.push(`across ${groupCount} workspaces`);
  if (totals.red)   bits.push(`${totals.red} needing attention now`);
  else if (totals.amber) bits.push(`${totals.amber} to watch`);
  else bits.push('all on track');
  return `${bits.join(' · ')}.`;
}
