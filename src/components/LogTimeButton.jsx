// src/components/LogTimeButton.jsx — the Dashboard's "Log time" hero action
// (T-0122 / POL-012).
//
// It used to be four lines inline in DashboardView that opened
// TaskActivitiesModal — a READ-ONLY table of entries already logged. To record
// anything the user then had to find "+ Log activity" inside that modal, on a
// task the button had picked for them without saying which.
//
// The whole flow lives here now: which task (services/logTime.js), what the
// button says, the form itself, and the way to change the task. The Dashboard
// renders one element; the flow can be mounted and clicked on its own.

import { useMemo, useState } from 'react';
import ActivityLogger from './ActivityLogger';
import LogActivityPicker from './LogActivityPicker';
import { logTimeTarget, logTimeLabel } from '../services/logTime';

export default function LogTimeButton({
  tasks = [],
  actionQueue = [],
  inProgress = [],
  projectById = {},
  projectFilter = 'all',
  userId,
  className = 'btn btn-sm',
}) {
  const [loggingTask, setLoggingTask] = useState(null);
  const [pickerOpen, setPickerOpen]   = useState(false);

  const target = useMemo(
    () => logTimeTarget({ actionQueue, inProgress, tasks }),
    [actionQueue, inProgress, tasks],
  );
  const btn = useMemo(() => logTimeLabel(target), [target]);

  // One click when there is a defensible first choice; the picker when there
  // is not. Either way what opens next is a form, never a list.
  const start = () => {
    if (target.task) setLoggingTask(target.task);
    else setPickerOpen(true);
  };

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={start}
        disabled={btn.disabled}
        title={btn.title}
      >{btn.label}</button>

      {/* The picker is the ENTRY point for the case where nothing could be
          pre-chosen. Changing your mind afterwards is handled inside the form
          by an inline select, so a half-filled entry is never thrown away. */}
      {pickerOpen && (
        <LogActivityPicker
          tasks={tasks}
          projectById={projectById}
          projectFilter={projectFilter}
          subtitle="Pick the task you worked on, then record the hours."
          onPick={(t) => { setPickerOpen(false); setLoggingTask(t); }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {loggingTask && !pickerOpen && (
        <ActivityLogger
          task={loggingTask}
          userId={userId}
          taskOptions={tasks}
          onChangeTask={setLoggingTask}
          onClose={() => setLoggingTask(null)}
        />
      )}
    </>
  );
}
