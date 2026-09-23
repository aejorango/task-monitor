// src/components/AutomationsView.jsx — Dashboard → Automations (T-0144).
//
// The Dashboard Explorer gives automations a page of their own, and it is
// right to: they were the last section of a very long Settings scroll, which
// is a poor home for the thing that silently changes your data at 2am.
//
// The page is a thin frame around `AutomationsSection` — the rule list, the
// dropdown editor, the run log and the notices. That component already owns
// the vocabulary (it imports TRIGGERS / ACTIONS from the runner's own module,
// so a form can never offer a rule the runner will not run), so this file
// adds the page chrome and nothing else. Copying any of its logic up here
// would be the second vocabulary CLAUDE.md warns about.

import { useMemo } from 'react';
import { useAuth } from '../hooks/useTasks';
import { useActiveWorkspaceId, useWorkspaces } from '../hooks/useWorkspace';
import { PageActions, PageSubtitle } from './PageHeader';
import AutomationsSection from './AutomationsSection';

export default function AutomationsView({ navigate }) {
  const { userId } = useAuth();
  const { workspaces } = useWorkspaces();
  const activeWsId = useActiveWorkspaceId();
  const workspace = workspaces.find((w) => w.id === activeWsId);

  // Only an owner or admin may write a rule; everyone else reads. The same
  // test Settings used — `firestore.rules` is the real enforcement, this only
  // decides whether the editor is offered.
  const isAdmin = useMemo(() => {
    const role = workspace?.acl?.[userId];
    return role === 'owner' || role === 'admin';
  }, [workspace, userId]);

  return (
    <>
      <PageSubtitle>
        When something happens in {workspace?.name || 'this workspace'}, do this —{' '}
        {isAdmin ? 'you can add and edit rules' : 'read-only for your role'}
      </PageSubtitle>
      <PageActions>
        <button className="cmd" onClick={() => navigate?.({ view: 'analytics' })}>
          Monitoring
        </button>
      </PageActions>

      <AutomationsSection userId={userId} isAdmin={isAdmin} />
    </>
  );
}
