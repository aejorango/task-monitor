// src/mobile/MobilePush.jsx — the screens pushed over the tabs: Minutes,
// Projects (and one project), Alerts, Goals, Settings, How to use and
// Reports. Each reads the same data the desktop page of that name does.
//
// Where the mockup has a control the app has no mobile form of (managing the
// knowledge base, webhooks, a data export, editing a goal's links), the row
// opens the real desktop page inside this screen — `embed` — rather than a
// button that does nothing.

import { Suspense, lazy, useMemo, useState } from 'react';
import {
  useMinutes, useGoals, useAllWorkspaceProjects, useAllWorkspaceTasks, useWebhooks,
} from '../hooks/useTasks';
import { useInbox } from '../hooks/useInbox';
import { useAiStatus } from '../hooks/useAiStatus';
import { useDialog } from '../components/Dialog';
import {
  updateMinute, addWorkspace, inviteToWorkspaceByEmail, updateWorkspaceMemberRole, addTask, notifyAssignment,
} from '../services/firebase';
import { setActiveWorkspaceId, setAllWorkspaces } from '../hooks/useWorkspace';
import { rateProjects } from '../services/portfolio';
import { taskPct } from '../services/goalProgress';
import { noticeWhen } from '../services/mentions';
import { TUTORIALS } from '../services/tutorials';
import { readDone, markDone, markUndone } from '../services/tutorialProgress';
import { exportDocument, heading, keyValues, table, paragraph } from '../services/exporters';
import {
  RAG_WORD, reportFor, workLogDays, attachmentsOf, goalBreakdown, weightLabel, shortDate,
  fileSize, mobileStatus, segmentNames, bySegment, sortProjects, searchProjects, PROJECT_SORTS,
} from '../services/mobileModel';
import ErrorBoundary from '../components/ErrorBoundary';
import { useMobile, Ico, ICON, Face } from './mobileUi';
import { TaskCard } from './MobileRows';
import MobileMinuteEditor from './MobileMinuteEditor';
import MobileProjectEditor from './MobileProjectEditor';

const SettingsView = lazy(() => import('../components/SettingsView'));
const GoalsView = lazy(() => import('../components/GoalsView'));

const TITLE = {
  minutes: 'Minutes', projects: 'Projects', report: 'Report', notif: 'Alerts',
  goals: 'Goals', settings: 'Settings', help: 'How to use',
};

export default function MobilePush() {
  const m = useMobile();
  const p = m.push;
  // The minutes editor is a full screen of its own, with its own Back: it
  // has to ask before throwing away a half-written meeting.
  if (p.kind === 'minute') return <MobileMinuteEditor />;
  if (p.kind === 'project-new' || p.kind === 'project-edit') return <MobileProjectEditor />;
  const project = p.kind === 'project' ? m.projectById[p.projectId] : null;
  const title = p.kind === 'project' ? (project?.name || 'Project') : p.kind === 'embed' ? p.title : TITLE[p.kind];
  const back = () => m.setPush(p.from || null);
  return (
    <div className="m-push">
      <div className="m-push-top">
        <button type="button" className="m-back" onClick={back} aria-label="Back"><Ico d={ICON.back} stroke={2.6} /></button>
        <span className="m-push-title">{title}</span>
        {p.kind === 'projects' && (
          <div className="m-push-tools">
            <button type="button" className={`m-icon-btn${p.searchOpen || p.q ? ' is-on' : ''}`} aria-label="Search projects"
              aria-pressed={!!p.searchOpen} onClick={() => m.setPush({ ...p, searchOpen: !p.searchOpen, q: p.searchOpen ? '' : p.q })}>
              <Ico d={ICON.search} size={19} stroke={2.3} />
            </button>
            <button type="button" className={`m-icon-btn${p.sort && p.sort !== 'health' ? ' is-on' : ''}`} aria-label="Sort projects"
              onClick={() => {
                m.setPicker({
                  title: 'Sort by',
                  options: Object.entries(PROJECT_SORTS).map(([k, label]) => ({ value: k, label, on: (p.sort || 'health') === k })),
                  onPick: (v) => m.setPush({ ...p, sort: v }),
                });
                m.setSheet('pick');
              }}>
              <Ico d={ICON.updown} size={19} stroke={2.3} />
            </button>
            <button type="button" className="m-push-add is-icon" aria-label="New project"
              onClick={() => m.setPush({ kind: 'project-new', from: { kind: 'projects', q: p.q, searchOpen: p.searchOpen, sort: p.sort } })}>
              <Ico d={ICON.plus} size={20} stroke={2.6} />
            </button>
          </div>
        )}
        {p.kind === 'project' && project && (
          <button type="button" className="m-push-edit" aria-label={`Edit ${project.name}`}
            onClick={() => m.setPush({ kind: 'project-edit', projectId: project.id, project, from: p })}>
            <Ico d={ICON.edit} size={16} stroke={2.4} /><span>Edit</span>
          </button>
        )}
        {p.kind === 'minutes' && (
          <button type="button" className="m-push-add" aria-label="New minutes"
            onClick={() => m.setPush({
              kind: 'minute', minuteId: null, minute: null,
              projectId: p.projectId && !p.projectId.startsWith('__') ? p.projectId : '',
              from: { kind: 'minutes', projectId: p.projectId },
            })}>
            <Ico d={ICON.plus} size={18} stroke={2.6} /><span>New</span>
          </button>
        )}
      </div>
      <div className="m-push-body">
        {p.kind === 'minutes' && <MinutesScreen />}
        {p.kind === 'projects' && <ProjectsScreen />}
        {p.kind === 'project' && project && <ProjectScreen project={project} />}
        {p.kind === 'notif' && <AlertsScreen />}
        {p.kind === 'goals' && <GoalsScreen />}
        {p.kind === 'settings' && <SettingsScreen />}
        {p.kind === 'help' && <HelpScreen />}
        {p.kind === 'report' && <ReportScreen />}
        {p.kind === 'embed' && (
          <div className="m-embed">
            {/* A desktop page failing here must cost this screen, not the app. */}
            <ErrorBoundary scope="view" viewName={p.title} resetKey={`${p.page || ''}:${p.section || ''}`}>
              <Suspense fallback={<div className="m-quiet">Loading…</div>}>
                {p.page === 'goals' ? <GoalsView /> : <SettingsView section={p.section || 'preferences'} />}
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Minutes ─────────────────────────────────────────────────────────────────

function MinutesScreen() {
  const m = useMobile();
  const { minutes, loading } = useMinutes();
  const [open, setOpen] = useState(0);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(null);
  // The filter rides on the push itself, so it survives a trip into the
  // editor and back. '__all__' | '__none__' | <projectId>, as on the desktop.
  const filter = m.push.projectId || '__all__';
  const setFilter = (id) => { m.setPush({ ...m.push, projectId: id }); setMenu(false); setOpen(0); };

  // Minutes store people as typed names. A name that is a member's is drawn
  // as that member, so a person is the same circle here as on their tasks.
  const uidFor = (name) => {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    return m.members.find((uid) => {
      const full = String(m.nameOf(uid) || '').toLowerCase();
      return full === n || full.split(/\s+/)[0] === n;
    }) || null;
  };

  const counts = useMemo(() => {
    const c = {};
    minutes.forEach((x) => { const k = x.projectId || '__none__'; c[k] = (c[k] || 0) + 1; });
    return c;
  }, [minutes]);
  // Only projects that have minutes: a filter that can only ever show nothing is noise.
  const options = [
    { id: '__all__', name: 'All', color: 'var(--m-ink)', n: minutes.length },
    ...m.projects.filter((pr) => counts[pr.id]).map((pr) => ({ id: pr.id, name: pr.name, color: pr.color, n: counts[pr.id] })),
    ...(counts.__none__ ? [{ id: '__none__', name: 'No project', color: 'var(--m-faint)', n: counts.__none__ }] : []),
  ];
  const sel = options.find((o) => o.id === filter) || { id: filter, name: m.projectById[filter]?.name || 'Project', color: m.projectById[filter]?.color, n: 0 };
  const visible = filter === '__all__' ? minutes
    : filter === '__none__' ? minutes.filter((x) => !x.projectId)
    : minutes.filter((x) => x.projectId === filter);

  const edit = (min) => m.setPush({
    kind: 'minute', minuteId: min?.id || null, minute: min || null,
    projectId: filter.startsWith('__') ? '' : filter,
    from: { kind: 'minutes', projectId: filter },
  });

  const toggleAction = async (min, idx) => {
    const next = (min.actionItems || []).map((a, i) => (i === idx ? { ...a, done: !a.done } : a));
    try { await updateMinute(min.id, { actionItems: next }); } catch (err) { m.fail(err, 'Could not tick that off.'); }
  };
  // "Make it a task", as the desktop card's + square does — and when the owner
  // is a member, the task is ASSIGNED to them (and they are told), not left
  // as a typed name.
  const makeTask = async (min, it) => {
    if (!it.text?.trim() || busy) return;
    setBusy(it.id);
    try {
      const owner = uidFor(it.owner);
      // The minute's own workspace — in All workspaces it need not be the active one.
      const ws = min.workspaceId || m.workspaceId;
      const ref = await addTask(m.userId, {
        workspaceId: ws,
        title: it.text.trim(),
        projectId: min.projectId || null,
        description: `From minutes: ${min.title || 'Untitled meeting'}`,
        plan: { endDate: it.due || null },
        assignedTo: owner ? [owner] : [],
        assignedToExternal: !owner && it.owner?.trim() ? [it.owner.trim()] : [],
      });
      await updateMinute(min.id, { actionItems: (min.actionItems || []).map((x) => (x.id === it.id ? { ...x, taskId: ref.id } : x)) });
      if (owner && owner !== m.userId) {
        await notifyAssignment({
          task: { id: ref.id, workspaceId: ws, projectId: min.projectId || null, title: it.text.trim() },
          before: [], after: [owner], byUserId: m.userId, byName: m.nameOf(m.userId),
        });
      }
      m.flash('Task created');
    } catch (err) { m.fail(err, 'Could not make that a task.'); }
    setBusy(null);
  };

  if (loading) return <div className="m-quiet">Loading minutes…</div>;
  return (
    <div className="m-stack is-12">
      {minutes.length > 0 && (
        <div className="m-proj-menu">
          <button type="button" className="m-proj-btn" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <span className="m-proj-k">PROJECT</span>
            <span className="m-dot is-10" style={{ background: sel.color || 'var(--m-faint)' }} />
            <span className="m-proj-name">{sel.name}</span>
            <span className="m-proj-count">{visible.length} meeting{visible.length === 1 ? '' : 's'}</span>
            <span className={`m-chev${menu ? ' is-up' : ''}`}>⌄</span>
          </button>
          {menu && (
            <div className="m-proj-pop" role="menu">
              {options.map((o) => (
                <button key={o.id} type="button" role="menuitemradio" aria-checked={o.id === filter}
                  className={`m-proj-opt${o.id === filter ? ' is-on' : ''}`} onClick={() => setFilter(o.id)}>
                  <span className="m-dot is-10" style={{ background: o.color || 'var(--m-faint)' }} />
                  <span className="m-proj-opt-name">{o.name}</span>
                  <span className="m-proj-opt-n">{o.n}</span>
                  <span className={`m-proj-check${o.id === filter ? ' is-on' : ''}`}>✓</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {visible.map((min, i) => {
        const items = min.actionItems || [];
        const done = items.filter((a) => a.done).length;
        const isOpen = open === i;
        const people = String(min.attendees || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
        const keeps = (min.bossMentions || []).filter((x) => x.text?.trim());
        const pushed = (min.bossPushbacks || []).filter((x) => x.text?.trim());
        const decisions = String(min.decisions || '').split('\n').map((x) => x.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean);
        const project = m.projectById[min.projectId];
        return (
          <div key={min.id} className="m-box">
            <button type="button" className="m-box-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? -1 : i)}>
              <span className="m-box-main">
                <span className="m-box-title">{min.title || 'Untitled meeting'}</span>
                <span className="m-box-meta">
                  {[shortDate(min.date, m.today), min.location, filter === '__all__' ? project?.name : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              {items.length > 0 && <span className={`m-min-count${done === items.length ? ' is-all' : ''}`}>{done}/{items.length}</span>}
            </button>
            {isOpen && (
              <div className="m-box-body">
                {people.length > 0 && (
                  <div className="m-stackfaces is-left">
                    {people.map((n) => <Face key={n} uid={uidFor(n)} name={n} size={34} className="is-stacked" />)}
                  </div>
                )}
                {min.notes && <div className="m-min-notes">{min.notes}</div>}
                {(keeps.length > 0 || pushed.length > 0) && (
                  <div className="m-priority">
                    <div className="m-priority-k">THE PRIORITY{min.bossName ? ` · ${min.bossName.toUpperCase()}` : ''}</div>
                    {keeps.map((x) => <div key={x.id} className="m-priority-keep">✓ {x.text}</div>)}
                    {pushed.map((x) => <div key={x.id} className="m-priority-push">✕ {x.text}</div>)}
                  </div>
                )}
                {decisions.map((d) => <div key={d} className="m-decision">{d}</div>)}
                {items.map((a, idx) => {
                  const linked = a.taskId ? m.tasks.find((t) => t.id === a.taskId) : null;
                  return (
                    <div key={a.id || idx} className="m-action">
                      <button type="button" className={`m-action-box${a.done ? ' is-on' : ''}`} role="checkbox" aria-checked={!!a.done}
                        aria-label={a.done ? 'Mark not done' : 'Mark done'} onClick={() => toggleAction(min, idx)}>{a.done ? '✓' : ''}</button>
                      <span className={`m-action-text${a.done ? ' is-done' : ''}`}>
                        {a.text || '—'}
                        {a.due && <span className={`m-action-due${!a.done && a.due < m.today ? ' is-late' : ''}`}>{shortDate(a.due, m.today)}</span>}
                      </span>
                      {a.owner && <Face uid={uidFor(a.owner)} name={a.owner} size={26} />}
                      {linked ? (
                        <button type="button" className="m-action-task is-linked" onClick={() => m.openTask(linked.id)} aria-label={`Open task ${linked.title}`}>Task ›</button>
                      ) : a.text?.trim() && !a.taskId && !a.done ? (
                        <button type="button" className="m-action-task" disabled={busy === a.id} onClick={() => makeTask(min, a)}
                          aria-label={`Make "${a.text}" a task`}>{busy === a.id ? '…' : '+ Task'}</button>
                      ) : null}
                    </div>
                  );
                })}
                <button type="button" className="m-ghost-pill is-edit" onClick={() => edit(min)}>Edit minutes</button>
              </div>
            )}
          </div>
        );
      })}

      {visible.length === 0 && (
        <div className="m-nothing">
          <div className="m-nothing-title">{minutes.length ? 'No minutes for this project' : 'No meeting minutes yet'}</div>
          <button type="button" className="m-pill-btn" onClick={() => edit(null)}>Write the first one</button>
        </div>
      )}
    </div>
  );
}

// ── Projects ────────────────────────────────────────────────────────────────

function teamOf(project, tasks) {
  const ids = new Set(project.members || []);
  if (project.userId) ids.add(project.userId);
  tasks.filter((t) => t.projectId === project.id).forEach((t) => (t.assignedTo || []).forEach((u) => ids.add(u)));
  return [...ids];
}

function ProjectsScreen() {
  const m = useMobile();
  const p = m.push;
  const sort = p.sort || 'health';
  const rated = useMemo(() => rateProjects(m.projects, m.tasks, m.today), [m.projects, m.tasks, m.today]);
  const segments = useMemo(() => segmentNames(m.workspace, m.projects), [m.workspace, m.projects]);
  const groups = useMemo(
    () => bySegment(sortProjects(searchProjects(rated, p.q), sort), segments),
    [rated, p.q, sort, segments],
  );
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);
  // The list's own state rides on the push, so opening a project and coming
  // Back finds the same search, sort and scroll of segments.
  const here = { kind: 'projects', q: p.q, searchOpen: p.searchOpen, sort };

  if (!rated.length) {
    return (
      <div className="m-nothing">
        <div className="m-nothing-title">No projects yet</div>
        <button type="button" className="m-pill-btn" onClick={() => m.setPush({ kind: 'project-new', from: here })}>Create the first one</button>
      </div>
    );
  }
  return (
    <div className="m-stack is-12">
      {p.searchOpen && (
        <div className="m-search">
          <Ico d={ICON.search} size={16} stroke={2.6} className="m-ink-2" />
          <input autoFocus value={p.q || ''} placeholder={`Search ${rated.length} projects`} aria-label="Search projects"
            onChange={(e) => m.setPush({ ...p, q: e.target.value })} />
        </div>
      )}
      {sort !== 'health' && (
        <div className="m-chips">
          <button type="button" className="m-fchip" onClick={() => m.setPush({ ...p, sort: 'health' })} aria-label="Back to sorting by health">
            Sorted by {PROJECT_SORTS[sort].split(' — ')[0].toLowerCase()}<span className="m-fchip-x">✕</span>
          </button>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.segment} className="m-stack is-12">
          <div className="m-seg-divider">
            <span className="m-seg-divider-name">{g.segment.toUpperCase()}</span>
            <span className="m-seg-divider-n">{g.rows.length}</span>
            <span className="m-seg-divider-rule" aria-hidden="true" />
          </div>
          {g.rows.map((h) => (
            <button key={h.project.id} type="button" className="m-pcard"
              style={{ '--m-proj': h.project.color || 'var(--m-faint)' }}
              onClick={() => m.setPush({ kind: 'project', projectId: h.project.id, from: here })}>
              <div className="m-pcard-top">
                <span className="m-pcard-name">{h.project.name}</span>
                <span className="m-pcard-rag">{RAG_WORD[h.rag]}</span>
              </div>
              <div className="m-pcard-mid">
                <span className="m-pcard-pct">{h.pct}%</span>
                <span className="m-pcard-tasks">{h.done}/{h.total} tasks{sort === 'due' && h.end ? ` · ends ${shortDate(h.end, m.today)}` : ''}</span>
                <span className="m-stackfaces is-right">
                  {teamOf(h.project, m.tasks).slice(0, 3).map((uid) => <Face key={uid} uid={uid} size={30} className="is-stacked" />)}
                </span>
              </div>
              <div className="m-pcard-track"><span style={{ width: `${h.pct}%` }} /></div>
            </button>
          ))}
        </div>
      ))}
      {shown === 0 && <div className="m-quiet">No project matches “{p.q}”.</div>}
    </div>
  );
}

function ProjectScreen({ project }) {
  const m = useMobile();
  const h = useMemo(() => rateProjects([project], m.tasks, m.today)[0], [project, m.tasks, m.today]);
  const own = m.tasks.filter((t) => t.projectId === project.id);
  const logged = Math.round(own.reduce((n, t) => n + (Number(t.totalHoursLogged) || 0), 0) * 10) / 10;
  const stuck = own.filter((t) => t.status !== 'done' && mobileStatus(t, m.blockedIds, m.today) === 'stuck').length;
  const phases = [...(project.phases || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((ph) => {
    const pt = own.filter((t) => t.phaseId === ph.id);
    return { ...ph, pct: pt.length ? Math.round(pt.filter((t) => t.status === 'done').length / pt.length * 100) : null };
  });
  const team = teamOf(project, m.tasks);
  const gap = h.elapsed == null ? null : h.pct - h.elapsed;
  const goTasks = () => {
    m.setPush(null);
    m.setTab('board');
    m.patchTv({ view: 'List', groupBy: 'due', fProj: [project.id], fWho: [], fSt: [], open: {}, more: {} });
  };
  return (
    <div className="m-stack is-16">
      <div className="m-proj-hero">
        <span className="m-hero-glow" aria-hidden="true" />
        <div className="m-proj-hero-top">
          <span className="m-proj-rag">{RAG_WORD[h.rag].toUpperCase()}</span>
          <span className="m-proj-time">{h.start && h.end ? `${shortDate(h.start)} – ${shortDate(h.end)}` : 'No dates yet'}</span>
        </div>
        <div className="m-proj-big">
          <span className="m-proj-pct">{h.pct}%</span>
          <span className="m-proj-sub">complete{h.elapsed != null ? ` · ${h.elapsed}% of time used` : ''}</span>
        </div>
        <div className="m-proj-track">
          <span className="m-proj-fill" style={{ width: `${h.pct}%` }} />
          {h.elapsed != null && <span className="m-proj-notch" style={{ left: `${h.elapsed}%` }} />}
        </div>
        {gap != null && <div className="m-proj-gap">{gap < 0 ? `${-gap} pts behind schedule` : `${gap} pts ahead of schedule`}</div>}
      </div>

      <div className="m-kpis">
        <div className="m-kpi"><span className="m-kpi-v">{h.done}/{h.total}</span><span className="m-kpi-l">TASKS</span></div>
        <div className="m-kpi"><span className="m-kpi-v">{logged}h</span><span className="m-kpi-l">LOGGED</span></div>
        <div className={`m-kpi${stuck ? ' is-red' : ''}`}><span className="m-kpi-v">{stuck}</span><span className="m-kpi-l">STUCK</span></div>
      </div>

      {phases.length > 0 && (
        <div>
          <div className="m-kicker">PHASES</div>
          <div className="m-phases">
            {phases.map((ph) => (
              <div key={ph.id}>
                <div className="m-phase-top"><span className="m-phase-n">{ph.name}</span><span className="m-phase-pct">{ph.pct == null ? '—' : `${ph.pct}%`}</span></div>
                <div className="m-phase-track"><span className={ph.pct === 100 ? 'is-done' : ''} style={{ width: `${ph.pct || 0}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="m-kicker-row">
          <span className="m-kicker">TASKS</span>
          <button type="button" className="m-navy-pill" onClick={goTasks}>{own.length} items · Open in Tasks ›</button>
        </div>
        <div className="m-stack is-9">
          {/* Open work first, soonest due first; finished work after it. */}
          {own.slice().sort((a, b) => (a.status === 'done') - (b.status === 'done')
            || String(a.plan?.endDate || '9').localeCompare(String(b.plan?.endDate || '9'))).slice(0, 8)
            .map((t) => <TaskCard key={t.id} task={t} sub="due" />)}
          {own.length === 0 && <div className="m-quiet">No tasks in this project yet.</div>}
        </div>
      </div>

      {team.length > 0 && (
        <div>
          <div className="m-kicker">TEAM</div>
          <div className="m-list">
            {team.map((uid) => (
              <div key={uid} className="m-list-row">
                <Face uid={uid} size={34} />
                <span className="m-list-name">{m.nameOf(uid)}</span>
                <span className="m-list-role">{uid === project.userId ? 'Owner' : (project.acl?.[uid] ? project.acl[uid][0].toUpperCase() + project.acl[uid].slice(1) : 'Member')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Alerts ──────────────────────────────────────────────────────────────────

const NOTICE_ICON = { mention: ['@', 'slate'], comment: ['❝', 'slate'], assignment: ['◉', 'orange'], automation: ['⚙', 'gold'] };

function AlertsScreen() {
  const m = useMobile();
  const { notices, markRead, markAllRead } = useInbox();
  return (
    <div className="m-stack is-10">
      {notices.length > 0 && (
        <button type="button" className="m-ghost-pill is-end" onClick={markAllRead}>Mark all read</button>
      )}
      {notices.map((n) => {
        const [icon, tone] = NOTICE_ICON[n.kind] || ['!', 'red'];
        return (
          <button key={n.id} type="button" className={`m-notice${n.read ? ' is-read' : ''}`}
            onClick={() => {
              markRead(n);
              m.setPush(null);
              if (n.taskId) m.openTask(n.taskId, n.kind === 'mention' || n.kind === 'comment' ? 'chat' : 'act');
            }}>
            <span className={`m-notice-icon is-${tone}`}>{icon}</span>
            <span className="m-notice-main">
              <span className="m-notice-text">{n.text}</span>
              <span className="m-notice-when">{noticeWhen(n.at)}</span>
            </span>
            {!n.read && <span className="m-unread-dot" aria-label="Unread" />}
          </button>
        );
      })}
      {notices.length === 0 && <div className="m-quiet">Nothing new. Mentions, comments and assignments land here.</div>}
    </div>
  );
}

// ── Goals ───────────────────────────────────────────────────────────────────

function GoalsScreen() {
  const m = useMobile();
  const { goals, loading } = useGoals();
  const { projects } = useAllWorkspaceProjects();
  const { tasks } = useAllWorkspaceTasks();
  const [open, setOpen] = useState(0);
  const stats = useMemo(() => {
    const s = {};
    projects.forEach((p) => {
      const pts = tasks.filter((t) => t.projectId === p.id && !t.deleted);
      s[p.id] = { id: p.id, name: p.name, color: p.color, pct: pts.length ? Math.round(pts.reduce((n, t) => n + taskPct(t), 0) / pts.length) : 0 };
    });
    return s;
  }, [projects, tasks]);
  if (loading) return <div className="m-quiet">Loading goals…</div>;
  if (!goals.length) return <div className="m-quiet">No goals yet.</div>;
  const editGoals = () => m.setPush({ kind: 'embed', page: 'goals', title: 'Goals', from: { kind: 'goals' } });
  return (
    <div className="m-stack is-12">
      {goals.map((goal, gi) => {
        const g = goalBreakdown(goal, stats);
        const isOpen = open === gi;
        return (
          <div key={goal.id} className="m-box is-flat">
            <button type="button" className="m-goal-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? -1 : gi)}>
              <span className="m-goal-top">
                <span className="m-goal-kpi">{(goal.kpi || '').toUpperCase() || 'GOAL'}</span>
                <span className="m-goal-links">{g.rows.length} project{g.rows.length === 1 ? '' : 's'}</span>
                <span className={`m-chev${isOpen ? ' is-up' : ''}`}>⌄</span>
              </span>
              <span className="m-goal-title">{goal.title || 'Untitled goal'}</span>
              <span className="m-goal-bar">
                <span className="m-goal-track">
                  {g.rows.map((r) => <span key={r.id} style={{ width: `${r.contrib}%`, background: r.color || 'var(--m-orange)' }} />)}
                </span>
                <span className="m-goal-pct">{g.pct == null ? '—' : `${g.pct}%`}</span>
              </span>
            </button>
            {isOpen && (
              <div className="m-box-body">
                <div className="m-kicker is-grey">HOW IT'S CALCULATED</div>
                {g.rows.map((r) => (
                  <button key={r.id} type="button" className="m-goal-row"
                    onClick={() => m.projectById[r.id] && m.setPush({ kind: 'project', projectId: r.id, from: { kind: 'goals' } })}>
                    <span className="m-dot is-10" style={{ background: r.color || 'var(--m-faint)' }} />
                    <span className="m-goal-row-main">
                      <span className="m-goal-row-name">{r.name}</span>
                      <span className="m-goal-row-math">{r.pct}% complete × {weightLabel(r.weight)} weight</span>
                    </span>
                    <span className="m-goal-row-c">+{Math.round(r.contrib)}%</span>
                  </button>
                ))}
                {g.rows.length === 0 && <div className="m-quiet is-left">No projects linked — nothing to measure yet.</div>}
                <button type="button" className="m-dashed-btn is-solid" onClick={editGoals}>+ Link projects</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

const ROLE_ORDER = ['admin', 'editor', 'viewer'];

function SettingsScreen() {
  const m = useMobile();
  const ask = useDialog();
  const ai = useAiStatus();
  const { hooks } = useWebhooks();
  const ws = m.workspace;
  const myRole = ws?.acl?.[m.userId];
  const canManage = myRole === 'owner' || myRole === 'admin';
  const embed = (title) => m.setPush({ kind: 'embed', section: 'ai-data', title, from: { kind: 'settings' } });
  const liveWs = m.workspaces.filter((w) => !w.deleted && !w.archived);

  const addWs = async () => {
    const name = await ask.prompt({ title: 'New workspace', label: 'Name', placeholder: 'e.g. Client work', confirmLabel: 'Create' });
    if (!name?.trim()) return;
    try { const w = await addWorkspace(m.userId, { name: name.trim() }); setActiveWorkspaceId(w.id); m.flash(`${name.trim()} created`); }
    catch (err) { m.fail(err, 'Could not create that workspace.'); }
  };
  const invite = async () => {
    if (!canManage) { m.flash('Only an owner or admin can invite', { tone: 'err' }); return; }
    const email = await ask.prompt({ title: 'Invite by email', label: 'Email', placeholder: 'name@company.com', confirmLabel: 'Invite' });
    if (!email?.trim()) return;
    try { await inviteToWorkspaceByEmail(ws, email.trim(), 'editor', m.userId); m.flash('Invite sent — they join at next sign-in'); }
    catch (err) { m.fail(err, 'Could not send that invite.'); }
  };
  const cycle = async (uid) => {
    const r = ws?.acl?.[uid];
    if (r === 'owner') { m.flash('Owner role is fixed'); return; }
    if (!canManage) { m.flash('Only an owner or admin can change roles', { tone: 'err' }); return; }
    const next = ROLE_ORDER[(ROLE_ORDER.indexOf(r) + 1) % ROLE_ORDER.length];
    try { await updateWorkspaceMemberRole(ws, uid, next); m.flash(`${m.firstOf(uid)} is ${next}`); }
    catch (err) { m.fail(err, 'Could not change that role.'); }
  };

  const aiRows = [
    { label: 'AI assistant', sub: ai.available ? 'Answers questions on your workspace' : 'Not connected on this device', cta: 'Manage' },
    { label: 'Knowledge base', sub: 'NotebookLM notebooks for grounded answers', cta: 'Manage' },
    { label: 'Webhooks', sub: `${hooks.length} endpoint${hooks.length === 1 ? '' : 's'}`, cta: 'View' },
    { label: 'Export my data', sub: 'Tasks, projects and logs as a file', cta: 'Export' },
  ];

  return (
    <div className="m-stack is-18">
      <div>
        <div className="m-kicker-row">
          <span className="m-kicker">WORKSPACES</span>
          <button type="button" className="m-link" onClick={addWs}>+ New</button>
        </div>
        <div className="m-list">
          {liveWs.length > 1 && (
            <button type="button" className={`m-list-row is-btn${m.allWorkspaces ? ' is-on' : ''}`}
              onClick={() => { setAllWorkspaces(true); m.flash('Showing all workspaces'); }}>
              <span className="m-ws-dot is-all" aria-hidden="true"><span /><span /><span /><span /></span>
              <span className="m-list-main">
                <span className="m-list-name is-bold">All workspaces</span>
                <span className="m-list-sub">Every workspace's tasks together · new items go to {m.workspace?.name || 'the active one'}</span>
              </span>
              {m.allWorkspaces && <span className="m-active-chip">ON</span>}
            </button>
          )}
          {liveWs.map((w) => {
            const on = !m.allWorkspaces && w.id === m.workspaceId;
            return (
              <button key={w.id} type="button" className={`m-list-row is-btn${on ? ' is-on' : ''}`}
                onClick={() => { setAllWorkspaces(false); setActiveWorkspaceId(w.id); m.flash(`${String(w.name || 'Workspace').split(' ')[0]} active`); }}>
                <span className="m-ws-dot" style={{ background: w.color || 'var(--m-navy)' }}>{String(w.name || '?').charAt(0)}</span>
                <span className="m-list-main">
                  <span className="m-list-name is-bold">{w.name || 'Workspace'}</span>
                  <span className="m-list-sub">{(w.members || []).length} member{(w.members || []).length === 1 ? '' : 's'}</span>
                </span>
                {on && <span className="m-active-chip">ACTIVE</span>}
              </button>
            );
          })}
        </div>
      </div>

      {ws && (
        <div>
          <div className="m-kicker-row">
            <span className="m-kicker">MEMBERS{m.allWorkspaces ? ` · ${String(ws.name || '').toUpperCase()}` : ''}</span>
            {canManage && <button type="button" className="m-link" onClick={invite}>+ Invite</button>}
          </div>
          <div className="m-list">
            {/* The active workspace's own members — roles belong to one workspace,
                whatever the screens are showing. */}
            {(ws.members || []).map((uid) => {
              const r = ws.acl?.[uid] || 'viewer';
              return (
                <button key={uid} type="button" className="m-list-row is-btn" onClick={() => cycle(uid)}>
                  <Face uid={uid} size={34} />
                  <span className="m-list-name">{m.nameOf(uid)}</span>
                  <span className={`m-role is-${r}`}>{r[0].toUpperCase() + r.slice(1)}</span>
                </button>
              );
            })}
          </div>
          {canManage && <div className="m-caption is-pad">Tap a member to change their role.</div>}
        </div>
      )}

      <div>
        <div className="m-kicker">AI &amp; DATA</div>
        <div className="m-list">
          {aiRows.map((r) => (
            <button key={r.label} type="button" className="m-list-row is-btn" onClick={() => embed(r.label)}>
              <span className="m-list-main">
                <span className="m-list-name is-bold">{r.label}</span>
                <span className="m-list-sub">{r.sub}</span>
              </span>
              <span className="m-cta">{r.cta}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── How to use ──────────────────────────────────────────────────────────────

function HelpScreen() {
  const m = useMobile();
  const [done, setDone] = useState(() => readDone(m.userId));
  const [open, setOpen] = useState(0);
  const n = TUTORIALS.filter((t) => done.has(t.id)).length;
  const flip = (id) => setDone(done.has(id) ? markUndone(m.userId, id) : markDone(m.userId, id));
  return (
    <div className="m-stack is-12">
      <div className="m-help-hero">
        <div className="m-kicker is-gold">GETTING STARTED</div>
        <div className="m-help-big"><span className="m-help-n">{n}</span><span className="m-help-of">of {TUTORIALS.length} done</span></div>
        <div className="m-help-track"><span style={{ width: `${(n / TUTORIALS.length) * 100}%` }} /></div>
      </div>
      {TUTORIALS.map((t, i) => {
        const isDone = done.has(t.id);
        const isOpen = open === i;
        return (
          <div key={t.id} className="m-box">
            <button type="button" className="m-lesson-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? -1 : i)}>
              <span className={`m-lesson-num${isDone ? ' is-done' : ''}`}>{isDone ? '✓' : i + 1}</span>
              <span className="m-box-main">
                <span className="m-lesson-title">{t.title}</span>
                <span className="m-box-meta">{t.steps.length} steps</span>
              </span>
              <span className={`m-chev${isOpen ? ' is-up' : ''}`}>⌄</span>
            </button>
            {isOpen && (
              <div className="m-lesson-body">
                {t.steps.map((s, j) => (
                  <div key={j} className="m-lesson-step">{j + 1}. {String(s.body || s.title || '').replace(/\*\*|`/g, '')}</div>
                ))}
                <button type="button" className="m-lesson-btn" onClick={() => flip(t.id)}>{isDone ? 'Mark not done' : 'Mark done'}</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Reports ─────────────────────────────────────────────────────────────────

function ReportScreen() {
  const m = useMobile();
  const [period, setPeriod] = useState('Week');
  const [rtab, setRtab] = useState('Summary');
  const r = useMemo(() => reportFor(period, {
    activities: m.activities, tasks: m.tasks, projects: m.projects, blockedIds: m.blockedIds, today: m.today,
  }), [period, m.activities, m.tasks, m.projects, m.blockedIds, m.today]);
  const days = useMemo(() => workLogDays(m.activities, { since: r.since, today: m.today }), [m.activities, r.since, m.today]);
  const files = useMemo(() => attachmentsOf(m.activities.filter((a) => a.date >= r.since)), [m.activities, r.since]);
  const max = Math.max(1, ...r.rows.map((x) => x.hours));
  const taskTitle = (id) => m.tasks.find((t) => t.id === id)?.title;

  const exportPdf = async () => {
    try {
      await exportDocument('pdf', `report-${period.toLowerCase()}`, {
        title: `${period} report`,
        blocks: [
          heading(`${period} report — ${m.workspace?.name || 'Workspace'}`),
          paragraph(`${shortDate(r.since)} to ${shortDate(m.today)}`),
          keyValues([['Logged', `${r.total}h`], ['Done', String(r.done)], ['Stuck now', String(r.stuck)]]),
          table(['Project', 'Hours'], r.rows.map((x) => [x.project?.name || 'No project', `${x.hours}h`])),
        ],
      });
      m.flash(`${period} report exported`);
    } catch (err) { m.fail(err, 'Could not export the report.'); }
  };

  return (
    <div className="m-stack is-14">
      <div className="m-seg is-period">
        {['Week', 'Month', 'Quarter'].map((p) => (
          <button key={p} type="button" className={`m-seg-btn is-40${period === p ? ' is-on' : ''}`}
            aria-pressed={period === p} onClick={() => setPeriod(p)}>{p}</button>
        ))}
      </div>
      <div className="m-rtabs" role="tablist">
        {['Summary', 'Work log', 'Artifacts'].map((t) => (
          <button key={t} type="button" role="tab" aria-selected={rtab === t}
            className={`m-rtab${rtab === t ? ' is-on' : ''}`} onClick={() => setRtab(t)}>{t}</button>
        ))}
      </div>

      {rtab === 'Summary' && (
        <div className="m-stack is-14">
          <div className="m-logged">
            <div className="m-logged-k">LOGGED</div>
            <div className="m-logged-v">{r.total}h</div>
            <div className="m-logged-chips">
              <span className="m-logged-chip is-gold">{r.done} done</span>
              <span className="m-logged-chip is-red">{r.stuck} stuck</span>
            </div>
          </div>
          <div className="m-bars">
            {r.rows.map((x) => (
              <div key={x.project?.id || 'none'}>
                <div className="m-bar-top"><span className="m-bar-name">{x.project?.name || 'No project'}</span><span className="m-bar-h">{x.hours}h</span></div>
                <div className="m-bar-track"><span style={{ width: `${(x.hours / max) * 100}%`, '--m-proj': x.project?.color || 'var(--m-faint)' }} /></div>
              </div>
            ))}
            {r.rows.length === 0 && <div className="m-quiet">Nothing logged in this period.</div>}
          </div>
          <button type="button" className="m-export" onClick={exportPdf}>Export PDF</button>
        </div>
      )}

      {rtab === 'Work log' && (
        <div className="m-stack is-14">
          {days.map((d) => (
            <div key={d.date}>
              <div className="m-day-head"><span className="m-day-name">{d.label}</span><span className="m-day-total">{d.total}h</span></div>
              <div className="m-stack is-8">
                {d.items.map((a) => (
                  <div key={a.id} className="m-wl-row">
                    <span className="m-rail" style={{ background: m.projectById[a.projectId]?.color || 'var(--m-faint)' }} />
                    <span className="m-wl-main">
                      <span className="m-wl-task">{a.taskTitle || taskTitle(a.taskId) || 'Task'}</span>
                      {(a.comment || a.bottleneckRemarks) && <span className="m-wl-text">{a.comment || `⚠ ${a.bottleneckRemarks}`}</span>}
                    </span>
                    <span className="m-wl-h">{Number(a.hoursSpent) || 0}h</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {days.length === 0 && <div className="m-quiet">Nothing logged in this period.</div>}
        </div>
      )}

      {rtab === 'Artifacts' && (
        <div className="m-stack is-9">
          {files.map((f) => (
            <a key={f.key} className="m-artifact" href={f.url || undefined} target="_blank" rel="noreferrer">
              <span className="m-artifact-type">{f.type}</span>
              <span className="m-artifact-main">
                <span className="m-artifact-name">{f.name}</span>
                <span className="m-artifact-meta">{[m.projectById[f.activity.projectId]?.name, fileSize(f.size)].filter(Boolean).join(' · ')}</span>
              </span>
              <Face uid={f.activity.userId} size={28} />
            </a>
          ))}
          {files.length === 0 && <div className="m-quiet">No files attached in this period.</div>}
        </div>
      )}
    </div>
  );
}

