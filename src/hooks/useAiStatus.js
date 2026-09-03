// src/hooks/useAiStatus.js — subscribe a component to the live AI provider.
//
// Detection is async (it probes the local Claude Code bridge), so components
// that gate UI on "is AI available" read it through this hook: the first
// render gets the optimistic answer, and the re-render lands with the truth.

import { useEffect, useState, useCallback } from 'react';
import {
  aiStatus, subscribeAiStatus, detectProvider, recheckProvider, recheckBridge,
} from '../services/ai';

export function useAiStatus() {
  const [status, setStatus] = useState(aiStatus);

  useEffect(() => {
    const unsub = subscribeAiStatus(setStatus);
    // Kick a probe on mount, then let the 60s cache do the rest. Logging into
    // the CLI while the app is open is picked up here or via recheck().
    detectProvider().then(() => setStatus(aiStatus()));
    return unsub;
  }, []);

  const recheck = useCallback(async () => {
    try { await recheckBridge(); }        // asks the bridge to re-probe the CLI
    catch { await recheckProvider(); }    // bridge down: just re-detect locally
    setStatus(aiStatus());
    return aiStatus();
  }, []);

  return { ...status, recheck };
}
