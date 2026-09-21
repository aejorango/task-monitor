// dev/bulk-tasks.jsx — dev-only harness for the task table's bulk bar.
//
// The real grid and the real bar, with sample tasks and no Firebase: selecting
// rows works exactly as it does in the app, and running an action shows you the
// plan it WOULD have committed instead of committing it.
//
// Open: http://localhost:5173/dev/bulk-tasks.html
// Not part of the production build (vite builds index.html only).
//
// A harness is an entry point, not a module anything imports.
/* eslint-disable react-refresh/only-export-components */

import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TasksTableGrid, TaskBulkBar } from '../src/components/TasksTableView';
import {
  bulkPlan, confirmFor, describeBulk, pruneSelection, selectionAfterClick,
} from '../src/services/bulkTasks';
import { groupTasks, headerCells, normalizeTableConfig } from '../src/services/tableViews';
import { todayLocal } from '../src/services/recurrence';
import '../src/App.css';

const PEOPLE = { 'u-ace': 'Ace Jorango', 'u-mia': 'Mia Santos' };
const PROJECTS = [
  { id: 'p1', name: 'BRIDGED', color: '#0051BA' },
  { id: 'p2', name: 'AIM', color: '#7B2D8F' },
];
const TITLES = [
  'Reconcile the September ledger', 'Board pack', 'Policy review', 'Vendor contract',
  'Archive old files', 'Quarterly forecast', 'Partner onboarding', 'Site visit notes',
  'Budget variance memo', 'Compliance checklist', 'Client kickoff', 'Data migration plan',
];
const SAMPLE = TITLES.map((title, i) => ({
  id: `t${i}`,
  title,
  status: ['todo', 'doing', 'done'][i % 3],
  priority: ['high', 'medium', 'low'][i % 3],
  projectId: i % 2 ? 'p2' : 'p1',
  assignedTo: i % 4 === 0 ? ['u-ace'] : [],
  plan: { endDate: `2026-10-${String((i % 28) + 1).padStart(2, '0')}` },
  actual: {},
  tags: i % 5 === 0 ? ['client'] : [],
  progress: 0,
}));

const ctx = {
  projectById: Object.fromEntries(PROJECTS.map((p) => [p.id, p])),
  memberProfiles: Object.fromEntries(Object.entries(PEOPLE).map(([uid, n]) => [uid, { displayName: n }])),
  projects: PROJECTS,
};
const config = normalizeTableConfig({ groupBy: 'none' }, ctx);
const nameFor = (uid) => PEOPLE[uid] || 'Nobody';

function Harness() {
  const [tasks, setTasks] = useState(SAMPLE);
  const [selected, setSelected] = useState(() => new Set());
  const [anchor, setAnchor] = useState(null);
  const [log, setLog] = useState([]);

  const groups = useMemo(() => groupTasks(tasks, config, ctx), [tasks]);
  const orderedIds = useMemo(() => groups.flatMap((g) => g.tasks.map((t) => t.id)), [groups]);
  const live = useMemo(() => pruneSelection(selected, orderedIds), [selected, orderedIds]);
  const allSelected = orderedIds.length > 0 && orderedIds.every((id) => live.has(id));
  const chosen = orderedIds.filter((id) => live.has(id)).map((id) => tasks.find((t) => t.id === id));

  // Apply the plan locally instead of committing it, so the table visibly
  // changes and the sentence the toast would say is printed underneath.
  const run = (actionId, value) => {
    const question = confirmFor(actionId, chosen.length);
    const plan = bulkPlan(chosen, actionId, value, { today: todayLocal() });
    setTasks((list) => list.map((t) => {
      const w = plan.writes.find((x) => x.id === t.id);
      if (!w) return t;
      const next = { ...t, plan: { ...t.plan }, actual: { ...t.actual } };
      for (const [k, v] of Object.entries(w.patch)) {
        if (k.startsWith('plan.')) next.plan[k.slice(5)] = v;
        else if (k.startsWith('actual.')) next.actual[k.slice(7)] = v;
        else next[k] = v;
      }
      return next;
    }).filter((t) => !t.deleted));
    setSelected(new Set());
    setAnchor(null);
    setLog((l) => [{
      at: new Date().toLocaleTimeString(),
      sentence: describeBulk(actionId, value, plan, { nameFor }),
      writes: plan.writes.length,
      batches: plan.batches,
      confirmed: question ? question.title : '—',
    }, ...l].slice(0, 8));
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0, fontSize: 20 }}>Task table — selecting rows and acting on them</h1>
      <p className="muted small">
        Click a checkbox to select · shift-click a row for a range · ⌘/Ctrl-click for
        individual rows · a plain click opens the task (here it just logs).
        Nothing is written; the plan is applied locally and logged below.
      </p>

      {live.size > 0 && (
        <TaskBulkBar
          count={live.size}
          busy={false}
          members={Object.keys(PEOPLE)}
          nameFor={nameFor}
          onClear={() => { setSelected(new Set()); setAnchor(null); }}
          onRun={run}
        />
      )}

      <TasksTableGrid
        groups={groups}
        header={headerCells(config, ctx)}
        config={config}
        ctx={ctx}
        selected={live}
        allSelected={allSelected}
        totalRows={orderedIds.length}
        onToggleAll={() => { setSelected(allSelected ? new Set() : new Set(orderedIds)); setAnchor(null); }}
        onSelectRow={(id, e) => {
          const next = selectionAfterClick({
            selected: live, anchor, orderedIds, id,
            shiftKey: e.shiftKey, metaKey: e.metaKey || e.ctrlKey,
          });
          setSelected(next.selected);
          setAnchor(next.anchor);
        }}
        onOpenTask={(t) => setLog((l) => [{ at: new Date().toLocaleTimeString(), sentence: `(opened “${t.title}”)`, writes: 0, batches: 0, confirmed: '—' }, ...l].slice(0, 8))}
        onSort={() => {}}
      />

      <h2 style={{ fontSize: 14, marginTop: 24 }}>What would have been written</h2>
      {log.length === 0 ? (
        <p className="muted small">Nothing yet.</p>
      ) : (
        <table className="table">
          <thead><tr><th>At</th><th>Toast</th><th className="num">Writes</th><th className="num">Batches</th><th>Confirm</th></tr></thead>
          <tbody>
            {log.map((r, i) => (
              <tr key={i}>
                <td>{r.at}</td><td>{r.sentence}</td>
                <td className="num">{r.writes}</td><td className="num">{r.batches}</td>
                <td className="muted small">{r.confirmed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
