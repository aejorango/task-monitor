// src/components/TasksTableView.jsx — the reporting surface: every task in the
// workspace as a table you shape yourself.
//
// The Activity Log answers "what did we do". This answers "where does everything
// stand" — pick the columns you care about, group by project, phase, status,
// priority or owner, sort by any column, then save the whole arrangement as a
// view you can come back to (and share as a spreadsheet).

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTasks, useProjects, useSavedViews, useAuth } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { addSavedView, updateSavedView } from '../services/firebase';
import {
  DEFAULT_TABLE_CONFIG, GROUP_OPTIONS, TASK_TABLE_COLUMNS,
  groupTasks, headerCells, normalizeTableConfig, rowCells, tableConfigFields,
  toggleSort,
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

  const savedView = savedViewId ? views.find((v) => v.id === savedViewId) : null;
  const [config, setConfig] = useState(() => normalizeTableConfig(savedView));
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);
  const pickerRef = useRef(null);

  // Opening a saved view loads its table. Adjusted during render so the table
  // never paints with the previous view's columns for a frame.
  const [seenView, setSeenView] = useState(savedViewId);
  if (seenView !== savedViewId) {
    setSeenView(savedViewId);
    setConfig(normalizeTableConfig(savedView));
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

  const ctx = useMemo(() => ({ projectById, memberProfiles }), [projectById, memberProfiles]);
  const groups = useMemo(() => groupTasks(visible, config, ctx), [visible, config, ctx]);
  const header = headerCells(config);

  const toggleColumn = (id) => {
    setConfig((c) => {
      const has = c.columns.includes(id);
      const columns = has ? c.columns.filter((x) => x !== id) : [...c.columns, id];
      return normalizeTableConfig({ ...c, columns });
    });
  };

  const moveColumn = (id, delta) => {
    setConfig((c) => {
      const columns = [...c.columns];
      const i = columns.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= columns.length) return c;
      [columns[i], columns[j]] = [columns[j], columns[i]];
      return normalizeTableConfig({ ...c, columns });
    });
  };

  const saveView = async () => {
    setSaving(true); setNote(null);
    try {
      if (savedView) {
        await updateSavedView(savedView.id, tableConfigFields(config));
        setNote({ ok: true, text: `Saved to “${savedView.name}”.` });
      } else {
        const name = window.prompt('Name this view', 'My task table');
        if (!name?.trim()) { setSaving(false); return; }
        await addSavedView(userId, {
          workspaceId,
          name: name.trim(),
          view: 'tasks-table',
          projectFilter,
          ...tableConfigFields(config),
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
    memberProfiles,
    projectName: projectById[projectFilter]?.name || null,
  });

  if (loading) return <p className="muted">Loading tasks…</p>;

  const colSpan = config.columns.length;

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

      <div className="tt-toolbar">
        <span className="tt-toolbar-label">Group by</span>
        <select
          className="select select-sm"
          value={config.groupBy}
          onChange={(e) => setConfig((c) => normalizeTableConfig({ ...c, groupBy: e.target.value }))}
        >
          {GROUP_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
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
              {TASK_TABLE_COLUMNS.map((col) => {
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
                      <span className="tt-column-move">
                        <button
                          type="button" className="btn btn-sm btn-ghost"
                          aria-label={`Move ${col.label} left`}
                          disabled={pos <= 0}
                          onClick={() => moveColumn(col.id, -1)}
                        >↑</button>
                        <button
                          type="button" className="btn btn-sm btn-ghost"
                          aria-label={`Move ${col.label} right`}
                          disabled={pos === config.columns.length - 1}
                          onClick={() => moveColumn(col.id, 1)}
                        >↓</button>
                      </span>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ margin: '6px 8px 4px' }}
                onClick={() => setConfig(normalizeTableConfig(DEFAULT_TABLE_CONFIG))}
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
        <div className="table-wrap">
          <table className="table tt-table">
            <thead>
              <tr>
                {header.map((h) => (
                  <th
                    key={h.id}
                    className={h.align === 'right' ? 'num' : undefined}
                    aria-sort={h.sorted === 'asc' ? 'ascending' : h.sorted === 'desc' ? 'descending' : 'none'}
                  >
                    <button
                      type="button"
                      className="tt-sort"
                      onClick={() => setConfig((c) => toggleSort(c, h.id))}
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
                    <tr key={task.id} className="tt-row" onClick={() => setEditing(task)}>
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
      )}

      {editing && (
        <TaskEditor task={editing} projects={projects} onClose={() => setEditing(null)} />
      )}

      {importOpen && <ImportWizard initialKind="tasks" onClose={() => setImportOpen(false)} />}
    </>
  );
}
