// src/components/PageHeader.jsx — the chrome every page wears.
//
// Three bands, straight from the Explorer mockups:
//   1. a navy breadcrumb strip — Workspaces › <workspace> › <page>
//   2. a white title block — icon tile, page name, one subtitle line, commands
//   3. a tab strip — the other pages in this page's hub
//
// The shell draws all three, because all three are derivable from the route:
// nothing here needs a page's own data. What a page DOES know — the count line
// under its title, and the buttons that act on it — it fills in with
// <PageSubtitle> and <PageActions>.
//
// Those two are PORTALS rather than a context value, deliberately. A context
// carrying `{ subtitle, actions }` would hand the shell a fresh object on every
// render of the page, and this codebase has been bitten twice by exactly that
// (see the useModalDialog note in CLAUDE.md): either the effect churns, or the
// slot goes stale. A portal has no identity to churn — the page renders its own
// subtitle and its own buttons, in its own render pass, and React puts the
// result in the header's hole.

import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { tabsForView, hubForView } from '../services/views';

const SUBTITLE_SLOT = 'chrome-subtitle';
const ACTIONS_SLOT  = 'chrome-actions';

/**
 * Put `children` in the header's hole — or, if there is no hole, right here.
 *
 * The fallback is the whole point. A view can be mounted without the shell
 * around it: a test harness does it, `dev/*.html` does it, and one day a view
 * will be reused somewhere unplanned. Returning null in that case makes a
 * page's Export and Save buttons *silently vanish* — no error, nothing in the
 * console, just a page that quietly lost its commands. Rendering them in place
 * is worse-looking and right.
 *
 * `useLayoutEffect`, not `useEffect`, so the move happens before the browser
 * paints: the shell commits its header in the same pass as the page below it,
 * so by the time layout effects run the hole is there and nothing flashes.
 */
function HeaderSlot({ id, className, children }) {
  const [node, setNode] = useState(() => (
    typeof document === 'undefined' ? null : document.getElementById(id)
  ));
  useLayoutEffect(() => { setNode(document.getElementById(id)); }, [id]);
  if (node) return createPortal(children, node);
  return <div className={className}>{children}</div>;
}

/** One short line under the page title: "4 active · 1 archived". */
export function PageSubtitle({ children }) {
  return <HeaderSlot id={SUBTITLE_SLOT} className="chrome-sub is-loose">{children}</HeaderSlot>;
}

/**
 * The page's own commands, on the right of the title. Use `className="cmd"`
 * buttons so they read as a command row rather than a wall of filled buttons —
 * the mockups put at most one accent button per page.
 */
export function PageActions({ children }) {
  return <HeaderSlot id={ACTIONS_SLOT} className="chrome-cmds is-loose">{children}</HeaderSlot>;
}

export default function PageHeader({
  route, navigate, pageLabel, pageIcon, workspaceName, status,
  search = null, tools = null, onToggleMenu = null,
}) {
  const tabs = tabsForView(route.view);
  const hub = hubForView(route.view);

  // The title names the HUB and the tab names the page — "Reports" with Summary
  // underlined, exactly as the mockups read. Titling it "Review" while the tab
  // beneath says "Summary" gives the same page two names on one screen.
  // A page in no hub, or in a hub with nothing to switch between, keeps its own
  // name: there is no second name to prefer.
  const inHub = tabs.length > 0;
  const title = inHub ? hub.label : pageLabel;
  const icon  = inHub ? hub.icon  : pageIcon;
  // …and the crumb's last step is what the strip calls this page, so the path
  // and the underlined tab can never say different things.
  const here = tabs.find((t) => t.active)?.label || pageLabel;

  return (
    <div className="chrome">
      <div className="crumbs">
        {/* The menu button — CSS shows it on a phone only. It lived in the
            bar above; there is no bar above. */}
        {onToggleMenu && (
          <button className="nav-toggle" onClick={onToggleMenu} aria-label="Toggle menu">
            <span className="nav-toggle-icon"><span /><span /><span /></span>
          </button>
        )}
        <button className="crumb crumb-link" onClick={() => navigate({ view: 'settings' })}>
          Workspaces
        </button>
        {workspaceName && (
          <>
            <span className="crumb-sep" aria-hidden="true">›</span>
            <span className="crumb">{workspaceName}</span>
          </>
        )}
        {/* The hub — unless the page in it carries the same name, which the
            hub's own landing page usually does. "Projects › Projects" is a
            path that says nothing twice. */}
        {inHub && hub.label !== here && (
          <>
            <span className="crumb-sep" aria-hidden="true">›</span>
            <span className="crumb">{hub.label}</span>
          </>
        )}
        <span className="crumb-sep" aria-hidden="true">›</span>
        <span className="crumb crumb-here">{here}</span>
        {/* The project filter was centred here until it moved to the toolbar
            below the tabs, where the Board hub had always drawn it — see the
            note beside `PICKER_HUBS` in AppShell. The crumb strip carries the
            path and the status, and nothing you operate. */}
        {status && <div className="crumbs-status">{status}</div>}
      </div>

      <div className="chrome-bar">
        <div className="chrome-row">
          <div className="chrome-icon" aria-hidden="true">
            <Icon name={icon || 'dashboard'} size={22} />
          </div>
          <div className="chrome-text">
            <h1 className="chrome-title">{title}</h1>
            <div className="chrome-sub" id={SUBTITLE_SLOT} />
          </div>
          {/* Two groups on the right: the tools that follow you from page to
              page, then the page's own commands. */}
          {tools && <div className="chrome-tools">{tools}</div>}
          <div className="chrome-cmds" id={ACTIONS_SLOT} />
        </div>

        {tabs.length > 0 && (
          <div className="chrome-tabrow">
          <nav className="chrome-tabs" aria-label={`${hub.label} pages`}>
            {tabs.map((t) => (
              <button
                key={t.view}
                className={`chrome-tab${t.active ? ' active' : ''}`}
                aria-current={t.active ? 'page' : undefined}
                onClick={() => navigate({
                  view: t.view,
                  savedViewId: null,
                  tagFilter: null,
                  statusFilter: null,
                })}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {/* The mockups put a find box at the right-hand end of the tab
              strip. A hub supplies one when it has something to search; the
              rest of the app leaves the slot empty rather than drawing a box
              that does nothing. */}
          {search}
          </div>
        )}
      </div>
    </div>
  );
}
