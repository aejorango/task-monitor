// src/services/minutesExport.js — minutes as a document you can actually send.
//
// Meeting minutes are the classic thing somebody needs OUT of a tool: attendees,
// what was decided, who is doing what by when. Until now the only way to share
// them was a screenshot.

import { bullets, heading, keyValues, paragraph, sheetFromRows, table } from './exporters';

const clean = (v) => String(v ?? '').trim();

/** Attendees are typed as free text; split them however the user separated them. */
export function parseAttendees(raw) {
  return clean(raw)
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One line per action item, for the readable formats. */
export function actionLine(item) {
  const parts = [clean(item.text) || '(no description)'];
  if (clean(item.owner)) parts.push(`— ${clean(item.owner)}`);
  if (clean(item.due)) parts.push(`(due ${clean(item.due)})`);
  if (item.done) parts.push('✓ done');
  return parts.join(' ');
}

/**
 * @param {object} minute
 * @param {{ projectName?: string }} opts
 */
export function buildMinutesDocument(minute, { projectName } = {}) {
  const attendees = parseAttendees(minute?.attendees);
  const actions = (minute?.actionItems || []).filter((i) => clean(i.text));
  const mentions = (minute?.bossMentions || []).filter((x) => clean(x.text));
  const pushbacks = (minute?.bossPushbacks || []).filter((x) => clean(x.text));

  const blocks = [];

  const facts = [['Date', clean(minute?.date) || '—']];
  if (clean(minute?.location)) facts.push(['Location', clean(minute.location)]);
  if (projectName) facts.push(['Project', projectName]);
  facts.push(['Attendees', attendees.length ? attendees.join(', ') : 'Not recorded']);
  blocks.push(keyValues(facts));

  if (clean(minute?.notes)) {
    blocks.push(heading('Notes', 1));
    // Blank lines separate paragraphs; keep them as paragraphs, not one blob.
    clean(minute.notes).split(/\n{2,}/).forEach((p) => blocks.push(paragraph(p.replace(/\n/g, ' '))));
  }

  if (clean(minute?.decisions)) {
    blocks.push(heading('Decisions', 1));
    const lines = clean(minute.decisions).split('\n').map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
    blocks.push(lines.length > 1 ? bullets(lines) : paragraph(lines[0] || ''));
  }

  blocks.push(heading('Action items', 1));
  if (actions.length) {
    blocks.push(table(['Action', 'Owner', 'Due', 'Status'], actions.map((i) => [
      clean(i.text),
      clean(i.owner) || '—',
      clean(i.due) || '—',
      i.done ? 'Done' : 'Open',
    ])));
  } else {
    blocks.push(paragraph('No action items were recorded.'));
  }

  if (clean(minute?.bossName) || mentions.length || pushbacks.length) {
    blocks.push(heading(clean(minute?.bossName) ? `${clean(minute.bossName)} — points raised` : 'Points raised', 1));
    if (mentions.length) blocks.push(bullets(mentions.map((m) => clean(m.text))));
    if (pushbacks.length) {
      blocks.push(paragraph('Pushback:'));
      blocks.push(bullets(pushbacks.map((m) => clean(m.text))));
    }
  }

  return {
    title: clean(minute?.title) || 'Untitled meeting',
    subtitle: [clean(minute?.date), projectName].filter(Boolean).join(' · '),
    blocks,
    sheets: [sheetFromRows('Action items', ['Action', 'Owner', 'Due', 'Status'],
      actions.map((i) => [clean(i.text), clean(i.owner), clean(i.due), i.done ? 'Done' : 'Open']))],
  };
}

/** The filename base: minutes-<title>, stamped with the date by downloadFile. */
export function minutesFileBase(minute) {
  return `minutes-${clean(minute?.title) || 'meeting'}`;
}
