// functions/index.js — the AI proxy.
//
// Why this exists: with no server, the only way a company member could use AI
// was for the browser to hold the company's Anthropic key. That key was
// readable from the company document and visible in the Network tab, so any
// member could spend the budget outside the app, and the per-company switch was
// advisory rather than enforced.
//
// Now the key lives in companies/{id}/secrets/anthropic, which only this
// function and a superadmin can read, and the browser asks this function
// instead of api.anthropic.com.
//
// Deploy: firebase deploy --only functions   (needs the Blaze plan — outbound
// network calls are not available on Spark.)

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { authorizeAiCall, normalizeAiRequest } from './src/authorize.js';

initializeApp();
const db = getFirestore();

// Webhook delivery. Separate file, same codebase — Settings → Webhooks stored
// configuration that nothing ever sent.
export { onTaskWritten, onActivityWritten } from './webhooks.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export const aiProxy = onCall(
  { region: 'asia-southeast1', timeoutSeconds: 120, memory: '256MiB', cors: true },
  async (request) => {
    const shaped = normalizeAiRequest(request.data);
    if (!shaped.ok) throw new HttpsError('invalid-argument', shaped.message, { code: shaped.code });

    const uid = request.auth?.uid;
    const userSnap = uid ? await db.doc(`users/${uid}`).get() : null;
    const userDoc = userSnap?.exists ? userSnap.data() : null;

    const companyId = userDoc?.companyId || null;
    const [companySnap, secretSnap] = companyId
      ? await Promise.all([
        db.doc(`companies/${companyId}`).get(),
        db.doc(`companies/${companyId}/secrets/anthropic`).get(),
      ])
      : [null, null];

    const decision = authorizeAiCall(
      request.auth,
      userDoc,
      companySnap?.exists ? companySnap.data() : null,
      secretSnap?.exists ? secretSnap.data()?.anthropicApiKey : '',
    );
    if (!decision.ok) {
      throw new HttpsError(
        decision.code === 'unauthenticated' ? 'unauthenticated' : 'permission-denied',
        decision.message,
        { code: decision.code },
      );
    }

    const apiKey = secretSnap.data().anthropicApiKey;
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: decision.model,
        max_tokens: shaped.maxTokens,
        system: shaped.system,
        messages: [{ role: 'user', content: shaped.user }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[aiProxy] anthropic', res.status, detail.slice(0, 400));
      // Never hand the upstream body to the client: it can echo the key back.
      throw new HttpsError('internal', 'The AI service did not answer. Try again in a moment.');
    }

    const payload = await res.json();
    const text = (payload.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    // A usage record the company's admin can actually see. Written by the
    // function, so a member cannot under-report what they spent.
    await db.collection('aiUsage').add({
      userId: uid,
      companyId: decision.companyId,
      model: decision.model,
      inputTokens: payload.usage?.input_tokens ?? null,
      outputTokens: payload.usage?.output_tokens ?? null,
      at: new Date(),
    }).catch((err) => console.error('[aiProxy] usage log failed', err));

    return {
      text,
      model: decision.model,
      usage: {
        inputTokens: payload.usage?.input_tokens ?? null,
        outputTokens: payload.usage?.output_tokens ?? null,
      },
    };
  },
);
