// src/App.jsx
import TaskForm from './components/TaskForm';
import TaskList from './components/TaskList';
import { useAuth } from './hooks/useTasks';
import './App.css';

export default function App() {
  const { userId, ready } = useAuth();

  return (
    <div className="app">
      <header>
        <h1>Task Monitor</h1>
        <p className="muted">
          Personal tracker · synced via Firestore
          {ready && userId && (
            <span className="session-pill"> · session {userId.slice(0, 6)}</span>
          )}
          {ready && !userId && (
            <span className="session-pill warn"> · auth not connected</span>
          )}
        </p>
      </header>
      <main>
        <TaskForm />
        <TaskList />
      </main>
    </div>
  );
}
