// src/services/anthropic.js — direct browser calls to the Anthropic Messages API.
//
// The API key is stored in localStorage (per-device, like the rest of our
// preferences) and supplied via the `x-api-key` header. We pass the
// `anthropic-dangerous-direct-browser-access` header so the CORS check passes.
//
// This is fine for a personal app where you're the only one with the API key.
// For a multi-user app, you'd proxy this through Firebase Functions.

const STORAGE_KEY = 'task-monitor.anthropic-api-key.v1';
const MODEL_KEY   = 'task-monitor.anthropic-model.v1';

export function getApiKey() {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}
export function setApiKey(key) {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
export function getModel() {
  try { return localStorage.getItem(MODEL_KEY) || 'claude-sonnet-4-5-20250929'; } catch { return 'claude-sonnet-4-5-20250929'; }
}
export function setModel(model) {
  try { localStorage.setItem(MODEL_KEY, model); } catch {}
}

export async function callClaude({ system, user, maxTokens = 2048 }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('No Anthropic API key set. Add one in Settings → AI.');
    err.code = 'no-api-key';
    throw err;
  }
  const model = getModel();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Anthropic API error ${res.status}: ${text.slice(0, 400)}`);
    err.code = `http-${res.status}`;
    throw err;
  }
  const data = await res.json();
  // Concatenate text blocks
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return text;
}

// Generate a draft list of tasks from a project name + description.
// Returns array of { title, description, priority, estimatedDays } (where
// `priority` is low|medium|high and `estimatedDays` is a small positive int).
// Throws if the model output cannot be parsed.
export async function generateTaskDrafts({ projectName, projectDescription, phaseNames, count = 8 }) {
  const phaseHint = phaseNames?.length
    ? `\n\nThe project has these phases: ${phaseNames.join(', ')}. Distribute tasks across phases as appropriate.`
    : '';
  const system = `You are a project-management assistant. You break a project down into concrete, actionable tasks.
Respond ONLY with a JSON array of task objects. Each task has these fields:
- title (string, 6-90 chars, imperative tense, specific)
- description (string, 1-3 sentences explaining what to do)
- priority ("low" | "medium" | "high")
- estimatedDays (integer, 1-30, realistic duration in working days)
- phase (string, optional — must match one of the project's phase names if provided)

Do NOT include any prose, markdown, or explanations outside the JSON array. The response must start with [ and end with ].`;

  const user = `Project: ${projectName}

Description:
${projectDescription || '(no description provided)'}
${phaseHint}

Generate ${count} tasks that, together, would deliver this project. Order them logically (earliest/foundational first).`;

  const text = await callClaude({ system, user, maxTokens: 2048 });

  // Find the first [ and the matching last ] in case the model wraps in markdown
  // or adds whitespace.
  const firstBracket = text.indexOf('[');
  const lastBracket  = text.lastIndexOf(']');
  if (firstBracket === -1 || lastBracket === -1) {
    throw new Error(`Could not find JSON array in model response:\n${text.slice(0, 400)}`);
  }
  const jsonStr = text.slice(firstBracket, lastBracket + 1);
  let parsed;
  try { parsed = JSON.parse(jsonStr); }
  catch (e) {
    throw new Error(`Could not parse JSON: ${e.message}\nResponse:\n${text.slice(0, 400)}`);
  }
  if (!Array.isArray(parsed)) throw new Error('Model did not return a JSON array.');

  // Normalize & clamp
  return parsed.map((t, i) => ({
    id: `draft-${i}`,
    title: String(t.title || '').slice(0, 200).trim() || `Task ${i + 1}`,
    description: String(t.description || '').slice(0, 500).trim(),
    priority: ['low', 'medium', 'high'].includes(String(t.priority).toLowerCase()) ? String(t.priority).toLowerCase() : 'medium',
    estimatedDays: Math.max(1, Math.min(30, Math.round(Number(t.estimatedDays) || 3))),
    phase: t.phase ? String(t.phase).trim() : '',
  }));
}
