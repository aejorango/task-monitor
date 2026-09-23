// dev/shell.jsx — dev-only harness for the icon rail and the page chrome.
//
// The rail, the breadcrumb strip, the title block and the tab strip, wired to a
// fake route so every hub and every page can be clicked through without signing
// in. The real components: HUBS and tabsForView come from services/views.js,
// PageHeader is the production one, so a hub added to the registry shows up
// here the same day.
//
// Open: http://localhost:5175/dev/shell.html
// Not part of the production build (vite builds index.html only).
//
// A harness is an entry point, not a module anything imports.
/* eslint-disable react-refresh/only-export-components */

import { Fragment, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Icon from '../src/components/Icon';
import PageHeader, { PageActions, PageSubtitle } from '../src/components/PageHeader';
import { HUBS, hubForView, hubLanding, RENDERABLE_VIEWS } from '../src/services/views';
import { Tile } from '../src/components/DashboardView';
import WorkspaceSwitcher from '../src/components/WorkspaceSwitcher';
import Avatar, { AvatarStack } from '../src/components/Avatar';
import FindItem from '../src/components/FindItem';
import '../src/App.css';

const WORKSPACES = [
  { id: 'w1', name: 'BRIDGED — Q3 roadmap', color: '#0051BA', icon: '◆', members: ['a', 'b', 'c', 'd'] },
  { id: 'w2', name: 'Personal',             color: '#7B2D8F', icon: '★', members: ['a'] },
];

const SUBTITLES = {
  dashboard: '4 projects · 84 items · 201h logged this week',
  projects:  '4 active · 1 archived',
  board:     '23 items · 3 blocked · WIP 5 / 3',
  review:    'This week (7d) · Jul 14 – Jul 20',
  messages:  '2 conversations · 1 unread',
  settings:  'This device · theme, week start, alerts',
};

function Sample({ view }) {
  return (
    <>
      <PageSubtitle>{SUBTITLES[view] || `The ${view} page`}</PageSubtitle>
      <PageActions>
        <button className="cmd">
          <span className="cmd-icon"><Icon name="plus" size={14} /></span>New item
        </button>
        <button className="cmd">Export</button>
        <button className="cmd cmd-primary">Share</button>
      </PageActions>
      {view === 'dashboard' ? <DashboardSample /> : view === 'projects' ? <ProjectsSample /> : view === 'board' ? <BoardSample /> : view === 'review' ? <ReportSample /> : view === 'settings' ? <SettingsSample /> : view === 'messages' ? <MessagesSample /> : NEW_SAMPLES[view] ? NEW_SAMPLES[view]() : (
        <div className="card" style={{ padding: 24 }}>
          <h2 style={{ marginTop: 0, fontSize: 15 }}>Page body</h2>
          <p className="muted small" style={{ margin: 0 }}>
            The real view renders here. This harness only exercises the chrome
            around it: rail highlight, breadcrumb, title, subtitle, commands, tabs.
          </p>
        </div>
      )}
    </>
  );
}

function Harness() {
  const [view, setView] = useState('dashboard');
  const [ws, setWs] = useState('w1');
  const [online, setOnline] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [find, setFind] = useState('');

  const route = { view, projectFilter: 'all', savedViewId: null };
  const navigate = (patch) => { if (patch.view) setView(patch.view); };
  const activeHub = hubForView(view);
  const current = RENDERABLE_VIEWS.find((v) => v.id === view) || { label: view };

  return (
    <div className={`app-shell${narrow ? ' rail-narrow' : ''}`}>
      {drawer && <div className="sidebar-overlay" onClick={() => setDrawer(false)} aria-hidden="true" />}
      <aside className={`rail${drawer ? ' open' : ''}`} aria-label="Sections">
        <div className="rail-brand-row">
          <div className="rail-brand" title="Task Monitor">TM</div>
          <span className="rail-brand-name">Task Monitor</span>
          <button
            className="rail-collapse"
            onClick={() => setNarrow((n) => !n)}
            aria-pressed={narrow}
            aria-label={narrow ? 'Expand the sidebar' : 'Collapse the sidebar to icons'}
            title={narrow ? 'Expand the sidebar' : 'Collapse the sidebar to icons'}
          >{narrow ? '»' : '«'}</button>
        </div>
        <div className="rail-ws">
          <WorkspaceSwitcher
            workspaces={WORKSPACES}
            activeId={ws}
            onSwitch={setWs}
            onManage={() => setView('workspaces')}
          />
        </div>
        <div className="rail-label">Sections</div>
        <nav className="rail-nav">
          {HUBS.map((h) => {
            const isActive = activeHub?.id === h.id;
            return (
              <button
                key={h.id}
                className={`rail-btn${isActive ? ' active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                title={h.label}
                onClick={() => { setView(hubLanding(h.id)); setDrawer(false); }}
              >
                <Icon name={h.icon} size={19} />
                <span className="rail-btn-label">{h.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="rail-foot">
          <button className="sidebar-user-block">
            <div className="sidebar-user-avatar fallback">A</div>
            <div className="sidebar-user-text">
              <div className="sidebar-user-name">Ace Jorango</div>
              <div className="sidebar-user-sub">Superadmin · v1</div>
            </div>
          </button>
        </div>
      </aside>


      <PageHeader
        route={route}
        navigate={navigate}
        pageLabel={current.label}
        pageIcon={current.icon}
        workspaceName={WORKSPACES.find((w) => w.id === ws)?.name}
        onToggleMenu={() => setDrawer((d) => !d)}
        tools={<>
          <span className="chip">★ Saved views</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setOnline((o) => !o)}>
            {online ? 'Go offline' : 'Go online'}
          </button>
        </>}
        projectPicker={(
          <span className="chip">All projects ▾</span>
        )}
        search={activeHub?.id === 'board'
          ? <FindItem value={find} onChange={(v) => setFind(v || '')} />
          : null}
        status={<>
          {activeHub?.id === 'board' && (
            <span className="crumb-chip stuck"><span className="crumb-dot" />2 stuck</span>
          )}
          <span className={`crumb-live${online ? '' : ' is-off'}`}>{online ? 'live' : 'offline'}</span>
        </>}
      />

      {activeHub?.id === 'board' && <ToolbarSample />}

      <main className="content">
        <Sample key={view} view={view} />
      </main>
    </div>
  );
}


// ─── The Board hub's shared toolbar (static twin of BoardToolbar) ─────────
const FACES = [['Ace'], ['Rob'], ['Mary'], ['Tim'], ['Pam']].map(([n]) => [n, null]);
function ToolbarSample() {
  const [scope, setScope] = useState('all');
  const [who, setWho] = useState(null);
  return (
    <div className="bt" role="group" aria-label="Board filters">
      <button className="bt-new">+ New item</button>
      {['All', 'Mine', 'Stuck'].map((label) => {
        const id = label.toLowerCase();
        return (
          <button
            key={id}
            className={`bt-pill${scope === id ? ' is-on' : ''}`}
            aria-pressed={scope === id}
            onClick={() => setScope(id)}
          >{label}</button>
        );
      })}
      <div className="bt-faces">
        {who && <button className="bt-clear" onClick={() => setWho(null)}>Everyone</button>}
        {FACES.map(([initial]) => (
          <span
            key={initial}
            className={`bt-face${who === initial ? ' is-on' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => setWho(who === initial ? null : initial)}
            onKeyDown={(e) => { if (e.key === 'Enter') setWho(who === initial ? null : initial); }}
          ><Avatar id={initial} name={initial} size={28} /></span>
        ))}
      </div>
    </div>
  );
}

// ─── Dashboard overview, at the fidelity the mockup specifies ──────────────
// Static rows in the real classes: this is what the CSS has to hold, checked
// without a workspace, a sign-in or a network.

const P = [
  { id: 'p1', name: 'SBLAF onboarding', color: '#0051BA', rag: 'RED',   pct: 64 },
  { id: 'p2', name: 'Partner API integration', color: '#e2892e', rag: 'AMBER', pct: 50 },
  { id: 'p3', name: 'Marketplace redesign', color: '#7B2D8F', rag: 'GREEN', pct: 83 },
];
const ROWS = {
  p1: [
    { t: 'Migrate legacy loan records', s: 'stuck', o: ['D', '#e2892e', 'Diana'], due: '12d late', late: true, pct: 35 },
    { t: 'Finalize disbursement copy',  s: 'stuck', o: ['R', '#1D7CC7', 'Rob'],   due: '3d late', late: true, pct: 60 },
    { t: 'KYC vendor sign-off',         s: 'todo',  o: null,                      due: 'Jul 24', pct: 0 },
    { t: 'Eligibility rules draft',     s: 'done',  o: ['M', '#137a36', 'Mary'],  due: 'Jul 12', pct: 100 },
  ],
  p2: [
    { t: 'Sandbox key rotation', s: 'done',  o: ['R', '#1D7CC7', 'Rob'], due: 'Jul 19', pct: 100 },
    { t: 'Webhook retry logic',  s: 'doing', o: ['R', '#1D7CC7', 'Rob'], due: 'Jul 28', pct: 45 },
  ],
  p3: [
    { t: 'Ship marketplace filter chips', s: 'done',  o: ['T', '#7B2D8F', 'Tim'], due: 'Jul 15', pct: 100 },
    { t: 'Card A/B setup',                s: 'doing', o: ['P', '#16324d', 'Pam'], due: 'Jul 31', pct: 70 },
  ],
};
const LABEL = { todo: 'To do', doing: 'Working on it', review: 'In review', done: 'Done', stuck: 'Stuck' };
const KLABEL = { todo: 'Not started', doing: 'Working on it', review: 'In review', done: 'Done' };
const KTONE  = { todo: 'navy', doing: 'amber', review: 'info', done: 'green' };
const STAGES = [
  { name: 'Backlog',  count: 31, tone: 'navy',  state: 'unscheduled' },
  { name: 'Planned',  count: 14, tone: 'navy',  state: 'has a date' },
  { name: 'Building', count: 9,  tone: 'amber', state: 'at limit' },
  { name: 'Blocked',  count: 3,  tone: 'red',   state: 'needs a decision' },
  { name: 'Shipped',  count: 26, tone: 'green', state: 'done' },
];
const RUNS = [
  ['Migrate legacy loan records', 'red',   'Blocked',     '3h', 'Jul 20'],
  ['Sandbox key rotation',        'green', 'Completed',   '2h', 'Jul 19'],
  ['Card A/B setup',              'amber', 'In progress', '4h', 'Jul 19'],
  ['Audit checklist review',      'navy',  'Not started', '—',  'Jul 18'],
];
const ALERTS = [
  ['Sev 1', 'red',   'Migrate legacy loan records', 'SBLAF onboarding · 12 days past due · 2 more overdue'],
  ['Sev 2', 'red',   'Finalize disbursement copy',  'Blocked 4 days · waiting on legal sign-off'],
  ['Sev 3', 'amber', 'Diana is over capacity',      '42.0h logged against 35h · this week'],
];
const TEAM = [
  ['D', '#e2892e', 'Diana', 120, 'red'],
  ['R', '#1D7CC7', 'Rob',    89, 'amber'],
  ['M', '#137a36', 'Mary',   74, 'green'],
  ['T', '#7B2D8F', 'Tim',    56, 'green'],
  ['P', '#16324d', 'Pam',    40, 'green'],
];

function DashboardSample() {
  const [closed, setClosed] = useState({});
  return (
    <>
      <div className="tiles">
        <Tile tone="navy"  icon="◈" label="Items in flight" value={23} delta="+4" bar={62} sub="across 4 projects" />
        <Tile tone="red"   icon="!" label="Blocked"         value={3}  bar={13} sub="oldest 12 days" />
        <Tile tone="amber" icon="◷" label="Due this week"   value={9}  bar={38} sub="2 unassigned" />
        <Tile tone="green" icon="✓" label="Throughput"      value={11} delta="5.5h today" bar={78} sub="completed in the last 7 days" />
      </div>

      <section className="mboard">
        <div className="mboard-head">
          <h2 className="mboard-title">Main board</h2>
          <span className="mboard-chip">grouped by project</span>
          <div className="mboard-legend">
            <span className="sbadge sbadge-todo">To do</span>
            <span className="sbadge sbadge-doing">Working on it</span>
            <span className="sbadge sbadge-done">Done</span>
          </div>
        </div>
        <div className="mboard-cols">
          <span /><span>Item</span><span>Status</span><span>Owner</span><span>Due</span><span>Progress</span>
        </div>
        {P.map((g) => (
          <div key={g.id}>
            <div
              className="mboard-group"
              role="button"
              tabIndex={0}
              aria-expanded={!closed[g.id]}
              onClick={() => setClosed((c) => ({ ...c, [g.id]: !c[g.id] }))}
            >
              <span className={`mboard-chev${closed[g.id] ? '' : ' open'}`} aria-hidden="true">▸</span>
              <span className="mboard-group-name" style={{ color: g.color }}>{g.name}</span>
              <span className="mboard-group-count">{ROWS[g.id].length} items</span>
              <span className={`ragchip ragchip-${g.rag.toLowerCase()}`}>{g.rag}</span>
              <span className="mboard-group-pct">{g.pct}% complete</span>
            </div>
            {!closed[g.id] && ROWS[g.id].map((r, i) => (
              <div key={r.t} className={`mboard-row${i % 2 ? ' alt' : ''}`} role="button" tabIndex={0}>
                <span className="mboard-rail" style={{ background: g.color }} aria-hidden="true" />
                <span className="mboard-cell">
                  <span className={`mboard-check${r.s === 'done' ? ' on' : ''}`} aria-hidden="true">{r.s === 'done' ? '✓' : ''}</span>
                </span>
                <span className={`mboard-item${r.s === 'done' ? ' done' : ''}`}>{r.t}</span>
                <span className="mboard-cell"><span className={`sbadge sbadge-${r.s}`}>{LABEL[r.s]}</span></span>
                <span className="mboard-cell mboard-owner">
                  {r.o
                    ? <><span className="mboard-av" style={{ background: r.o[1] }}>{r.o[0]}</span><span className="mboard-owner-name">{r.o[2]}</span></>
                    : <span className="mboard-owner-none">Unassigned</span>}
                </span>
                <span className={`mboard-due${r.late ? ' late' : ''}`}>{r.due}</span>
                <span className="mboard-cell mboard-prog">
                  <span className="mboard-track">
                    <span className="mboard-fill" style={{ width: `${r.pct}%`, background: r.pct === 100 ? 'var(--c-done)' : g.color }} />
                  </span>
                  <span className="mboard-pct">{r.pct}%</span>
                </span>
              </div>
            ))}
          </div>
        ))}
      </section>

      <div className="db-split">
        <section className="dcard">
          <div className="dcard-head">
            <h2 className="dcard-title">Delivery pipeline</h2>
            <span className="pipe-chip">3 of 5 stages healthy</span>
          </div>
          <p className="dcard-sub">Items flowing through BRIDGED — Q3 roadmap right now.</p>
          <div className="stage-flow">
            {STAGES.map((st) => (
              <div key={st.name} className={`stage stage-${st.tone}`}>
                <div className="stage-name">{st.name}</div>
                <div className="stage-count">{st.count}</div>
                <div className="stage-state">{st.state}</div>
              </div>
            ))}
          </div>
          <div className="dcard-label">Recent activity</div>
          <div className="runs">
            {RUNS.map(([name, tone, state, dur, when]) => (
              <div key={name} className="run" role="button" tabIndex={0}>
                <span className={`run-dot tone-${tone}`} aria-hidden="true" />
                <span className="run-name">{name}</span>
                <span className={`run-state tone-${tone}`}>{state}</span>
                <span className="run-dur">{dur}</span>
                <span className="run-when">{when}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="db-rail">
          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title">Active alerts</h2>
              <span className="alert-count">3</span>
            </div>
            <div className="alerts">
              {ALERTS.map(([sev, tone, title, meta]) => (
                <div key={title} className={`alert alert-${tone}`}>
                  <div className="alert-top">
                    <span className={`alert-sev tone-${tone}`}>{sev}</span>
                    <span className="alert-title">{title}</span>
                  </div>
                  <div className="alert-meta">{meta}</div>
                </div>
              ))}
            </div>
          </section>
          <section className="dcard">
            <h2 className="dcard-title">Team utilization</h2>
            <p className="dcard-sub">Against 35h weekly capacity</p>
            <div className="util">
              {TEAM.map(([ini, color, name, pct, tone]) => (
                <div key={name} className="util-row">
                  <span className="util-av" style={{ background: color }}>{ini}</span>
                  <span className="util-name">{name}</span>
                  <span className="util-track"><span className={`util-fill tone-${tone}`} style={{ width: `${Math.min(pct, 100)}%` }} /></span>
                  <span className={`util-pct tone-${tone}`}>{pct}%</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}


// ─── Projects portfolio table ──────────────────────────────────────────────
const PT = [
  { band: 'At risk', tone: 'red', rows: [
    { n: 'SBLAF onboarding', ic: 'S', c: '#0051BA', meta: '22 items · Lending', rag: 'Red', ragK: 'red',
      team: [['D', '#e2892e'], ['R', '#1D7CC7'], ['M', '#137a36']], more: 1,
      tl: 'Jun 15 – Jul 24', pct: 64, el: 92, h: '46h' },
  ] },
  { band: 'Needs attention', tone: 'amber', rows: [
    { n: 'Partner API integration', ic: 'P', c: '#e2892e', meta: '18 items · Platform', rag: 'Amber', ragK: 'amber',
      team: [['R', '#1D7CC7'], ['P', '#16324d']], more: 0,
      tl: 'Jun 22 – Aug 8', pct: 50, el: 68, h: '31h' },
  ] },
  { band: 'On track', tone: 'green', rows: [
    { n: 'Marketplace redesign', ic: 'M', c: '#7B2D8F', meta: '24 items · Product', rag: 'Green', ragK: 'green',
      team: [['T', '#7B2D8F'], ['P', '#16324d'], ['D', '#e2892e']], more: 0,
      tl: 'May 30 – Jul 31', pct: 83, el: 80, h: '96h' },
    { n: 'Compliance & audit', ic: 'C', c: '#137a36', meta: '12 items · Risk', rag: 'Green', ragK: 'green',
      team: [['M', '#137a36'], ['D', '#e2892e']], more: 0,
      tl: 'Jul 1 – Sep 12', pct: 58, el: 55, h: '28h' },
  ] },
];

function ProjectsSample() {
  const [closed, setClosed] = useState({});
  return (
    <>
      <div className="tiles">
        <Tile tone="navy"  label="Active"    value={4}     sub="2 on track" />
        <Tile tone="red"   label="At risk"   value={1}     sub="SBLAF onboarding" />
        <Tile tone="amber" label="Due ≤ 14d" value={2}     sub="ending inside a fortnight" />
        <Tile tone="green" label="Delivered" value="64%" bar={64} sub="average completion" />
      </div>

      <div className="ptable">
        <div className="ptable-bar">
          <button className="pill pill-accent">+ New project</button>
          <button className="pill">◫ Group: Segment</button>
          <button className="pill">⚙ Segments</button>
          <span className="ptable-count">4 projects shown</span>
        </div>
        <div className="ptable-cols">
          <span>Project</span><span>Health</span><span>Team</span>
          <span>Timeline</span><span>Progress</span><span>Hours</span>
        </div>
        {PT.map((g) => (
          <div key={g.band}>
            <div
              className="ptable-group" role="button" tabIndex={0}
              aria-expanded={!closed[g.band]}
              onClick={() => setClosed((c) => ({ ...c, [g.band]: !c[g.band] }))}
            >
              <span className={`ptable-chev${closed[g.band] ? '' : ' open'}`} aria-hidden="true">▸</span>
              <span className={`ptable-group-name tone-ink-${g.tone}`}>{g.band}</span>
              <span className="ptable-group-count">{g.rows.length}</span>
            </div>
            {!closed[g.band] && g.rows.map((r, i) => (
              <div key={r.n} className={`ptable-row${i % 2 ? ' alt' : ''}`} role="button" tabIndex={0}>
                <span className="ptable-rail" style={{ background: r.c }} aria-hidden="true" />
                <span className="ptable-name-cell">
                  <span className="ptable-icon" style={{ background: r.c }} aria-hidden="true">{r.ic}</span>
                  <span className="ptable-name-text">
                    <span className="ptable-name">{r.n}</span>
                    <span className="ptable-meta">{r.meta}</span>
                  </span>
                </span>
                <span className="ptable-cell"><span className={`ragchip ragchip-${r.ragK}`}>{r.rag}</span></span>
                <span className="ptable-cell ptable-team">
                  {r.team.map(([ini, col], k) => (
                    <span key={ini} className="ptable-av" style={{ background: col, marginLeft: k ? -6 : 0 }}>{ini}</span>
                  ))}
                  {r.more > 0 && <span className="ptable-more">+{r.more}</span>}
                </span>
                <span className="ptable-timeline">{r.tl}</span>
                <span className="ptable-cell ptable-prog">
                  <span className="ptable-track">
                    <span className="ptable-fill" style={{ width: `${r.pct}%`, background: r.c }} />
                    <span className="ptable-notch" style={{ left: `${r.el}%` }} />
                  </span>
                  <span className="ptable-pct">{r.pct}%</span>
                </span>
                <span className="ptable-hours">{r.h}</span>
              </div>
            ))}
          </div>
        ))}
        <div className="ptable-key">
          <span className="ptable-key-item"><span className="ptable-key-notch" />today in the project’s span</span>
          <span className="ptable-key-item"><span className="ragchip ragchip-red">Red</span>needs attention now</span>
          <span className="ptable-key-item"><span className="ragchip ragchip-amber">Amber</span>watch it</span>
          <span className="ptable-key-item"><span className="ragchip ragchip-green">Green</span>on track</span>
        </div>
      </div>
    </>
  );
}


// ─── Kanban columns and cards ──────────────────────────────────────────────
const COLS = [
  { id: 'todo',   label: 'To Do',       count: 3, limit: null, fill: null },
  { id: 'doing',  label: 'In Progress', count: 4, limit: 4,    fill: 100, state: 'is-over' },
  { id: 'review', label: 'In Review',   count: 2, limit: 3,    fill: 67 },
  { id: 'done',   label: 'Done',        count: 4, limit: null, fill: null },
];
const CARDS = {
  todo: [
    { t: 'KYC vendor sign-off', c: '#0051BA', prio: 'high', due: 'Due Fri', tags: ['client'], who: 'Diana' },
    { t: 'Eligibility rules draft', c: '#0051BA', prio: 'medium', due: 'Due Oct 12', who: 'Mary' },
  ],
  doing: [
    { t: 'Migrate legacy loan records', c: '#0051BA', prio: 'high', due: '12d late', late: true,
      flags: ['Blocked', '◷ 12d in progress'], sub: [2, 5], who: 'Rob', pct: 35 },
    { t: 'Card A/B setup', c: '#7B2D8F', prio: 'medium', due: 'Due today', sub: [1, 3], who: 'Tim', pct: 45 },
  ],
  review: [
    { t: 'Webhook retry logic', c: '#e2892e', prio: 'medium', due: 'Jul 21', who: 'Rob', pct: 85 },
    { t: 'De-dup borrower records', c: '#0051BA', prio: 'medium', due: 'Jul 25', who: 'Pam', pct: 80 },
  ],
  done: [
    { t: 'Ship marketplace filter chips', c: '#7B2D8F', prio: 'low', due: 'Jul 19', who: 'Pam' },
    { t: 'KYC data model spec', c: '#0051BA', prio: 'high', due: 'Jul 18', who: 'Diana' },
  ],
};

const BANDS = [
  { id: 'sblaf',   name: 'SBLAF onboarding', color: '#0051BA', open: true },
  { id: 'partner', name: 'Partner API',      color: '#e2892e', open: false },
  { id: 'market',  name: 'Marketplace',      color: '#7B2D8F', open: false },
];
const ST_CLASS = { todo: 'st-todo', doing: 'st-doing', review: 'st-review', done: 'st-done' };
const PRIO_CLASS = { high: 'p-high', medium: 'p-med', low: 'p-low' };

function BoardSample() {
  const [open, setOpen] = useState({ sblaf: true });
  return (
    <div className="bx-board">
      <div className="bx-cols" style={{ '--bx-n': COLS.length }}>
        {COLS.map((c) => (
          <div key={c.id}>
            <div className="bx-col-head" style={{ background: `var(--c-col-${c.id})` }}>
              <span className="bx-col-dot" style={{ background: `var(--c-st-${c.id === 'todo' ? 'idle' : c.id})` }} />
              <span className="bx-col-name">{c.label}</span>
              <span className="bx-col-count">{c.count}</span>
              {c.limit != null && (
                <span className={`bx-col-wip${c.state === 'is-over' ? ' over' : ''}`}>
                  WIP {c.count}/{c.limit}
                </span>
              )}
            </div>
            {c.fill != null && (
              <div className="bx-col-rule">
                <span style={{ width: `${c.fill}%`, background: c.state === 'is-over' ? 'var(--c-st-stuck)' : 'var(--c-st-done)' }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {BANDS.map((b) => {
        const isOpen = !!open[b.id];
        const counts = COLS
          .map((c) => ({ label: c.label, n: (CARDS[c.id] || []).filter((k) => k.c === b.color).length }))
          .filter((c) => c.n > 0);
        const total = COLS.reduce((n, c) => n + (CARDS[c.id] || []).filter((k) => k.c === b.color).length, 0);
        return (
          <div key={b.id} className="bx-band">
            <button
              type="button"
              className="bx-band-bar"
              style={{ background: b.color }}
              aria-expanded={isOpen}
              onClick={() => setOpen((o) => ({ ...o, [b.id]: !o[b.id] }))}
            >
              <span className="bx-band-chev">{isOpen ? '▾' : '▸'}</span>
              <span className="bx-band-name">{b.name}</span>
              {!isOpen && (
                <span className="bx-band-counts">
                  {counts.map((c) => <span key={c.label}>{c.n} {c.label}</span>)}
                </span>
              )}
              <span className="bx-band-total">{total} items</span>
            </button>
            {isOpen && (
              <div className="bx-cols bx-band-body" style={{ '--bx-n': COLS.length }}>
                {COLS.map((c) => (
                  <div key={c.id} className={`bx-col-bed c-${c.id}`}>
                    <div className="bx-band-lane">
                      {(CARDS[c.id] || []).filter((k) => k.c === b.color).map((k) => (
                        <div key={k.t} className={`bx-kc${c.id === 'done' ? ' is-done' : ''}`}>
                          <span className="bx-kc-rail" style={{ background: k.c }} />
                          <div className="bx-kc-top">
                            <span className="bx-kc-title">{k.t}</span>
                            <span className={`bx-kc-prio ${PRIO_CLASS[k.prio] || 'p-med'}`} />
                          </div>
                          <div className="bx-kc-chips">
                            <span className={`bx-st ${ST_CLASS[c.id]}`}>{KLABEL[c.id]}</span>
                            {(k.flags || []).map((f) => <span key={f} className="bx-flag f-red">{f}</span>)}
                          </div>
                          <div className="bx-kc-foot">
                            <AvatarStack people={[{ id: k.who || 'Diana', name: k.who || 'Diana' }]} size={22} />
                            <span className={`bx-kc-due${k.late ? ' late' : ''}`}>{k.due}</span>
                            <span className="bx-kc-meta">
                              {c.id === 'done' ? <span className="tc-tick">✓</span> : (k.who || 'Diana')}
                            </span>
                          </div>
                          {k.pct != null && (
                            <div className="bx-kc-prog"><span style={{ width: `${k.pct}%`, background: k.c }} /></div>
                          )}
                          <div className="task-card-actions">
                            <button className="btn btn-sm btn-ghost">▶</button>
                            <button className="btn btn-sm btn-ghost">+ Log</button>
                            <button className="btn btn-sm btn-ghost">Edit</button>
                          </div>
                        </div>
                      ))}
                      {(CARDS[c.id] || []).filter((k) => k.c === b.color).length === 0 && (
                        <div className="bx-empty-lane">—</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


// ─── Reports · Summary ─────────────────────────────────────────────────────
const LEG = [
  ['SBLAF onboarding', '#0051BA'], ['Partner API integration', '#e2892e'],
  ['Marketplace redesign', '#7B2D8F'], ['Compliance & audit', '#137a36'],
];
const HOURS = [[11,8,7,5],[10,7,6,4],[11,7,7,5],[12,8,7,5],[10,7,6,5],[8,6,6,4],[10,8,7,4]];
const DAYS = ['14','15','16','17','18','19','20'];
const MIX = [
  ['Done', 'var(--c-done)', 11], ['In progress', 'var(--c-doing)', 7],
  ['Overdue', 'var(--c-danger)', 3], ['Not started', 'var(--c-todo)', 9],
];
const BYP = [
  ['SBLAF onboarding', '#0051BA', '60.0h', '72.0h', '+12h (+20%)', 'red', 64, 'Red', 'red'],
  ['Partner API integration', '#e2892e', '46.0h', '51.0h', '+5h (+11%)', 'red', 50, 'Amber', 'amber'],
  ['Marketplace redesign', '#7B2D8F', '48.0h', '46.0h', '−2h (−4%)', 'green', 83, 'Green', 'green'],
  ['Compliance & audit', '#137a36', '—', '32.0h', '—', 'none', 58, 'Green', 'green'],
];

function ReportSample() {
  const max = Math.max(...HOURS.map((r) => r.reduce((a, b) => a + b, 0)));
  const mixTotal = MIX.reduce((n, m) => n + m[2], 0);
  return (
    <>
      <div className="period-bar">
        <button className="pill active">This week (7d)</button>
        <button className="pill">Last 14 days</button>
        <button className="pill">This month (30d)</button>
        <button className="pill">Last 90 days</button>
        <span className="period-note">Jul 14 – Jul 20 · 7 days</span>
      </div>

      <div className="tiles">
        <Tile tone="navy"  label="Hours logged"    value="201.0h" sub="34 entries logged" />
        <Tile tone="green" label="Tasks completed" value={11} sub="8 entries marked complete" />
        <Tile tone="teal"  label="Tasks created"   value={6}  sub="new in this period" />
        <Tile tone="red"   label="Overdue"         value={3}  sub="past their plan date" />
        <Tile tone="amber" label="Blocked entries" value={2}  sub="entries logged as blocked" />
      </div>

      <div className="rep-split">
        <section className="dcard">
          <div className="dcard-head">
            <h2 className="dcard-title">Hours by day</h2>
            <span className="rep-total">201.0h logged</span>
          </div>
          <div className="stack">
            {HOURS.map((row, i) => (
              <div key={DAYS[i]} className="stack-col">
                <div className="stack-bar">
                  {row.map((h, j) => (
                    <span key={LEG[j][0]} className="stack-seg" style={{ height: `${(h / max) * 100}%`, background: LEG[j][1] }} />
                  ))}
                </div>
                <div className="stack-label">{DAYS[i]}</div>
              </div>
            ))}
          </div>
          <div className="stack-legend">
            {LEG.map(([n, c]) => (
              <span key={n} className="stack-legend-item"><span className="stack-swatch" style={{ background: c }} />{n}</span>
            ))}
          </div>
        </section>

        <section className="dcard">
          <h2 className="dcard-title">Status mix</h2>
          <div className="mix-bar">
            {MIX.map(([l, c, n]) => <span key={l} className="mix-seg" style={{ width: `${(n / mixTotal) * 100}%`, background: c }} />)}
          </div>
          <div className="mix-list">
            {MIX.map(([l, c, n]) => (
              <div key={l} className="mix-row">
                <span className="mix-dot" style={{ background: c }} />
                <span className="mix-label">{l}</span>
                <span className="mix-count">{n}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rtable">
        <div className="rtable-head">
          <h2 className="rtable-title">By project</h2>
          <span className="rtable-note">planned vs. logged</span>
        </div>
        <div className="rtable-cols">
          <span>Project</span><span>Planned</span><span>Logged</span>
          <span>Var.</span><span>Completion</span><span>Health</span>
        </div>
        {BYP.map(([n, c, pl, lo, v, vt, pct, rag, ragK], i) => (
          <div key={n} className={`rtable-row${i % 2 ? ' alt' : ''}`}>
            <span className="rtable-rail" style={{ background: c }} aria-hidden="true" />
            <span className="rtable-name">
              <span className="mix-dot" style={{ background: c }} />
              <span className="rtable-name-text">{n}</span>
            </span>
            <span className="rtable-num">{pl}</span>
            <span className="rtable-num strong">{lo}</span>
            <span className="rtable-cell"><span className={`vchip vchip-${vt}`}>{v}</span></span>
            <span className="rtable-cell rtable-prog">
              <span className="rtable-track"><span className="rtable-fill" style={{ width: `${pct}%`, background: c }} /></span>
              <span className="rtable-pct">{pct}%</span>
            </span>
            <span className="rtable-cell"><span className={`ragchip ragchip-${ragK}`}>{rag}</span></span>
          </div>
        ))}
        <div className="rtable-totals">
          <span className="rtable-totals-label">Totals</span>
          <span><strong>154.0h</strong> planned</span>
          <span><strong>201.0h</strong> logged</span>
          <span className="tone-ink-red"><strong>+47h (+31%)</strong><span className="rtable-caveat"> · 4 not estimated</span></span>
        </div>
      </section>
    </>
  );
}


// ─── Settings group card ───────────────────────────────────────────────────
function SettingsSample() {
  const [week, setWeek] = useState(1);
  const [density, setDensity] = useState('Comfortable');
  return (
    <div style={{ maxWidth: 720 }}>
      <section className="sgroup">
        <div className="sgroup-head">
          <span className="sgroup-icon" aria-hidden="true">◧</span>
          <h2 className="sgroup-title">Defaults</h2>
          <span className="sgroup-count">3 settings</span>
        </div>
        <div className="srow">
          <div className="srow-text">
            <div className="srow-name">Default project for quick-add</div>
            <div className="srow-hint">Where a task goes when you do not pick one</div>
          </div>
          <select className="select srow-select" defaultValue="">
            <option value="">— First available —</option>
            <option>SBLAF onboarding</option>
          </select>
        </div>
        <div className="srow">
          <div className="srow-text">
            <div className="srow-name">Week starts on</div>
            <div className="srow-hint">Affects My Week, Timesheet and every calendar</div>
          </div>
          <div className="sseg" role="group" aria-label="Week starts on">
            {[[1, 'Mon'], [0, 'Sun']].map(([v, l]) => (
              <button key={l} className={`sseg-opt${week === v ? ' active' : ''}`} aria-pressed={week === v} onClick={() => setWeek(v)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="srow">
          <div className="srow-text">
            <div className="srow-name">Density</div>
            <div className="srow-hint">Row height across boards and tables</div>
          </div>
          <div className="sseg" role="group" aria-label="Density">
            {['Comfortable', 'Compact'].map((d) => (
              <button key={d} className={`sseg-opt${density === d ? ' active' : ''}`} aria-pressed={density === d} onClick={() => setDensity(d)}>{d}</button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Messages thread ───────────────────────────────────────────────────────
function MessagesSample() {
  return (
    <div className="chat has-active">
      <aside className="chat-list">
        <div className="chat-list-head">
          <span className="chat-list-title">Conversations</span>
          <button className="btn btn-primary btn-sm">+ New</button>
        </div>
        <div className="chat-list-scroll">
          <button className="chat-conv active">
            <div className="chat-avatar group" style={{ width: 44, height: 44 }}>◍</div>
            <div className="chat-conv-body">
              <div className="chat-conv-top"><span className="chat-conv-name">Launch team</span><span className="chat-conv-time">now</span></div>
              <div className="chat-conv-preview">Rob: sandbox keys rotated ✅</div>
            </div>
          </button>
          <button className="chat-conv unread">
            <div className="chat-avatar group" style={{ width: 44, height: 44, background: '#e2892e', color: '#fff' }}>M</div>
            <div className="chat-conv-body">
              <div className="chat-conv-top"><span className="chat-conv-name">Mary Perkins</span><span className="chat-conv-time">2m</span></div>
              <div className="chat-conv-preview">Sent you the QA checklist<span className="chat-unread-dot" /></div>
            </div>
          </button>
          <button className="chat-conv">
            <div className="chat-avatar group" style={{ width: 44, height: 44, background: '#1D7CC7', color: '#fff' }}>R</div>
            <div className="chat-conv-body">
              <div className="chat-conv-top"><span className="chat-conv-name">Rob Santos</span><span className="chat-conv-time">1h</span></div>
              <div className="chat-conv-preview">You: thanks, merging now</div>
            </div>
          </button>
        </div>
      </aside>
      <section className="chat-thread">
        <div className="chat-thread-inner">
          <header className="chat-thread-head">
            <div className="chat-avatar group" style={{ width: 38, height: 38 }}>◍</div>
            <div className="chat-thread-head-body">
              <span className="chat-thread-title">Launch team</span>
              <span className="chat-thread-sub">4 members</span>
            </div>
          </header>
          <div className="chat-msgs">
            <div className="chat-day-sep"><span>Today</span></div>
            <div className="chat-msg theirs">
              <div className="chat-msg-sender" style={{ color: '#7B2D8F' }}>Tim Francis</div>
              <div className="chat-bubble">Morning! Are the new marketplace cards ready for QA?</div>
              <div className="chat-msg-time">9:02 AM</div>
            </div>
            <div className="chat-msg mine">
              <div className="chat-bubble">Yep — merged this morning. Running a11y checks now.</div>
              <div className="chat-msg-time">9:05 AM</div>
            </div>
            <div className="chat-msg theirs">
              <div className="chat-msg-sender" style={{ color: '#1D7CC7' }}>Rob Santos</div>
              <div className="chat-bubble">Sandbox keys rotated ✅ partner webhooks are stable again.</div>
              <div className="chat-msg-time">9:11 AM</div>
            </div>
            <div className="chat-msg mine">
              <div className="chat-bubble">Amazing work 🙌 Let’s demo it Friday.</div>
              <div className="chat-msg-time">9:13 AM</div>
            </div>
          </div>
          <div className="chat-composer">
            <textarea className="chat-input" rows={1} placeholder="Message…" readOnly />
            <button className="chat-send">➤</button>
          </div>
        </div>
      </section>
    </div>
  );
}


/* ─── The pages added in T-0144 ────────────────────────────────────────────
   Static rows in the real classes, so the CSS for each new page can be seen
   without a workspace or a sign-in. */

const SPARK = (pts, tone) => {
  const w = 120, h = 28, max = Math.max(...pts), min = Math.min(...pts), span = (max - min) || 1;
  const d = pts.map((p, i) => `${(i / (pts.length - 1)) * w},${h - ((p - min) / span) * (h - 4) - 2}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className={`spark spark-${tone}`} aria-hidden="true">
      <polyline points={d} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

function MonitoringSample() {
  const thr = [6, 8, 7, 9, 10, 9, 12, 11];
  const blk = [4, 5, 6, 6, 8, 10, 12, 13];
  const peak = Math.max(...thr);
  const cards = [
    ['navy', 'Cycle time', '4.2d', '-0.6d', [22, 20, 18, 17, 15, 14, 12, 11], 'start to finish, tasks closed this week'],
    ['green', 'Throughput', 11, '+1', thr, 'tasks finished this week'],
    ['red', 'Blocked rate', '13%', '+4%', blk, '3 of 23 open tasks'],
    ['amber', 'On-time', '71%', '-9%', [86, 84, 80, 78, 75, 73, 72, 71], 'finished by their plan date'],
  ];
  const rules = [
    ['Sev 1', 'red', 'Task overdue beyond 3 days', 'due date + 3d < today', '2 firing'],
    ['Sev 2', 'red', 'Task blocked', 'a bottleneck is logged against it', '3 firing'],
    ['Sev 3', 'amber', 'Member over capacity', 'hours logged this week > 35h', '1 firing'],
    ['Sev 4', 'green', 'Item idle in progress', 'in progress for more than 7 days', 'quiet'],
  ];
  return (
    <>
      <div className="tiles">
        {cards.map(([tone, label, value, delta, series, sub]) => (
          <div key={label} className={`tile tile-${tone}`}>
            <div className="tile-head"><span className="tile-dot" /><span className="tile-label">{label}</span></div>
            <div className="tile-value-row"><span className="tile-value">{value}</span><span className="tile-delta">{delta}</span></div>
            <div className="tile-spark">{SPARK(series, tone)}</div>
            <div className="tile-sub">{sub}</div>
          </div>
        ))}
      </div>
      <div className="rep-split">
        <section className="dcard">
          <div className="dcard-head"><h2 className="dcard-title">Throughput vs. blocked</h2><span className="rep-total">8 weeks</span></div>
          <p className="dcard-sub">Bars are tasks finished that week; the dot is the share of open work that was blocked.</p>
          <div className="mon-chart">
            {thr.map((n, i) => (
              <div key={i} className="mon-col">
                <div className="mon-bar-wrap">
                  <span className="mon-bar" style={{ height: `${(n / peak) * 100}%` }} />
                  <span className="mon-dot" style={{ bottom: `${blk[i]}%` }} />
                </div>
                <div className="mon-label">{`0${i + 1}-14`.slice(-5)}</div>
              </div>
            ))}
          </div>
          <div className="stack-legend">
            <span className="stack-legend-item"><span className="stack-swatch" style={{ background: 'var(--c-emerald)' }} />Finished</span>
            <span className="stack-legend-item"><span className="stack-swatch" style={{ background: 'var(--c-danger)', borderRadius: '50%' }} />Blocked rate</span>
          </div>
        </section>
        <section className="dcard">
          <div className="dcard-head"><h2 className="dcard-title">Alert rules</h2><span className="alert-count">3</span></div>
          <p className="dcard-sub">The conditions the Dashboard raises alerts on.</p>
          <div className="rule-list">
            {rules.map(([sev, tone, name, cond, state]) => (
              <div key={sev} className={`rule rule-${tone}`}>
                <span className={`alert-sev tone-${tone === 'green' ? 'navy' : tone}`}>{sev}</span>
                <span className="rule-body"><span className="rule-name">{name}</span><span className="rule-cond">{cond}</span></span>
                <span className={`vchip vchip-${tone === 'green' ? 'green' : tone}`}>{state}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function PeopleSample() {
  const rows = [
    ['D', '#e2892e', 'Diana Harris', '47.0h', 6, 134, 'red', '67%', 'red'],
    ['R', '#1D7CC7', 'Rob Santos', '44.0h', 7, 126, 'red', '71%', 'amber'],
    ['M', '#137a36', 'Mary Perkins', '40.0h', 5, 114, 'red', '80%', 'amber'],
    ['T', '#7B2D8F', 'Tim Francis', '30.0h', 4, 86, 'amber', '100%', 'green'],
    ['P', '#16324d', 'Pam Cruz', '14.0h', 3, 40, 'green', '—', 'navy'],
  ];
  return (
    <div className="rep-split">
      <section className="rtable">
        <div className="ppl-cols"><span>Member</span><span>Logged</span><span>Items</span><span>Utilization</span><span>On-time</span></div>
        {rows.map(([ini, col, name, h, items, pct, tone, ot, otT], i) => (
          <div key={name} className={`ppl-row${i % 2 ? ' alt' : ''}`}>
            <span className="ppl-who"><span className="ppl-av" style={{ background: col }}>{ini}</span><span className="ppl-name">{name}</span></span>
            <span className="rtable-num strong">{h}</span>
            <span className="rtable-num">{items}</span>
            <span className="rtable-cell ppl-util">
              <span className="ppl-track">
                <span className={`ppl-fill tone-${tone}`} style={{ width: `${Math.min((pct / 140) * 100, 100)}%` }} />
                <span className="ppl-cap" />
              </span>
              <span className={`ppl-pct tone-ink-${tone}`}>{pct}%</span>
            </span>
            <span className="rtable-cell"><span className={`vchip vchip-${otT}`}>{ot}</span></span>
          </div>
        ))}
        <div className="ppl-key">
          <span className="ptable-key-item"><span className="ptable-key-notch" />cap 35h</span>
          <span className="ptable-key-item tone-ink-red"><span className="ppl-swatch" />Over cap</span>
        </div>
      </section>
      <div className="db-rail">
        <section className="dcard">
          <h2 className="dcard-title">Throughput</h2>
          <p className="dcard-sub">Tasks completed in this period</p>
          <div className="util">
            {[['R', '#1D7CC7', 'Rob', 4], ['D', '#e2892e', 'Diana', 3], ['M', '#137a36', 'Mary', 2], ['T', '#7B2D8F', 'Tim', 1]].map(([i, c, n, d]) => (
              <div key={n} className="util-row">
                <span className="util-av" style={{ background: c }}>{i}</span>
                <span className="util-name">{n}</span>
                <span className="util-track"><span className="util-fill" style={{ width: `${(d / 4) * 100}%`, background: c }} /></span>
                <span className="util-pct">{d}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="dcard">
          <h2 className="dcard-title">Flags</h2>
          <div className="alerts">
            <div className="alert alert-red"><div className="alert-top"><span className="alert-sev tone-red">OVER</span><span className="alert-title">3 people over 35h · Diana 47.0h</span></div></div>
            <div className="alert alert-amber"><div className="alert-top"><span className="alert-sev tone-amber">LATE</span><span className="alert-title">Rob · 2 items past due</span></div></div>
          </div>
        </section>
      </div>
    </div>
  );
}

function VarianceSample() {
  const rows = [
    ['Migrate legacy loan records', 14, '24h / 10h'],
    ['Finalize disbursement copy', 10, '34h / 24h'],
    ['KYC vendor sign-off', 6, '14h / 8h'],
    ['Card A/B setup', 2, '14h / 12h'],
    ['Webhook retry logic', -3, '3h / 6h'],
    ['Ship marketplace filter chips', -6, '2h / 8h'],
  ];
  const widest = 14;
  return (
    <>
      <div className="period-bar">
        <button className="pill">Over plan</button>
        <button className="pill">Under plan</button>
        <button className="pill active">Everything</button>
        <span className="period-note">+23h over plan overall</span>
      </div>
      <section className="dcard">
        <div className="dcard-head"><h2 className="dcard-title">Plan vs. actual</h2><span className="vchip vchip-red">+23h over plan</span></div>
        <p className="dcard-sub">Variance per item, worst first.</p>
        <div className="var-list">
          {rows.map(([t, delta, detail]) => {
            const over = delta > 0;
            const w = (Math.abs(delta) / widest) * 48;
            return (
              <div key={t} className="var-row">
                <span className="var-title">{t}</span>
                <span className="var-track">
                  <span className="var-zero" aria-hidden="true" />
                  <span className={`var-bar ${over ? 'over' : 'under'}`} style={{ left: over ? '50%' : `${50 - w}%`, width: `${w}%` }} />
                </span>
                <span className={`vchip vchip-${over ? 'red' : 'green'} var-val`}>{over ? '+' : ''}{delta}h</span>
                <span className="var-detail">{detail}</span>
              </div>
            );
          })}
        </div>
        <div className="var-key">
          <span className="ptable-key-item tone-ink-red"><span className="var-swatch over" />Over plan</span>
          <span className="ptable-key-item tone-ink-green"><span className="var-swatch under" />Under plan</span>
          <span className="ptable-key-item"><span className="ptable-key-notch" />On plan</span>
          <span className="var-caveat">4 tasks not estimated — excluded, not counted as zero</span>
        </div>
      </section>
    </>
  );
}

function LibrarySample() {
  const standing = [
    ['▤', 'Delivery status report', 'Where every project stands, what is overdue, what is blocked', '4 projects · 84 tasks', 'Word · PDF · Web'],
    ['◈', 'Task list', 'Every open and closed task with dates, owner and estimate', '84 tasks', 'Excel · CSV · PDF'],
    ['☰', 'Activity log', 'Every logged entry with hours, status and remarks', '312 entries', 'Excel · CSV · PDF'],
  ];
  return (
    <>
      <div className="lib-label">Standing reports</div>
      <div className="lib-grid">
        {standing.map(([icon, name, what, covers, fmt]) => (
          <div key={name} className="lib-card lib-card-green">
            <div className="lib-head"><span className="lib-icon lib-icon-green">{icon}</span><span className="lib-name">{name}</span><span className="vchip vchip-green">Ready</span></div>
            <p className="lib-what">{what}</p>
            <div className="lib-meta">
              <div><div className="lib-meta-label">Covers</div><div className="lib-meta-value">{covers}</div></div>
              <div><div className="lib-meta-label">Formats</div><div className="lib-meta-value">{fmt}</div></div>
            </div>
            <div className="lib-foot">
              <span className="lib-last">Built when you ask for it</span>
              <span className="lib-actions"><button className="lib-btn">Open</button><button className="lib-btn">Export ▾</button></span>
            </div>
          </div>
        ))}
      </div>
      <div className="lib-label">Saved by you</div>
      <div className="lib-grid">
        <div className="lib-card lib-card-amber">
          <div className="lib-head"><span className="lib-icon lib-icon-amber">★</span><span className="lib-name">Client work this quarter</span><span className="vchip vchip-navy">Saved</span></div>
          <p className="lib-what">Task table · 7 columns · grouped by project</p>
          <div className="lib-meta">
            <div><div className="lib-meta-label">Page</div><div className="lib-meta-value">Task table</div></div>
            <div><div className="lib-meta-label">Filters</div><div className="lib-meta-value">#client</div></div>
          </div>
          <div className="lib-foot">
            <span className="lib-last">Yours · on this workspace</span>
            <span className="lib-actions"><button className="lib-btn">Run</button><button className="lib-btn lib-btn-danger">Remove</button></span>
          </div>
        </div>
      </div>
      <p className="lib-note">
        Nothing here sends itself. Task Monitor has no mail server, so a report
        arrives when somebody opens it or exports it — there is no schedule and
        no recipient list to fill in.
      </p>
    </>
  );
}

function WorkloadSample() {
  const widest = 50;
  return (
    <section className="wl-card">
      <div className="wl-head">
        <span className="wl-title">Workload</span>
        <span className="wl-cap">cap 40h</span>
      </div>
      <div className="wl-rows">
        {WL.map((p) => {
          const tone = p.hours > 40 ? 'red' : p.hours >= 32 ? 'amber' : 'green';
          return (
            <button type="button" key={p.name} className="wl-row">
              <Avatar id={p.name} name={p.name} size={30} />
              <span className="wl-name">
                <span className="wl-person">{p.name}</span>
                <span className="wl-count">{p.open} open · {p.done} done</span>
              </span>
              <span className="wl-track">
                {p.segs.map(([h, c]) => (
                  <span key={c} className="wl-seg" style={{ width: `${(h / widest) * 100}%`, background: c }} />
                ))}
                <span className="wl-notch" style={{ left: `${(40 / widest) * 100}%` }} aria-hidden="true" />
              </span>
              <span className="wl-assumed-slot">
                {p.guessed > 0 && <span className="wl-assumed">{p.guessed} assumed</span>}
              </span>
              <span className={`wl-hours tone-ink-${tone}`}>{p.hours}h</span>
            </button>
          );
        })}
      </div>
      <div className="wl-legend">
        <span className="wl-leg"><span className="wl-leg-dot" style={{ background: '#0051BA' }} />SBLAF onboarding</span>
        <span className="wl-leg"><span className="wl-leg-dot" style={{ background: '#e2892e' }} />Partner API</span>
        <span className="wl-leg"><span className="wl-leg-dot" style={{ background: '#7B2D8F' }} />Marketplace</span>
        <span className="wl-leg"><span className="wl-leg-line" />40h cap</span>
      </div>
      <p className="wl-note">
        Open work only, in estimated hours. A task with no estimate is counted
        at 4h — the row says how many of those there were.
      </p>
    </section>
  );
}

const ILOG = [
  ['Diana Harris', '1.0h', 'Jul 20', 'red',   'Chased legal in the weekly sync — MSA is with counsel, Friday response expected.'],
  ['Diana Harris', '2.5h', 'Jul 17', 'navy',  'Rewrote the partial-release string three ways so legal has options.'],
  ['Mary Perkins', '1.5h', 'Jul 15', 'amber', 'Compliance flagged partial-release wording as reading like a funds guarantee.'],
  ['Diana Harris', '3.5h', 'Jul 14', 'green', 'Drafted the full confirmation-state copy set and shared for review.'],
];
const ICON_FOR = { red: '!', green: '✓', navy: '•', amber: '•' };
const ISUBS = [['Draft copy variants', true], ['Compliance review', true], ['Legal sign-off', false], ['Ship to staging', false]];
function CalendarSample() {
  return (
    <div className="bcard calendar">
      <div className="cal-toolbar">
        <h2 className="cal-month-label">July <span className="accent">2026</span></h2>
        <button className="cal-nav-btn">‹</button>
        <button className="cal-nav-btn">›</button>
        <button className="cal-nav-today">Today</button>
        <div className="cal-filter-group">
          {['All', 'To do', 'Ongoing', 'Done'].map((l, i) => (
            <button key={l} className={`cal-filter-btn${i === 0 ? ' active' : ''}`}>{l}</button>
          ))}
        </div>
        <span className="cal-basis">by due date</span>
      </div>
      <div className="cal-header">
        {DOW.map((d, i) => (
          <div key={d} className={`cal-day-label${i > 4 ? ' weekend' : ''}`}>{d}</div>
        ))}
      </div>
      <div className="cal-grid">
        {Array.from({ length: 35 }, (_, idx) => {
          const day = idx - 1;
          const inMonth = day >= 1 && day <= 31;
          const isToday = day === 20;
          return (
            <div key={idx} className={`cal-cell${inMonth ? '' : ' out'}${isToday ? ' today' : ''}${idx % 7 > 4 ? ' weekend' : ''}`}>
              <div className="cal-cell-head">
                {isToday
                  ? <span className="cal-today-badge"><span className="cal-today-num">{day}</span><span className="cal-today-label">Today</span></span>
                  : <span className="cal-cell-num">{inMonth ? day : ''}</span>}
              </div>
              <div className="cal-cell-tasks">
                {(CAL_DUE[day] || []).map(([title, status, color]) => (
                  <button key={title} className={`cal-task cal-task-${status}`} style={{ '--task-color': color }}>
                    {title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const WEEKS = ['W26', 'W27', 'W28', 'W29', 'W30', 'W31', 'W32', 'W33'];
const BARS = [
  ['Draft borrower eligibility rules', '#0051BA', 62, 18, 0,   false, 'Diana'],
  ['Set up sandbox test accounts',     '#e2892e', 70, 16, 0,   false, 'Rob'],
  ['Filter chips spec',                '#7B2D8F', 74, 18, 0,   false, 'Mary'],
  ['Finalize disbursement copy',       '#0051BA', 20, 32, 60,  true,  'Diana'],
  ['Migrate legacy loan records',      '#0051BA', 14, 38, 35,  true,  'Rob'],
  ['Review sandbox credentials',       '#e2892e', 44, 14, 70,  false, 'Rob'],
  ['Card A/B setup',                   '#7B2D8F', 48, 18, 45,  false, 'Tim'],
  ['Webhook retry logic',              '#e2892e', 38, 22, 85,  false, 'Rob'],
  ['De-dup borrower records',          '#0051BA', 52, 20, 80,  false, 'Pam'],
  ['KYC data model spec',              '#0051BA', 4,  30, 100, false, 'Diana'],
  ['Ship marketplace filter chips',    '#7B2D8F', 24, 26, 100, false, 'Pam'],
  ['Rotate partner API keys',          '#e2892e', 40, 12, 100, false, 'Rob'],
  ['Wireframe application steps',      '#0051BA', 0,  22, 100, false, 'Tim'],
];
const GANTT_GROUPS = [
  ['SBLAF onboarding', '#0051BA', 'Jul 01 → Aug 14'],
  ['Partner API', '#e2892e', 'Jul 08 → Aug 02'],
  ['Marketplace', '#7B2D8F', 'Jul 06 → Aug 09'],
];
function GanttSample() {
  const [period, setPeriod] = useState('all');
  const cols = WEEKS.map(() => '7fr').join(' ');
  const byProject = GANTT_GROUPS.map(([name, color, span]) => ({
    name, color, span, bars: BARS.filter((b) => b[1] === color),
  }));
  let alt = 0;
  return (
    <div className="bcard gantt-card" style={{ '--gc-label-w': '288px' }}>
      <div className="gantt-card-head">
        <span className="gantt-card-title">Gantt</span>
        <span className="seg" role="group" aria-label="Period">
          {[['all', 'All', 'layers'], ['month', 'This month', 'calendar'],
            ['quarter', 'This quarter', 'dashboard'], ['next30', 'Next 30 days', 'clock']].map(([id, label, icon]) => (
            <button
              key={id}
              className={`seg-btn${period === id ? ' is-on' : ''}`}
              aria-pressed={period === id}
              onClick={() => setPeriod(id)}
            >
              <Icon name={icon} size={14} />
              <span className="seg-label">{label}</span>
            </button>
          ))}
        </span>
      </div>

      <div className="gc-ruler">
        <span className="gc-ruler-pad" />
        <span className="gc-ruler-cols" style={{ gridTemplateColumns: cols }}>
          {WEEKS.map((w) => <span key={w} className="gc-col">{w}</span>)}
        </span>
      </div>

      <div className="gc-body">
        {byProject.map((g) => (
          <Fragment key={g.name}>
            <div className="gc-group">
              <span className="gc-group-name">
                <span className="gc-dot" style={{ background: g.color }} />
                {g.name}
                <span className="gc-group-count">{g.bars.length}</span>
              </span>
              <span className="gc-group-span">{g.span}</span>
            </div>
            {g.bars.map(([title, color, start, width, pct, late, who]) => {
              alt += 1;
              return (
                <div key={title} className={`gc-row${alt % 2 ? '' : ' alt'}`}>
                  <div className="gc-label">
                    <span className="gc-dot" style={{ background: color }} />
                    <span className="gc-name">{title}</span>
                    <Avatar id={who} name={who} size={20} />
                  </div>
                  <div className="gc-track">
                    <span className="gc-today" style={{ left: '52%' }} />
                    <div
                      className="gc-bar"
                      style={{
                        left: `${start}%`,
                        width: `${width}%`,
                        background: `color-mix(in srgb, ${color} 15%, transparent)`,
                        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 38%, transparent)`,
                      }}
                    >
                      <span
                        className="gc-fill"
                        style={{ width: `${pct}%`, background: pct === 100 ? 'var(--c-done)' : color }}
                      />
                    </div>
                    {late && <span className="gc-late" style={{ left: `${start + width}%` }}>▲</span>}
                  </div>
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>

      <div className="gantt-legend">
        <span className="gl"><span className="gl-line" />Today</span>
        <span className="gl gl-late">▲ Past due</span>
        <span className="gl"><span className="gl-swatch" style={{ background: 'var(--c-done)' }} />Complete</span>
      </div>
    </div>
  );
}

const WBS_TREE = [
  ['SBLAF onboarding', '#0051BA', [
    ['Discovery', [
      ['Draft borrower eligibility rules', 'Not started', 'high', 'Jul 14', 'Jul 28', false],
      ['KYC data model spec', 'Done', 'high', 'Jul 1', 'Jul 18', false],
    ]],
    ['Build', [
      ['Finalize disbursement copy', 'Working on it', 'high', 'Jul 8', 'Jul 18', true],
      ['Migrate legacy loan records', 'Working on it', 'high', 'Jul 6', 'Jul 18', true],
    ]],
  ]],
  ['Partner API', '#e2892e', [
    ['Build', [
      ['Review sandbox credentials', 'Working on it', 'medium', 'Jul 15', 'Jul 22', false],
      ['Webhook retry logic', 'Working on it', 'medium', null, null, false],
    ]],
    ['Launch', [['Rotate partner API keys', 'Done', 'low', 'Jul 12', 'Jul 19', false]]],
  ]],
];
const WBS_PRIO = { high: ['p-high', 'High'], medium: ['p-med', 'Med'], low: ['p-low', 'Low'] };
function WbsSample() {
  const ink = (c) => `color-mix(in srgb, ${c} 62%, var(--c-text))`;
  return (
    <div className="wbs">
      <div className="wbs-head">
        <span className="bx-h">Work breakdown</span>
        <span className="bx-note">project › phase › item</span>
      </div>
      {WBS_TREE.map(([proj, color, phases]) => (
        <div key={proj}>
          <button type="button" className="wbs-proj" aria-expanded="true">
            <span className="wbs-chev">▾</span>
            <span className="wbs-badge" style={{ background: color }}>WBS</span>
            <span className="wbs-proj-name" style={{ color: ink(color) }}>{proj}</span>
            <span className="wbs-count">{phases.reduce((n, [, items]) => n + items.length, 0)} items</span>
          </button>
          {phases.map(([phase, items], pi) => (
            <div key={phase}>
              <button type="button" className="wbs-phase" aria-expanded="true">
                <span className="wbs-chev">▾</span>
                <span
                  className="wbs-pcode"
                  style={{ color: ink(color), background: `color-mix(in srgb, ${color} 16%, transparent)` }}
                >{pi + 1}</span>
                <span className="wbs-pname">{phase}</span>
                <span className="wbs-pcount">{items.length} items</span>
              </button>
              {items.map(([title, status, prio, start, end, late], ti) => (
                <button type="button" key={title} className="wbs-item">
                  <span className="wbs-icode">{pi + 1}.{ti + 1}</span>
                  <span className={`wbs-ititle${status === 'Done' ? ' is-done' : ''}`}>{title}</span>
                  <span className="wbs-dates">
                    {start || end ? (
                      <>
                        <span>{start || '—'}</span>
                        <span className="wbs-arrow">→</span>
                        <span className={late ? 'late' : undefined}>{end || '—'}</span>
                      </>
                    ) : <span className="wbs-nodate">no dates</span>}
                  </span>
                  <span className="wbs-prio-slot">
                    <span className={`bx-prio ${WBS_PRIO[prio][0]}`}>{WBS_PRIO[prio][1]}</span>
                  </span>
                  <span className="wbs-status-slot">
                    <span className={`bx-st ${status === 'Done' ? 'st-done' : status === 'Working on it' ? 'st-doing' : 'st-todo'}`}>{status}</span>
                  </span>
                  <Avatar id={title} name={['Diana', 'Rob', 'Mary', 'Tim'][ti % 4]} size={20} />
                </button>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Projects · Timeline (static twin of TimelineView) ────────────────────
const PTL_COLS = ['Jun 15', 'Jun 29', 'Jul 13', 'Jul 27', 'Aug 10', 'Aug 24', 'Sep 7', 'Sep 21'];
const PTL_ROWS = [
  { name: 'SBLAF onboarding',        color: '#0051BA', left: 4,  width: 38, pct: 64, tone: 'red',   marks: [22, 42] },
  { name: 'Partner API integration', color: '#e2892e', left: 22, width: 46, pct: 50, tone: 'amber', marks: [40] },
  { name: 'Marketplace redesign',    color: '#7B2D8F', left: 0,  width: 58, pct: 83, tone: 'green', marks: [30, 58] },
  { name: 'Compliance & audit',      color: '#137a36', left: 30, width: 64, pct: 58, tone: 'green', marks: [] },
  { name: 'Pilot — agent portal',    color: '#8a94a0', left: null, width: null, pct: 0, tone: 'navy', marks: [] },
];
function TimelineSample() {
  const todayAt = 52;
  return (
    <div className="ptl">
      <div className="ptl-head">
        <span className="bx-h">Timeline</span>
        <span className="bx-note">2026-06-12 → 2026-09-24</span>
      </div>
      <div className="ptl-ruler">
        <div className="ptl-gutter" />
        <div className="ptl-cols" style={{ '--ptl-n': PTL_COLS.length }}>
          {PTL_COLS.map((c) => <span key={c} className="ptl-col">{c}</span>)}
        </div>
      </div>
      {PTL_ROWS.map((r, i) => (
        <button type="button" key={r.name} className={`ptl-row${i % 2 ? ' alt' : ''}`}>
          <span className="ptl-label">
            <span className="ptl-dot" style={{ background: r.color }} />
            <span className="ptl-name">{r.name}</span>
          </span>
          <span className="ptl-track">
            <span className="ptl-today" style={{ left: `${todayAt}%` }} />
            {r.left == null ? (
              <span className="ptl-nodate">nothing in this project has a date yet</span>
            ) : (
              <>
                <span
                  className="ptl-bar"
                  style={{
                    left: `${r.left}%`,
                    width: `${r.width}%`,
                    background: `color-mix(in srgb, ${r.color} 14%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${r.color} 32%, transparent)`,
                  }}
                >
                  <span className="ptl-fill" style={{ width: `${r.pct}%`, background: r.color }} />
                  <span className={`ptl-pct tone-ink-${r.tone}`}>{r.pct}%</span>
                </span>
                {r.marks.map((m) => (
                  <span key={m} className="ptl-mark" style={{ left: `${m}%` }}>◆</span>
                ))}
              </>
            )}
          </span>
        </button>
      ))}
      <div className="ptl-legend">
        <span><span className="ptl-key-bar" />Planned span, filled by completion</span>
        <span><span className="ptl-key-today" />Today</span>
        <span className="ptl-key-ms">◆ Phase end</span>
      </div>
    </div>
  );
}

// ─── Dashboard · Goals (static twin of GoalsView) ─────────────────────────
const GL = [
  { name: 'Cut time-to-decision', owner: 'Diana', pct: 64, tone: 'amber', due: '2026-09-30',
    kpi: '48h → 24h', done: 1, total: 3,
    krs: [['Automate eligibility checks', 80, 'green'], ['Reduce manual KYC steps', 55, 'amber'], ['Cut disbursement handoffs', 40, 'red']],
    projs: [['SBLAF onboarding', '#0051BA'], ['Partner API', '#e2892e']] },
  { name: 'Data quality before features', owner: 'Rob', pct: 42, tone: 'red', due: '2026-08-31',
    kpi: '99% clean records', done: 0, total: 3,
    krs: [['De-dup borrower records', 20, 'red'], ['Migrate legacy records', 35, 'red'], ['Schema validation suite', 70, 'amber']],
    projs: [['SBLAF onboarding', '#0051BA']] },
  { name: 'Marketplace conversion lift', owner: 'Tim', pct: 83, tone: 'green', due: '2026-07-31',
    kpi: '+15% apply rate', done: 1, total: 3, unmeasured: 1,
    krs: [['Ship filter chips', 100, 'green'], ['Run A/B on cards', 75, 'amber'], ['Mobile polish pass', null, 'navy']],
    projs: [['Marketplace', '#7B2D8F']] },
];
function GoalsSample() {
  return (
    <div className="gl-grid">
      {GL.map((g) => (
        <div key={g.name} className={`gl-card tone-${g.tone}`}>
          <div className="gl-head">
            <span className="gl-ring" style={{ '--gl-deg': `${g.pct * 3.6}deg` }}>
              <span className="gl-ring-in">{g.pct}%</span>
            </span>
            <div className="gl-id">
              <button type="button" className="gl-name">{g.name}</button>
              <div className="gl-who">
                <Avatar id={g.owner} name={g.owner} size={24} />
                <span className="gl-due">{g.due}</span>
              </div>
            </div>
          </div>
          <div className="gl-band">
            <div className="gl-band-cell">
              <div className="gl-lbl">Target</div>
              <div className="gl-target">{g.kpi}</div>
            </div>
            <div className="gl-band-cell gl-band-now">
              <div className="gl-lbl">Now</div>
              <div className="gl-now">{g.done}/{g.total}</div>
            </div>
          </div>
          <div className="gl-lbl gl-krs-lbl">Key results</div>
          <div className="gl-krs">
            {g.krs.map(([t, pct, tone]) => (
              <div key={t}>
                <div className="gl-kr-top">
                  <span className="gl-kr-name">{t}</span>
                  <span className={`gl-kr-pct tone-ink-${tone}`}>{pct == null ? '—' : `${pct}%`}</span>
                </div>
                <div className="gl-kr-track">
                  {pct != null && <span className={`gl-kr-bar tone-fill-${tone}`} style={{ width: `${pct}%` }} />}
                </div>
              </div>
            ))}
          </div>
          {g.unmeasured > 0 && (
            <p className="gl-unmeasured">
              {g.unmeasured} of {g.total} not linked to a project, so it is not in the ring.
            </p>
          )}
          <div className="gl-projs">
            {g.projs.map(([n, c]) => (
              <button type="button" key={n} className="gl-proj">
                <span className="gl-proj-dot" style={{ background: c }} />{n}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Settings · Members (static twin of WorkspaceMembers) ────────────────
const AC_TILES = [
  ['Members', '5', '1 owner · 4 collaborators', 'navy'],
  ['Pending', '1', 'waiting to be claimed', 'amber'],
  ['Can change access', '2', '1 owner · 1 admin', 'navy'],
  ['Read-only', '1', 'viewers', 'green'],
];
const AC_MEMBERS = [
  ['Diana Harris', 'diana@bridged.ph', 'owner',  'Workspace',  'now'],
  ['Rob Santos',   'rob@bridged.ph',   'admin',  'Workspace',  '12m'],
  ['Mary Perkins', 'mary@bridged.ph',  'editor', '3 projects', '2h'],
  ['Tim Francis',  'tim@bridged.ph',   'editor', '1 project',  '1d'],
  ['Pam Cruz',     'pam@bridged.ph',   'viewer', 'Workspace',  '—'],
];
const AC_ROLES = [
  ['owner',  'Owner',  1, 'Created the workspace. Everything an admin can do, plus deleting the workspace itself. Cannot be removed or demoted.'],
  ['admin',  'Admin',  1, 'Invite and remove people, change roles, and edit everything an editor can.'],
  ['editor', 'Editor', 2, 'Create and edit projects, tasks and activity. Cannot change who has access.'],
  ['viewer', 'Viewer', 1, 'Read-only. Sees the boards, reports and minutes; changes nothing.'],
];
function MembersSample() {
  return (
    <>
      <div className="ac-tiles">
        {AC_TILES.map(([label, value, sub, tone]) => (
          <div key={label} className={`ac-tile tone-${tone}`}>
            <div className="ac-tile-label">{label}</div>
            <div className="ac-tile-value">{value}</div>
            <div className="ac-tile-sub">{sub}</div>
          </div>
        ))}
      </div>
      <div className="ac-split">
        <section className="ac-panel">
          <div className="ac-panel-head">
            <span className="bx-h">Role assignments</span>
            <button type="button" className="ac-invite-btn">+ Invite member</button>
          </div>
          <div className="ac-thead">
            <span>Member</span><span>Role</span><span>Scope</span><span>Last logged</span>
          </div>
          {AC_MEMBERS.map(([name, email, role, scope, seen], i) => (
            <div key={email} className={`ac-row${i % 2 ? ' alt' : ''}`}>
              <span className="ac-who">
                <Avatar id={name} name={name} size={30} />
                <span className="ac-who-text">
                  <span className="ac-name">{name}{i === 0 && <span className="ac-you"> (you)</span>}</span>
                  <span className="ac-email">{email}</span>
                </span>
              </span>
              <span className="ac-cell">
                {role === 'owner'
                  ? <span className={`ac-role role-${role}`}>Owner</span>
                  : <select className="ac-role-select" defaultValue={role}>
                      <option value="admin">Admin</option>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>}
              </span>
              <span className="ac-cell ac-scope">{scope}</span>
              <span className="ac-cell ac-seen">{seen}</span>
              {role !== 'owner' && <button className="ac-remove">✕</button>}
            </div>
          ))}
          <p className="ac-foot">
            Last logged is read from the activity entries currently loaded, so a dash means
            nothing of theirs is in that window — not that they have never been here.
          </p>
        </section>
        <div className="ac-side">
          <section className="ac-card">
            <div className="bx-h-sm">Role definitions</div>
            <p className="ac-card-sub">What each role can do in this workspace.</p>
            <div className="ac-roles">
              {AC_ROLES.map(([id, label, n, perms]) => (
                <div key={id} className="ac-roledef">
                  <div className="ac-roledef-top">
                    <span className={`ac-role role-${id}`}>{label}</span>
                    <span className="ac-roledef-count">{n} member{n === 1 ? '' : 's'}</span>
                  </div>
                  <p className="ac-roledef-perms">{perms}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="ac-card">
            <div className="bx-h-sm">Pending invites</div>
            <div className="ac-invites">
              <div className="ac-invite">
                <div className="ac-invite-text">
                  <div className="ac-invite-email">noel.reyes@bridged.ph</div>
                  <div className="ac-invite-meta">Joins as Viewer when they next sign in</div>
                </div>
                <button className="ac-withdraw">Withdraw</button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

/* ── How to use (T-0156) ───────────────────────────────────────────────────
   The twin of the four ported panels. It draws the STATIC markup, so if the
   component moves to new classes and this does not, the harness is checking a
   design that no longer ships — which is worse than no harness, because it
   looks like a check. `tests/ui/howToUse.test.mjs` asserts the twin moved. */

const HTU_FLOWS = [
  { n: '1', title: 'Log',     where: 'Dashboard → Log time' },
  { n: '2', title: 'Track',   where: 'Board → Kanban' },
  { n: '3', title: 'Measure', where: 'Dashboard → Monitoring' },
  { n: '4', title: 'Report',  where: 'Reports → Summary' },
];

const HTU_STATUSES = [
  ['todo',   'Not started',   'Nobody has started it yet.'],
  ['doing',  'Working on it', 'Someone has picked it up and it is moving.'],
  ['review', 'In review',     'Done by its owner, waiting on a second pair of eyes.'],
  ['stuck',  'Stuck',         'A bottleneck somebody logged, or open and past its plan date.'],
  ['done',   'Done',          'Shipped. The hours stay in the report.'],
];

const HTU_KEYS = [
  ['⌘K', 'Command palette'], ['Esc', 'Close it again'],
  ['↑ ↓', 'Move through results'], ['↵', 'Open the highlighted one'],
  ['D', 'Due alert: done'], ['S', 'Due alert: skip'],
];

function HowToUseSample() {
  return (
    <div className="htu-stack">
      <div className="htu-hero">
        <span className="htu-hero-glow" aria-hidden="true" />
        <div className="htu-hero-text">
          <div className="htu-hero-eyebrow">How to use</div>
          <div className="htu-hero-line">Log the work. Everything else is computed.</div>
        </div>
        <button className="htu-hero-cta">Take the tutorial →</button>
      </div>

      <div className="bx-panel htu-card">
        <div className="htu-lbl">Data model<span className="htu-lbl-note">your most recent entry</span></div>
        <div className="htu-nest-ws">
          <div className="htu-nest-head">
            <span className="htu-nest-badge ws">Workspace</span>
            <span className="htu-nest-name ws">BRIDGED — Q3</span>
          </div>
          <div className="htu-nest-proj">
            <div className="htu-nest-head">
              <span className="htu-nest-badge proj">Project</span>
              <span className="htu-nest-name proj">SBLAF onboarding</span>
              <span className="htu-nest-phases">4 phases</span>
            </div>
            <div className="htu-nest-item">
              <div className="htu-nest-irow">
                <span className="htu-nest-tick" aria-hidden="true">✓</span>
                <span className="htu-nest-badge item">Item</span>
                <span className="htu-nest-title">Rotate partner API keys</span>
                <Avatar name="Rob" id="rob" size={20} />
              </div>
              <div className="htu-nest-arow">
                <span className="htu-nest-badge act">Activity</span>
                <span className="htu-nest-hours">2.0h</span>
                <span className="htu-nest-comment">rotated sandbox keys</span>
                <span className="htu-nest-date">Jul 20, 2025</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bx-panel htu-card">
        <div className="htu-lbl">The loop</div>
        <div className="htu-loop">
          {HTU_FLOWS.map((f, i) => (
            <span key={f.n} className="htu-loop-cell">
              <button className="htu-loop-chip">
                <span className="htu-loop-num">{f.n}</span>
                <span className="htu-loop-text">
                  <span className="htu-loop-title">{f.title}</span>
                  <span className="htu-loop-where">{f.where}</span>
                </span>
              </button>
              {i < HTU_FLOWS.length - 1 && <span className="htu-loop-arrow" aria-hidden="true">→</span>}
            </span>
          ))}
        </div>
      </div>

      <div className="htu-pair">
        <div className="bx-panel htu-card">
          <div className="htu-lbl">Status language</div>
          <div className="htu-statuses">
            {HTU_STATUSES.map(([k, label, when]) => (
              <div key={k} className="htu-status-row">
                <span className={`bx-st st-${k} htu-status-pill`}>{label}</span>
                <span className="htu-status-when">{when}</span>
              </div>
            ))}
          </div>
          <div className="htu-foot">
            Four of those are the board&rsquo;s columns. <strong>Stuck</strong> is not — it is
            printed over whatever column the task is in.
          </div>
        </div>
        <div className="bx-panel htu-card">
          <div className="htu-lbl">Shortcuts</div>
          <div className="htu-keys">
            {HTU_KEYS.map(([k, a]) => (
              <div key={k} className="htu-key-row">
                <span className="htu-keycap">{k}</span>
                <span className="htu-key-act">{a}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <details className="bx-panel htu-card htu-fold">
        <summary className="htu-lbl htu-fold-head">
          Decide what goes where<span className="htu-lbl-note">stop at the first yes</span>
          <span className="htu-fold-mark" aria-hidden="true" />
        </summary>
        <div className="htu-fold-body">
          <div className="htu-steps">
            <div className="htu-step">
              <span className="htu-step-n">1</span>
              <div className="htu-step-body">
                <div className="htu-step-q">Does this need to be hidden from some current members?</div>
                <div className="htu-step-a yes"><strong>Yes →</strong> New Workspace</div>
              </div>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

/* ── Tutorial (T-0158) ─────────────────────────────────────────────────────
   The static twin of the ported page. If the component moves to new classes
   and this does not, the harness is verifying a design that no longer ships —
   which is worse than no harness, because it looks like a check. */

const TV_LESSONS = [
  ['Set up a workspace',   '01', '4 steps', 'done'],
  ['Create a project',     '02', '3 steps', 'done'],
  ['Create a task',        '03', '3 steps', 'active'],
  ['Use the Kanban board', '04', '3 steps', 'todo'],
  ['Log time & activity',  '05', '3 steps', 'todo'],
  ['Explore the Gantt',    '06', '2 steps', 'todo'],
];
const TV_MARK = { done: '✓', active: '▸', todo: '' };
const TV_STEPS = [
  ['New item', 'Press + New item to open the quick-add.', 'Kanban'],
  ['More details', 'Click + More details to set a phase, priority or plan dates.', 'Kanban'],
  ['Add it', 'Hit Add task. It lands in the To Do column.', 'Kanban'],
];

function TutorialSample() {
  const sel = 2;
  return (
    <div className="tv-layout">
      <div className="bx-panel tv-rail">
        <div className="tv-rail-head">
          <span className="tv-lbl">Lessons</span>
          <span className="tv-count">2/6</span>
        </div>
        <div className="tv-bar"><span className="tv-bar-fill" style={{ width: '33%' }} /></div>
        <div className="tv-rail-list">
          {TV_LESSONS.map(([title, n, size, st], i) => (
            <button key={n} className={`tv-lesson${i === sel ? ' is-sel' : ''}`}>
              <span className={`tv-dot st-${st}`} aria-hidden="true">{TV_MARK[st]}</span>
              <span className="tv-lesson-text">
                <span className="tv-lesson-title">{title}</span>
                <span className="tv-lesson-meta">{n} · {size}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="tv-main">
        <div className="bx-panel tv-card">
          <div className="tv-head">
            <span className="tv-head-glow" aria-hidden="true" />
            <span className="tv-head-n">03</span>
            <div className="tv-head-text">
              <div className="tv-head-title">Create a task</div>
              <div className="tv-head-meta">3 steps · In progress</div>
            </div>
          </div>
          <div className="tv-body">
            <div className="tv-steps">
              {TV_STEPS.map(([title, body, where], j) => (
                <div key={title} className="tv-step">
                  <div className="tv-step-rail">
                    <span className="tv-step-n">{j + 1}</span>
                    {j < TV_STEPS.length - 1 && <span className="tv-step-line" />}
                  </div>
                  <div className="tv-step-text">
                    <div className="tv-step-title">{title}</div>
                    <div className="tv-step-body">{body}</div>
                    <span className="tv-step-where">{where}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="tv-actions">
              <button className="tv-btn">← Back</button>
              <button className="tv-btn tv-btn-go">
                <Icon name="play" size={13} /> Start this tour →
              </button>
              <span className="tv-pos">Lesson 3 of 6</span>
            </div>
          </div>
        </div>

        <div className="bx-panel tv-try">
          <div className="tv-try-head">
            <span className="tv-lbl">Try it here</span>
            <span className="tv-try-chip">your real data</span>
          </div>
          <div className="tv-try-bed">
            <div className="tv-try-top">
              <span className="tv-try-icon htu-pal-3"><Icon name="check" size={11} /></span>
              <span className="tv-try-title">Create a task</span>
              <span className="bx-st st-todo">Not started</span>
            </div>
            <div className="tv-try-grid">
              <div className="tv-field">
                <div className="tv-field-lbl">Steps</div>
                <div className="tv-field-val is-strong">3</div>
              </div>
              <div className="tv-field wide">
                <div className="tv-field-lbl">Pages it walks you through</div>
                <div className="tv-field-val">Kanban</div>
              </div>
              <div className="tv-field">
                <div className="tv-field-lbl">It points at</div>
                <div className="tv-field-val is-mono">3 controls</div>
              </div>
            </div>
            <div className="tv-try-actions">
              <button className="tv-btn tv-btn-open">Open Kanban</button>
              <span className="tv-try-note">
                The tour highlights each control in turn — this just takes you there.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const NEW_SAMPLES = {
  members:    () => <MembersSample />,
  goals:      () => <GoalsSample />,
  timeline:   () => <TimelineSample />,
  calendar:   () => <CalendarSample />,
  gantt:      () => <GanttSample />,
  wbs:        () => <WbsSample />,
  workload:   () => <WorkloadSample />,
  monitoring: () => <MonitoringSample />,
  people:     () => <PeopleSample />,
  variance:   () => <VarianceSample />,
  library:    () => <LibrarySample />,
  'how-to-use': () => <HowToUseSample />,
  tutorial:   () => <TutorialSample />,
};

// One root, kept across hot updates. Calling createRoot again on every edit
// stacks dead roots on the same node: the page keeps painting from the first
// one, so nothing you click does anything and nothing says why.
const host = document.getElementById('root');
const root = (globalThis.__shellRoot ||= createRoot(host));
root.render(<StrictMode><Harness /></StrictMode>);
