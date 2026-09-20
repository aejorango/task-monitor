// T-0034 / IMP-001 — the browser half: no key, ever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { proxyErrorMessage } from './aiProxyClient.js';
import {
  clearCurrentCompanyContext, getEffectiveApiKey, isUsingCompanyKey,
  setCurrentCompanyContext, setCurrentUserRole,
} from './aiCredentials.js';

const root = path.resolve(import.meta.dirname, '..', '..');

test('the company context carries a flag, never a key', () => {
  setCurrentUserRole('user');
  setCurrentCompanyContext({ id: 'c1', name: 'Acme', hasApiKey: true, aiEnabled: true });
  assert.equal(isUsingCompanyKey(), true, 'the UI still knows whose budget it is');
  assert.equal(getEffectiveApiKey(), '', 'but the browser holds nothing spendable');
  clearCurrentCompanyContext();
});

test('a member never receives a key, whatever is passed in', () => {
  setCurrentUserRole('user');
  // Even if a stale document still carried one, it must not become spendable.
  setCurrentCompanyContext({ id: 'c1', apiKey: 'sk-ant-leaked', hasApiKey: true, aiEnabled: true });
  assert.equal(getEffectiveApiKey(), '');
  clearCurrentCompanyContext();
});

test('a superadmin may still use their OWN key from their own device', () => {
  setCurrentUserRole('superadmin');
  clearCurrentCompanyContext();
  // getApiKey() reads localStorage, which is empty here — the point is that the
  // path exists for a superadmin and not for a member.
  assert.equal(typeof getEffectiveApiKey(), 'string');
  setCurrentUserRole('user');
  assert.equal(getEffectiveApiKey(), '');
});

test('nothing in the client sends x-api-key with a company key any more', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'services', 'ai.js'), 'utf8');
  // The direct-to-Anthropic path survives only for a superadmin's personal key.
  const directCalls = src.split('\n').filter((l) => l.includes("'x-api-key'"));
  assert.ok(directCalls.length <= 1, `expected at most the personal-key path:\n${directCalls.join('\n')}`);
  assert.match(src, /callProxy/, 'members go through the server-side proxy');
});

test('the proxy client sends only the prompt', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'services', 'aiProxyClient.js'), 'utf8');
  assert.doesNotMatch(src, /x-api-key|anthropic-version|api\.anthropic\.com/,
    'the browser must not talk to Anthropic directly');
  assert.match(src, /httpsCallable/);
});

test('the company document no longer carries the key', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'services', 'firebase.js'), 'utf8');
  const addCompany = src.slice(src.indexOf('export async function addCompany'), src.indexOf('export async function updateCompany'));
  assert.doesNotMatch(addCompany, /anthropicApiKey:\s*\(/, 'the key goes in the secret subdocument');
  assert.match(addCompany, /hasApiKey/);
  assert.match(src, /companies', companyId, 'secrets', 'anthropic'/);
});

test('every proxy failure is a sentence, and none of them leak a key', () => {
  for (const code of [
    'functions/unauthenticated', 'functions/permission-denied', 'functions/invalid-argument',
    'functions/not-found', 'functions/deadline-exceeded', 'functions/resource-exhausted',
    'functions/internal', undefined,
  ]) {
    const msg = proxyErrorMessage({ code, message: 'Ask your administrator.' });
    assert.match(msg, /^[A-Z].*\.$/, `${code}: ${msg}`);
    assert.doesNotMatch(msg, /sk-ant|functions\/|Firebase/i, `${code}: ${msg}`);
  }
});

test('the deployed bundle contains no Anthropic key', () => {
  const dist = path.join(root, 'dist', 'assets');
  if (!fs.existsSync(dist)) return;   // nothing built yet in this checkout
  for (const file of fs.readdirSync(dist).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dist, file), 'utf8');
    assert.doesNotMatch(src, /sk-ant-[A-Za-z0-9_-]{10,}/, `${file} contains an Anthropic key`);
  }
});
