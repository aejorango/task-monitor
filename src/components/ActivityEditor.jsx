// src/components/ActivityEditor.jsx — edit an existing activity entry.

import { useState } from 'react';
import { editActivity } from '../services/firebase';
import FileUpload from './FileUpload';

const COMPLETION_OPTIONS = [
  { value: 'not-started', label: 'Not started' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'blocked',     label: 'Blocked' },
  { value: 'completed',   label: 'Completed' },
];

export default function ActivityEditor({ activity, onClose }) {
  const [date, setDate]           = useState(activity.date || '');
  const [comment, setComment]     = useState(activity.comment || '');
  const [hours, setHours]         = useState(activity.hoursSpent ?? '');
  const [completion, setCompletion] = useState(activity.completionStatus || 'in-progress');
  const [bottleneck, setBottleneck] = useState(activity.bottleneckRemarks || '');
  const [requestedBy, setRequestedBy] = useState(activity.requestedBy || '');
  const [attachments, setAttachments] = useState(activity.attachments || []);

  const [attachName, setAttachName] = useState('');
  const [attachUrl, setAttachUrl]   = useState('');
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
    try {
      await editActivity(activity, {
        date,
        comment: comment.trim(),
        hoursSpent: Number(hours) || 0,
        completionStatus: completion,
        bottleneckRemarks: bottleneck.trim(),
        requestedBy: requestedBy.trim(),
        attachments,
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
        <h3 className="modal-title">Edit activity</h3>
        <p className="modal-sub">{activity.taskTitle}</p>

        <div className="field-row">
          <div className="field">
            <label className="label">Date</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Hours spent</label>
            <input type="number" step="0.25" min="0" className="input" value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label className="label">Activity details</label>
          <textarea className="textarea" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
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
            <input className="input" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label className="label">Remarks / bottlenecks</label>
          <textarea className="textarea" rows={2} value={bottleneck} onChange={(e) => setBottleneck(e.target.value)} />
        </div>

        <div className="field">
          <label className="label">Files & links</label>
          <FileUpload taskId={activity.taskId} attachments={attachments} onChange={setAttachments} />
          <div className="attach-row" style={{ marginTop: 8 }}>
            <input className="input input-sm" value={attachName} onChange={(e) => setAttachName(e.target.value)} placeholder="Label" />
            <input type="url" className="input input-sm" value={attachUrl} onChange={(e) => setAttachUrl(e.target.value)} placeholder="…or paste a link" />
            <button type="button" className="btn btn-sm" onClick={addAttachment}>+ Link</button>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
