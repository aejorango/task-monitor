// Module hooks for tests/ui/jsx-loader.mjs. Runs on the loader thread.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformSync } from 'rolldown/experimental';

const JSX = /\.jsx$/;
// App modules also read `import.meta.env` (Vite's build-time constant). Node
// has no such thing, so every app file is rewritten to read a global the test
// harness controls — see tests/ui/dom.mjs.
const APP_SOURCE = /\/(src|dev)\/[^?]*\.(js|jsx)$/;
const VENDOR = /\/node_modules\//;
// App components import App.css; there is no stylesheet in a Node test.
const STYLE = /\.(css|scss|sass|less)$/;

// Vite resolves `./foo` to foo.js / foo.jsx; Node does not. Do the same here so
// the app's own import style works unchanged under `node --test`.
const EXTENSIONS = ['.js', '.jsx', '.mjs', '/index.js', '/index.jsx'];

export async function resolve(specifier, context, next) {
  if (STYLE.test(specifier)) {
    return { url: 'data:text/javascript,export default {}', shortCircuit: true };
  }

  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier)) {
    const parentDir = context.parentURL
      ? path.dirname(fileURLToPath(context.parentURL))
      : process.cwd();
    for (const ext of EXTENSIONS) {
      const candidate = path.resolve(parentDir, specifier + ext);
      if (fs.existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, format: 'module', shortCircuit: true };
      }
    }
  }

  return next(specifier, context);
}

export async function load(url, context, next) {
  const pathname = new URL(url).pathname;
  const isJsx = JSX.test(pathname) && !VENDOR.test(pathname);
  const isApp = APP_SOURCE.test(pathname) && !VENDOR.test(pathname);
  if (!isJsx && !isApp) return next(url, context);

  const filename = fileURLToPath(url);
  let source = fs.readFileSync(filename, 'utf8');
  source = source.replaceAll('import.meta.env', 'globalThis.__VITE_ENV__');

  if (!isJsx) return { format: 'module', source, shortCircuit: true };

  const out = transformSync(filename, source, { jsx: { runtime: 'automatic' } });
  if (out.errors?.length) {
    throw new Error(`JSX transform failed for ${filename}:\n${out.errors.map(String).join('\n')}`);
  }
  return { format: 'module', source: out.code, shortCircuit: true };
}
