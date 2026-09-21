// src/components/AiOperatorHint.jsx — the runbook, for the person who can run it.
//
// An AI result can come back degraded — placeholder text because nothing is
// connected, an ungrounded answer, a failed bridge. The `reason` on that result
// is written for whoever is reading the screen; `operatorHint` is the shell
// commands and the Settings section that would fix it, and it is shown only to
// an operator. Both used to be the same string, so npm commands were rendered
// verbatim into answers for every user (BUG-028).
//
// The same split `knowledgeCopy(status, { isOperator })` already makes.

import { useAuth } from '../hooks/useTasks';
import { useIsOperator } from '../hooks/useUserProfile';

export default function AiOperatorHint({ hint }) {
  const { userId } = useAuth();
  const { isOperator } = useIsOperator(userId);
  if (!hint || !isOperator) return null;
  return (
    <p className="muted small" style={{ marginTop: 6 }}>
      <strong>Operator:</strong> {hint}
    </p>
  );
}
