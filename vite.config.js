// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // IMPORTANT: must match your GitHub repo name for Pages routing.
  // If you ever rename the repo, update this too.
  base: '/task-monitor/',
});