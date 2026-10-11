// src/mobile/MobileProjectEditor.jsx — a new project, from a phone.
//
// The desktop project editor carries fourteen sections (WIP limits, custom
// fields, share links, the knowledge base…). Starting a project needs five
// of them: its name, its colour, its segment, who leads it and its phases —
// so that is this screen, built from the minutes editor's pieces. Everything
// else is set later on the desktop, where it already lives. It writes through
// the desktop's addProject, so the project is the same document either way.

import { useState } from 'react';
import { addProject, addSegmentToWorkspace, uid } from '../services/firebase';
import { useDialog } from '../components/Dialog';
import { segmentNames, NO_SEGMENT, PROJECT_SWATCHES } from '../services/mobileModel';
import { useMobile, Ico, ICON, Face } from './mobileUi';

export default function MobileProjectEditor() {
  const m = useMobile();
  const ask = useDialog();
  const p = m.push;
  const segments = segmentNames(m.workspace, m.projects);
  const [initial] = useState(() => ({
    name: '', description: '', color: PROJECT_SWATCHES[m.projects.length % PROJECT_SWATCHES.length],
    segment: p.segment || NO_SEGMENT, lead: m.userId, phases: [],
  }));
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...(typeof patch === 'function' ? patch(f) : patch) }));
  const changed = JSON.stringify(form) !== JSON.stringify(initial);

  const back = () => m.setPush(p.from || { kind: 'projects' });
  const close = async () => {
    if (changed && !await ask.confirm({ title: 'Discard this project?', confirmLabel: 'Discard', danger: true })) return;
    back();
  };

  const pick = (title, options, onPick) => { m.setPicker({ title, options, onPick }); m.setSheet('pick'); };
  const pickSegment = () => pick('Segment', [
    ...segments.map((sg) => ({ value: sg, label: sg, on: sg === form.segment })),
    { value: '__new__', label: '+ New segment…' },
  ], async (v) => {
    if (v !== '__new__') { set({ segment: v }); return; }
    const name = (await ask.prompt({ title: 'New segment', label: 'Name', placeholder: 'e.g. Sales, Finance', confirmLabel: 'Add' }))?.trim();
    if (!name) return;
    // The desktop adds a new segment to the workspace too, so every project
    // can pick it. If this account may not change the workspace, the project
    // still carries the name and is grouped under it.
    try { await addSegmentToWorkspace(m.workspaceId, name); }
    catch (err) { console.warn('[segment]', err); }
    set({ segment: name });
  });
  const pickLead = () => pick('Lead', [
    ...m.members.map((u) => ({ value: u, label: m.nameOf(u), uid: u, on: u === form.lead })),
    { value: '', label: 'Nobody yet', on: !form.lead },
  ], (v) => set({ lead: v }));

  const addPhase = () => set((f) => ({ phases: [...f.phases, { id: uid(), name: '' }] }));
  const setPhase = (id, name) => set((f) => ({ phases: f.phases.map((x) => (x.id === id ? { ...x, name } : x)) }));
  const delPhase = (id) => set((f) => ({ phases: f.phases.filter((x) => x.id !== id) }));

  const save = async () => {
    const name = form.name.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const ref = await addProject(m.userId, {
        workspaceId: m.workspaceId,
        name,
        description: form.description.trim(),
        color: form.color,
        segment: form.segment || NO_SEGMENT,
        phases: form.phases.filter((x) => x.name.trim()).map((x) => ({ id: x.id, name: x.name.trim() })),
        assignedTo: form.lead ? [form.lead] : [],
      });
      m.flash(`${name} created`);
      // Straight into the project it made, with Back leading to the list.
      m.setPush({ kind: 'project', projectId: ref.id, from: p.from || { kind: 'projects' } });
    } catch (err) {
      setSaving(false);
      m.fail(err, 'Could not create that project.');
    }
  };

  return (
    <div className="m-detail" role="dialog" aria-label="New project">
      <div className="m-detail-top">
        <button type="button" className="m-back" onClick={close} aria-label="Back"><Ico d={ICON.back} stroke={2.6} /></button>
        <span className="m-detail-code">NEW PROJECT</span>
      </div>

      <div className="m-detail-body">
        <div className="m-pe-head">
          <span className="m-pe-tile" style={{ background: form.color }} aria-hidden="true">
            {(form.name.trim()[0] || '?').toUpperCase()}
          </span>
          <textarea className="m-title-input" rows={1} value={form.name} placeholder="Project name"
            aria-label="Project name" onChange={(e) => set({ name: e.target.value.replace(/\n/g, ' ') })} />
        </div>

        <div className="m-swatches" role="radiogroup" aria-label="Colour">
          {PROJECT_SWATCHES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={form.color === c} aria-label={`Colour ${c}`}
              className={`m-swatch${form.color === c ? ' is-on' : ''}`} style={{ background: c }} onClick={() => set({ color: c })} />
          ))}
        </div>

        <div className="m-tiles">
          <button type="button" className="m-tile" onClick={pickSegment}>
            <span className="m-tile-k">SEGMENT</span>
            <span className="m-tile-v"><span className="m-tile-ellipsis">{form.segment}</span></span>
          </button>
          <button type="button" className="m-tile" onClick={pickLead}>
            <span className="m-tile-k">LEAD</span>
            <span className={`m-tile-v${form.lead ? '' : ' is-empty'}`}>
              {form.lead && <Face uid={form.lead} size={26} />}
              <span className="m-tile-ellipsis">{form.lead ? (form.lead === m.userId ? 'Me' : m.firstOf(form.lead)) : 'Nobody yet'}</span>
            </span>
          </button>
        </div>

        <div className="m-ed-section">
          <div className="m-kicker">ABOUT</div>
          <textarea className="m-textarea" value={form.description} placeholder="What is this project for?"
            aria-label="Description" onChange={(e) => set({ description: e.target.value })} />
        </div>

        <div className="m-ed-section">
          <div className="m-kicker">PHASES</div>
          <div className="m-stack is-8">
            {form.phases.map((ph, i) => (
              <div key={ph.id} className="m-pe-phase">
                <span className="m-pe-phase-n">{i + 1}</span>
                <input value={ph.name} placeholder={['Planning', 'Build', 'Launch'][i] || `Phase ${i + 1}`}
                  aria-label={`Phase ${i + 1}`} onChange={(e) => setPhase(ph.id, e.target.value)} />
                <button type="button" className="m-pri-x is-ink" onClick={() => delPhase(ph.id)} aria-label="Remove phase">✕</button>
              </div>
            ))}
            <button type="button" className="m-dashed-btn" onClick={addPhase}>+ Add phase</button>
          </div>
          <div className="m-caption is-pad">Phases break the work into stages. Limits, custom fields and sharing are set on the desktop.</div>
        </div>
      </div>

      <div className="m-detail-foot is-one">
        <button type="button" className={`m-foot-btn is-save${form.name.trim() ? '' : ' is-off'}`}
          onClick={save} disabled={saving || !form.name.trim()}>
          {saving ? 'Creating…' : 'Create project'}
        </button>
      </div>
    </div>
  );
}
