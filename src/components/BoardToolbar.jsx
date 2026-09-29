// src/components/BoardToolbar.jsx — the Board hub's filters, in the tab row.
//
// They used to be a strip of their own under the tabs: the project picker,
// the All · Mine · Stuck pills and a row of member faces. On request they are
// now three dropdowns at the right-hand end of the tab strip, left of the Find
// item box and drawn to look like it — Project ▾ · Status ▾ · <person> ▾ —
// so the hub's filters sit in one line with the thing they filter.
//
// Status replaced the All · Mine · Stuck menu on request. Nothing it did was
// lost: Stuck is one of the Status options, and Mine is picking yourself in
// the person menu.
//
// It is still drawn once, by AppShell, for every page in the Board hub, rather
// than inside each page where copies would drift apart. And what the filters
// MEAN is still `services/boardScope.js`, not this file: the toolbar only
// writes the route, and each page reads it back through `scopeTasks`, so the
// Kanban and the Gantt cannot disagree about how much work there is.

import { useMemo } from 'react';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { useAuth, useProjects } from '../hooks/useTasks';
import { ProjectPicker } from './AppShell';
import { memberLabel } from '../services/invites';
import { STATUS_OPTIONS, statusOf, statusPatch } from '../services/boardScope';
import FilterMenu from './FilterMenu';
import Avatar from './Avatar';

const EVERYONE = '__everyone__';

export default function BoardToolbar({ route, navigate }) {
  const { userId } = useAuth();
  const { workspaces } = useWorkspaces();
  const { projects } = useProjects();
  const activeWsId = useActiveWorkspaceId();
  const workspace = workspaces.find((w) => w.id === activeWsId);

  // The roster, ordered so you are first — your own face is the one you look
  // for, and hunting for it in a hash order is a small daily tax. A menu has
  // room for everyone, so the old cap of eight faces is gone.
  const people = useMemo(() => {
    const profiles = workspace?.memberProfiles || {};
    const ids = workspace?.members || Object.keys(profiles);
    return ids
      .map((id) => ({
        id,
        label: memberLabel(id, profiles, { selfUid: userId }),
        icon: <Avatar id={id} name={memberLabel(id, profiles)} photo={profiles[id]?.photoURL || null} size={20} />,
      }))
      .sort((a, b) => (a.id === userId ? -1 : b.id === userId ? 1 : a.label.localeCompare(b.label)));
  }, [workspace, userId]);

  return (
    <div className="bt" role="group" aria-label="Board filters">
      <div className="bt-proj" data-tutorial="project-picker">
        <ProjectPicker
          projects={projects}
          value={route.projectFilter}
          onChange={(projectFilter) => navigate({ projectFilter })}
          triggerClassName="fbx"
        />
      </div>

      {/* An icon in place of the word "Status" (on request) — a ring part
          filled, the way a status is part-way along. `name` keeps "Status"
          for a screen reader and the tooltip. */}
      <FilterMenu
        name="Status"
        icon={<StatusIcon />}
        value={statusOf(route)}
        options={STATUS_OPTIONS}
        onChange={(id) => navigate(statusPatch(id))}
      />

      {/* No visible label on request: the value names itself — "Everyone",
          or a face and a name. `name` keeps it "Assigned to" for a screen
          reader. `?mine=1` (from ⌘K or a link) shows as you, and choosing
          anybody here clears it, so there is one visible truth. */}
      {people.length > 0 && (
        <FilterMenu
          name="Assigned to"
          icon={<PersonIcon />}
          value={route.who || (route.onlyMine && userId) || EVERYONE}
          options={[{ id: EVERYONE, label: 'Everyone' }, ...people]}
          onChange={(id) => navigate({ who: id === EVERYONE ? null : id, onlyMine: false })}
        />
      )}
    </div>
  );
}

function PersonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

function StatusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" opacity="0.35" />
      <path d="M12 3a9 9 0 0 1 9 9" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}
