// The phone app's rules (src/services/mobileModel.js): what each screen counts,
// groups and claims. Pure, so it is tested without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, shortDate, bucketOf, triageCounts, priorityTask, needsYou, lateLabel, mobileStatus,
  hoursLeft, hoursLabel, filterTasks, groupTasks, weekStrip, workloadRows, reportFor,
  workLogDays, attachmentsOf, goalBreakdown, weightLabel, shiftPlan, taskCode, fileType,
  splitNames, joinNames, pastChoices, minuteDraft, minutePayload, minuteChanged,
  segmentNames, sortProjects, searchProjects, bySegment, NO_SEGMENT,
} from './mobileModel.js';
import { goalProgress } from './goalProgress.js';

const TODAY = '2026-07-20';
const at = (n) => addDays(TODAY, n);
const task = (o) => ({ status: 'todo', plan: {}, assignedTo: [], ...o });
const NONE = new Set();

test('a task falls in exactly one bucket: overdue, today, the next six days, later, done', () => {
  assert.equal(bucketOf(task({ plan: { endDate: at(-1) } }), TODAY), 'over');
  assert.equal(bucketOf(task({ plan: { endDate: TODAY } }), TODAY), 'today');
  assert.equal(bucketOf(task({ plan: { endDate: at(6) } }), TODAY), 'week');
  assert.equal(bucketOf(task({ plan: { endDate: at(7) } }), TODAY), 'later');
  // No due date is "nobody has said when", not "soon".
  assert.equal(bucketOf(task({}), TODAY), 'later');
  assert.equal(bucketOf(task({ status: 'done', plan: { endDate: at(-9) } }), TODAY), 'done');
});

test('Stuck is the desktop rule: a logged bottleneck, or open and past its date', () => {
  assert.equal(mobileStatus(task({ id: 'a', status: 'doing', plan: { endDate: at(-1) } }), NONE, TODAY), 'stuck');
  assert.equal(mobileStatus(task({ id: 'b', status: 'doing', plan: { endDate: at(2) } }), new Set(['b']), TODAY), 'stuck');
  assert.equal(mobileStatus(task({ id: 'c', status: 'doing', plan: { endDate: at(2) } }), NONE, TODAY), 'doing');
  assert.equal(mobileStatus(task({ id: 'd', status: 'review' }), NONE, TODAY), 'review');
  assert.equal(mobileStatus(task({ id: 'e', status: 'done', plan: { endDate: at(-5) } }), NONE, TODAY), 'done');
});

test('the Home tiles, the Priority card and Needs you agree with each other', () => {
  const tasks = [
    task({ id: 'late', plan: { endDate: at(-3) } }),
    task({ id: 'today', plan: { endDate: TODAY } }),
    task({ id: 'soon', plan: { endDate: at(2) } }),
    task({ id: 'gone', deleted: true, plan: { endDate: at(-1) } }),
    task({ id: 'shut', status: 'done', plan: { endDate: at(-1) } }),
  ];
  assert.deepEqual(triageCounts(tasks, { blockedIds: NONE, today: TODAY }), { over: 1, today: 1, stuck: 1, week: 1 });
  const hero = priorityTask(tasks, { blockedIds: NONE, today: TODAY });
  assert.equal(hero.id, 'late', 'stuck beats due today');
  const needs = needsYou(tasks, { blockedIds: NONE, today: TODAY, exclude: hero.id });
  assert.deepEqual(needs.map((t) => t.id), ['today'], 'the Priority card is not listed twice');
  assert.equal(priorityTask([task({ status: 'done' })], { today: TODAY }), null);
});

test('lateness and dates read the way the mockup prints them', () => {
  assert.equal(lateLabel(task({ plan: { endDate: at(-2) } }), TODAY), '2 days late');
  assert.equal(lateLabel(task({ plan: { endDate: at(-1) } }), TODAY), '1 day late');
  assert.equal(lateLabel(task({ plan: { endDate: TODAY } }), TODAY), 'Due today');
  assert.equal(shortDate(TODAY, TODAY), 'Today');
  assert.equal(shortDate(at(-1), TODAY), 'Yesterday');
  assert.equal(shortDate('2026-07-24', TODAY), 'Jul 24');
});

test('an unestimated task has no hours left, not zero — and its label says so', () => {
  assert.equal(hoursLeft(task({ estimateHours: null, totalHoursLogged: 3 })), null);
  assert.equal(hoursLeft(task({ estimateHours: 4, totalHoursLogged: 6 })), 0, 'never below zero');
  assert.equal(hoursLabel(task({ estimateHours: 12, totalHoursLogged: 8.5 })), '8.5/12h');
  assert.equal(hoursLabel(task({ estimateHours: null, totalHoursLogged: 2 })), '2h', 'not "2/0h"');
});

test('filters combine, and the Stuck filter finds what the list calls Stuck', () => {
  const tasks = [
    task({ id: 'a', projectId: 'p1', assignedTo: ['u1'], title: 'Ledger', plan: { endDate: at(-1) } }),
    task({ id: 'b', projectId: 'p2', assignedTo: ['u2'], title: 'Deck' }),
  ];
  const ids = (f) => filterTasks(tasks, { blockedIds: NONE, today: TODAY, ...f }).map((t) => t.id);
  assert.deepEqual(ids({}), ['a', 'b']);
  assert.deepEqual(ids({ projects: ['p2'] }), ['b']);
  assert.deepEqual(ids({ people: ['u1'] }), ['a']);
  assert.deepEqual(ids({ statuses: ['stuck'] }), ['a']);
  assert.deepEqual(ids({ q: 'deck' }), ['b']);
});

test('the List groups: buckets in order, empty ones dropped, every one starts folded', () => {
  const tasks = [
    task({ id: 'x', plan: { endDate: at(-1) }, estimateHours: 4, totalHoursLogged: 1 }),
    task({ id: 'y', plan: {} }),
    task({ id: 'z', status: 'done', totalHoursLogged: 2 }),
  ];
  const g = groupTasks(tasks, { by: 'due', blockedIds: NONE, today: TODAY });
  assert.deepEqual(g.map((x) => x.key), ['over', 'later', 'done']);
  assert.deepEqual(g.map((x) => x.defaultOpen), [false, false, false]);
  assert.equal(g[0].hoursLabel, '3h left');
  assert.equal(g[2].hoursLabel, '2h', 'Done counts what was logged');

  const byOwner = groupTasks([task({ id: 'o', assignedTo: ['u9'] })], { by: 'owner', members: ['u1'], today: TODAY });
  assert.equal(byOwner[0].key, 'w_none', 'someone outside the workspace still lands somewhere');
});

test('the Week strip runs either side of today, counting open work due on each', () => {
  const tasks = [task({ plan: { endDate: at(1) } }), task({ status: 'done', plan: { endDate: at(1) } }), task({ plan: { endDate: at(-3) } })];
  const week = weekStrip(tasks, TODAY);
  assert.equal(week.length, 7, 'the default is still seven days from today');
  assert.equal(week[0].ymd, TODAY);
  assert.equal(week[1].count, 1, 'done work is not counted');

  const wide = weekStrip(tasks, TODAY, { before: 10, after: 20 });
  assert.equal(wide.length, 31);
  assert.equal(wide[10].ymd, TODAY);
  assert.equal(wide[7].count, 1, 'a day before today counts too');
  assert.equal(wide[0].month, 'JUL', 'the first day names its month');
  assert.equal(wide.find((d) => d.ymd === '2026-08-01').month, 'AUG', 'and so does the 1st');
  assert.equal(wide[11].month, null);
});

test('Team load counts the work nobody estimated instead of hiding it', () => {
  const [row] = workloadRows([
    task({ assignedTo: ['u1'], estimateHours: 35, totalHoursLogged: 0 }),
    task({ assignedTo: ['u1'], estimateHours: null }),
  ], ['u1']);
  assert.equal(row.hours, 35);
  assert.equal(row.pct, 100);
  assert.equal(row.unestimated, 1);
  assert.equal(row.tone, 'amber');
});

test('a report covers exactly its period and adds up', () => {
  const activities = [
    { id: '1', date: TODAY, hoursSpent: 2, projectId: 'p1' },
    { id: '2', date: at(-6), hoursSpent: 1.5, projectId: 'p2' },
    { id: '3', date: at(-7), hoursSpent: 9, projectId: 'p1' },
    { id: '4', date: TODAY, hoursSpent: 5, projectId: 'p1', deleted: true },
  ];
  const r = reportFor('Week', { activities, tasks: [], projects: [{ id: 'p1' }, { id: 'p2' }], blockedIds: NONE, today: TODAY });
  assert.equal(r.since, at(-6));
  assert.equal(r.total, 3.5);
  assert.deepEqual(r.rows.map((x) => [x.project.id, x.hours]), [['p1', 2], ['p2', 1.5]]);
  const days = workLogDays(activities.filter((a) => !a.deleted), { since: r.since, today: TODAY });
  assert.deepEqual(days.map((d) => d.label), ['Today', 'Jul 14']);
});

test('artifacts are the files on activities, typed by extension', () => {
  const files = attachmentsOf([{ id: 'a', attachments: [{ name: 'deck.pdf', url: 'u', size: 10 }, { url: 'https://x.test/doc' }] }]);
  assert.deepEqual(files.map((f) => f.type), ['PDF', 'LINK']);
  assert.equal(fileType({ name: 'notes' }), 'FILE');
});

test("a goal's rows add up to the goal's own percentage", () => {
  const stats = { p1: { id: 'p1', name: 'A', pct: 60 }, p2: { id: 'p2', name: 'B', pct: 38 } };
  const goal = { deliverables: [{ projectIds: ['p1'] }, { projectIds: ['p1', 'p2'] }, { projectIds: [] }] };
  const g = goalBreakdown(goal, stats);
  const sum = g.rows.reduce((n, r) => n + r.contrib, 0);
  assert.equal(g.pct, goalProgress(goal, stats).pct);
  assert.ok(Math.abs(sum - g.pct) <= 1, `${sum} ≈ ${g.pct}`);
  assert.equal(weightLabel(0.25), '1/4');
  // Nothing linked is "nothing to measure", never 0%.
  assert.equal(goalBreakdown({ deliverables: [{ projectIds: [] }] }, stats).pct, null);
});

test('+1 day moves the whole plan and leaves an undated task alone', () => {
  assert.deepEqual(shiftPlan(task({ plan: { startDate: at(0), endDate: at(2) } }), 1), { 'plan.endDate': at(3), 'plan.startDate': at(1) });
  assert.deepEqual(shiftPlan(task({ plan: { endDate: at(2) } }), -1), { 'plan.endDate': at(1) });
  assert.equal(shiftPlan(task({}), 1), null);
});

test('the task code is the one the desktop editor prints', () => {
  assert.equal(taskCode({ id: 'abc123xyz' }), 'TASK ABC123');
});

test('attendees are names: split forgivingly, joined without duplicates', () => {
  assert.deepEqual(splitNames('Ace Jorango, Mia;  Raf\n'), ['Ace Jorango', 'Mia', 'Raf']);
  assert.equal(joinNames(['Mia', 'mia', ' Ace ', '']), 'Mia, Ace');
});

test('a meeting date is today or the week before it, never the future', () => {
  const c = pastChoices(TODAY);
  assert.equal(c.length, 7);
  assert.deepEqual([c[0].label, c[1].label], ['Today', 'Yesterday']);
  assert.ok(c.every((x) => x.ymd <= TODAY));
});

test('the phone editor keeps the desktop shape, both ways', () => {
  let n = 0;
  const newId = () => `n${(n += 1)}`;
  const fresh = minuteDraft(null, { today: TODAY, projectId: 'p1', newId });
  assert.equal(fresh.date, TODAY);
  assert.equal(fresh.projectId, 'p1', 'a new minute starts in the filtered project');
  assert.equal(fresh.actionItems.length, 1);

  const saved = minuteDraft({
    title: 'Sync', actionItems: [{ id: 'a', text: 'Do it', owner: 'Mia', taskId: 't9' }], bossMentions: [{ text: 'Ship' }],
  }, { today: TODAY, newId });
  assert.equal(saved.actionItems[0].taskId, 't9', 'a link to a task survives the round trip');
  assert.ok(saved.bossMentions[0].id, 'every line gets an id');

  const out = minutePayload({
    ...fresh, title: '  Retro ', projectId: '',
    actionItems: [
      { id: 'x', text: '', owner: '', due: '', done: false, taskId: null },
      { id: 'y', text: '', owner: '', due: '', done: false, taskId: 't1' },
      { id: 'z', text: ' Ship ', owner: ' Raf ', due: '', done: false, taskId: null },
    ],
    bossMentions: [{ id: 'm', text: ' ' }], bossPushbacks: [{ id: 'k', text: 'No SSO' }],
  });
  assert.equal(out.title, 'Retro');
  assert.equal(out.projectId, null);
  assert.deepEqual(out.actionItems.map((x) => x.id), ['y', 'z'], 'blank items go; a linked one stays');
  assert.equal(out.actionItems[1].owner, 'Raf');
  assert.deepEqual(out.bossMentions, []);
  assert.equal(out.bossPushbacks.length, 1);

  assert.equal(minuteChanged(fresh, { ...fresh }), false);
  assert.equal(minuteChanged(fresh, { ...fresh, title: 'x' }), true);
});

test('projects divide into the workspace\'s segments, Uncategorized last', () => {
  const ws = { segments: [{ name: 'Sales' }, { name: 'Finance' }] };
  const projects = [{ id: 'a', segment: 'Finance' }, { id: 'b' }, { id: 'c', segment: 'Legacy' }];
  const names = segmentNames(ws, projects);
  assert.deepEqual(names, ['Finance', 'Legacy', 'Sales', NO_SEGMENT], 'a segment only a project carries still shows');
  const rows = projects.map((project) => ({ project, pct: 0 }));
  assert.deepEqual(bySegment(rows, names).map((g) => [g.segment, g.rows.length]), [['Finance', 1], ['Legacy', 1], [NO_SEGMENT, 1]],
    'an empty segment is not drawn');
});

test('the Projects sort and search', () => {
  const rows = [
    { project: { name: 'Beta', description: 'payments' }, pct: 50, end: '2026-09-01' },
    { project: { name: 'alpha' }, pct: 10, end: null },
    { project: { name: 'Gamma' }, pct: 10, end: '2026-08-01' },
  ];
  const names = (r) => r.map((x) => x.project.name);
  assert.deepEqual(names(sortProjects(rows, 'health')), ['Beta', 'alpha', 'Gamma'], 'health keeps the rated order');
  assert.deepEqual(names(sortProjects(rows, 'name')), ['alpha', 'Beta', 'Gamma']);
  assert.deepEqual(names(sortProjects(rows, 'progress')), ['alpha', 'Gamma', 'Beta']);
  assert.deepEqual(names(sortProjects(rows, 'due')), ['Gamma', 'Beta', 'alpha'], 'no finish date goes last');
  assert.deepEqual(names(searchProjects(rows, 'PAY')), ['Beta'], 'search reads the description too');
  assert.equal(searchProjects(rows, '  ').length, 3);
});
