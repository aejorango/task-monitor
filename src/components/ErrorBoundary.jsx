// src/components/ErrorBoundary.jsx — catches a render crash so the user sees a
// card they can act on instead of a white page.
//
// Two scopes:
//   scope="app"  — wraps everything. Only reachable if the shell itself breaks.
//   scope="view" — wraps one page inside the shell, so the sidebar survives and
//                  the user can simply go somewhere else.
//
// `resetKey` (the current view) clears the error on navigation: without it a
// crash on one page would follow the user to every other page.

import { Component } from 'react';
import { describeCrash } from '../services/errorMessages';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, showDetail: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // The user gets plain language; the console gets everything, so a bug
    // report has something to go on.
    console.error(
      `[error-boundary:${this.props.scope || 'view'}]`,
      error,
      info?.componentStack,
    );
  }

  componentDidUpdate(prevProps) {
    // Navigating away is itself a recovery — drop the error so the next page
    // renders normally.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, showDetail: false });
    }
  }

  retry = () => this.setState({ error: null, showDetail: false });

  reload = () => window.location.reload();

  render() {
    const { error, showDetail } = this.state;
    if (!error) return this.props.children;

    const { scope = 'view', viewName = '' } = this.props;
    const crash = describeCrash(error, { scope, viewName });
    const isReload = crash.primaryAction === 'reload';

    return (
      <div className={`crash-card crash-${scope}`} role="alert">
        <div className="crash-icon" aria-hidden="true">⚠</div>
        <h2 className="crash-title">{crash.title}</h2>
        <p className="crash-body">{crash.body}</p>

        <div className="crash-actions">
          {isReload ? (
            <button type="button" className="btn btn-primary" onClick={this.reload}>
              Reload the app
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={this.retry}>
                Try again
              </button>
              <button type="button" className="btn" onClick={this.reload}>
                Reload the app
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-sm crash-detail-toggle"
          aria-expanded={showDetail}
          onClick={() => this.setState((s) => ({ showDetail: !s.showDetail }))}
        >
          {showDetail ? 'Hide technical details' : 'Technical details'}
        </button>
        {showDetail && (
          <p className="crash-detail mono small">{crash.detail}</p>
        )}
      </div>
    );
  }
}
