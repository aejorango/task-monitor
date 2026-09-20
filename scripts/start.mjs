#!/usr/bin/env node
// scripts/start.mjs — `npm start`: the web app and the AI bridge, together.
//
// Deliberately zero-dependency, like the bridge itself: it spawns both
// processes, prefixes their output so you can tell them apart, and makes sure
// Ctrl-C takes both of them down rather than orphaning one.
//
//   npm start            both
//   npm start -- --no-ai just the web app

import { spawn } from 'node:child_process';
import process from 'node:process';

const wantsBridge = !process.argv.includes('--no-ai');

const COLORS = { web: '\x1b[36m', ai: '\x1b[35m', dim: '\x1b[2m', off: '\x1b[0m' };
const useColor = process.stdout.isTTY;
const paint = (c, s) => (useColor ? `${COLORS[c]}${s}${COLORS.off}` : s);

const children = [];
let shuttingDown = false;

function run(label, command, args, { optional = false } = {}) {
  const child = spawn(command, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
    shell: false,
  });
  children.push(child);

  const tag = paint(label === 'web' ? 'web' : 'ai', `[${label}]`);
  const forward = (stream, to) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) to.write(`${tag} ${line}\n`);
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);

  child.on('error', (err) => {
    process.stderr.write(`${tag} failed to start: ${err.message}\n`);
    if (!optional) shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (optional && code !== 0) {
      // The bridge is optional: the app runs fine without AI.
      process.stderr.write(
        `${tag} stopped (${signal || `exit ${code}`}). `
        + 'AI features will be unavailable; everything else keeps working.\n',
      );
      return;
    }
    shutdown(code ?? 0);
  });

  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }
  // Give them a moment to close their ports, then leave.
  setTimeout(() => process.exit(code), 300).unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    process.stdout.write('\n');
    shutdown(0);
  });
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

console.log(paint('dim', 'Starting Task Monitor…'));
run('web', npx, ['vite']);
if (wantsBridge) {
  run('ai', process.execPath, ['bridge/server.mjs'], { optional: true });
} else {
  console.log(paint('dim', 'AI bridge skipped (--no-ai).'));
}
