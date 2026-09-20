// vite.config.js
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// One source of truth for the version: package.json. Baked in at build time so
// Settings → About and any bug report agree with what was actually shipped.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Served at the root of a custom domain (tasks.blueinnovation.ph via the
// CNAME in public/). Assets resolve at '/'. When deploying to a path-based
// host (like /task-monitor/ on raw GitHub Pages), change `base` accordingly
// — every relative path uses `import.meta.env.BASE_URL` so it just works.
export default defineConfig({
  plugins: [react()],
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
});