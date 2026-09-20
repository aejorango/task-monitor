// src/templates/gallery.js — ready-made processes.
//
// The app could already save a project as a template, which helps once you have
// built one. It did nothing for the first project on a blank account, where
// "add a project" means an empty box and a cursor.
//
// Each of these is a real process with its phases and a starting set of tasks,
// so somebody with a job to run can pick the nearest one and adjust, rather
// than invent the structure from nothing. Plain data — no ids, no dates, no
// counters — the same shape `projectAsTemplatePayload` produces.

/**
 * @typedef {{
 *   id, name, icon, summary, audience,
 *   phases: string[],
 *   tasks: { title, phase, description?, priority? }[]
 * }} ProcessTemplate
 */

/** @type {ProcessTemplate[]} */
export const TEMPLATE_GALLERY = [
  {
    id: 'client-project',
    name: 'Client project',
    icon: '◈',
    summary: 'Scope, build, review, hand over — the shape most client work takes.',
    audience: 'Agencies and consultants',
    phases: ['Discovery', 'Proposal', 'Delivery', 'Review', 'Handover'],
    tasks: [
      { title: 'Kick-off call with the client', phase: 'Discovery', priority: 'high',
        description: 'Agree what success looks like, who decides, and when.' },
      { title: 'Write the scope of work', phase: 'Discovery' },
      { title: 'Send the proposal', phase: 'Proposal', priority: 'high' },
      { title: 'Get the proposal signed', phase: 'Proposal', priority: 'high' },
      { title: 'Build the first draft', phase: 'Delivery' },
      { title: 'Internal review', phase: 'Review' },
      { title: 'Client review and changes', phase: 'Review' },
      { title: 'Hand over files and access', phase: 'Handover' },
      { title: 'Send the final invoice', phase: 'Handover', priority: 'high' },
    ],
  },
  {
    id: 'product-launch',
    name: 'Product launch',
    icon: '▲',
    summary: 'From "we are building this" to "people know about it".',
    audience: 'Product and marketing teams',
    phases: ['Plan', 'Build', 'Test', 'Launch', 'Follow-up'],
    tasks: [
      { title: 'Agree what ships and what does not', phase: 'Plan', priority: 'high' },
      { title: 'Set the launch date', phase: 'Plan', priority: 'high' },
      { title: 'Build the release', phase: 'Build' },
      { title: 'Write the release notes', phase: 'Build' },
      { title: 'Test on a real device', phase: 'Test', priority: 'high' },
      { title: 'Fix what testing found', phase: 'Test' },
      { title: 'Announce it', phase: 'Launch', priority: 'high' },
      { title: 'Watch for problems in the first week', phase: 'Follow-up' },
      { title: 'Write up what we learned', phase: 'Follow-up' },
    ],
  },
  {
    id: 'audit',
    name: 'Audit or review',
    icon: '◉',
    summary: 'Gather, examine, report, follow up on the findings.',
    audience: 'Compliance, internal audit, quality',
    phases: ['Preparation', 'Fieldwork', 'Reporting', 'Follow-up'],
    tasks: [
      { title: 'Agree the scope and the period', phase: 'Preparation', priority: 'high' },
      { title: 'Request the documents', phase: 'Preparation' },
      { title: 'Review the documents', phase: 'Fieldwork' },
      { title: 'Interview the people involved', phase: 'Fieldwork' },
      { title: 'Write up the findings', phase: 'Reporting', priority: 'high' },
      { title: 'Agree the findings with the owner', phase: 'Reporting' },
      { title: 'Issue the report', phase: 'Reporting', priority: 'high' },
      { title: 'Check the agreed actions were done', phase: 'Follow-up' },
    ],
  },
  {
    id: 'event',
    name: 'Event',
    icon: '✦',
    summary: 'Everything that has to be true before the doors open.',
    audience: 'Anyone running a meeting, workshop or conference',
    phases: ['Plan', 'Prepare', 'Run', 'Wrap up'],
    tasks: [
      { title: 'Set the date and the venue', phase: 'Plan', priority: 'high' },
      { title: 'Agree the budget', phase: 'Plan', priority: 'high' },
      { title: 'Confirm the speakers', phase: 'Prepare' },
      { title: 'Open registration', phase: 'Prepare' },
      { title: 'Prepare the materials', phase: 'Prepare' },
      { title: 'Run the event', phase: 'Run', priority: 'high' },
      { title: 'Thank everyone who took part', phase: 'Wrap up' },
      { title: 'Collect feedback', phase: 'Wrap up' },
      { title: 'Reconcile the budget', phase: 'Wrap up' },
    ],
  },
  {
    id: 'onboarding',
    name: 'New joiner',
    icon: '✿',
    summary: 'Everything a new person needs in their first month.',
    audience: 'Managers and operations',
    phases: ['Before they start', 'First week', 'First month'],
    tasks: [
      { title: 'Prepare the laptop and accounts', phase: 'Before they start', priority: 'high' },
      { title: 'Send the welcome note and first-day plan', phase: 'Before they start' },
      { title: 'Introduce them to the team', phase: 'First week', priority: 'high' },
      { title: 'Walk through how we work', phase: 'First week' },
      { title: 'Agree what good looks like at 30 days', phase: 'First week', priority: 'high' },
      { title: 'First one-to-one', phase: 'First week' },
      { title: '30-day check-in', phase: 'First month', priority: 'high' },
    ],
  },
  {
    id: 'blank',
    name: 'Start from scratch',
    icon: '◆',
    summary: 'An empty project with no phases and no tasks.',
    audience: 'When none of the above fits',
    phases: [],
    tasks: [],
  },
];

export const templateById = (id) => TEMPLATE_GALLERY.find((t) => t.id === id) || null;

/**
 * A gallery entry as the payload `addProject` + `addTask` want.
 * @param {ProcessTemplate} template
 * @param {{ name?: string, uid: () => string }} opts  `name` overrides the
 *   template's own; `uid` mints the phase ids (injected so this stays pure).
 */
export function templateToProject(template, { name, uid }) {
  if (!template) return null;
  const phases = (template.phases || []).map((phaseName, order) => ({
    id: uid(), name: phaseName, order,
  }));
  const byName = new Map(phases.map((p) => [p.name, p.id]));

  return {
    project: {
      name: (name || '').trim() || template.name,
      description: template.summary,
      icon: template.icon,
      phases,
    },
    tasks: (template.tasks || []).map((t) => ({
      title: t.title,
      description: t.description || '',
      priority: t.priority || 'medium',
      phaseId: byName.get(t.phase) || null,
    })),
  };
}

/** "5 phases · 9 tasks" — what a person is about to get. */
export function describeTemplate(template) {
  if (!template) return '';
  const phases = template.phases?.length || 0;
  const tasks = template.tasks?.length || 0;
  if (!phases && !tasks) return 'Empty';
  return [
    phases ? `${phases} phase${phases === 1 ? '' : 's'}` : null,
    tasks ? `${tasks} task${tasks === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');
}
