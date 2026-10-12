// src/mobile/MobileTaskDetail.jsx — one task, full screen: the status, the
// four facts you change most (owner, project, start, due), the description,
// and six tabs — Log · Chat · Sub-items · Files · Links · AI — over the same
// records the desktop task editor reads and writes.
//
// The title and the description edit where they stand: tap, type, and it is
// saved when you leave the field (Escape puts it back). A log entry opens the
// Log sheet on itself. What is offered follows firestore.rules — see
// taskRights / activityRights — so nobody is handed a button the server will
// refuse.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useActivities, useTaskComments } from '../hooks/useTasks';
import { useAiStatus } from '../hooks/useAiStatus';
import { addTaskComment, updateTask, addActivity } from '../services/firebase';
import { generateClaudePrompt, generateSubtasks } from '../services/anthropic';
import { buildFallbackPrompt } from '../services/dueAlerts';
import { noticeWhen } from '../services/mentions';
import {
  M_STATUS, mobileStatus, hoursLabel, ownerOf, shortDate, taskCode, dueChoices,
  attachmentsOf, fileSize, taskRights, activityRights,
} from '../services/mobileModel';
import { activateProps } from '../hooks/useActivate';
import { useMobile, Ico, ICON, Face, StatusPill } from './mobileUi';

const LINK_REL = { 'related-to': 'RELATED TO', 'duplicate-of': 'DUPLICATE OF', blocks: 'BLOCKS', 'child-of': 'PART OF' };

export default function MobileTaskDetail() {
  const m = useMobile();
  const t = m.task;
  const { activities: acts } = useActivities(t.id, t.workspaceId);
  const { comments } = useTaskComments(t.workspaceId, t.id);
  const ai = useAiStatus();
  const [comment, setComment] = useState('');
  const [prompt, setPrompt] = useState(null);
  const [busy, setBusy] = useState(null);
  // Inline editing: which field is open ('title' | 'desc'), and what is in it.
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const field = useRef(null);
  // Set by Escape: a browser may fire blur as the field goes away, and that
  // blur must not save what Escape just threw out.
  const cancelled = useRef(false);

  const st = mobileStatus(t, m.blockedIds, m.today);
  const owner = ownerOf(t);
  const project = m.projectById[t.projectId];
  const workspace = m.workspaces.find((w) => w.id === t.workspaceId) || null;
  const { canEdit } = taskRights(t, { uid: m.userId, workspace, project });
  const rightsFor = (a) => activityRights(a, { uid: m.userId, workspace, project: m.projectById[a.projectId] });
  const subs = t.subtasks || [];
  const doneSubs = subs.filter((s) => s.done).length;
  const late = t.status !== 'done' && t.plan?.endDate && t.plan.endDate < m.today;
  const files = useMemo(() => attachmentsOf(acts), [acts]);
  const sortedActs = useMemo(
    () => [...acts].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
    [acts],
  );

  const blockedBy = (t.dependsOn || []).map((id) => m.tasks.find((x) => x.id === id)).filter(Boolean);
  const blocks = m.tasks.filter((x) => (x.dependsOn || []).includes(t.id));
  const related = (t.links || []).map((l) => ({ l, target: m.tasks.find((x) => x.id === l.targetId) })).filter((r) => r.target);
  const deps = [
    ...blockedBy.map((x) => ({ rel: 'BLOCKED BY', task: x })),
    ...blocks.map((x) => ({ rel: 'BLOCKS', task: x })),
    ...related.map((r) => ({ rel: LINK_REL[r.l.type] || 'RELATED TO', task: r.target })),
  ];

  // ── pickers ───────────────────────────────────────────────────────────────
  const pick = (title, options, onPick, extra = {}) => {
    m.setPicker({ title, options, onPick, ...extra });
    m.setSheet('pick');
  };
  const pickOwner = () => pick('Owner', [
    ...m.members.map((uid) => ({ value: uid, label: m.nameOf(uid), uid, on: owner?.uid === uid })),
    { value: '', label: 'Unassigned', on: !owner },
  ], (v) => m.setTaskField(t, 'owner', v));
  // Only projects in the task's own workspace (see TaskEditor's projectChoices).
  const pickProject = () => pick('Project', m.projects.filter((p) => !p.workspaceId || p.workspaceId === t.workspaceId).map((p) => ({
    value: p.id, label: p.name, color: p.color, on: p.id === t.projectId,
  })), (v) => m.setTaskField(t, 'project', v));
  const pickDate = (field, title) => {
    const cur = field === 'from' ? t.plan?.startDate : t.plan?.endDate;
    pick(title, [
      ...dueChoices(m.today).map((c) => ({ value: c.ymd, label: c.label, on: cur === c.ymd })),
      { value: '', label: 'No date', on: !cur },
    ], (v) => m.setTaskField(t, field, v), { date: cur || '' });
  };
  const pickDependency = () => pick('Blocked by…', m.tasks
    .filter((x) => x.id !== t.id && x.status !== 'done' && !(t.dependsOn || []).includes(x.id))
    .slice(0, 40)
    .map((x) => ({ value: x.id, label: x.title || 'Untitled task' })),
  async (id) => {
    try { await updateTask(t.id, { dependsOn: [...(t.dependsOn || []), id] }); m.flash('Link added'); }
    catch (err) { m.fail(err, 'Could not add that link.'); }
  });

  // ── writes ────────────────────────────────────────────────────────────────
  const toggleSub = async (i) => {
    const next = subs.map((s, j) => (j === i ? { ...s, done: !s.done } : s));
    try { await updateTask(t.id, { subtasks: next }); } catch (err) { m.fail(err, 'Could not tick that off.'); }
  };
  const sendComment = async () => {
    const text = comment.trim();
    if (!text) return;
    setBusy('comment');
    try {
      await addTaskComment(m.userId, t, text, { members: m.members, memberProfiles: m.profiles, authorName: m.nameOf(m.userId) });
      setComment('');
    } catch (err) { m.fail(err, 'Could not post that comment.'); }
    setBusy(null);
  };
  const projectNote = { name: project?.name, description: project?.description };
  const withLinks = () => ({
    ...t,
    // "Reads this task + its dependencies & relations": they go in with it.
    description: [t.description, deps.length ? `Dependencies & relations: ${deps.map((d) => `${d.rel.toLowerCase()} "${d.task.title}" (${M_STATUS[mobileStatus(d.task, m.blockedIds, m.today)].label})`).join('; ')}` : '']
      .filter(Boolean).join('\n\n'),
  });
  const genPrompt = async () => {
    setBusy('prompt');
    try {
      if (ai.available) {
        setPrompt({ text: await generateClaudePrompt({ task: withLinks(), projectName: projectNote.name, projectDescription: projectNote.description, subtasks: subs }), template: false });
      } else {
        setPrompt({ text: buildFallbackPrompt(withLinks(), projectNote), template: true });
      }
    } catch (err) {
      setPrompt({ text: buildFallbackPrompt(withLinks(), projectNote), template: true });
      console.error(err);
    }
    setBusy(null);
  };
  const genSubs = async () => {
    if (!ai.available) { m.flash('AI is off — sub-items need it', { tone: 'err' }); return; }
    setBusy('subs');
    try {
      const fresh = await generateSubtasks({ task: withLinks(), projectName: project?.name });
      await updateTask(t.id, { subtasks: [...subs, ...fresh] });
      m.setDtab('sub');
      m.flash(`${fresh.length} sub-items added`);
    } catch (err) { m.fail(err, 'Could not suggest sub-items.'); }
    setBusy(null);
  };
  // A file link on the task is an activity entry carrying it — where the
  // desktop keeps every file — so it shows in Log, in Files and in Reports.
  const addFileLink = () => {
    m.setPicker({
      title: 'Add file link',
      cta: 'Add to this task',
      note: 'It is saved as a log entry with no hours, so it sits next to the work it belongs to.',
      onAdd: async (att) => {
        try {
          await addActivity(m.userId, t, {
            date: m.today,
            hoursSpent: 0,
            comment: `Added a file link: ${att.name}`,
            attachments: [att],
            bottleneckRemarks: '',
            completionStatus: t.status === 'done' ? 'completed' : 'in-progress',
          });
          m.flash('Link added');
        } catch (err) { m.fail(err, 'Could not add that link.'); }
      },
    });
    m.setSheet('link');
  };
  // ── inline title + description ───────────────────────────────────────────
  const startEdit = (which) => {
    if (!canEdit) return;
    setDraft(which === 'title' ? (t.title || '') : (t.description || ''));
    setEditing(which);
  };
  // Grow the box with its text, and put the caret at the end when it opens.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editing]);
  useLayoutEffect(() => {
    const el = field.current;
    if (!el || !editing) return;
    cancelled.current = false;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);
  const commitEdit = async () => {
    const which = editing;
    if (!which || cancelled.current) return;
    setEditing(null);
    const value = which === 'title' ? draft.replace(/\s+/g, ' ').trim() : draft.trim();
    const before = which === 'title' ? (t.title || '') : (t.description || '').trim();
    if (value === before) return;
    if (which === 'title' && !value) { m.flash('A task needs a title — it was kept', { tone: 'err' }); return; }
    try {
      await updateTask(t.id, which === 'title' ? { title: value } : { description: value });
      m.flash(which === 'title' ? 'Title saved' : 'Description saved');
    } catch (err) { m.fail(err, 'Could not save that change.'); }
  };
  const editKeys = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancelled.current = true; setEditing(null); }
    // Enter ends a title (it is one line); in a description it is a new line.
    if (e.key === 'Enter' && editing === 'title') { e.preventDefault(); e.currentTarget.blur(); }
  };

  const copyPrompt = async () => {
    try { await navigator.clipboard.writeText(prompt.text); m.flash('Prompt copied'); }
    catch { m.flash('Copy is blocked here — select the text instead', { tone: 'err' }); }
  };

  const tabs = [
    ['act', '⏱', 'Log'], ['chat', '❝', 'Chat'], ['sub', '✓', `${doneSubs}/${subs.length}`],
    ['files', '◫', 'Files'], ['links', '⛓', 'Links'], ['ai', '✦', 'AI'],
  ];
  const tile = (label, body, onClick) => (
    <button type="button" className="m-tile" onClick={onClick}>
      <span className="m-tile-k">{label}</span>
      <span className="m-tile-v">{body}</span>
    </button>
  );

  return (
    <div className="m-detail">
      <div className="m-detail-top">
        <button type="button" className="m-back" onClick={m.closeTask} aria-label="Back"><Ico d={ICON.back} stroke={2.6} /></button>
        <span className="m-detail-code">{taskCode(t)}</span>
        <span className="m-detail-hrs">{hoursLabel(t)}</span>
        {canEdit && (
          <button type="button" className="m-detail-del" onClick={() => m.deleteTask(t)}
            aria-label={`Delete ${t.title || 'this task'}`} title="Delete task (it goes to Trash — Undo is offered)">
            <Ico d={ICON.trash} size={18} stroke={2.2} />
          </button>
        )}
      </div>

      <div className="m-detail-body">
        <StatusPill status={st} big onClick={() => m.setSheet('status')} suffix=" ▾" />
        {editing === 'title' ? (
          <textarea ref={field} className="m-detail-title is-editing" rows={1} value={draft} aria-label="Task title"
            onChange={(e) => setDraft(e.target.value.replace(/\n/g, ' '))} onBlur={commitEdit} onKeyDown={editKeys} />
        ) : (
          <div className={`m-detail-title${canEdit ? ' is-editable' : ''}`}
            {...(canEdit ? activateProps(() => startEdit('title'), { label: `Edit title: ${t.title || 'Untitled task'}` }) : {})}>
            {t.title || 'Untitled task'}
          </div>
        )}

        <div className="m-tiles">
          {tile('OWNER', <>{owner ? <Face uid={owner.uid} name={owner.name || ''} size={26} /> : null}<span>{owner ? (owner.uid ? m.firstOf(owner.uid) : owner.name) : 'Nobody'}</span></>, pickOwner)}
          {tile('PROJECT', <span className="m-tile-ellipsis">{project?.name || 'None'}</span>, pickProject)}
          {tile('START', <span>{t.plan?.startDate ? shortDate(t.plan.startDate, m.today) : '—'}</span>, () => pickDate('from', 'Start'))}
          {tile('DUE', <span className={late ? 'm-ink-late' : ''}>{t.plan?.endDate ? shortDate(t.plan.endDate, m.today) : '—'}</span>, () => pickDate('due', 'Due'))}
        </div>

        {editing === 'desc' ? (
          <textarea ref={field} className="m-detail-desc is-editing" rows={3} value={draft} aria-label="Description"
            placeholder="What is this task about?" onChange={(e) => setDraft(e.target.value)} onBlur={commitEdit} onKeyDown={editKeys} />
        ) : (
          <div className={`m-detail-desc${canEdit ? ' is-editable' : ''}${t.description?.trim() ? '' : ' is-empty'}`}
            {...(canEdit ? activateProps(() => startEdit('desc'), { label: t.description?.trim() ? `Edit description: ${t.description.trim().slice(0, 140)}` : 'Add a description' }) : {})}>
            {t.description?.trim() || (canEdit ? 'Add a description…' : 'No description yet.')}
          </div>
        )}

        <div className="m-dtabs" role="tablist">
          {tabs.map(([k, icon, label]) => (
            <button key={k} type="button" role="tab" aria-selected={m.dtab === k}
              className={`m-dtab${m.dtab === k ? ' is-on' : ''}`} onClick={() => m.setDtab(k)}>
              <span className="m-dtab-icon" aria-hidden="true">{icon}</span>{label}
            </button>
          ))}
        </div>

        <div className="m-dpanel">
          {m.dtab === 'act' && (
            <div className="m-stack is-10">
              {sortedActs.map((a) => {
                const may = rightsFor(a).canEdit;
                return (
                <div key={a.id} className={`m-act${may ? ' is-editable' : ''}`}
                  {...(may ? activateProps(() => m.editLog(a), { label: `Edit log entry: ${m.firstOf(a.userId)}, ${Number(a.hoursSpent) || 0}h, ${shortDate(a.date, m.today)}${a.comment ? ` — ${a.comment.slice(0, 120)}` : ''}` }) : {})}>
                  <div className="m-act-head">
                    <Face uid={a.userId} size={28} />
                    <span className="m-act-who">{m.firstOf(a.userId)}</span>
                    {(Number(a.hoursSpent) || 0) > 0 && <span className="m-act-h">{Number(a.hoursSpent)}h</span>}
                    <span className="m-act-when">{shortDate(a.date, m.today)}</span>
                    {may && <Ico d={ICON.edit} size={14} stroke={2.4} className="m-act-edit" />}
                  </div>
                  {a.comment && <div className="m-act-text">{a.comment}</div>}
                  {a.bottleneckRemarks?.trim() && <div className="m-act-bott">⚠ {a.bottleneckRemarks.trim()}</div>}
                  {(a.attachments || []).length > 0 && (
                    <div className="m-act-files">
                      {a.attachments.map((f, i) => (
                        <a key={`${f.url}:${i}`} className="m-act-file" href={f.url || undefined} target="_blank" rel="noreferrer"
                          onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                          <Ico d={ICON.clip} size={13} stroke={2.4} />{f.name || 'File'}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                );
              })}
              {sortedActs.length === 0 && <div className="m-quiet">No logs yet</div>}
            </div>
          )}

          {m.dtab === 'chat' && (
            <div className="m-stack is-10">
              {comments.map((c) => (
                <div key={c.id} className="m-cmt">
                  <Face uid={c.userId} size={32} />
                  <div className="m-cmt-bubble">
                    <div className="m-cmt-head"><span className="m-cmt-who">{m.firstOf(c.userId)}</span><span className="m-cmt-when">{noticeWhen(c.createdAt)}</span></div>
                    <div className="m-cmt-text">{c.body}</div>
                  </div>
                </div>
              ))}
              {comments.length === 0 && <div className="m-quiet is-16">No comments yet</div>}
              <div className="m-cmt-composer">
                <input value={comment} onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendComment(); }}
                  placeholder="Comment or @mention" aria-label="Comment" />
                <button type="button" className="m-cmt-send" onClick={sendComment} disabled={busy === 'comment'}>Send</button>
              </div>
            </div>
          )}

          {m.dtab === 'sub' && (
            <div className="m-stack is-9">
              {subs.map((s, i) => (
                <button key={s.id || i} type="button" className={`m-sub${s.done ? ' is-done' : ''}`}
                  role="checkbox" aria-checked={!!s.done} onClick={() => toggleSub(i)}>
                  <span className="m-sub-box">{s.done ? '✓' : ''}</span>
                  <span className="m-sub-text">{s.text}</span>
                </button>
              ))}
              {subs.length === 0 && <div className="m-quiet">No sub-items</div>}
            </div>
          )}

          {m.dtab === 'files' && (
            <div className="m-stack is-9">
              {files.map((f) => (
                <a key={f.key} className="m-file" href={f.url || undefined} target="_blank" rel="noreferrer">
                  <span className="m-file-type">{f.type}</span>
                  <span className="m-file-name">{f.name}</span>
                  <span className="m-file-size">{fileSize(f.size)}</span>
                </a>
              ))}
              {files.length === 0 && <div className="m-quiet">No files yet</div>}
              <button type="button" className="m-dashed-btn" onClick={addFileLink}>+ Add file link</button>
            </div>
          )}

          {m.dtab === 'links' && (
            <div className="m-stack is-9">
              {deps.map((d) => {
                const ds = mobileStatus(d.task, m.blockedIds, m.today);
                return (
                  <button key={`${d.rel}:${d.task.id}`} type="button" className="m-link-row" onClick={() => m.openTask(d.task.id, 'links')}>
                    <span className="m-link-main">
                      <span className="m-link-rel">{d.rel}</span>
                      <span className="m-link-title">{d.task.title}</span>
                    </span>
                    <StatusPill status={ds} />
                  </button>
                );
              })}
              {deps.length === 0 && <div className="m-quiet is-16">No dependencies</div>}
              <button type="button" className="m-dashed-btn" onClick={pickDependency}>+ Add link</button>
            </div>
          )}

          {m.dtab === 'ai' && (
            <div className="m-stack is-10">
              <div className="m-ai-actions">
                <button type="button" className="m-ai-act is-navy" onClick={genPrompt} disabled={busy === 'prompt'}>
                  <span className="m-gold m-ai-act-icon">✦</span>{busy === 'prompt' ? 'Writing…' : 'GenAI prompt'}
                </button>
                <button type="button" className="m-ai-act is-gold" onClick={genSubs} disabled={busy === 'subs'}>
                  <span className="m-ai-act-icon">✓</span>{busy === 'subs' ? 'Thinking…' : 'Sub-items'}
                </button>
              </div>
              {prompt && (
                <div className="m-prompt">
                  {prompt.template && <div className="m-prompt-note">AI is off, so this is a template built from the task.</div>}
                  <div className="m-prompt-text">{prompt.text}</div>
                  <button type="button" className="m-ghost-pill is-cream" onClick={copyPrompt}>Copy</button>
                </div>
              )}
              <div className="m-caption">Reads this task + its dependencies &amp; relations.</div>
            </div>
          )}
        </div>
      </div>

      <div className="m-detail-foot">
        <button type="button" className="m-foot-btn is-gold" onClick={() => m.setStatus(t, t.status === 'done' ? 'doing' : 'done')}>
          {t.status === 'done' ? 'Reopen' : 'Mark done'}
        </button>
        <button type="button" className="m-foot-btn is-orange" onClick={() => m.openLogFor(t.id)}>Log time</button>
      </div>
    </div>
  );
}
