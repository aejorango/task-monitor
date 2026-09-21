// src/components/NotFoundView.jsx — the page for a hash that names no page.
//
// The content area used to be simply blank while the topbar claimed to be
// another page entirely (BUG-025). A blank screen looks like a bug; this says
// what happened and gives one way out.

export default function NotFoundView({ view, navigate }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">🧭</div>
      <p>That page does not exist.</p>
      <p className="small">
        {view
          ? <>There is no page called <strong>{view}</strong>. The link may be out of date, or a saved view may point at a page that has since been removed.</>
          : <>The link may be out of date, or a saved view may point at a page that has since been removed.</>}
      </p>
      <button
        className="btn btn-primary"
        style={{ marginTop: 12 }}
        onClick={() => navigate?.({ view: 'dashboard', projectFilter: 'all' })}
      >Go to the Dashboard</button>
    </div>
  );
}
