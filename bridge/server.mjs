#!/usr/bin/env node
// bridge/server.mjs — the local AI bridge.
//
// Task Monitor is a static browser app with no backend, so the page itself
// cannot spawn the `claude` CLI. This tiny zero-dependency server runs on the
// operator's own machine, exposes the AI module over localhost, and the app
// detects it automatically.
//
//   npm run bridge
//
// It binds to 127.0.0.1 only and answers a fixed allowlist of origins, so a
// random website you visit cannot spend your Claude subscription.

import http from 'node:http';
import {
  askAI, askAIJson, detectProvider, recheckProvider,
  aiSettings, setAiSettings, getUsage, cliVersion, providerLabel, PROVIDERS,
} from './ai.mjs';
import {
  knowledgeStatus, listNotebooks, resetKnowledgeCaches, knowledgeHint,
  listSources, addSourceUrl, addSourceText, askNotebook,
  notebookAskStats, recentAsks, rateAsk,
} from './notebooklm.mjs';

const PORT = Number(process.env.TM_BRIDGE_PORT || 4319);
const HOST = '127.0.0.1';
const MAX_BODY = 1_000_000;   // 1 MB

const DEFAULT_ORIGINS = [
  'http://localhost:5173',  'http://127.0.0.1:5173',   // vite dev
  'http://localhost:4173',  'http://127.0.0.1:4173',   // vite preview
  'https://tasks.blueinnovation.ph',                   // production
];
const EXTRA_ORIGINS = String(process.env.TM_BRIDGE_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const ALLOW_ANY = EXTRA_ORIGINS.includes('*');
const ORIGINS = new Set([...DEFAULT_ORIGINS, ...EXTRA_ORIGINS]);

function corsHeaders(origin) {
  const allowed = ALLOW_ANY ? (origin || '*') : (origin && ORIGINS.has(origin) ? origin : null);
  if (!allowed) return null;
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    'access-control-allow-headers': 'content-type',
    // Chrome's Private Network Access preflight for public https → localhost.
    'access-control-allow-private-network': 'true',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function send(res, status, body, cors) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...(cors || {}),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Request body too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error(`Invalid JSON body: ${e.message}`)); }
    });
    req.on('error', reject);
  });
}

function healthPayload() {
  const mode = detectProvider();
  return {
    ok: true,
    service: 'task-monitor-bridge',
    aiMode: mode,
    aiLabel: providerLabel(mode),
    cli: { available: mode === 'claude-code', version: cliVersion() },
    settings: aiSettings(),
    providers: PROVIDERS,
    // Read from the cached status only. /health is polled on every page load,
    // and spawning `notebooklm auth check` from here would put a Google
    // round-trip in front of the app starting up.
    knowledge: knowledgeSnapshot(),
  };
}

// The last knowledge status we happen to know, without probing for a new one.
let _lastKnowledge = { cliFound: null, authenticated: null };
function knowledgeSnapshot() { return { ..._lastKnowledge }; }
function rememberKnowledge(status) {
  _lastKnowledge = { cliFound: !!status.cliFound, authenticated: !!status.authenticated };
  return status;
}

// A CLI failure is an upstream-dependency failure, not a bug in the bridge —
// 502, with the CLI's own already-user-readable message.
function knowledgeError(err) {
  const e = new Error(err?.message || String(err));
  e.status = 502;
  return e;
}

/* ── /knowledge/* — the NotebookLM knowledge base ──────────────────────────
   Optional by design: with the CLI missing or signed out these routes still
   answer, they just answer "not set up yet" with the command that fixes it.
   Anything that actually needed the CLI and could not reach it is a 502. */

async function handleKnowledge(route, url, req) {
  switch (route) {
    case 'GET /knowledge/status': {
      const status = rememberKnowledge(await knowledgeStatus());
      // Notebooks are best-effort here: a signed-out CLI must still return a
      // status (with its hint) rather than a 502 on the status route itself.
      let notebooks = null;
      if (status.authenticated) {
        try { notebooks = await listNotebooks(); } catch { notebooks = null; }
      }
      return { status: 200, body: { ...status, notebooks, hint: knowledgeHint(status, notebooks) || status.hint } };
    }

    case 'POST /knowledge/status/refresh': {
      // The whole point of Re-check: an operator who just ran `notebooklm
      // login` gets picked up without restarting the bridge.
      resetKnowledgeCaches();
      const status = rememberKnowledge(await knowledgeStatus({ force: true }));
      let notebooks = null;
      if (status.authenticated) {
        try { notebooks = await listNotebooks({ force: true }); } catch { notebooks = null; }
      }
      return { status: 200, body: { ...status, notebooks, hint: knowledgeHint(status, notebooks) || status.hint } };
    }

    case 'GET /knowledge/notebooks': {
      const force = url.searchParams.get('force') === '1';
      try {
        return { status: 200, body: { notebooks: await listNotebooks({ force }) } };
      } catch (err) { throw knowledgeError(err); }
    }

    case 'GET /knowledge/sources': {
      const notebook = url.searchParams.get('notebook');
      if (!notebook) return { status: 400, body: { error: '`notebook` is required.' } };
      try {
        return { status: 200, body: { sources: await listSources(notebook) } };
      } catch (err) { throw knowledgeError(err); }
    }

    case 'POST /knowledge/sources': {
      const { notebook, kind, url: srcUrl, title, text } = await readBody(req);
      if (!notebook) return { status: 400, body: { error: '`notebook` is required.' } };
      if (kind !== 'url' && kind !== 'text') {
        return { status: 400, body: { error: "`kind` must be 'url' or 'text'." } };
      }
      if (kind === 'url' && !/^https?:\/\//i.test(String(srcUrl || ''))) {
        return { status: 400, body: { error: 'A source URL must start with http:// or https://' } };
      }
      if (kind === 'text' && !String(text || '').trim()) {
        return { status: 400, body: { error: '`text` is required for a text source.' } };
      }
      try {
        const data = kind === 'url'
          ? await addSourceUrl(notebook, srcUrl)
          : await addSourceText(notebook, title, text);
        return { status: 200, body: { ok: true, data } };
      } catch (err) { throw knowledgeError(err); }
    }

    case 'POST /knowledge/ask': {
      const b = await readBody(req);
      if (!b.notebook) return { status: 400, body: { error: '`notebook` is required.' } };
      if (!String(b.question || '').trim()) return { status: 400, body: { error: '`question` is required.' } };
      try {
        const out = await askNotebook(b.notebook, b.question, {
          conversationId: b.conversationId || null,
          source: b.source || 'manual',
          workspaceId: b.workspaceId || null,
          projectId: b.projectId || null,
          taskId: b.taskId || null,
        });
        return { status: 200, body: out };
      } catch (err) { throw knowledgeError(err); }
    }

    case 'GET /knowledge/usage': {
      const notebook = url.searchParams.get('notebook');
      if (!notebook) return { status: 400, body: { error: '`notebook` is required.' } };
      // Local log only — no CLI, no network, so this can never 502.
      return {
        status: 200,
        body: { stats: notebookAskStats(notebook), recent: recentAsks(notebook, 10) },
      };
    }

    default: {
      // PATCH /knowledge/asks/<id> — the only route with an id in the path.
      const m = route.match(/^PATCH \/knowledge\/asks\/([^/]+)$/);
      if (!m) return null;
      const { helpful } = await readBody(req);
      const row = rateAsk(decodeURIComponent(m[1]), helpful === null ? null : !!helpful);
      if (!row) return { status: 404, body: { error: 'No such ask in the local log.' } };
      return { status: 200, body: { ok: true, ask: row } };
    }
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const cors = corsHeaders(origin);

  // Browsers only send Origin for cross-origin requests; curl sends none.
  if (origin && !cors) {
    return send(res, 403, {
      error: `Origin "${origin}" is not allowed. Start the bridge with ` +
             'TM_BRIDGE_ORIGINS="https://your.app" to permit it.',
    }, null);
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors || {});
    return res.end();
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    if (url.pathname.startsWith('/knowledge/')) {
      const out = await handleKnowledge(route, url, req);
      if (out) return send(res, out.status, out.body, cors);
    }

    switch (route) {
      case 'GET /health':
        return send(res, 200, healthPayload(), cors);

      case 'POST /ai/recheck':
        return send(res, 200, { aiMode: recheckProvider(), ...healthPayload() }, cors);

      case 'GET /ai/settings':
        return send(res, 200, { settings: aiSettings(), aiMode: detectProvider() }, cors);

      case 'POST /ai/settings': {
        const patch = await readBody(req);
        const settings = setAiSettings(patch);
        return send(res, 200, { settings, aiMode: detectProvider() }, cors);
      }

      case 'GET /ai/usage':
        return send(res, 200, getUsage(), cors);

      case 'POST /ai/complete': {
        const { system, user, maxTokens, web, meta, ground } = await readBody(req);
        if (!system || !user) return send(res, 400, { error: '`system` and `user` are required.' }, cors);
        const out = await askAI(String(system), String(user), { maxTokens, web: !!web, meta: meta || {}, ground: ground || null });
        return send(res, 200, out, cors);
      }

      case 'POST /ai/json': {
        const { system, user, maxTokens, web, meta, ground } = await readBody(req);
        if (!system || !user) return send(res, 400, { error: '`system` and `user` are required.' }, cors);
        const out = await askAIJson(String(system), String(user), { maxTokens, web: !!web, meta: meta || {}, ground: ground || null });
        return send(res, 200, out, cors);
      }

      default:
        return send(res, 404, { error: `No route for ${route}` }, cors);
    }
  } catch (err) {
    console.error(`[bridge] ${route} failed:`, err.message);
    return send(res, err.status || 500, { error: err.message || String(err) }, cors);
  }
});

server.listen(PORT, HOST, () => {
  const mode = detectProvider();
  console.log(`Task Monitor AI bridge listening on http://${HOST}:${PORT}`);
  console.log(`AI provider: ${providerLabel(mode)}`);
  if (mode === 'mock') {
    console.log('  → Install and log in:  npm i -g @anthropic-ai/claude-code && claude');
    console.log('  → Or export ANTHROPIC_API_KEY, then POST /ai/recheck.');
  }
  console.log(`Allowed origins: ${ALLOW_ANY ? '(any — TM_BRIDGE_ORIGINS=*)' : [...ORIGINS].join(', ')}`);
  // Optional layer: probe it in the background so the first /knowledge/status
  // is warm, and never let its absence delay or fail startup.
  knowledgeStatus().then((k) => {
    rememberKnowledge(k);
    console.log(k.cliFound
      ? `Knowledge base: notebooklm ${k.authenticated ? 'signed in' : 'found but signed out (run `notebooklm login`)'}`
      : 'Knowledge base: notebooklm CLI not installed (optional — see README)');
  }).catch(() => {});
});
