// src/App.jsx — root shell + view router with code-split non-Board views.

import { lazy, Suspense } from 'react';
import { useAuth, useProjects } from './hooks/useTasks';
import { useOverdueScan } from './hooks/useNotifications';
import AppShell, { useRoute } from './components/AppShell';
import Board from './components/Board';   // eager: most common entry point
import TimerWidget from './components/TimerWidget';
import './App.css';

const TableView    = lazy(() => import('./components/TableView'));
const GanttView    = lazy(() => import('./components/GanttView'));
const CalendarView = lazy(() => import('./components/CalendarView'));
const ReviewView    = lazy(() => import('./components/ReviewView'));
const AnalyticsView = lazy(() => import('./components/AnalyticsView'));
const ProjectsView = lazy(() => import('./components/ProjectsView'));
const SettingsView = lazy(() => import('./components/SettingsView'));

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
        {route.view === 'board'    && <Board    projectFilter={route.projectFilter} initialTagFilter={route.tagFilter} initialStatusFilter={route.statusFilter} />}
        {route.view === 'table'    && <TableView projectFilter={route.projectFilter} initialTagFilter={route.tagFilter} />}
        {route.view === 'gantt'    && <GanttView projectFilter={route.projectFilter} initialTagFilter={route.tagFilter} />}
        {route.view === 'calendar' && <CalendarView projectFilter={route.projectFilter} initialTagFilter={route.tagFilter} />}
        {route.view === 'review'    && <ReviewView />}
        {route.view === 'analytics' && <AnalyticsView projectFilter={route.projectFilter} />}
        {route.view === 'projects' && <ProjectsView />}
        {route.view === 'settings' && <SettingsView />}
      </Suspense>
    </AppShell>
  );
}
