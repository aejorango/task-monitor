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
    'access-control-allow-methods': 'GET, POST, OPTIONS',
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
  };
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
        const { system, user, maxTokens, web, meta } = await readBody(req);
        if (!system || !user) return send(res, 400, { error: '`system` and `user` are required.' }, cors);
        const out = await askAI(String(system), String(user), { maxTokens, web: !!web, meta: meta || {} });
        return send(res, 200, out, cors);
      }

      case 'POST /ai/json': {
        const { system, user, maxTokens, web, meta } = await readBody(req);
        if (!system || !user) return send(res, 400, { error: '`system` and `user` are required.' }, cors);
        const out = await askAIJson(String(system), String(user), { maxTokens, web: !!web, meta: meta || {} });
        return send(res, 200, out, cors);
      }

      default:
        return send(res, 404, { error: `No route for ${route}` }, cors);
    }
  } catch (err) {
    console.error(`[bridge] ${route} failed:`, err.message);
    return send(res, 500, { error: err.message || String(err) }, cors);
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
});
