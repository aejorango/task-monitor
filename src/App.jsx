// src/App.jsx — root shell + view router with code-split non-Board views.

import { lazy, Suspense, useEffect } from 'react';
import { useAuth, useProjects } from './hooks/useTasks';
import { useWorkspaces, useSyncMyMemberProfile } from './hooks/useWorkspace';
import { useMyCompany } from './hooks/useCompany';
import { setCurrentUserRole } from './services/anthropic';
import { useUserProfile } from './hooks/useUserProfile';
import { useOverdueScan } from './hooks/useNotifications';
import AppShell, { useRoute } from './components/AppShell';
import Board from './components/Board';   // eager: most common entry point
import TimerWidget from './components/TimerWidget';
import LandingView from './components/LandingView';
import PendingApprovalView from './components/PendingApprovalView';
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
const HowToUseView      = lazy(() => import('./components/HowToUseView'));
const WBSView           = lazy(() => import('./components/WBSView'));
const GoalsView         = lazy(() => import('./components/GoalsView'));
const MessagesView      = lazy(() => import('./components/MessagesView'));

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
      <Suspense fallback={<FullPageSpinner label="Loading invite…" />}>
        <InviteClaimView inviteId={route.projectFilter} navigate={navigate} />
      </Suspense>
    );
  }

  if (!userId) {
    return <LandingView />;
  }

  if (profileLoading) {
    return <FullPageSpinner label="Loading your profile…" />;
  }

  // Profile is null when the doc hasn't been created yet (the sign-in flow
  // creates it, but the listener can race here). Treat as pending until the
  // profile arrives so we never accidentally let an unprofiled user in.
  if (!profile || profile.status === 'pending') {
    return <PendingApprovalView user={{ uid: userId }} profile={profile} />;
  }
  if (profile.status === 'rejected') {
    return <PendingApprovalView user={{ uid: userId }} profile={profile} />;
  }

  return <ApprovedApp userId={userId} ready={ready} route={route} navigate={navigate} profile={profile} />;
}

function ApprovedApp({ userId, ready, route, navigate, profile }) {
  const { projects } = useProjects();
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

  return (
    <AppShell
      userId={userId}
      ready={ready}
      projects={projects}
      route={route}
      navigate={navigate}
      timerWidget={<TimerWidget />}
      userProfile={profile}
    >
      <Suspense fallback={<ViewSpinner />}>
        {route.view === 'invite'    && <InviteClaimView inviteId={route.projectFilter} navigate={navigate} />}
        {route.view === 'dashboard' && <DashboardView projectFilter={route.projectFilter} navigate={navigate} />}
        {route.view === 'board'     && <Board    projectFilter={route.projectFilter} initialTagFilter={route.tagFilter} initialStatusFilter={route.statusFilter} onlyMine={route.onlyMine} />}
        {route.view === 'table'     && <TableView projectFilter={route.projectFilter} initialTagFilter={route.tagFilter} />}
        {route.view === 'gantt'     && <GanttView projectFilter={route.projectFilter} initialTagFilter={route.tagFilter} />}
        {route.view === 'wbs'       && <WBSView projectFilter={route.projectFilter} />}
        {route.view === 'goals'     && <GoalsView />}
        {route.view === 'messages'  && <MessagesView />}
        {route.view === 'calendar'  && <CalendarView projectFilter={route.projectFilter} initialTagFilter={route.tagFilter} />}
        {route.view === 'review'         && <ReviewView />}
        {route.view === 'analytics'      && <AnalyticsView projectFilter={route.projectFilter} />}
        {route.view === 'projects'       && <ProjectsView />}
        {route.view === 'settings'       && <SettingsView />}
        {route.view === 'work-performed' && <WorkPerformedView projectFilter={route.projectFilter} />}
        {route.view === 'how-to-use'     && <HowToUseView />}
      </Suspense>
    </AppShell>
  );
}
