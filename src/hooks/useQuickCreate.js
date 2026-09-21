// src/hooks/useQuickCreate.js — the receiving end of ⌘K's "New …".
//
// The palette navigates to the page that owns the thing, then fires
// `task-monitor:quick-create`. Each page listens for its own entity and opens
// its create flow with whatever the user typed already in it. One hook so every
// page does it identically — and so the event name lives in exactly one place.

import { useEffect, useState } from 'react';

export const QUICK_CREATE_EVENT = 'task-monitor:quick-create';

/**
 * @param {string} entity   'task' | 'project' | 'minute' | 'goal' | 'activity'
 * @param {(text: string) => void} onCreate  open your create flow, prefilled
 */
export function useQuickCreate(entity, onCreate) {
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.entity !== entity) return;
      onCreate(e.detail.text || '');
    };
    window.addEventListener(QUICK_CREATE_EVENT, handler);
    return () => window.removeEventListener(QUICK_CREATE_EVENT, handler);
  }, [entity, onCreate]);
}

/** Ask a page to open its create flow. Used by the command palette. */
export function requestQuickCreate(entity, text = '') {
  window.dispatchEvent(new CustomEvent(QUICK_CREATE_EVENT, { detail: { entity, text } }));
}

/**
 * The shape a seed travels in.
 *
 * `at` is what makes asking twice with the same words work: the consumer keys
 * on the OBJECT, so a second "new project Website revamp" refills the field
 * even though the text is identical. Written here rather than at each call
 * site, so the four of them cannot disagree about it.
 */
export function newSeed(text) {
  return { text: String(text ?? ''), at: Date.now() };
}

/**
 * Apply a seed exactly once, the moment it arrives.
 *
 * The render-phase state update is deliberate and is React's documented way to
 * adjust state when a prop changes — it re-renders before the browser paints,
 * so nothing flashes. An effect would show the empty field first.
 *
 *   useSeededField(seed, (text) => { setName(text); });
 */
export function useSeededField(seed, apply) {
  // `null`, not `seed`: a form that MOUNTS with a seed already set — which is
  // what happens when the editor is opened by the command itself — has to
  // apply it on that first render, not wait for a second one that never comes.
  const [seen, setSeen] = useState(null);
  if (seed && seen !== seed) {
    setSeen(seed);
    apply(seed.text || '');
  }
}
