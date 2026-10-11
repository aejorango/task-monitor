// src/mobile/MobileMinuteEditor.jsx — new or edit minutes, made for a thumb.
//
// The desktop MinuteEditor is a two-column modal of inputs. On a phone the
// same record is a screen built from the task screen's own pieces: the title
// as the heading, four tiles for the facts you pick rather than type (date,
// project, where, whose priorities), attendees as faces you tap, and every list
// — The Priority, the action items — as rows you add one at a time. It saves
// the desktop's fields through the desktop's functions, so either editor can
// open what the other wrote. The shape and the save rules are
// minuteDraft / minutePayload in services/mobileModel.js.

import { useMemo, useState } from 'react';
import {
  addMinute, updateMinute, softDeleteMinute, restoreDeleted, uid,
} from '../services/firebase';
import { useDialog } from '../components/Dialog';
import {
  minuteDraft, minutePayload, minuteChanged, splitNames, joinNames, pastChoices, dueChoices, shortDate,
} from '../services/mobileModel';
import { useMobile, Ico, ICON, Face } from './mobileUi';

export default function MobileMinuteEditor() {
  const m = useMobile();
  const ask = useDialog();
  const p = m.push;
  // The minute the screen was opened on travels with it (push.minute), so the
  // form never starts from a listener that has not answered yet.
  const minute = p.minute || null;
  const isNew = !p.minuteId;

  // The working copy is taken once, when the screen opens: a teammate's save
  // arriving mid-edit must not overwrite what is being typed.
  const [initial] = useState(() => minuteDraft(minute, { today: m.today, projectId: p.projectId, newId: uid }));
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...(typeof patch === 'function' ? patch(f) : patch) }));

  const back = () => m.setPush(p.from || { kind: 'minutes' });
  const close = async () => {
    if (minuteChanged(form, initial)
      && !await ask.confirm({ title: 'Discard these changes?', confirmLabel: 'Discard', danger: true })) return;
    back();
  };

  // ── people ──────────────────────────────────────────────────────────────
  // Attendees are stored as names. A name that is a member's is that member:
  // tapped on and off as a face; anybody else is a chip.
  const memberName = (uid2) => String(m.nameOf(uid2) || '');
  const uidFor = (name) => {
    const n = String(name || '').trim().toLowerCase();
    return m.members.find((u) => {
      const full = memberName(u).toLowerCase();
      return full === n || full.split(/\s+/)[0] === n;
    }) || null;
  };
  const names = splitNames(form.attendees);
  const present = new Set(names.map(uidFor).filter(Boolean));
  const guests = names.filter((n) => !uidFor(n));
  const toggleMember = (u) => set((f) => {
    const list = splitNames(f.attendees);
    const next = present.has(u) ? list.filter((n) => uidFor(n) !== u) : [...list, memberName(u)];
    return { attendees: joinNames(next) };
  });
  const addGuest = async () => {
    const name = await ask.prompt({ title: 'Add an attendee', label: 'Name', placeholder: 'e.g. Mr. Reyes', confirmLabel: 'Add' });
    if (name?.trim()) set((f) => ({ attendees: joinNames([...splitNames(f.attendees), name.trim()]) }));
  };
  const dropGuest = (name) => set((f) => ({ attendees: joinNames(splitNames(f.attendees).filter((n) => n !== name)) }));

  // ── pickers (the app's own bottom sheet) ────────────────────────────────
  const pick = (title, options, onPick, extra = {}) => { m.setPicker({ title, options, onPick, ...extra }); m.setSheet('pick'); };
  const pickDate = () => pick('Meeting date', pastChoices(m.today).map((c) => ({ value: c.ymd, label: c.label, on: c.ymd === form.date })),
    (v) => v && set({ date: v }), { date: form.date });
  const pickProject = () => pick('Project', [
    { value: '', label: 'No project', on: !form.projectId },
    ...m.projects.map((pr) => ({ value: pr.id, label: pr.name, color: pr.color, on: pr.id === form.projectId })),
  ], (v) => set({ projectId: v }));
  const promptText = async (title, key, placeholder) => {
    const v = await ask.prompt({ title, label: title, defaultValue: form[key], placeholder, confirmLabel: 'Done' });
    if (v != null) set({ [key]: v });
  };
  const pickOwner = (id) => {
    const cur = form.actionItems.find((x) => x.id === id)?.owner || '';
    pick('Who does it?', [
      ...m.members.map((u) => ({ value: memberName(u), label: memberName(u), uid: u, on: uidFor(cur) === u })),
      { value: '__other__', label: 'Someone else…' },
      { value: '', label: 'Nobody yet', on: !cur },
    ], async (v) => {
      let owner = v;
      if (v === '__other__') {
        owner = await ask.prompt({ title: 'Who does it?', label: 'Name', defaultValue: uidFor(cur) ? '' : cur, confirmLabel: 'Done' });
        if (owner == null) return;
      }
      setItem(id, { owner: String(owner).trim() });
    });
  };
  const pickDue = (id) => {
    const cur = form.actionItems.find((x) => x.id === id)?.due || '';
    pick('Due', [
      ...dueChoices(m.today).map((c) => ({ value: c.ymd, label: c.label, on: c.ymd === cur })),
      { value: '', label: 'No date', on: !cur },
    ], (v) => setItem(id, { due: v }), { date: cur });
  };

  // ── lists ───────────────────────────────────────────────────────────────
  const setItem = (id, patch) => set((f) => ({ actionItems: f.actionItems.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const addItem = () => set((f) => ({ actionItems: [...f.actionItems, { id: uid(), text: '', owner: '', due: '', done: false, taskId: null }] }));
  const delItem = (id) => set((f) => ({ actionItems: f.actionItems.filter((x) => x.id !== id) }));
  const addLine = (key) => set((f) => ({ [key]: [...f[key], { id: uid(), text: '' }] }));
  const setLine = (key, id, text) => set((f) => ({ [key]: f[key].map((x) => (x.id === id ? { ...x, text } : x)) }));
  const delLine = (key, id) => set((f) => ({ [key]: f[key].filter((x) => x.id !== id) }));

  // ── save / delete ───────────────────────────────────────────────────────
  const save = async () => {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    try {
      const payload = minutePayload(form);
      if (isNew) await addMinute(m.userId, { ...payload, workspaceId: m.workspaceId });
      else await updateMinute(p.minuteId, payload);
      m.flash(isNew ? 'Minutes saved' : 'Changes saved');
      back();
    } catch (err) {
      setSaving(false);
      m.fail(err, 'Could not save these minutes.');
    }
  };
  const remove = async () => {
    if (!await ask.confirm({ title: `Delete “${form.title || 'these minutes'}”?`, confirmLabel: 'Delete', danger: true })) return;
    setSaving(true);
    try {
      await softDeleteMinute(p.minuteId);
      back();
      m.flash('Minutes deleted', { undo: () => restoreDeleted('minute', p.minuteId).catch((err) => m.fail(err, 'Could not bring them back.')) });
    } catch (err) {
      setSaving(false);
      m.fail(err, 'Could not delete these minutes.');
    }
  };

  const project = m.projectById[form.projectId];
  const filled = useMemo(() => form.actionItems.filter((x) => x.text.trim()).length, [form.actionItems]);
  const tile = (label, body, onClick, empty = false) => (
    <button type="button" className="m-tile" onClick={onClick}>
      <span className="m-tile-k">{label}</span>
      <span className={`m-tile-v${empty ? ' is-empty' : ''}`}>{body}</span>
    </button>
  );

  return (
    <div className="m-detail" role="dialog" aria-label={isNew ? 'New minutes' : 'Edit minutes'}>
      <div className="m-detail-top">
        <button type="button" className="m-back" onClick={close} aria-label="Back"><Ico d={ICON.back} stroke={2.6} /></button>
        <span className="m-detail-code">{isNew ? 'NEW MINUTES' : 'EDIT MINUTES'}</span>
        {filled > 0 && <span className="m-detail-hrs">{filled} action{filled === 1 ? '' : 's'}</span>}
      </div>

      <div className="m-detail-body">
        <textarea className="m-title-input" rows={1} value={form.title} placeholder="Meeting title"
          aria-label="Meeting title" onChange={(e) => set({ title: e.target.value.replace(/\n/g, ' ') })} />

        <div className="m-tiles">
          {tile('DATE', <span>{shortDate(form.date, m.today)}</span>, pickDate)}
          {tile('PROJECT', project
            ? <><span className="m-dot is-10" style={{ background: project.color || 'var(--m-faint)' }} /><span className="m-tile-ellipsis">{project.name}</span></>
            : <span>None</span>, pickProject, !project)}
          {tile('WHERE', <span className="m-tile-ellipsis">{form.location || 'Add a place'}</span>,
            () => promptText('Where', 'location', 'Room / link'), !form.location)}
          {tile('BOSS', <span className="m-tile-ellipsis">{form.bossName || 'Whose priorities'}</span>,
            () => promptText("Boss's name", 'bossName', 'e.g. Mr. Reyes'), !form.bossName)}
        </div>

        <div className="m-ed-section">
          <div className="m-kicker-row">
            <span className="m-kicker">ATTENDEES</span>
            <span className="m-ed-count">{names.length || ''}</span>
          </div>
          <div className="m-who-row is-wrap">
            {m.members.map((u) => (
              <button key={u} type="button" className={`m-who${present.has(u) ? ' is-on' : ''}`}
                aria-pressed={present.has(u)} onClick={() => toggleMember(u)}>
                <Face uid={u} size={44} />
                <span className="m-who-label">{u === m.userId ? 'Me' : m.firstOf(u)}</span>
              </button>
            ))}
          </div>
          <div className="m-wrap-row is-sm m-ed-guests">
            {guests.map((n) => (
              <button key={n} type="button" className="m-fchip" onClick={() => dropGuest(n)} aria-label={`Remove ${n}`}>
                {n}<span className="m-fchip-x">✕</span>
              </button>
            ))}
            <button type="button" className="m-chip-btn" onClick={addGuest}>+ Someone else</button>
          </div>
        </div>

        <div className="m-ed-section">
          <div className="m-kicker">NOTES</div>
          <textarea className="m-textarea is-tall" value={form.notes} placeholder="Discussion, updates, context…"
            aria-label="Notes" onChange={(e) => set({ notes: e.target.value })} />
        </div>

        <div className="m-ed-section">
          <div className="m-kicker">DECISIONS</div>
          <textarea className="m-textarea" value={form.decisions} placeholder="One decision per line"
            aria-label="Decisions" onChange={(e) => set({ decisions: e.target.value })} />
        </div>

        <div className="m-ed-section">
          <div className="m-priority is-edit">
            <div className="m-priority-k">THE PRIORITY{form.bossName ? ` · ${form.bossName.toUpperCase()}` : ''}</div>
            {[['bossMentions', '✓', 'Keeps stressing…', 'Add what they stressed'], ['bossPushbacks', '✕', 'Pushed back on…', 'Add a push-back']].map(([key, mark, ph, add]) => (
              <div key={key} className="m-pri-list">
                {form[key].map((x) => (
                  <div key={x.id} className={`m-pri-row${key === 'bossPushbacks' ? ' is-push' : ''}`}>
                    <span className="m-pri-mark" aria-hidden="true">{mark}</span>
                    <input value={x.text} placeholder={ph} aria-label={ph} onChange={(e) => setLine(key, x.id, e.target.value)} />
                    <button type="button" className="m-pri-x" onClick={() => delLine(key, x.id)} aria-label="Remove">✕</button>
                  </div>
                ))}
                <button type="button" className="m-pri-add" onClick={() => addLine(key)}>{mark} {add}</button>
              </div>
            ))}
          </div>
        </div>

        <div className="m-ed-section">
          <div className="m-kicker">ACTION ITEMS</div>
          <div className="m-stack is-9">
            {form.actionItems.map((it, i) => {
              const ownerUid = uidFor(it.owner);
              const late = !it.done && it.due && it.due < m.today;
              return (
                <div key={it.id} className={`m-ed-item${it.done ? ' is-done' : ''}`}>
                  <div className="m-ed-item-top">
                    <button type="button" className={`m-action-box${it.done ? ' is-on' : ''}`} role="checkbox" aria-checked={it.done}
                      aria-label={it.done ? 'Mark not done' : 'Mark done'} onClick={() => setItem(it.id, { done: !it.done })}>{it.done ? '✓' : ''}</button>
                    <input className="m-ed-item-text" value={it.text} placeholder={`Action ${i + 1}`} aria-label={`Action ${i + 1}`}
                      onChange={(e) => setItem(it.id, { text: e.target.value })} />
                    <button type="button" className="m-pri-x is-ink" onClick={() => delItem(it.id)} aria-label="Remove action">✕</button>
                  </div>
                  <div className="m-ed-item-meta">
                    <button type="button" className="m-ed-chip" onClick={() => pickOwner(it.id)}>
                      {it.owner ? <Face uid={ownerUid} name={it.owner} size={22} /> : <span className="m-row-noav" />}
                      <span>{it.owner || 'Owner'}</span>
                    </button>
                    <button type="button" className={`m-ed-chip${late ? ' is-late' : ''}`} onClick={() => pickDue(it.id)}>
                      <Ico d={ICON.cal} size={14} stroke={2.4} />
                      <span>{it.due ? shortDate(it.due, m.today) : 'Due'}</span>
                    </button>
                    {it.taskId && <span className="m-ed-linked">Linked task</span>}
                  </div>
                </div>
              );
            })}
            <button type="button" className="m-dashed-btn" onClick={addItem}>+ Add action item</button>
          </div>
        </div>
      </div>

      <div className={`m-detail-foot${isNew ? ' is-one' : ''}`}>
        {!isNew && <button type="button" className="m-foot-btn is-danger" onClick={remove} disabled={saving}>Delete</button>}
        <button type="button" className={`m-foot-btn is-save${form.title.trim() ? '' : ' is-off'}`}
          onClick={save} disabled={saving || !form.title.trim()}>
          {saving ? 'Saving…' : isNew ? 'Save minutes' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
