// src/mobile/MobileSheets.jsx — the bottom sheets: Status, Log time, Create,
// New task, a picker (owner · project · date · task) and Filter. One sheet is
// open at a time; the scrim behind it closes it.

import { useMemo, useState } from 'react';
import {
  M_STATUS, STATUS_SHEET_ORDER, mobileStatus, filterTasks, addDays, shortDate, dueChoices, linkAttachment, fileType,
} from '../services/mobileModel';
import { useMobile, Ico, ICON, Face, SheetHead } from './mobileUi';

const BLOCKERS = ['None', 'Waiting', 'Blocked', 'Unclear'];

export default function MobileSheets() {
  const m = useMobile();
  if (!m.sheet) return null;
  const close = () => { m.setSheet(null); m.setPicker(null); };
  return (
    <>
      <div className="m-scrim" onClick={close} aria-hidden="true" />
      {m.sheet === 'status' && m.task && <StatusSheet />}
      {m.sheet === 'log' && <LogSheet />}
      {m.sheet === 'plus' && <PlusSheet />}
      {m.sheet === 'new' && m.nt && <NewSheet />}
      {m.sheet === 'pick' && m.picker && <PickSheet />}
      {m.sheet === 'filter' && <FilterSheet />}
      {m.sheet === 'link' && m.picker && <LinkSheet />}
    </>
  );
}

function Sheet({ children, gap = 13, label }) {
  return <div className={`m-sheet${gap === 0 ? ' is-tight' : ''}`} style={{ gap }} role="dialog" aria-label={label}>{children}</div>;
}

function StatusSheet() {
  const m = useMobile();
  const cur = mobileStatus(m.task, m.blockedIds, m.today);
  return (
    <Sheet gap={0} label="Status">
      <SheetHead title="Status" />
      <div className="m-stack is-9">
        {STATUS_SHEET_ORDER.map((k) => (
          <button key={k} type="button" className={`m-status-opt m-tone-${M_STATUS[k].tone}${cur === k ? ' is-on' : ''}`}
            aria-pressed={cur === k} onClick={() => m.setStatus(m.task, k)}>
            <span className="m-status-opt-label">{M_STATUS[k].label}</span>
            {cur === k && <Ico d={ICON.check} size={20} stroke={3} />}
          </button>
        ))}
      </div>
      <div className="m-caption is-top">Stuck means a blocker is written down — choosing it opens Log time.</div>
    </Sheet>
  );
}

function LogSheet() {
  const m = useMobile();
  const { log, setLog } = m;
  const t = m.tasks.find((x) => x.id === log.taskId);
  const days = [0, 1, 2].map((n) => ({ n, label: n === 0 ? 'Today' : n === 1 ? 'Yesterday' : shortDate(addDays(m.today, -n), m.today) }));
  const pickTask = () => {
    m.setPicker({
      title: 'Which task?',
      returnTo: 'log',
      options: m.tasks.filter((x) => x.status !== 'done').map((x) => ({ value: x.id, label: x.title || 'Untitled task', on: x.id === log.taskId })),
      onPick: (id) => setLog((l) => ({ ...l, taskId: id })),
    });
    m.setSheet('pick');
  };
  const canSave = !!t && (log.hours > 0 || log.bott !== 'None' || log.details.trim() || log.attachments.length > 0);
  const links = log.attachments;
  // A log carries LINKS (Drive, a doc, a ticket), not uploaded files: the
  // file lives where it already lives, and the entry points at it.
  const addLink = () => {
    m.setPicker({
      title: 'Add file link',
      returnTo: 'log',
      onAdd: (att) => setLog((l) => ({ ...l, attachments: [...l.attachments, att] })),
    });
    m.setSheet('link');
  };
  const dropLink = (i) => setLog((l) => ({ ...l, attachments: l.attachments.filter((_, j) => j !== i) }));

  return (
    <Sheet label="Log time">
      <SheetHead title="Log time" onClose={() => m.setSheet(null)} />
      <button type="button" className="m-field-btn" onClick={pickTask}>
        <span className="m-field-btn-text">{t ? t.title : 'Pick a task'}</span>
        <Ico d={ICON.updown} size={16} stroke={2.6} />
      </button>

      <div className="m-day-row">
        {days.map((d) => (
          <button key={d.n} type="button" className={`m-day${log.day === d.n ? ' is-on' : ''}`}
            aria-pressed={log.day === d.n} onClick={() => setLog((l) => ({ ...l, day: d.n }))}>{d.label}</button>
        ))}
      </div>

      <div className="m-hours">
        <div className="m-hours-text">
          <div className="m-hours-day">{days[log.day].label.toUpperCase()}</div>
          <div className="m-hours-n">{log.hours}h</div>
        </div>
        <button type="button" className="m-hours-btn is-down" aria-label="Less"
          onClick={() => setLog((l) => ({ ...l, hours: Math.max(0, l.hours - 0.5) }))}>−</button>
        <button type="button" className="m-hours-btn is-up" aria-label="More"
          onClick={() => setLog((l) => ({ ...l, hours: Math.min(12, l.hours + 0.5) }))}>+</button>
      </div>

      <textarea className="m-textarea" value={log.details} placeholder="What changed?" aria-label="What changed?"
        onChange={(e) => setLog((l) => ({ ...l, details: e.target.value }))} />

      {links.map((f, i) => (
        <div key={`${f.url}:${i}`} className="m-linkrow">
          <span className="m-linkrow-type">{fileType(f)}</span>
          <span className="m-linkrow-main">
            <span className="m-linkrow-name">{f.name}</span>
            <span className="m-linkrow-url">{f.url}</span>
          </span>
          <button type="button" className="m-pri-x is-ink" onClick={() => dropLink(i)} aria-label={`Remove ${f.name}`}>✕</button>
        </div>
      ))}
      <button type="button" className="m-attach" disabled={!t} onClick={addLink}>
        <Ico d={ICON.clip} size={18} />
        <span className="m-attach-text">{links.length ? 'Add another file link' : 'Add file link'}</span>
      </button>

      <div className="m-wrap-row">
        {BLOCKERS.map((b) => (
          <button key={b} type="button" className={`m-chip-btn${log.bott === b ? (b === 'None' ? ' is-gold' : ' is-red') : ''}`}
            aria-pressed={log.bott === b} onClick={() => setLog((l) => ({ ...l, bott: b }))}>
            {b === 'None' ? 'No blocker' : b}
          </button>
        ))}
      </div>

      <button type="button" className={`m-primary${canSave ? '' : ' is-off'}`} disabled={!canSave} onClick={m.saveLog}>
        Save {log.hours}h
      </button>
    </Sheet>
  );
}

function PlusSheet() {
  const m = useMobile();
  const newTask = () => {
    const first = m.tv.fProj.length === 1 ? m.tv.fProj[0] : (m.projects[0]?.id || '');
    m.setNt({ title: '', projectId: first, owner: m.userId, status: 'todo', from: m.today, due: addDays(m.today, 5) });
    m.setSheet('new');
  };
  return (
    <Sheet label="Create">
      <div className="m-sheet-handle" aria-hidden="true" />
      <span className="m-sheet-title">Create</span>
      <div className="m-create">
        <button type="button" className="m-create-btn is-gold" onClick={newTask}><span className="m-create-ico">＋</span>New task</button>
        <button type="button" className="m-create-btn is-orange" onClick={() => m.openLogFor(null)}><span className="m-create-ico">◷</span>Log time</button>
      </div>
    </Sheet>
  );
}

function NewSheet() {
  const m = useMobile();
  const { nt, setNt } = m;
  const project = m.projectById[nt.projectId];
  const open = (title, options, field, extra = {}) => {
    m.setPicker({ title, options, returnTo: 'new', onPick: (v) => setNt((s) => ({ ...s, [field]: v })), ...extra });
    m.setSheet('pick');
  };
  const dateOpts = (cur) => [
    ...dueChoices(m.today).map((c) => ({ value: c.ymd, label: c.label, on: cur === c.ymd })),
    { value: '', label: 'No date', on: !cur },
  ];
  const tile = (label, body, onClick) => (
    <button type="button" className="m-tile" onClick={onClick}>
      <span className="m-tile-k">{label}</span><span className="m-tile-v">{body}</span>
    </button>
  );
  return (
    <Sheet label="New task">
      <SheetHead title="New task" onClose={() => m.setSheet(null)} />
      <input className="m-input" autoFocus value={nt.title} placeholder="What needs doing?" aria-label="Task title"
        onChange={(e) => { const v = e.target.value; setNt((s) => ({ ...s, title: v })); }}
        onKeyDown={(e) => { if (e.key === 'Enter') m.createTask(); }} />
      <div className="m-tiles is-sheet">
        {tile('PROJECT', <span className="m-tile-ellipsis">{project?.name || 'None'}</span>,
          () => open('Project', [{ value: '', label: 'No project', on: !nt.projectId }, ...m.projects.map((p) => ({ value: p.id, label: p.name, color: p.color, on: p.id === nt.projectId }))], 'projectId'))}
        {tile('OWNER', <>{nt.owner ? <Face uid={nt.owner} size={26} /> : null}<span>{nt.owner ? m.firstOf(nt.owner) : 'Nobody'}</span></>,
          () => open('Owner', [...m.members.map((uid) => ({ value: uid, label: m.nameOf(uid), uid, on: uid === nt.owner })), { value: '', label: 'Unassigned', on: !nt.owner }], 'owner'))}
        {tile('START', <span>{nt.from ? shortDate(nt.from, m.today) : '—'}</span>, () => open('Start', dateOpts(nt.from), 'from', { date: nt.from || '' }))}
        {tile('DUE', <span>{nt.due ? shortDate(nt.due, m.today) : '—'}</span>, () => open('Due', dateOpts(nt.due), 'due', { date: nt.due || '' }))}
      </div>
      <div className="m-wrap-row">
        {['todo', 'doing', 'review', 'done'].map((k) => (
          <button key={k} type="button" className={`m-chip-btn${nt.status === k ? ` is-st m-tone-${M_STATUS[k].tone}` : ''}`}
            aria-pressed={nt.status === k} onClick={() => setNt((s) => ({ ...s, status: k }))}>{M_STATUS[k].label}</button>
        ))}
      </div>
      <button type="button" className={`m-primary${nt.title.trim() ? '' : ' is-off'}`} onClick={m.createTask}>Create task</button>
    </Sheet>
  );
}

function PickSheet() {
  const m = useMobile();
  const p = m.picker;
  const choose = (v) => {
    p.onPick(v);
    m.setPicker(null);
    m.setSheet(p.returnTo || null);
  };
  return (
    <Sheet label={p.title}>
      <div className="m-sheet-handle" aria-hidden="true" />
      <span className="m-sheet-title">{p.title}</span>
      <div className="m-pick-list">
        {p.options.map((o) => (
          <button key={o.value || '_none'} type="button" className={`m-pick-opt${o.on ? ' is-on' : ''}`}
            aria-pressed={!!o.on} onClick={() => choose(o.value)}>
            {o.uid && <Face uid={o.uid} size={32} />}
            {o.color && <span className="m-dot is-10" style={{ background: o.color }} />}
            <span className="m-pick-label">{o.label}</span>
          </button>
        ))}
        {p.options.length === 0 && <div className="m-quiet">Nothing to choose from.</div>}
      </div>
      {p.date !== undefined && (
        <label className="m-pick-date">
          <span>Other date</span>
          <input type="date" defaultValue={p.date} onChange={(e) => e.target.value && choose(e.target.value)} />
        </label>
      )}
    </Sheet>
  );
}

function FilterSheet() {
  const m = useMobile();
  const { tv, patchTv } = m;
  const tog = (key, val) => () => patchTv((s) => ({ [key]: s[key].includes(val) ? s[key].filter((x) => x !== val) : [...s[key], val] }));
  const result = useMemo(() => filterTasks(m.tasks, {
    projects: tv.fProj, people: tv.fWho, statuses: tv.fSt, q: tv.q, blockedIds: m.blockedIds, today: m.today,
  }).length, [m.tasks, tv.fProj, tv.fWho, tv.fSt, tv.q, m.blockedIds, m.today]);
  return (
    <Sheet gap={12} label="Filter">
      <div className="m-sheet-handle" aria-hidden="true" />
      <div className="m-sheet-head">
        <span className="m-sheet-title">Filter</span>
        <button type="button" className="m-link" onClick={() => patchTv({ fProj: [], fWho: [], fSt: [], q: '' })}>Reset</button>
      </div>
      <div className="m-kicker is-grey">OWNER</div>
      <div className="m-who-row">
        {m.members.slice(0, 8).map((uid) => {
          const on = tv.fWho.includes(uid);
          return (
            <button key={uid} type="button" className={`m-who${on ? ' is-on' : ''}${tv.fWho.length && !on ? ' is-dim' : ''}`}
              aria-pressed={on} onClick={tog('fWho', uid)}>
              <Face uid={uid} size={48} />
              <span className="m-who-label">{uid === m.userId ? 'Me' : m.firstOf(uid)}</span>
            </button>
          );
        })}
      </div>
      <div className="m-kicker is-grey is-top">PROJECT</div>
      <div className="m-wrap-row is-sm">
        {m.projects.map((p) => (
          <button key={p.id} type="button" className={`m-chip-btn${tv.fProj.includes(p.id) ? ' is-navy' : ''}`}
            aria-pressed={tv.fProj.includes(p.id)} onClick={tog('fProj', p.id)}>{p.name}</button>
        ))}
      </div>
      <div className="m-kicker is-grey is-top">STATUS</div>
      <div className="m-wrap-row is-sm">
        {STATUS_SHEET_ORDER.map((k) => (
          <button key={k} type="button" className={`m-chip-btn${tv.fSt.includes(k) ? ' is-navy' : ''}`}
            aria-pressed={tv.fSt.includes(k)} onClick={tog('fSt', k)}>{M_STATUS[k].label}</button>
        ))}
      </div>
      <button type="button" className="m-primary is-navy-solid" onClick={() => m.setSheet(null)}>Show {result} tasks</button>
    </Sheet>
  );
}

/** Paste a link: the URL, and optionally what to call it. */
function LinkSheet() {
  const m = useMobile();
  const p = m.picker;
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [tried, setTried] = useState(false);
  const att = linkAttachment(url, name);
  const done = () => { m.setPicker(null); m.setSheet(p.returnTo || null); };
  const add = async () => {
    setTried(true);
    if (!att) return;
    await p.onAdd(att);
    done();
  };
  return (
    <Sheet label={p.title}>
      <SheetHead title={p.title} onClose={done} />
      <input className="m-input" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
        autoFocus value={url} placeholder="Paste a link — Drive, Docs, Figma…" aria-label="Link"
        onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
      <input className="m-input" value={name} placeholder={att ? `Name (optional) — ${att.name}` : 'Name (optional)'} aria-label="Name"
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
      {tried && url.trim() && !att && <div className="m-caption is-err">That is not a web link. It should look like drive.google.com/… or https://…</div>}
      {p.note && <div className="m-caption">{p.note}</div>}
      <button type="button" className={`m-primary${att ? '' : ' is-off'}`} onClick={add}>{p.cta || 'Add link'}</button>
    </Sheet>
  );
}
