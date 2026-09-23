// src/components/BoardToolbar.jsx — the strip above every Board tab.
//
// The Board Explorer draws it once, above the tab content, and it is the same
// strip whichever tab you are on: a primary "New item", the All · Mine · Stuck
// pills, and the workspace roster on the right. So it is drawn once too — by
// AppShell, for every page in the Board hub — rather than eight times inside
// eight pages that would drift apart.
//
// What the pills MEAN is `services/boardScope.js`, not this file. The toolbar
// only writes the route; each page reads it back through `scopeTasks`, so the
// Kanban and the Timeline cannot disagree about how much work there is.

import { useMemo } from 'react';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { useAuth, useProjects } from '../hooks/useTasks';
import { ProjectPicker } from './AppShell';
import { memberLabel } from '../services/invites';
import { BOARD_SCOPES, scopeOf, scopePatch } from '../services/boardScope';
import { activateProps } from '../hooks/useActivate';
import Avatar from './Avatar';

export default function BoardToolbar({ route, navigate }) {
  const { userId } = useAuth();
  const { workspaces } = useWorkspaces();
  const { projects } = useProjects();
  const activeWsId = useActiveWorkspaceId();
  const workspace = workspaces.find((w) => w.id === activeWsId);
  const scope = scopeOf(route);

  // The roster, ordered so you are first — your own face is the one you look
  // for, and hunting for it in a hash order is a small daily tax.
  const members = useMemo(() => {
    const profiles = workspace?.memberProfiles || {};
    const ids = workspace?.members || Object.keys(profiles);
    return ids
      .map((id) => ({
        id,
        name: memberLabel(id, profiles, { selfUid: userId }),
        photo: profiles[id]?.photoURL || null,
      }))
      .sort((a, b) => (a.id === userId ? -1 : b.id === userId ? 1 : 0))
      .slice(0, 8);
  }, [workspace, userId]);

  return (
    <div className="bt" role="group" aria-label="Board filters">
      {/* "+ New item" was removed from every Board tab on request and this
          took its place: what the whole hub is ABOUT is which project you are
          looking at, and that decision used to live only in the crumb strip.
          The same ProjectPicker component, so the two cannot disagree. A task
          is still created from ⌘K → New task and from the Kanban's own
          quick-add. */}
      <div className="bt-proj">
        <ProjectPicker
          projects={projects}
          value={route.projectFilter}
          onChange={(projectFilter) => navigate({ projectFilter })}
        />
      </div>

      {BOARD_SCOPES.map((s) => (
        <button
          key={s.id}
          className={`bt-pill${scope === s.id ? ' is-on' : ''}`}
          aria-pressed={scope === s.id}
          title={s.hint}
          onClick={() => navigate(scopePatch(s.id, scope))}
        >{s.label}</button>
      ))}

      {members.length > 0 && (
        <div className="bt-faces">
          {route.who && (
            <button className="bt-clear" onClick={() => navigate({ who: null })}>
              Everyone
            </button>
          )}
          {members.map((m) => (
            <span
              key={m.id}
              className={`bt-face${route.who === m.id ? ' is-on' : ''}`}
              {...activateProps(
                () => navigate({ who: route.who === m.id ? null : m.id }),
                { label: `Show only ${m.name}` },
              )}
            >
              <Avatar id={m.id} name={m.name} photo={m.photo} size={28} title={`Show only ${m.name}`} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
