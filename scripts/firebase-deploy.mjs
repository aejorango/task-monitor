#!/usr/bin/env node
// scripts/firebase-deploy.mjs — deploy, without a personal account baked into
// package.json.
//
// The Firebase CLI account was hardcoded to one Gmail address, so `npm run
// deploy` failed on anybody else's machine with an opaque CLI error. The
// account now comes from FIREBASE_ACCOUNT (or .firebaserc's default, or
// whoever `firebase login` last used) and is reported before we start.
//
//   npm run deploy                          # hosting
//   npm run deploy:rules                    # firestore + storage rules
//   npm run deploy:all                      # both
//   FIREBASE_ACCOUNT=me@example.com npm run deploy

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const TARGETS = {
  hosting:   ['hosting'],
  rules:     ['firestore:rules', 'storage:rules'],
  // The AI proxy. Needs the Blaze plan: a function that calls Anthropic makes
  // an outbound request, which Spark does not allow.
  functions: ['functions'],
  all:       ['hosting', 'firestore:rules', 'storage:rules', 'functions'],
};

const target = process.argv[2] || 'hosting';
const only = TARGETS[target];

if (!only) {
  console.error(`Unknown deploy target "${target}". Use one of: ${Object.keys(TARGETS).join(', ')}.`);
  process.exit(1);
}

const account = process.env.FIREBASE_ACCOUNT?.trim();
const args = ['deploy', '--only', only.join(',')];
if (account) args.push('--account', account);

console.log(`Deploying ${only.join(', ')}`);
console.log(account
  ? `  as ${account} (from FIREBASE_ACCOUNT)`
  : '  as your logged-in Firebase CLI account — set FIREBASE_ACCOUNT to choose another');

const result = spawnSync('firebase', args, { stdio: 'inherit', env: process.env });

if (result.error) {
  console.error(
    result.error.code === 'ENOENT'
      ? 'The Firebase CLI is not installed. Install it with: npm i -g firebase-tools'
      : `Could not run the Firebase CLI: ${result.error.message}`,
  );
  process.exit(1);
}
process.exit(result.status ?? 1);
