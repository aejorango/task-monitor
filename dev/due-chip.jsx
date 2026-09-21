// dev/due-chip.jsx — dev-only harness for the board card's due date.
//
// The real CardBody, a column of tasks spread across the interesting dates,
// and no Firebase. Every state POL-013 named is on one screen.
//
// Open: http://localhost:5173/dev/due-chip.html
// Not part of the production build (vite builds index.html only).
//
// A harness is an entry point, not a module anything imports.
/* eslint-disable react-refresh/only-export-components */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CardBody } from '../src/components/Board';
import { todayLocal } from '../src/services/recurrence';
import { addDaysISO } from '../src/services/dueAlerts';
import '../src/App.css';

const TODAY = todayLocal();
const at = (n) => addDaysISO(TODAY, n);
const project = { id: 'p1', name: 'BRIDGED', color: '#0051BA' };

const CASES = [
  { title: 'Overdue by nine days',  plan: { endDate: at(-9) } },
  { title: 'Overdue by one day',    plan: { endDate: at(-1) } },
  { title: 'Due today',             plan: { endDate: TODAY } },
  { title: 'Due tomorrow',          plan: { endDate: at(1) } },
  { title: 'Due in three days',     plan: { endDate: at(3) } },
  { title: 'Due in six days',       plan: { endDate: at(6) } },
  { title: 'Due in a week',         plan: { endDate: at(7) } },
  { title: 'Due next month',        plan: { endDate: at(40) } },
  { title: 'Due next year',         plan: { endDate: at(400) } },
  { title: 'No due date at all',    plan: {} },
  { title: 'Done, and it landed late',  status: 'done', plan: { endDate: at(-9) }, actual: { endDate: at(-2) } },
  { title: 'Done, and it landed early', status: 'done', plan: { endDate: at(4) },  actual: { endDate: at(-1) } },
];

function Harness() {
  return (
    <div style={{ padding: 32, maxWidth: 420, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0, fontSize: 20 }}>Board card — every due state</h1>
      <p className="muted small">Today is {TODAY}. Hover a chip for the full date.</p>
      <div className="board-col-body">
        {CASES.map((c, i) => (
          <CardBody
            key={i}
            task={{ id: `t${i}`, status: 'todo', priority: 'medium', ...c }}
            project={project}
            expanded={false}
            onToggleExpand={() => {}}
            onLog={() => {}}
            onEdit={() => {}}
            onEditActivity={() => {}}
            dragging={false}
          />
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
