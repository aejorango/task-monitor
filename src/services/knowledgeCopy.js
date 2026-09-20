// src/services/knowledgeCopy.js — what the Knowledge base panel says, and to whom.
//
// The knowledge base lives on the operator's own machine: it needs a bridge
// process, a CLI installed with pipx, and a Google login. Every one of those is
// a shell command, and none of them mean anything to the person using the app.
//
// So this module answers one question — "what state is the knowledge base in,
// and what should THIS reader be told about it?" — and returns either an
// operator's runbook or a plain sentence. Pure: no imports, no fetches, so the
// wording is unit-tested rather than eyeballed.

/** The states the integration can be in, in the order you hit them. */
export const KNOWLEDGE_STATES = [
  'checking',      // first probe hasn't answered yet
  'bridge-off',    // the app is not even trying to reach the bridge
  'bridge-down',   // trying, nothing answering
  'cli-missing',   // bridge up, CLI not installed
  'signed-out',    // CLI installed, not logged in
  'empty',         // logged in, no notebooks yet
  'ready',         // usable
];

/**
 * @param {object} status  the shape from useKnowledgeStatus()
 * @returns {string} one of KNOWLEDGE_STATES
 */
export function knowledgeState(status) {
  const { probed, bridgeOff, bridgeOk, cliFound, authenticated, notebooks } = status || {};
  if (bridgeOff) return 'bridge-off';
  if (!probed)   return 'checking';
  if (!bridgeOk) return 'bridge-down';
  if (!cliFound) return 'cli-missing';
  if (!authenticated) return 'signed-out';
  if (!(notebooks || []).length) return 'empty';
  return 'ready';
}

// What an operator is told: the one command that moves this state forward.
const OPERATOR = {
  'checking': {
    title: 'Checking…',
    message: 'Looking for the knowledge base on this machine.',
    commands: [],
  },
  'bridge-off': {
    title: 'Bridge not being probed',
    message: 'This page is not trying to reach the local bridge. Turn it on for '
           + 'this device to use the knowledge base here.',
    commands: [],
  },
  'bridge-down': {
    title: 'Bridge not running',
    message: 'Start the AI bridge on this machine, then press Re-check.',
    commands: ['npm run bridge'],
  },
  'cli-missing': {
    title: 'NotebookLM CLI not installed',
    message: 'Install it on the machine running the bridge, sign in with a '
           + 'dedicated Google account, then press Re-check — no restart needed.',
    commands: [
      'brew install pipx && pipx ensurepath',
      'pipx install "notebooklm-py[browser]"',
      'notebooklm login',
    ],
  },
  'signed-out': {
    title: 'NotebookLM not signed in',
    message: 'The CLI is installed but signed out. Sign in with a dedicated '
           + 'Google account, then press Re-check.',
    commands: ['notebooklm login'],
  },
  'empty': {
    title: 'No notebooks yet',
    message: 'Signed in, but this account has no notebooks. Create one at '
           + 'notebooklm.google.com, add a few sources, then press Re-check.',
    commands: [],
  },
  'ready': {
    title: 'Connected',
    message: 'AI answers can be grounded in your own notebooks.',
    commands: [],
  },
};

// What everybody else is told: whether it works, and who to ask. No commands,
// no bridge URLs, no filenames — none of it is theirs to fix.
const USER = {
  'checking': {
    title: 'Checking…',
    message: 'Seeing whether a knowledge base is connected.',
  },
  'ready': {
    title: 'Connected',
    message: 'AI answers on this account can draw on your team’s own documents.',
  },
};

const USER_UNAVAILABLE = {
  title: 'Not connected',
  message: 'A knowledge base lets AI answers draw on your team’s own documents. '
         + 'Yours is not connected yet — your admin sets this up.',
};

/**
 * @param {object} status   from useKnowledgeStatus()
 * @param {{ isOperator?: boolean }} opts
 * @returns {{ state, title, message, commands: string[], showDetail: boolean }}
 */
export function knowledgeCopy(status, { isOperator = false } = {}) {
  const state = knowledgeState(status);

  if (!isOperator) {
    const copy = USER[state] || USER_UNAVAILABLE;
    return { state, ...copy, commands: [], showDetail: state === 'ready' };
  }

  const copy = OPERATOR[state] || OPERATOR['bridge-down'];
  return { state, ...copy, showDetail: state === 'ready' };
}
