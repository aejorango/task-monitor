// src/components/TaskForm.jsx
// Compact-by-default form with an expandable "More details" section
// for description, priority, and plan dates.

import { useState } from 'react';
import { addTask } from '../services/firebase';
import { useAuth } from '../hooks/useTasks';

export default function TaskForm() {
  const { userId, ready } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('BRIDGED');
  const [priority, setPriority] = useState('medium');
  const [planStart, setPlanStart] = useState('');
  const [planEnd, setPlanEnd] = useState('');

  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !userId) return;

    setSubmitting(true);
    try {
      await addTask(userId, {
        title: title.trim(),
        description: description.trim(),
        category,
        priority,
        plan: {
          startDate: planStart || null,
          endDate:   planEnd   || null,
        },
      });
      // Reset on success
      setTitle('');
      setDescription('');
      setPlanStart('');
      setPlanEnd('');
    } catch (err) {
      console.error('Failed to add task:', err);
      alert('Could not save task. Check console.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="task-form">
      <div className="task-form-row primary">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          required
          disabled={!ready}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="BRIDGED">BRIDGED</option>
          <option value="AIM">AIM</option>
          <option value="Personal">Personal</option>
        </select>
      </div>

      {expanded && (
        <>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description / context (optional)"
          />

          <div className="task-form-row">
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Low priority</option>
              <option value="medium">Medium priority</option>
              <option value="high">High priority</option>
            </select>
            <label className="date-input">
              <span className="muted small">Plan start</span>
              <input
                type="date"
                value={planStart}
                onChange={(e) => setPlanStart(e.target.value)}
              />
            </label>
            <label className="date-input">
              <span className="muted small">Plan end</span>
              <input
                type="date"
                value={planEnd}
                onChange={(e) => setPlanEnd(e.target.value)}
              />
            </label>
          </div>
        </>
      )}

      <div className="form-actions">
        <button
          type="button"
          className="link-btn"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '− Less' : '+ More details'}
        </button>
        <button type="submit" disabled={submitting || !ready}>
          {submitting ? 'Saving…' : 'Add Task'}
        </button>
      </div>
    </form>
  );
}
