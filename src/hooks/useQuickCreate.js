// src/hooks/useQuickCreate.js — the receiving end of ⌘K's "New …".
//
// The palette navigates to the page that owns the thing, then fires
// `task-monitor:quick-create`. Each page listens for its own entity and opens
// its create flow with whatever the user typed already in it. One hook so every
// page does it identically — and so the event name lives in exactly one place.

import { useEffect } from 'react';

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
