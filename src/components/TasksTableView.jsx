// src/components/TasksTableView.jsx — the reporting surface: every task in the
// workspace as a table you shape yourself.
//
// The Activity Log answers "what did we do". This answers "where does everything
// stand" — pick the columns you care about, group by project, phase, status,
// priority or owner, sort by any column, then save the whole arrangement as a
// view you can come back to (and share as a spreadsheet).

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTasks, useProjects, useSavedViews, useAuth } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { addSavedView, updateSavedView, todayLocal } from '../services/firebase';
import {
  BULK_ACTIONS, PRIORITIES, PRIORITY_LABELS, STATUS_LABELS, TASK_STATUSES,
} from '../services/bulkTasks';
import { useBulkTasks } from '../hooks/useBulkTasks';
import { memberLabel } from '../services/invites';
import { useToast } from './Toast';
import { useDialog } from './Dialog';
import {
  DEFAULT_TABLE_CONFIG,
  columnCatalogue, groupOptions, groupTasks, headerCells, normalizeTableConfig,
  rowCells, tableConfigFields, toggleSort,
} from '../services/tableViews';
import { buildTaskListDocument } from '../services/taskExport';
import { friendlyError } from '../services/access';
import ExportButton from './ExportButton';
import TaskEditor from './TaskEditor';
import ImportWizard from './ImportWizard';
import Icon from './Icon';

export default function TasksTableView({ projectFilter = 'all', savedViewId = null }) {
  const { tasks, loading } = useTasks();
  const { projects, byId: projectById } = useProjects();
  const { views } = useSavedViews();
  const { userId } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const { workspaces } = useWorkspaces();
  // Memoised: a fresh {} every render would re-sort and re-group the whole
  // table on every keystroke elsewhere on the page.
  const memberProfiles = useMemo(
    () => workspaces.find((w) => w.id === workspaceId)?.memberProfiles || {},
    [workspaces, workspaceId],
  );
  // Who can be assigned in bulk. A name is picked from this list; nobody types
  // an account id, here or anywhere else.
  const memberUids = useMemo(
    () => workspaces.find((w) => w.id === workspaceId)?.members || [],
    [workspaces, workspaceId],
  );

  // Everything the columns need to render themselves — including the projects,
  // because a project's own custom fields are columns too.
  const ctx = useMemo(
    () => ({ projectById, memberProfiles, projects }),
    [projectById, memberProfiles, projects],
  );
  const columns = columnCatalogue(ctx).list;
  const grouping = groupOptions(ctx);

  const savedView = savedViewId ? views.find((v) => v.id === savedViewId) : null;
  const [config, setConfig] = useState(() => normalizeTableConfig(savedView, ctx));
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);
  const pickerRef = useRef(null);

  // Opening a saved view loads its table. Adjusted during render so the table
  // never paints with the previous view's columns for a frame.
  const [seenView, setSeenView] = useState(savedViewId);
  if (seenView !== savedViewId) {
    setSeenView(savedViewId);
    setConfig(normalizeTableConfig(savedView, ctx));
  }

  useEffect(() => {
    if (!picker) return undefined;
    const onDown = (e) => { if (!pickerRef.current?.contains(e.target)) setPicker(false); };
    const onKey = (e) => { if (e.key === 'Escape') setPicker(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [picker]);

  const [editing, setEditing] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  const visible = useMemo(
    () => (projectFilter === 'all' ? tasks : tasks.filter((t) => t.projectId === projectFilter)),
    [tasks, projectFilter],
  );

  const groups = useMemo(() => groupTasks(visible, config, ctx), [visible, config, ctx]);
  const header = headerCells(config, ctx);

  /* ── selection ──────────────────────────────────────────────────────────
     The Activity Log has had a bulk bar since the beginning and this table
     had none, so there was nowhere in the app to re-prioritise or reschedule
     ten tasks at once (T-0128 / IMP-017). Every decision below — what a click
     does, what an action writes, what the toast says — is in the pure
     services/bulkTasks.js; this component only renders it. */
  const toast = useToast();
  const ask = useDialog();

  // The rows in the order they are on screen — what a shift-range is measured
  // along. Grouping and sorting change it, so it is derived from `groups`
  // rather than from the task list.
  const orderedIds = useMemo(
    () => groups.flatMap((g) => g.tasks.map((t) => t.id)),
    [groups],
  );
  const byId = useMemo(() => {
    const map = {};
    for (const t of visible) map[t.id] = t;
    return map;
  }, [visible]);

  const nameFor = useCallback(
    (uid) => memberLabel(uid, memberProfiles, { selfUid: userId }),
    [memberProfiles, userId],
  );

  // Selecting rows and acting on them. The sequencing lives in the hook so it
  // can be driven by a test; this page cannot render without a live workspace.
  const bulk = useBulkTasks({ orderedIds, byId, toast, ask, nameFor });

  const toggleColumn = (id) => {
    setConfig((c) => {
      const has = c.columns.includes(id);
      const next = has ? c.columns.filter((x) => x !== id) : [...c.columns, id];
      return normalizeTableConfig({ ...c, columns: next }, ctx);
    });
  };

  const moveColumn = (id, delta) => {
    setConfig((c) => {
      const next = [...c.columns];
      const i = next.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= next.length) return c;
      [next[i], next[j]] = [next[j], next[i]];
      return normalizeTableConfig({ ...c, columns: next }, ctx);
    });
  };

  const saveView = async () => {
    setSaving(true); setNote(null);
    try {
      if (savedView) {
        await updateSavedView(savedView.id, tableConfigFields(config, ctx));
        setNote({ ok: true, text: `Saved to “${savedView.name}”.` });
      } else {
        const name = window.prompt('Name this view', 'My task table');
        if (!name?.trim()) { setSaving(false); return; }
        await addSavedView(userId, {
          workspaceId,
          name: name.trim(),
          view: 'tasks-table',
          projectFilter,
          ...tableConfigFields(config, ctx),
        });
        setNote({ ok: true, text: `Saved as “${name.trim()}”. It is in the sidebar.` });
      }
    } catch (err) {
      console.error(err);
      setNote({ ok: false, text: friendlyError(err, 'Could not save this view. Try again.') });
    } finally {
      setSaving(false);
      setTimeout(() => setNote(null), 6000);
    }
  };

  const buildExport = () => buildTaskListDocument(groups.flatMap((g) => g.tasks), {
    title: savedView?.name || 'Task table',
    projectById,
    projects,
    memberProfiles,
    projectName: projectById[projectFilter]?.name || null,
  });

  if (loading) return <p className="muted">Loading tasks…</p>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{savedView?.name || 'Task table'}</h1>
          <p className="page-subtitle">
            Every task, arranged how you want it. Pick the columns, group them, sort
            them — then save the arrangement or send it as a spreadsheet.
          </p>
        </div>
        <div className="page-actions">
          <ExportButton
            build={buildExport}
            baseName={savedView?.name || 'task-table'}
            kind="table"
            title="Save this table as a spreadsheet, CSV or PDF"
          />
          <button className="btn" onClick={() => setImportOpen(true)} title="Import tasks from a spreadsheet">
            Import
          </button>
          <button className="btn" onClick={saveView} disabled={saving}>
            {saving ? 'Saving…' : savedView ? '★ Update this view' : '★ Save as view'}
          </button>
        </div>
      </div>

      {bulk.selected.size > 0 && (
        <TaskBulkBar
          count={bulk.selected.size}
          busy={bulk.busy}
          members={memberUids}
          nameFor={nameFor}
          onClear={bulk.clear}
          onRun={bulk.run}
        />
      )}

      <div className="tt-toolbar">
        <span className="tt-toolbar-label">Group by</span>
        <select
          className="select select-sm"
          value={config.groupBy}
          onChange={(e) => setConfig((c) => normalizeTableConfig({ ...c, groupBy: e.target.value }, ctx))}
        >
          {grouping.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>

        <span className="tt-column-picker" ref={pickerRef}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setPicker((v) => !v)}
            aria-haspopup="true"
            aria-expanded={picker}
          >
            Columns ({config.columns.length}) ▾
          </button>
          {picker && (
            <div className="tt-column-menu">
              <p className="muted small" style={{ margin: '4px 8px 8px' }}>
                Tick what to show. Use the arrows to reorder.
              </p>
              {columns.map((col) => {
                const on = config.columns.includes(col.id);
                const pos = config.columns.indexOf(col.id);
                return (
                  <div key={col.id} className="tt-column-row">
                    <label className="tt-column-label">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={col.always}
                        onChange={() => toggleColumn(col.id)}
                      />
                      <span>{col.label}</span>
                      {col.always && <span className="muted small"> (always shown)</span>}
                    </label>
                    {on && (
                      // ← / → rather than ↑ / ↓: this is a vertical list of
                      // columns that the TABLE lays out horizontally, and the
                      // move is along the table. The glyph followed the list
                      // while the label followed the table, so the two
                      // contradicted each other (BUG-033).
                      <span className="tt-column-move">
                        <button
                          type="button" className="btn btn-sm btn-ghost"
                          aria-label={`Move ${col.label} left`}
                          title={`Move ${col.label} left`}
                          disabled={pos <= 0}
                          onClick={() => moveColumn(col.id, -1)}
                        >←</button>
                        <button
                          type="button" className="btn btn-sm btn-ghost"
                          aria-label={`Move ${col.label} right`}
                          title={`Move ${col.label} right`}
                          disabled={pos === config.columns.length - 1}
                          onClick={() => moveColumn(col.id, 1)}
                        >→</button>
                      </span>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ margin: '6px 8px 4px' }}
                onClick={() => setConfig(normalizeTableConfig(DEFAULT_TABLE_CONFIG, ctx))}
              >
                Reset to the default columns
              </button>
            </div>
          )}
        </span>

        <span className="muted small">
          {visible.length} task{visible.length === 1 ? '' : 's'}
          {projectById[projectFilter] && <> in {projectById[projectFilter].name}</>}
        </span>
        {note && (
          <span className={`small ${note.ok ? 'ok-text' : 'link-danger'}`} role="status">{note.text}</span>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">▤</div>
          <p>No tasks yet.</p>
          <p className="small">Add one on the Kanban board and it appears here.</p>
        </div>
      ) : (
        <TasksTableGrid
          groups={groups}
          header={header}
          config={config}
          ctx={ctx}
          selected={bulk.selected}
          allSelected={bulk.allSelected}
          totalRows={orderedIds.length}
          onToggleAll={bulk.toggleAll}
          onSelectRow={bulk.clickRow}
          onOpenTask={setEditing}
          onSort={(id) => setConfig((c) => toggleSort(c, id, ctx))}
        />
      )}

      {editing && (
        <TaskEditor task={editing} projects={projects} onClose={() => setEditing(null)} />
      )}

      {importOpen && <ImportWizard initialKind="tasks" onClose={() => setImportOpen(false)} />}
    </>
  );
}

/* ── The grid ──────────────────────────────────────────────────────────────
   Presentational: it is handed the groups, the columns and the selection, and
   it reports clicks back. Nothing here reaches for Firestore, which is what
   lets a test mount the real table with real tasks and actually click it —
   TasksTableView itself cannot render at all without a live workspace. */

export function TasksTableGrid({
  groups, header, config, ctx, selected, allSelected, totalRows,
  onToggleAll, onSelectRow, onOpenTask, onSort,
}) {
  const colSpan = config.columns.length + 1;   // + the selection column
  return (
    <div className="table-wrap">
      <table className="table tt-table">
        <thead>
          <tr>
            <th className="tt-pick">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label={allSelected ? 'Clear the selection' : `Select all ${totalRows} tasks`}
                title={allSelected ? 'Clear the selection' : 'Select every row'}
              />
            </th>
            {header.map((h) => (
              <th
                key={h.id}
                className={h.align === 'right' ? 'num' : undefined}
                aria-sort={h.sorted === 'asc' ? 'ascending' : h.sorted === 'desc' ? 'descending' : 'none'}
              >
                <button
                  type="button"
                  className="tt-sort"
                  onClick={() => onSort(h.id)}
                  title={`Sort by ${h.label}`}
                >
                  {h.label}
                  {h.sorted && <span className="tt-sort-arrow">{h.sorted === 'asc' ? '▲' : '▼'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.key}>
              {group.label && (
                <tr className="tt-group-row">
                  <td colSpan={colSpan}>
                    <Icon name="projects" size={14} /> {group.label}
                  </td>
                </tr>
              )}
              {group.tasks.map((task) => (
                <tr
                  key={task.id}
                  className={`tt-row${selected.has(task.id) ? ' is-selected' : ''}${task._depth ? ` is-child d${Math.min(task._depth, 4)}` : ''}`}
                  onClick={(e) => {
                    // Shift or ⌘/Ctrl extends the selection; a plain click still
                    // opens the task, which is what the row did before
                    // selection existed.
                    if (e.shiftKey || e.metaKey || e.ctrlKey) onSelectRow(task.id, e);
                    else onOpenTask(task);
                  }}
                  // Shift-click is also the browser's "extend the text
                  // selection" gesture; without this the range you took comes
                  // with half the table highlighted behind it.
                  onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                >
                  <td className="tt-pick" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(task.id)}
                      onChange={(e) => onSelectRow(task.id, e.nativeEvent)}
                      aria-label={`Select ${task.title}`}
                    />
                  </td>
                  {rowCells(task, config, ctx).map((cell) => (
                    <td key={cell.id} className={cell.align === 'right' ? 'num' : undefined}>
                      {cell.text}
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Bulk bar ──────────────────────────────────────────────────────────────
   One button per action from BULK_ACTIONS, so the bar and the runner can never
   offer different things. Every value is PICKED — a status, a priority, a
   person, a date, a tag — and nothing is typed except the tag's own name.
   Nobody is ever asked for an id. */

export function TaskBulkBar({ count, busy, members = [], nameFor, onClear, onRun }) {
  // Which action's picker is open, if any. One at a time: two open menus over a
  // table is how you apply the wrong one.
  const [open, setOpen] = useState(null);
  const barRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!barRef.current?.contains(e.target)) setOpen(null); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(null); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (actionId, value) => { setOpen(null); onRun(actionId, value); };

  const choicesFor = (action) => {
    switch (action.valueKind) {
      case 'status':
        return TASK_STATUSES.map((v) => ({ value: v, label: STATUS_LABELS[v] }));
      case 'priority':
        return PRIORITIES.map((v) => ({ value: v, label: PRIORITY_LABELS[v] }));
      case 'assignee':
        return [
          ...members.map((uid) => ({ value: uid, label: nameFor(uid) })),
          { value: '', label: 'Nobody' },
        ];
      default:
        return null;
    }
  };

  return (
    <div className="bulk-bar" ref={barRef}>
      <span className="bulk-bar-count">
        <strong>{count}</strong> selected
      </span>
      <button className="btn btn-sm btn-ghost" onClick={onClear}>Clear</button>
      <div style={{ flex: 1 }} />

      {BULK_ACTIONS.map((action) => {
        const choices = choicesFor(action);

        // Delete needs no value — it asks for a confirmation instead.
        if (action.valueKind === 'none') {
          return (
            <button
              key={action.id}
              className={`btn btn-sm${action.danger ? ' btn-danger' : ''}`}
              disabled={busy}
              onClick={() => pick(action.id)}
            >{action.label}</button>
          );
        }

        return (
          <div key={action.id} className="dropdown">
            <button
              className="btn btn-sm"
              disabled={busy}
              aria-haspopup="true"
              aria-expanded={open === action.id}
              onClick={() => setOpen(open === action.id ? null : action.id)}
            >{action.label} ▾</button>

            {open === action.id && (
              <div className="dropdown-menu">
                {choices && choices.map((c) => (
                  <button
                    key={c.value || '__none__'}
                    className="dropdown-item"
                    onClick={() => pick(action.id, c.value)}
                  >{c.label}</button>
                ))}
                {action.valueKind === 'date' && (
                  <BulkDateField onApply={(v) => pick(action.id, v)} />
                )}
                {action.valueKind === 'tag' && (
                  <BulkTagField onApply={(v) => pick(action.id, v)} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A due date for the whole selection, or no due date at all. */
function BulkDateField({ onApply }) {
  const [value, setValue] = useState(todayLocal());
  return (
    <div className="bulk-field">
      <label className="label" htmlFor="bulk-due-date">New due date</label>
      <input
        id="bulk-due-date"
        type="date"
        className="input input-sm"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onApply(value); }}
      />
      <div className="bulk-field-actions">
        <button className="btn btn-sm" onClick={() => onApply('')}>Clear the date</button>
        <button className="btn btn-sm btn-primary" disabled={!value} onClick={() => onApply(value)}>
          Apply
        </button>
      </div>
    </div>
  );
}

/** A tag to add to everything selected. Added to what is there, never over it. */
function BulkTagField({ onApply }) {
  const [value, setValue] = useState('');
  const clean = value.trim().replace(/^#/, '');
  return (
    <div className="bulk-field">
      <label className="label" htmlFor="bulk-tag">Tag to add</label>
      <input
        id="bulk-tag"
        className="input input-sm"
        value={value}
        autoFocus
        placeholder="e.g. client"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && clean) onApply(clean); }}
      />
      <div className="bulk-field-actions">
        <button className="btn btn-sm btn-primary" disabled={!clean} onClick={() => onApply(clean)}>
          Add #{clean || '…'}
        </button>
      </div>
    </div>
  );
}
