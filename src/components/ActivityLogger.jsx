// src/components/ActivityLogger.jsx — log an activity with PM-suite fields.

import { useState } from 'react';
import { addActivity, todayLocal } from '../services/firebase';
import FileUpload from './FileUpload';

const COMPLETION_OPTIONS = [
  { value: 'not-started', label: 'Not started' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'blocked',     label: 'Blocked' },
  { value: 'completed',   label: 'Completed' },
];

export default function ActivityLogger({ task, userId, onClose }) {
  const [date, setDate]           = useState(todayLocal());
  const [comment, setComment]     = useState('');
  const [hours, setHours]         = useState('');
  const [completion, setCompletion] = useState('in-progress');
  const [bottleneck, setBottleneck] = useState('');
  const [requestedBy, setRequestedBy] = useState(task.requestedBy || '');
  const [attachName, setAttachName] = useState('');
  const [attachUrl, setAttachUrl]   = useState('');
  const [attachments, setAttachments] = useState([]);
  const [saving, setSaving]         = useState(false);

  const addAttachment = () => {
    if (!attachUrl.trim()) return;
    setAttachments([
      ...attachments,
      {
        name: attachName.trim() || attachUrl,
        url:  attachUrl.trim(),
        type: attachUrl.includes('drive.google') ? 'drive' : 'external',
      },
    ]);
    setAttachName('');
    setAttachUrl('');
  };

  const handleSave = async () => {
    if (!comment.trim() && !hours && attachments.length === 0 && !bottleneck.trim()) {
      alert('Add at least one of: comment, hours, attachment, or bottleneck note.');
      return;
    }
    setSaving(true);
    try {
      await addActivity(userId, task, {
        date,
        comment: comment.trim(),
        hoursSpent: Number(hours) || 0,
        attachments,
        completionStatus: completion,
        bottleneckRemarks: bottleneck.trim(),
        requestedBy: requestedBy.trim(),
      });
      onClose();
    } catch (err) {
      console.error(err);
      alert('Could not save activity. Check console.');
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Log activity</h3>
        <p className="modal-sub">{task.title}</p>

        <div className="field-row">
          <div className="field">
            <label className="label">Date</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Hours spent</label>
            <input type="number" step="0.25" min="0" className="input" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 2.5" />
          </div>
        </div>

        <div className="field">
          <label className="label">Activity details</label>
          <textarea
            className="textarea"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What did you do? e.g. Drafted sections 12-15, sent to Mark for review…"
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label className="label">Completion status</label>
            <select className="select" value={completion} onChange={(e) => setCompletion(e.target.value)}>
              {COMPLETION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Requested by</label>
            <input className="input" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} placeholder="e.g. Mark" />
          </div>
        </div>

        <div className="field">
          <label className="label">Remarks / bottlenecks (optional)</label>
          <textarea
            className="textarea"
            rows={2}
            value={bottleneck}
            onChange={(e) => setBottleneck(e.target.value)}
            placeholder="Any blockers, dependencies, or notes for follow-up"
          />
        </div>

        <div className="field">
          <label className="label">Files & links</label>
          <FileUpload taskId={task.id} attachments={attachments} onChange={setAttachments} />
          <div className="attach-row" style={{ marginTop: 8 }}>
            <input className="input input-sm" value={attachName} onChange={(e) => setAttachName(e.target.value)} placeholder="Label" />
            <input type="url" className="input input-sm" value={attachUrl} onChange={(e) => setAttachUrl(e.target.value)} placeholder="…or paste a link (Drive, Dropbox, etc.)" />
            <button type="button" className="btn btn-sm" onClick={addAttachment}>+ Link</button>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save log'}
          </button>
        </div>
      </div>
    </div>
  );
}
