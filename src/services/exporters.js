// src/services/exporters.js — turning what is on screen into a file somebody
// can send, print or open in Excel.
//
// Until now the only deliverables were CSV and a developer JSON dump, so a
// status report, a set of minutes or a task list could not leave the app in a
// form anyone would accept.
//
// Shape of this module:
//   * The libraries (docx, exceljs, jspdf) are DYNAMIC imports. They are large
//     and most sessions never export anything; loading them up front would cost
//     every user for a feature a few people use.
//   * Every file goes out through downloadFile(), so every name is
//     <name>-YYYY-MM-DD.<ext> in the user's own day.
//   * The document BUILDERS (toMarkdown, toHtml, sheetFromRows) are pure and
//     tested; only the byte-generation is left to the libraries.

import { downloadFile, safeFileName, stampedName } from './download';

/**
 * An error we raised on purpose, whose message is written for the user.
 * Anything else that escapes an export is a library's internal complaint and
 * must not be shown — hence the marker.
 */
export function exportError(message) {
  const err = new Error(message);
  err.code = 'export';
  return err;
}

/** Every format the app can hand a user, with a label for a menu. */
export const EXPORT_FORMATS = [
  { value: 'xlsx', label: 'Excel spreadsheet (.xlsx)', kinds: ['table'] },
  { value: 'csv',  label: 'CSV (.csv)',                kinds: ['table'] },
  { value: 'docx', label: 'Word document (.docx)',     kinds: ['document'] },
  { value: 'pdf',  label: 'PDF (.pdf)',                kinds: ['document', 'table'] },
  { value: 'md',   label: 'Markdown (.md)',            kinds: ['document'] },
  { value: 'html', label: 'Web page (.html)',          kinds: ['document'] },
  { value: 'txt',  label: 'Plain text (.txt)',         kinds: ['document'] },
];

export const formatsFor = (kind) => EXPORT_FORMATS.filter((f) => f.kinds.includes(kind));

/* ── the document model ────────────────────────────────────────────────────
   Everything exportable is described as a list of blocks, so one report can be
   rendered to six formats without six versions of the content. */

export const heading = (text, level = 1) => ({ type: 'heading', text: String(text ?? ''), level });
export const paragraph = (text) => ({ type: 'paragraph', text: String(text ?? '') });
export const bullets = (items) => ({ type: 'bullets', items: (items || []).map((i) => String(i ?? '')) });
export const table = (columns, rows) => ({ type: 'table', columns, rows: rows || [] });
export const keyValues = (pairs) => ({ type: 'keyValues', pairs: pairs || [] });
export const spacer = () => ({ type: 'spacer' });

const cell = (v) => (v === null || v === undefined ? '' : String(v));

/* ── Markdown ──────────────────────────────────────────────────────────── */

export function toMarkdown(doc) {
  const out = [];
  if (doc.title) out.push(`# ${doc.title}`, '');
  if (doc.subtitle) out.push(`_${doc.subtitle}_`, '');

  for (const block of doc.blocks || []) {
    switch (block.type) {
      case 'heading':
        out.push(`${'#'.repeat(Math.min(6, (block.level || 1) + 1))} ${block.text}`, '');
        break;
      case 'paragraph':
        if (block.text) out.push(block.text, '');
        break;
      case 'bullets':
        block.items.forEach((i) => out.push(`- ${i}`));
        if (block.items.length) out.push('');
        break;
      case 'keyValues':
        block.pairs.forEach(([k, v]) => out.push(`**${k}:** ${cell(v)}`, ''));
        break;
      case 'table': {
        if (!block.columns?.length) break;
        // Pipes inside a cell would break the table.
        const esc = (v) => cell(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
        out.push(`| ${block.columns.map(esc).join(' | ')} |`);
        out.push(`| ${block.columns.map(() => '---').join(' | ')} |`);
        block.rows.forEach((r) => out.push(`| ${r.map(esc).join(' | ')} |`));
        out.push('');
        break;
      }
      case 'spacer':
        out.push('');
        break;
      default:
        break;
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/* ── Plain text ────────────────────────────────────────────────────────── */

export function toPlainText(doc) {
  return toMarkdown(doc)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^_(.+)_$/gm, '$1');
}

/* ── HTML ──────────────────────────────────────────────────────────────── */

const escapeHtml = (v) => cell(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function toHtml(doc) {
  const body = [];
  if (doc.title) body.push(`<h1>${escapeHtml(doc.title)}</h1>`);
  if (doc.subtitle) body.push(`<p class="subtitle">${escapeHtml(doc.subtitle)}</p>`);

  for (const block of doc.blocks || []) {
    switch (block.type) {
      case 'heading':
        body.push(`<h${Math.min(6, (block.level || 1) + 1)}>${escapeHtml(block.text)}</h${Math.min(6, (block.level || 1) + 1)}>`);
        break;
      case 'paragraph':
        if (block.text) body.push(`<p>${escapeHtml(block.text)}</p>`);
        break;
      case 'bullets':
        if (block.items.length) {
          body.push(`<ul>${block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`);
        }
        break;
      case 'keyValues':
        body.push(`<dl>${block.pairs.map(([k, v]) =>
          `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`);
        break;
      case 'table':
        body.push(
          '<table><thead><tr>'
          + (block.columns || []).map((c) => `<th>${escapeHtml(c)}</th>`).join('')
          + '</tr></thead><tbody>'
          + block.rows.map((r) => `<tr>${r.map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')
          + '</tbody></table>',
        );
        break;
      default:
        break;
    }
  }

  // Self-contained: it has to open correctly from a Downloads folder, with no
  // network and no stylesheet to find.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.title || 'Export')}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         max-width: 820px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 26px; letter-spacing: -0.02em; margin-bottom: 4px; }
  .subtitle { color: #666; margin-top: 0; }
  h2 { font-size: 19px; margin-top: 32px; }
  h3 { font-size: 16px; margin-top: 24px; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 14px; }
  th, td { border: 1px solid #ddd; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; font-weight: 600; }
  dt { font-weight: 600; margin-top: 8px; }
  dd { margin: 0 0 4px; }
  @media print { body { margin: 0; max-width: none; } }
</style>
</head>
<body>
${body.join('\n')}
</body>
</html>
`;
}

/* ── Spreadsheet rows ──────────────────────────────────────────────────── */

/**
 * A worksheet description: a header row, body rows, and a sensible width per
 * column so nothing opens as `####`.
 */
export function sheetFromRows(name, columns, rows) {
  const widths = columns.map((c, i) => {
    const longest = rows.reduce((max, r) => Math.max(max, cell(r[i]).length), cell(c).length);
    return Math.min(60, Math.max(10, longest + 2));
  });
  return {
    // Excel refuses these characters in a sheet name, and caps it at 31 chars.
    name: (cell(name).replace(/[\\/?*[\]:]/g, '-').slice(0, 31)) || 'Sheet1',
    columns,
    rows,
    widths,
  };
}

/* ── Writers ───────────────────────────────────────────────────────────── */

async function writeXlsx(baseName, sheets) {
  const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Task Monitor';
  wb.created = new Date();

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    ws.addRow(sheet.columns);
    sheet.rows.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];       // header stays put
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: Math.max(1, sheet.columns.length) },
    };
    sheet.widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return downloadFile(baseName, 'xlsx', new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
}

async function writeDocx(baseName, doc) {
  const d = await import('docx');
  const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun, WidthType } = d;

  const children = [];
  if (doc.title) children.push(new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE }));
  if (doc.subtitle) {
    children.push(new Paragraph({ children: [new TextRun({ text: doc.subtitle, italics: true, color: '666666' })] }));
  }

  for (const block of doc.blocks || []) {
    switch (block.type) {
      case 'heading':
        children.push(new Paragraph({
          text: block.text,
          heading: block.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
        }));
        break;
      case 'paragraph':
        if (block.text) children.push(new Paragraph({ text: block.text }));
        break;
      case 'bullets':
        block.items.forEach((i) => children.push(new Paragraph({ text: i, bullet: { level: 0 } })));
        break;
      case 'keyValues':
        block.pairs.forEach(([k, v]) => children.push(new Paragraph({
          children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun({ text: cell(v) })],
        })));
        break;
      case 'table':
        children.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: (block.columns || []).map((c) => new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: cell(c), bold: true })] })],
              })),
            }),
            ...block.rows.map((r) => new TableRow({
              children: r.map((v) => new TableCell({ children: [new Paragraph(cell(v))] })),
            })),
          ],
        }));
        break;
      case 'spacer':
        children.push(new Paragraph(''));
        break;
      default:
        break;
    }
  }

  const document = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(document);
  return downloadFile(baseName, 'docx', blob);
}

async function writePdf(baseName, doc) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 48;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  let y = margin;

  const newPageIfNeeded = (needed) => {
    if (y + needed > pdf.internal.pageSize.getHeight() - margin) {
      pdf.addPage();
      y = margin;
    }
  };

  const text = (value, { size = 11, bold = false, gap = 6 } = {}) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(cell(value), width);
    newPageIfNeeded(lines.length * size * 1.3);
    pdf.text(lines, margin, y);
    y += lines.length * size * 1.3 + gap;
  };

  if (doc.title) text(doc.title, { size: 20, bold: true, gap: 4 });
  if (doc.subtitle) {
    pdf.setTextColor(110);
    text(doc.subtitle, { size: 10, gap: 14 });
    pdf.setTextColor(0);
  }

  for (const block of doc.blocks || []) {
    switch (block.type) {
      case 'heading':
        y += 8;
        text(block.text, { size: block.level === 1 ? 15 : 13, bold: true, gap: 4 });
        break;
      case 'paragraph':
        if (block.text) text(block.text);
        break;
      case 'bullets':
        block.items.forEach((i) => text(`•  ${i}`, { gap: 2 }));
        y += 4;
        break;
      case 'keyValues':
        block.pairs.forEach(([k, v]) => text(`${k}: ${cell(v)}`, { gap: 2 }));
        y += 4;
        break;
      case 'table':
        autoTable(pdf, {
          startY: y,
          margin: { left: margin, right: margin },
          head: [(block.columns || []).map(cell)],
          body: block.rows.map((r) => r.map(cell)),
          styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
          headStyles: { fillColor: [241, 243, 245], textColor: 20, fontStyle: 'bold' },
        });
        y = pdf.lastAutoTable.finalY + 16;
        break;
      case 'spacer':
        y += 10;
        break;
      default:
        break;
    }
  }

  return downloadFile(baseName, 'pdf', pdf.output('blob'));
}

/* ── The one entry point ───────────────────────────────────────────────── */

/**
 * Save a document in the chosen format.
 *
 * @param {'xlsx'|'csv'|'docx'|'pdf'|'md'|'html'|'txt'} format
 * @param {string} baseName  filename without date or extension
 * @param {{ title?, subtitle?, blocks?, sheets? }} doc
 * @returns {Promise<string>} the filename that was saved
 */
export async function exportDocument(format, baseName, doc) {
  const name = safeFileName(baseName);

  switch (format) {
    case 'md':   return downloadFile(name, 'md', toMarkdown(doc));
    case 'txt':  return downloadFile(name, 'txt', toPlainText(doc));
    case 'html': return downloadFile(name, 'html', toHtml(doc));
    case 'csv': {
      const { toCsv } = await import('./csv');
      const sheet = (doc.sheets || [])[0] || firstTableAsSheet(doc);
      if (!sheet) throw exportError('There is no table in this to save as a CSV.');
      return downloadFile(name, 'csv', toCsv([sheet.columns, ...sheet.rows]));
    }
    case 'xlsx': {
      const sheets = doc.sheets?.length ? doc.sheets : [firstTableAsSheet(doc)].filter(Boolean);
      if (!sheets.length) throw exportError('There is no table in this to save as a spreadsheet.');
      return writeXlsx(name, sheets);
    }
    case 'docx': return writeDocx(name, doc);
    case 'pdf':  return writePdf(name, doc);
    default:
      throw exportError(`Cannot save as “${format}”.`);
  }
}

/** A document whose content is one table can still be a spreadsheet. */
export function firstTableAsSheet(doc) {
  const t = (doc.blocks || []).find((b) => b.type === 'table');
  if (!t) return null;
  return sheetFromRows(doc.title || 'Export', t.columns, t.rows);
}

/** What the file will be called, for a confirmation message. */
export const exportFileName = (baseName, format) => stampedName(baseName, format);

/* ── Goals ─────────────────────────────────────────────────────────────────
   A goal is a one-page artefact: what changes, what gets delivered, by when,
   and how far along each project is. Kept here rather than in the component so
   the same structure feeds every format. */

/**
 * @param {object[]} goals
 * @param {{ projectStats?: Record<string, {name, pct, taskCount}>, deliverableProjectIds?: Function }} opts
 */
export function buildGoalsDocument(goals = [], opts = {}) {
  const stats = opts.projectStats || {};
  const idsOf = opts.deliverableProjectIds || ((d) => d?.projectIds || (d?.projectId ? [d.projectId] : []));
  const blocks = [];

  if (!goals.length) {
    blocks.push(paragraph('No goals have been set yet.'));
  }

  for (const goal of goals) {
    blocks.push(heading(`${goal.code ? `${goal.code} — ` : ''}${goal.title || 'Untitled goal'}`, 1));

    const facts = [];
    if (goal.initiative) facts.push(['Initiative', goal.initiative]);
    if (goal.kpi) facts.push(['KPI', goal.kpi]);
    // The target date lives on each deliverable, not on the goal.
    if (facts.length) blocks.push(keyValues(facts));

    const agenda = (goal.changeAgenda || []).filter((a) => a?.from || a?.to);
    if (agenda.length) {
      blocks.push(heading('Change agenda', 2));
      blocks.push(table(['From', 'To'], agenda.map((a) => [a.from || '—', a.to || '—'])));
    }

    const deliverables = (goal.deliverables || []).filter((d) => d?.text || idsOf(d).length);
    blocks.push(heading('Deliverables', 2));
    if (deliverables.length) {
      blocks.push(table(['#', 'Deliverable', 'Projects', 'Target', 'Progress'], deliverables.map((d, i) => {
        const linked = idsOf(d).map((pid) => stats[pid]).filter(Boolean);
        const pct = linked.length
          ? Math.round(linked.reduce((s, p) => s + (p.pct || 0), 0) / linked.length)
          : null;
        return [
          i + 1,
          d.text || '—',
          linked.map((p) => p.name).join(', ') || '—',
          d.targetDate || '—',
          pct === null ? '—' : `${pct}%`,
        ];
      })));
    } else {
      blocks.push(paragraph('No deliverables listed.'));
    }

    blocks.push(spacer());
  }

  const rows = [];
  for (const goal of goals) {
    for (const [i, d] of (goal.deliverables || []).entries()) {
      const linked = idsOf(d).map((pid) => stats[pid]).filter(Boolean);
      rows.push([
        goal.code || '',
        goal.title || '',
        i + 1,
        d.text || '',
        linked.map((p) => p.name).join(', '),
        linked.length ? Math.round(linked.reduce((s, p) => s + (p.pct || 0), 0) / linked.length) : '',
        d.targetDate || '',
        d.status || '',
      ]);
    }
  }

  return {
    title: 'Goals',
    subtitle: `${goals.length} goal${goals.length === 1 ? '' : 's'} · Task Monitor`,
    blocks,
    sheets: [sheetFromRows(
      'Goals',
      ['Goal code', 'Goal', '#', 'Deliverable', 'Projects', 'Progress %', 'Target date', 'Status'],
      rows,
    )],
  };
}
