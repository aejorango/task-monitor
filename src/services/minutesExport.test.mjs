// T-0047 / MISS-004 — minutes as a shareable document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionLine, buildMinutesDocument, minutesFileBase, parseAttendees } from './minutesExport.js';
import { toMarkdown } from './exporters.js';

const MINUTE = {
  title: 'Weekly sync',
  date: '2026-09-18',
  location: 'Meeting room 2',
  attendees: 'Ace, Sam; Jordan\nPat',
  notes: 'We went through the rollout.\n\nThe bank is still slow.',
  decisions: '- Ship phase 3 on Friday\n- Escalate the bank',
  actionItems: [
    { id: 'a', text: 'Chase the bank', owner: 'Ace', due: '2026-09-22', done: false },
    { id: 'b', text: 'Draft the release note', owner: 'Sam', due: '', done: true },
    { id: 'c', text: '   ' },
  ],
  bossName: 'Director',
  bossMentions: [{ text: 'Wants weekly numbers' }, { text: '' }],
  bossPushbacks: [{ text: 'Not happy with the timeline' }],
};

test('attendees split however they were typed', () => {
  assert.deepEqual(parseAttendees('Ace, Sam; Jordan\nPat'), ['Ace', 'Sam', 'Jordan', 'Pat']);
  assert.deepEqual(parseAttendees('  '), []);
  assert.deepEqual(parseAttendees(null), []);
});

test('the document carries every part of the meeting', () => {
  const md = toMarkdown(buildMinutesDocument(MINUTE, { projectName: 'SBLAF rollout' }));
  assert.match(md, /^# Weekly sync/m);
  assert.match(md, /\*\*Date:\*\* 2026-09-18/);
  assert.match(md, /\*\*Location:\*\* Meeting room 2/);
  assert.match(md, /\*\*Project:\*\* SBLAF rollout/);
  assert.match(md, /\*\*Attendees:\*\* Ace, Sam, Jordan, Pat/);
  assert.match(md, /## Notes/);
  assert.match(md, /## Decisions/);
  assert.match(md, /- Ship phase 3 on Friday/);
  assert.match(md, /## Action items/);
  assert.match(md, /Chase the bank/);
});

test('notes keep their paragraphs instead of becoming one blob', () => {
  const doc = buildMinutesDocument(MINUTE);
  const notesIdx = doc.blocks.findIndex((b) => b.type === 'heading' && b.text === 'Notes');
  assert.equal(doc.blocks[notesIdx + 1].text, 'We went through the rollout.');
  assert.equal(doc.blocks[notesIdx + 2].text, 'The bank is still slow.');
});

test('action items become a table with owner, due and status', () => {
  const doc = buildMinutesDocument(MINUTE);
  const t = doc.blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.columns, ['Action', 'Owner', 'Due', 'Status']);
  assert.equal(t.rows.length, 2, 'the blank item is dropped');
  assert.deepEqual(t.rows[0], ['Chase the bank', 'Ace', '2026-09-22', 'Open']);
  assert.deepEqual(t.rows[1], ['Draft the release note', 'Sam', '—', 'Done']);
});

test('the spreadsheet is the action list — the part people track', () => {
  const doc = buildMinutesDocument(MINUTE);
  assert.equal(doc.sheets[0].name, 'Action items');
  assert.equal(doc.sheets[0].rows.length, 2);
});

test('points raised are attributed to the person who raised them', () => {
  const md = toMarkdown(buildMinutesDocument(MINUTE));
  assert.match(md, /## Director — points raised/);
  assert.match(md, /- Wants weekly numbers/);
  assert.match(md, /Pushback:/);
  assert.match(md, /- Not happy with the timeline/);
  assert.doesNotMatch(md, /^- $/m, 'the empty mention is dropped');
});

test('a sparse minute still produces a sensible document', () => {
  const md = toMarkdown(buildMinutesDocument({ title: '', date: '' }));
  assert.match(md, /^# Untitled meeting/m);
  assert.match(md, /\*\*Date:\*\* —/);
  assert.match(md, /\*\*Attendees:\*\* Not recorded/);
  assert.match(md, /No action items were recorded/);
  assert.doesNotMatch(md, /undefined|null/);
});

test('a single decision is a sentence, not a one-item bullet list', () => {
  const doc = buildMinutesDocument({ ...MINUTE, decisions: 'Ship it' });
  const idx = doc.blocks.findIndex((b) => b.type === 'heading' && b.text === 'Decisions');
  assert.equal(doc.blocks[idx + 1].type, 'paragraph');
});

test('an action line reads as a sentence', () => {
  assert.equal(actionLine({ text: 'Chase the bank', owner: 'Ace', due: '2026-09-22' }),
    'Chase the bank — Ace (due 2026-09-22)');
  assert.equal(actionLine({ text: 'Done thing', done: true }), 'Done thing ✓ done');
  assert.equal(actionLine({}), '(no description)');
});

test('the filename is built from the title and stays safe', () => {
  assert.equal(minutesFileBase(MINUTE), 'minutes-Weekly sync');
  assert.equal(minutesFileBase({}), 'minutes-meeting');
});
