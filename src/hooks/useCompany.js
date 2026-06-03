// src/hooks/useCompany.js
// Wires the signed-in user's company → the Anthropic client.
//
// Flow:
//   1. We watch the user's profile for a `companyId`.
//   2. When set, we subscribe to companies/{companyId} and push the company's
//      Anthropic API key + model into the anthropic module's in-memory cache.
//   3. When unset (or company missing), we clear the cache so AI falls back
//      to the user's personal localStorage key (superadmin / legacy path).
//
// All AI callers go through getEffectiveApiKey() / getEffectiveModel() in
// services/anthropic.js, so they automatically pick up the company context.

import { useEffect, useState } from 'react';
import {
  subscribeToCompany,
  subscribeToCompanies,
} from '../services/firebase';
import {
  setCurrentCompanyContext,
  clearCurrentCompanyContext,
} from '../services/anthropic';

// Sync the AI client with the current user's company. Returns the resolved
// company doc (or null) so callers can show contextual UI.
export function useMyCompany(profile) {
  const companyId = profile?.companyId || null;
  const [company, setCompany] = useState(null);

  useEffect(() => {
    if (!companyId) {
      clearCurrentCompanyContext();
      return;
    }
    const unsub = subscribeToCompany(companyId, (c) => {
      setCompany(c);
      if (c) {
        setCurrentCompanyContext({
          id: c.id,
          name: c.name,
          apiKey: c.anthropicApiKey || '',
          model:  c.anthropicModel  || '',
        });
      } else {
        clearCurrentCompanyContext();
      }
    });
    return () => {
      unsub();
      // Don't clear on unmount alone — the user might just be navigating
      // between views; we only clear when companyId itself goes away above.
    };
  }, [companyId]);

  // Derive null when there's no companyId so we never carry stale state
  // forward after the user becomes unassigned. (Avoids a synchronous
  // setCompany(null) inside the effect body.)
  return { company: companyId ? company : null };
}

// Superadmin-only: list every company in the system (for the management UI).
// Returns an array of company docs (sorted by name) and a loading flag.
//
// When `enabled` is false, we skip the subscription entirely and surface
// derived empty values. This avoids a synchronous setState in the effect
// body (react-hooks/set-state-in-effect rule).
export function useAllCompanies(enabled) {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(!!enabled);

  useEffect(() => {
    if (!enabled) return;
    const unsub = subscribeToCompanies((list) => {
      setCompanies(list);
      setLoading(false);
    });
    return () => unsub();
  }, [enabled]);

  return enabled ? { companies, loading } : { companies: [], loading: false };
}
