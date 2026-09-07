// src/hooks/useKnowledgeStatus.js — "is the knowledge base usable, and which
// notebooks are there?" in one hook.
//
// Same shape and same discipline as useAiStatus: every consumer shares one
// probe, the first render gets the last known answer, and a re-render lands
// with the truth. Gate knowledge UI on `available` — never on an API key,
// because the CLI needs none.

import { useCallback, useEffect, useState } from 'react';
import {
  knowledgeState, subscribe, fetchKnowledgeStatus, refreshKnowledge,
} from '../services/knowledge';

export function useKnowledgeStatus() {
  const [state, setState] = useState(knowledgeState);

  useEffect(() => {
    const unsub = subscribe(setState);
    // Kick a probe on mount; the 60 s cache means extra mounts are free.
    fetchKnowledgeStatus().then(setState).catch(() => {});
    return unsub;
  }, []);

  const recheck = useCallback(async () => {
    const next = await refreshKnowledge();
    setState(next);
    return next;
  }, []);

  return {
    available: state.available,
    cliFound: state.cliFound,
    authenticated: state.authenticated,
    bridgeOk: state.bridgeOk,
    hint: state.hint,
    notebooks: state.notebooks,
    error: state.error,
    loading: state.loading,
    probed: state.probed,
    recheck,
  };
}

export default useKnowledgeStatus;
