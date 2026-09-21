// src/components/TagFilterBar.jsx — the "Tags: All #client #internal" strip.
//
// One component for the Board, the Gantt and the Activity Log, so a saved view
// filtered to #client looks and behaves the same wherever it points. Before
// BUG-018 only the Board had one, and the other two silently ignored the
// filter while the sidebar tooltip still advertised it.
//
// `state` is whatever `tagFilterState()` in services/tagFilter.js returned.

export default function TagFilterBar({ state, onChange, label = 'Tags:' }) {
  const { tags, active, missing } = state;
  // Nothing to offer and nothing filtering: the strip would be an empty row.
  if (tags.length === 0 && !active) return null;

  // A saved view can name a tag nothing here carries — renamed since, or shut
  // out by the project filter. Offer it anyway, so the reason the page is empty
  // is on screen and one click away from being undone.
  const offered = missing ? [active, ...tags] : tags;

  return (
    <div className="tag-filter-bar">
      <span className="small muted" style={{ marginRight: 4 }}>{label}</span>
      <button
        type="button"
        className={`chip ${!active ? 'active' : ''}`}
        onClick={() => onChange(null)}
        aria-pressed={!active}
      >All</button>
      {offered.map((tag) => (
        <button
          key={tag}
          type="button"
          className={`chip ${active === tag ? 'active' : ''}`}
          onClick={() => onChange(active === tag ? null : tag)}
          aria-pressed={active === tag}
          title={missing && tag === active ? 'Nothing on this page carries this tag' : undefined}
        >#{tag}</button>
      ))}
      {missing && (
        <span className="small muted" style={{ marginLeft: 4 }}>
          Nothing here carries #{active}.
        </span>
      )}
    </div>
  );
}
