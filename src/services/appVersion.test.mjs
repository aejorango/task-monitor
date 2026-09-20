// T-0032 / POL-005 — the version on screen must be the version that shipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { APP_VERSION, versionLine } from './appVersion.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('package.json carries a real version, not 0.0.0', () => {
  assert.notEqual(pkg.version, '0.0.0');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test('the version comes from package.json at build time', () => {
  const viteConfig = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8');
  assert.match(viteConfig, /__APP_VERSION__/);
  assert.match(viteConfig, /package\.json/,
    'hardcoding it here is how it drifted from package.json in the first place');
});

test('outside a Vite build the module still answers, clearly marked', () => {
  assert.equal(APP_VERSION, '0.0.0-dev');
  assert.match(versionLine(), /^v0\.0\.0-dev/);
});

test('no deploy script hardcodes a personal account', () => {
  const scripts = Object.values(pkg.scripts).join(' ');
  assert.doesNotMatch(scripts, /--account\s+\S+@/,
    'that makes npm run deploy fail on anyone else’s machine');
  assert.doesNotMatch(scripts, /@gmail\.com/);
});

test('the deploy targets all go through one script that reads FIREBASE_ACCOUNT', () => {
  assert.match(pkg.scripts.deploy, /firebase-deploy\.mjs hosting/);
  assert.match(pkg.scripts['deploy:rules'], /firebase-deploy\.mjs rules/);
  assert.match(pkg.scripts['deploy:all'], /firebase-deploy\.mjs all/);

  const script = fs.readFileSync(path.join(root, 'scripts', 'firebase-deploy.mjs'), 'utf8');
  assert.match(script, /FIREBASE_ACCOUNT/);
  assert.match(script, /storage:rules/, 'deploy:rules must cover storage.rules too');
  assert.match(script, /npm i -g firebase-tools/, 'say how to fix a missing CLI');
});

test('the deploy script adds no dependency', () => {
  const script = fs.readFileSync(path.join(root, 'scripts', 'firebase-deploy.mjs'), 'utf8');
  for (const line of script.split('\n')) {
    const m = /^import .*from ['"]([^'"]+)['"]/.exec(line.trim());
    if (m) assert.match(m[1], /^node:/, `${m[1]} is a dependency`);
  }
});
