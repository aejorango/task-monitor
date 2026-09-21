// src/App.jsx — root shell + view router with code-split non-Board views.

import { lazy, Suspense, useEffect } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { DialogProvider } from './components/Dialog';
import { useAuth, useProjects, useTasks } from './hooks/useTasks';
import { useWorkspaces, useSyncMyMemberProfile } from './hooks/useWorkspace';
import { useMyCompany } from './hooks/useCompany';
import { setCurrentUserRole } from './services/anthropic';
import { useUserProfile } from './hooks/useUserProfile';
import { useOverdueScan } from './hooks/useNotifications';
import { useRecurrenceCatchUp } from './hooks/useRecurrenceCatchUp';
import { useSettings } from './hooks/useSettings';
import AppShell, { useRoute } from './components/AppShell';
import { isKnownView } from './services/views';
import NotFoundView from './components/NotFoundView';
import Board from './components/Board';   // eager: most common entry point
import TimerWidget from './components/TimerWidget';
import DueTaskAlertModal from './components/DueTaskAlertModal';
import LandingView from './components/LandingView';
import PendingApprovalView from './components/PendingApprovalView';
import './App.css';

const TableView         = lazy(() => import('./components/TableView'));
const TasksTableView    = lazy(() => import('./components/TasksTableView'));
const TrashView         = lazy(() => import('./components/TrashView'));
const TimesheetView     = lazy(() => import('./components/TimesheetView'));
const WorkloadView      = lazy(() => import('./components/WorkloadView'));
const SharedViewPage    = lazy(() => import('./components/SharedViewPage'));
const GanttView         = lazy(() => import('./components/GanttView'));
const CalendarView      = lazy(() => import('./components/CalendarView'));
const DashboardView     = lazy(() => import('./components/DashboardView'));
const ReviewView        = lazy(() => import('./components/ReviewView'));
const ArtifactsView     = lazy(() => import('./components/ArtifactsView'));
const AnalyticsView     = lazy(() => import('./components/AnalyticsView'));
const InviteClaimView   = lazy(() => import('./components/InviteClaimView'));
const ProjectsView      = lazy(() => import('./components/ProjectsView'));
const SettingsView      = lazy(() => import('./components/SettingsView'));
const WorkPerformedView = lazy(() => import('./components/WorkPerformedView'));
const HowToUseView      = lazy(() => import('./components/HowToUseView'));
const WBSView           = lazy(() => import('./components/WBSView'));
const GoalsView         = lazy(() => import('./components/GoalsView'));
const MessagesView      = lazy(() => import('./components/MessagesView'));
const MinutesView       = lazy(() => import('./components/MinutesView'));
const AskAiView         = lazy(() => import('./components/AskAiView'));

// What each route is called in the sidebar — the error card says "We could not
// show the Gantt page", not "view 'gantt' threw".
const VIEW_NAMES = {
  dashboard: 'Dashboard', board: 'Board', table: 'Activity Log', gantt: 'Gantt',
  wbs: 'WBS', goals: 'Goals', messages: 'Messages', minutes: 'Minutes',
  calendar: 'Calendar', review: 'Review', artifacts: 'Artifacts',
  analytics: 'Analytics', projects: 'Projects', settings: 'Settings',
  'work-performed': 'Work Performed', timesheet: 'Timesheet', workload: 'Workload',
  'how-to-use': 'How to use',
  'ask-ai': 'Ask AI', trash: 'Trash', invite: 'invite', shared: 'shared page',
};

function ViewSpinner() {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-text-3)' }}>
      <div className="spinner" /> &nbsp; Loading view…
    </div>
  );
}

function FullPageSpinner({ label = 'Loading…' }) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: 12,
      color: 'var(--c-text-3)',
    }}>
      <div className="spinner" />
      <span className="small">{label}</span>
    </div>
  );
}

export default function App() {
  // Static import (not lazy) so the theme is applied on first paint no matter
  // which view loads first — Board never imports useSettings itself, and
  // Settings/Calendar are code-split, so without this call `data-theme` was
  // never set until the user happened to visit one of those two views.
  useSettings();
  const { userId, ready } = useAuth();
  const { profile, loading: profileLoading } = useUserProfile(userId);
  const { route, navigate } = useRoute();

  // Auth gate:
  //   1. Auth not ready yet            → spinner
  //   2. No user                       → LandingView (Google sign-in only)
  //   3. User but profile loading      → spinner
  //   4. Status pending                → PendingApprovalView
  //   5. Status rejected               → PendingApprovalView (rejected state)
  //   6. Status approved               → AppShell

  // A share link (#/shared/<token>) is for somebody who has no account and is
  // not going to get one. It renders BEFORE the auth gate — before we even wait
  // for sign-in to settle — because signing in is exactly what it must not ask
  // for. It reads one world-readable document and nothing else.
  if (route.view === 'shared') {
    return (
      <ErrorBoundary scope="app">
      <Suspense fallback={<FullPageSpinner label="Opening…" />}>
        <SharedViewPage token={route.projectFilter} />
      </Suspense>
      </ErrorBoundary>
    );
  }

  if (!ready) {
    return <FullPageSpinner label="Signing in…" />;
  }

  // Invite links (#/invite/<id>) must be claimable regardless of account
  // approval status — an invite grants project-level access independent of
  // workspace approval. Render the claim screen BEFORE the approval gate so a
  // recipient (signed out, or signed in but still pending) can accept it.
  // InviteClaimView prompts for Google sign-in when the user isn't signed in.
  if (route.view === 'invite') {
    return (
      <ErrorBoundary scope="app">
      <Suspense fallback={<FullPageSpinner label="Loading invite…" />}>
        <InviteClaimView inviteId={route.projectFilter} navigate={navigate} />
      </Suspense>
      </ErrorBoundary>
    );
  }

  if (!userId) {
    return <LandingView />;
  }

  if (profileLoading) {
    return <FullPageSpinner label="Loading your profile…" />;
  }

  // Approval is an allowlist on both sides of the wire: firestore.rules opens
  // up only for users/{uid}.status == 'approved', so the screen must agree
  // exactly. Anything else — pending, rejected, a status we don't recognise,
  // or a profile document that hasn't arrived yet — waits outside.
  if (profile?.status !== 'approved') {
    return <PendingApprovalView user={{ uid: userId }} profile={profile} />;
  }

  return <ApprovedApp userId={userId} ready={ready} route={route} navigate={navigate} profile={profile} />;
}

function ApprovedApp({ userId, ready, route, navigate, profile }) {
  const { projects } = useProjects();
  // The workspace's tasks are already subscribed to once, app-wide (see
  // services/sharedSubscription.js), so reading them here costs no extra query.
  const { tasks: tasksForRecurrence } = useTasks();
  const { workspaces } = useWorkspaces();
  useSyncMyMemberProfile(workspaces);
  // Pipe the user's company's Anthropic key into the AI client so every AI
  // call this user makes is billed to that company's budget.
  useMyCompany(profile);
  // Push the role into the AI client so its getEffectiveApiKey() can decide
  // whether the personal localStorage key is a valid fallback (superadmin
  // only). Without this, regular users could quietly use a stale localStorage
  // key and bypass the company-budget gate.
  useEffect(() => {
    setCurrentUserRole(profile?.role);
  }, [profile?.role]);
  useOverdueScan();
  // A recurring task comes round on its own schedule, not only when the last
  // one was ticked off. See hooks/useRecurrenceCatchUp.js for why this runs in
  // the app rather than on a cloud schedule.
  useRecurrenceCatchUp(tasksForRecurrence, { userId });

  // Deep link from a browser notification: #/board/<project>?task=<id>.
  // Board opens the editor on this event; retry briefly because the task
  // list may still be loading when the page first mounts.
  useEffect(() => {
    const id = route.openTaskId;
    if (!id) return;
    const fire = () => window.dispatchEvent(new CustomEvent('task-monitor:open-task', { detail: { taskId: id } }));
    const timers = [300, 1500, 4000].map((ms) => setTimeout(() => {
      if (!document.querySelector('.modal-backdrop:not(.due-alert-backdrop)')) fire();
    }, ms));
    return () => timers.forEach(clearTimeout);
  }, [route.openTaskId]);

  return (
    <ToastProvider>
    <DialogProvider>
    {/* In-app due-task alert: one task at a time, on every view. */}
    <DueTaskAlertModal navigate={navigate} />
    <AppShell
      userId={userId}
      ready={ready}
      projects={projects}
      route={route}
      navigate={navigate}
      timerWidget={<TimerWidget />}
      userProfile={profile}
    >
      <ErrorBoundary scope="view" viewName={VIEW_NAMES[route.view] || ''} resetKey={route.view}>
      <Suspense fallback={<ViewSpinner />}>
        {route.view === 'invite'    && <InviteClaimView inviteId={route.projectFilter} navigate={navigate} />}
        {route.view === 'ask-ai'    && <AskAiView />}
        {route.view === 'dashboard' && <DashboardView projectFilter={route.projectFilter} navigate={navigate} />}
        {route.view === 'board'     && <Board    projectFilter={route.projectFilter} initialTagFilter={route.tagFilter} initialStatusFilter={route.statusFilter} onlyMine={route.onlyMine} />}
        {route.view === 'table'       && <TableView projectFilter={route.projectFilter} initialTagFilter={route.tagFilter} />}
        {route.view === 'tasks-table' && <TasksTableView projectFilter={route.projectFilter} savedViewId={route.savedViewId} />}
        {route.view === 'gantt'     && <GanttView projectFilter={route.projectFilter} initialTagFilter={route.tagFilter} />}
        {route.view === 'wbs'       && <WBSView projectFilter={route.projectFilter} />}
        {route.view === 'workload'  && <WorkloadView projectFilter={route.projectFilter} />}
        {route.view === 'goals'     && <GoalsView />}
        {route.view === 'messages'  && <MessagesView />}
        {route.view === 'minutes'   && <MinutesView projectFilter={route.projectFilter} />}
        {route.view === 'calendar'  && <CalendarView projectFilter={route.projectFilter} initialTagFilter={route.tagFilter} />}
        {route.view === 'review'         && <ReviewView />}
        {route.view === 'artifacts'      && <ArtifactsView projectFilter={route.projectFilter} />}
        {route.view === 'analytics'      && <AnalyticsView projectFilter={route.projectFilter} />}
        {route.view === 'projects'       && <ProjectsView />}
        {route.view === 'settings'       && <SettingsView />}
        {route.view === 'work-performed' && <WorkPerformedView projectFilter={route.projectFilter} />}
        {route.view === 'timesheet'      && <TimesheetView projectFilter={route.projectFilter} />}
        {route.view === 'trash'          && <TrashView />}
        {route.view === 'how-to-use'     && <HowToUseView />}
        {/* A hash that names no page. Without this the content area is simply
            blank, which reads as a crash rather than as a bad link. */}
        {!isKnownView(route.view) && <NotFoundView view={route.view} navigate={navigate} />}
      </Suspense>
      </ErrorBoundary>
    </AppShell>
    </DialogProvider>
    </ToastProvider>
  );
}
