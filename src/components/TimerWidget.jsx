// src/components/TimerWidget.jsx — topbar widget showing live running timer.

import { useState, useEffect } from 'react';
import { useTimer, formatElapsed } from '../hooks/useTimer';
import { useAuth, useTasks } from '../hooks/useTasks';
import { addActivity, todayLocal } from '../services/firebase';

export default function TimerWidget() {
  const { running, state, elapsedMs, elapsedHours, stop } = useTimer();
  const { tasks } = useTasks();
  const { userId } = useAuth();
  const [stopping, setStopping] = useState(false);
  const [comment, setComment] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!running || !state) return null;

  const handleStop = () => {
    setConfirmOpen(true);
    setComment('');
  };

  const finalizeAndLog = async (alsoLog) => {
    setStopping(true);
    const stopped = stop();
    setConfirmOpen(false);
    if (!alsoLog || !stopped) { setStopping(false); return; }

    const task = tasks.find((t) => t.id === stopped.taskId);
    if (!task) {
      console.warn('Stopped timer but task is no longer available; skipping log.');
      setStopping(false);
      return;
    }

    try {
      await addActivity(userId, task, {
        date: todayLocal(),
        comment: comment.trim() || `Tracked time on ${task.title}`,
        hoursSpent: Number(elapsedHours.toFixed(2)),
        attachments: [],
        completionStatus: 'in-progress',
        bottleneckRemarks: '',
        requestedBy: task.requestedBy || '',
      });
    } catch (err) {
      console.error('Failed to log tracked time:', err);
      alert('Could not log tracked time. Check console.');
    } finally {
      setStopping(false);
    }
  };

  return (
    <>
      <div className="timer-widget" title={`Tracking: ${state.taskTitle}`}>
        <span className="timer-dot" />
        <span className="timer-title">{state.taskTitle}</span>
        <span className="timer-elapsed mono">{formatElapsed(elapsedMs)}</span>
        <button className="btn btn-sm" onClick={handleStop} disabled={stopping}>
          ⏹ Stop
        </button>
      </div>

      {confirmOpen && (
        <div className="modal-backdrop" onClick={() => setConfirmOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3 className="modal-title">Stop timer</h3>
            <p className="modal-sub">
              <strong>{state.taskTitle}</strong> · {formatElapsed(elapsedMs)} ({elapsedHours.toFixed(2)}h)
            </p>
            <div className="field">
              <label className="label">Note (optional)</label>
              <input
                className="input"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What did you do?"
              />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => finalizeAndLog(false)} disabled={stopping}>
                Discard
              </button>
              <button className="btn btn-primary" onClick={() => finalizeAndLog(true)} disabled={stopping}>
                {stopping ? 'Logging…' : 'Log activity'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
