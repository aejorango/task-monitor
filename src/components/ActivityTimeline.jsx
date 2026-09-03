// src/components/ActivityTimeline.jsx — the grouped activity rail shared by
// the project editor and the task editor.
//
// Activities logged on the same day share a single node on the timeline: one
// date header carrying that day's total hours, with each entry stacked
// underneath it. Without the grouping a busy day reads as a wall of repeated
// dates, which is what this replaces.

export function fmtDay(ymd) {
  if (!ymd) return '—';
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return String(ymd);
  return new Date(y, m - 1, d).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Tone drives the dot, the hours pill and the group colour. A day inherits
// the most severe tone of the entries inside it.
const TONE_RANK = { navy: 0, green: 1, amber: 2, red: 3 };
const TONE_ICON = { red: '!', green: '✓', amber: '◐', navy: '•' };

export function activityTone(a) {
  if (a.completionStatus === 'blocked' || a.bottleneckRemarks) return 'red';
  if (a.completionStatus === 'completed')   return 'green';
  if (a.completionStatus === 'in-progress') return 'amber';
  return 'navy';
}

// [{ date, items, hours, tone }], newest day first, entries newest-logged
// first inside each day.
export function groupActivitiesByDate(activities) {
  const byDate = new Map();
  activities.forEach((a) => {
    const key = a.date || '';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(a);
  });
  return [...byDate.entries()]
    .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
    .map(([date, items]) => ({
      date,
      items,
      hours: items.reduce((s, a) => s + (a.hoursSpent || 0), 0),
      tone: items.reduce(
        (worst, a) => (TONE_RANK[activityTone(a)] > TONE_RANK[worst] ? activityTone(a) : worst),
        'navy',
      ),
    }));
}

export default function ActivityTimeline({ activities, onSelect, renderEntryMeta }) {
  const groups = groupActivitiesByDate(activities);

  return groups.map((g, gi) => (
    <div key={g.date || `d${gi}`} className="pe-act">
      <div className="pe-act-rail">
        <span className={`pe-act-dot pe-tone-${g.tone}`}>{TONE_ICON[g.tone]}</span>
        {gi < groups.length - 1 && <span className="pe-act-line" />}
      </div>

      <div className="pe-act-group">
        <div className="pe-act-head">
          <span className="pe-act-date">{fmtDay(g.date)}</span>
          {g.hours > 0 && (
            <span className={`pe-act-hours pe-tone-${g.tone}`}>{g.hours.toFixed(1)}h</span>
          )}
          {g.items.length > 1 && (
            <span className="pe-act-who">{g.items.length} entries</span>
          )}
        </div>

        {g.items.map((a) => {
          const tone = activityTone(a);
          // On a single-entry day the header already carries the hours —
          // repeating them on the entry just doubles the pill.
          const showHours = g.items.length > 1 && (a.hoursSpent || 0) > 0;
          return (
            <button
              key={a.id}
              type="button"
              className="pe-act-entry"
              onClick={() => onSelect?.(a)}
              title="Edit this activity"
            >
              {(showHours || a.requestedBy) && (
                <div className="pe-act-entry-head">
                  {showHours && (
                    <span className={`pe-act-hours pe-tone-${tone}`}>{Number(a.hoursSpent).toFixed(1)}h</span>
                  )}
                  {a.requestedBy && <span className="pe-act-who">{a.requestedBy}</span>}
                </div>
              )}
              {renderEntryMeta?.(a)}
              {a.comment && <div className="pe-act-comment">{a.comment}</div>}
              {a.bottleneckRemarks && (
                <div className="pe-act-bottleneck">⚠ Bottleneck: {a.bottleneckRemarks}</div>
              )}
              {(a.attachments || []).length > 0 && (
                <div className="pe-act-files">
                  {a.attachments.map((f, fi) => (
                    <span key={fi} className="pe-act-file">📎 {f.name || f.url}</span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  ));
}
