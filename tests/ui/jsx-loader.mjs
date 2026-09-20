// tests/ui/jsx-loader.mjs — lets `node --test` import the app's .jsx files.
//
// Registered by `npm run test:ui` via --import. Uses the JSX transform that
// already ships inside rolldown (Vite's bundler), so tests compile components
// exactly the way the build does — no extra toolchain, no second config.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./jsx-hooks.mjs', pathToFileURL(import.meta.filename));
