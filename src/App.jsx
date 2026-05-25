// src/App.jsx — root shell + view router with code-split non-Board views.

import { lazy, Suspense, useState } from 'react';
import { useAuth, useProjects } from './hooks/useTasks';
import { useOverdueScan } from './hooks/useNotifications';
import AppShell, { useRoute } from './components/AppShell';
import Board from './components/Board';   // eager: most common entry point
import TimerWidget from './components/TimerWidget';
import LandingView, { isLandingDismissed } from './components/LandingView';
import { auth } from './services/firebase';
import './App.css';

const TableView         = lazy(() => import('./components/TableView'));
const GanttView         = lazy(() => import('./components/GanttView'));
const CalendarView      = lazy(() => import('./components/CalendarView'));
const DashboardView     = lazy(() => import('./components/DashboardView'));
const ReviewView        = lazy(() => import('./components/ReviewView'));
const AnalyticsView     = lazy(() => import('./components/AnalyticsView'));
const InviteClaimView   = lazy(() => import('./components/InviteClaimView'));
const ProjectsView      = lazy(() => import('./components/ProjectsView'));
const SettingsView      = lazy(() => import('./components/SettingsView'));
const WorkPerformedView = lazy(() => import('./components/WorkPerformedView'));

function ViewSpinner() {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-text-3)' }}>
      <div className="spinner" /> &nbsp; Loading view…
    </div>
  );
}

export default function App() {
  const { userId, ready } = useAuth();
  const { projects } = useProjects();
  const { route, navigate } = useRoute();
  useOverdueScan();

  // Landing-page gate. Show the welcome screen on first visit (when the user
  // is anonymous and hasn't dismissed it). Invite-claim links bypass this so
  // shared invites still land directly on the claim flow. A signed-in Google
  // user is never anonymous, so the gate naturally falls through for them.
  const [landingDismissed, setLandingDismissed] = useState(isLandingDismissed);
  const isAnonymous = !!auth.currentUser?.isAnonymous;
  const showLanding =
    ready &&
    userId &&
    isAnonymous &&
    !landingDismissed &&
    route.view !== 'invite';

  if (showLanding) {
    return <LandingView onDone={() => setLandingDismissed(true)} />;
  }

  return (
    <AppShell
      userId={userId}
      ready={ready}
      projects={projects}
      route={route}
      navigate={navigate}
      timerWidget={<TimerWidget />}
    >
      <Suspense fallback={<ViewSpinner />}>
        {route.view === 'invite'    && <InviteClaimView inviteId={route.projectFilter} navigate={navigate} />}
        {route.view === 'dashboard' && <DashboardView projectFilter={route.projectFilter} navigate={navigate} />}
        {route.view === 'board'     && <Board    projectFilter={route.projectFilter} initialTagFilter={route.tagFilter} initialStatusFilter={route.statusFilter} onlyMine={route.onlyMine} />}
        {route.view === 'table'     && <TableView projectFilter={route.projectFilter} initialTagFilter={route.tagFilter} />}
        {route.view === 'gantt'     && <GanttView projectFilter={route.projectFilter} initialTagFilter={route.tagFilter} />}
        {route.view === 'calendar'  && <CalendarView projectFilter={route.projectFilter} initialTagFilter={route.tagFilter} />}
        {route.view === 'review'         && <ReviewView />}
        {route.view === 'analytics'      && <AnalyticsView projectFilter={route.projectFilter} />}
        {route.view === 'projects'       && <ProjectsView />}
        {route.view === 'settings'       && <SettingsView />}
        {route.view === 'work-performed' && <WorkPerformedView projectFilter={route.projectFilter} />}
      </Suspense>
    </AppShell>
  );
}
