// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served at the root of a custom domain (tasks.blueinnovation.ph via the
// CNAME in public/). Assets resolve at '/'. When deploying to a path-based
// host (like /task-monitor/ on raw GitHub Pages), change `base` accordingly
// — every relative path uses `import.meta.env.BASE_URL` so it just works.
export default defineConfig({
  plugins: [react()],
  base: '/',
});