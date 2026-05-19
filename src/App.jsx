// src/App.jsx — root shell + view router.

import { useAuth, useProjects } from './hooks/useTasks';
import AppShell, { useRoute } from './components/AppShell';
import Board from './components/Board';
import TableView from './components/TableView';
import GanttView from './components/GanttView';
import ReviewView from './components/ReviewView';
import ProjectsView from './components/ProjectsView';
import './App.css';

export default function App() {
  const { userId, ready } = useAuth();
  const { projects } = useProjects();
  const { route, navigate } = useRoute();

  return (
    <AppShell
      userId={userId}
      ready={ready}
      projects={projects}
      route={route}
      navigate={navigate}
    >
      {route.view === 'board'    && <Board    projectFilter={route.projectFilter} />}
      {route.view === 'table'    && <TableView projectFilter={route.projectFilter} />}
      {route.view === 'gantt'    && <GanttView projectFilter={route.projectFilter} />}
      {route.view === 'review'   && <ReviewView />}
      {route.view === 'projects' && <ProjectsView />}
    </AppShell>
  );
}
