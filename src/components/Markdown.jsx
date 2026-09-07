// src/components/Markdown.jsx — minimal Markdown renderer + paired editor.
// Supports the subset that matters for task / project descriptions:
//   #, ##, ###      → h3/h4/h5 (we never go bigger than h3 inside content)
//   **bold**        → <strong>
//   *italic*        → <em>
//   `code`          → <code>
//   [text](url)     → <a>
//   - item / * item → <ul><li>
//   1. item         → <ol><li>
//   > quote         → <blockquote>
//   ---             → <hr>
//   ```lang …```    → <pre><code>
//   | a | b |       → <table> (GitHub pipe tables, with an optional
//   |---|---|         alignment row; cells are inline-rendered)
//   line breaks: blank line splits paragraphs, single newline stays inline
//
// Sanitization: HTML tags are escaped before any inline parsing, so the only
// HTML we emit is what this renderer produces.

import { useState } from 'react';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(s) {
  let out = escapeHtml(s);
  // code (must run before others so contents aren't double-formatted)
  out = out.replace(/`([^`]+)`/g, (_, m) => `<code>${m}</code>`);
  // links [text](url) — only http(s)/mailto/relative
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    const safe = /^(https?:|mailto:|\/|#|task-monitor)/i.test(url);
    return safe
      ? `<a href="${url}" target="_blank" rel="noreferrer noopener">${text}</a>`
      : escapeHtml(text);
  });
  // @-mentions: render the token as a pill. Matches @ followed by 4+ word
  // characters (sufficient to avoid colliding with email addresses, which
  // would be matched by escapeHtml-preserved & here is irrelevant since
  // the @ would be preceded by alphanum, not whitespace/start-of-string).
  out = out.replace(/(^|[\s(])@([\w.\-]{3,40})/g, '$1<span class="mention">@$2</span>');
  // bold
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // italic (single asterisks, not preceded/followed by another *)
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
  return out;
}

// A pipe-table row → its cells. Leading/trailing pipes are optional, and an
// escaped \| stays literal.
function splitRow(line) {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return body.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}
const isTableRow    = (l) => /\|/.test(l) && /\S/.test(l);
// The separator row is what makes a table a table: |---|:--:|
const isTableDivider = (l) => /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(l);
const alignOf = (cell) => {
  const c = cell.trim();
  if (c.startsWith(':') && c.endsWith(':')) return 'center';
  if (c.endsWith(':')) return 'right';
  return null;
};

export function renderMarkdown(src) {
  if (!src) return '';
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  let para = [];

  const flushPara = () => {
    if (para.length === 0) return;
    html.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line → paragraph break
    if (trimmed === '') {
      flushPara();
      i++; continue;
    }

    // Fenced code block — content is escaped, never inline-parsed.
    const fence = trimmed.match(/^(```+|~~~+)\s*([\w+-]*)\s*$/);
    if (fence) {
      flushPara();
      const marker = fence[1][0].repeat(3);
      const lang = fence[2];
      const body = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker}+\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++;   // consume the closing fence (or fall off the end)
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      html.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    // Horizontal rule. Checked after the table branch's divider so a real
    // table separator is never mistaken for a rule.
    if (/^---+\s*$/.test(trimmed) && !(isTableRow(trimmed) && isTableDivider(trimmed))) {
      flushPara();
      html.push('<hr>');
      i++; continue;
    }

    // Pipe table: a header row followed by a |---|---| divider.
    if (isTableRow(trimmed) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushPara();
      const head = splitRow(trimmed);
      const aligns = splitRow(lines[i + 1]).map(alignOf);
      i += 2;
      const body = [];
      while (i < lines.length && isTableRow(lines[i]) && lines[i].includes('|')) {
        body.push(splitRow(lines[i]));
        i++;
      }
      const cell = (tag, text, n) => {
        const a = aligns[n] ? ` style="text-align:${aligns[n]}"` : '';
        return `<${tag}${a}>${renderInline(text ?? '')}</${tag}>`;
      };
      const thead = `<thead><tr>${head.map((h, n) => cell('th', h, n)).join('')}</tr></thead>`;
      const tbody = body.length
        ? `<tbody>${body.map((r) =>
            // Pad/trim every row to the header width so a ragged row from the
            // model cannot break the column grid.
            `<tr>${head.map((_, n) => cell('td', r[n], n)).join('')}</tr>`).join('')}</tbody>`
        : '';
      html.push(`<div class="markdown-table-wrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    // Heading
    const h = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushPara();
      const level = Math.min(h[1].length + 2, 5); // # → h3, ## → h4, ### → h5
      html.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
      i++; continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      flushPara();
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        block.push(lines[i].trim().slice(2));
        i++;
      }
      html.push(`<blockquote>${renderInline(block.join(' '))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[*-]\s+/.test(trimmed)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^[*-]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[*-]\s+/, ''));
        i++;
      }
      html.push(`<ul>${items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      html.push(`<ol>${items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</ol>`);
      continue;
    }

    // Regular paragraph text
    para.push(trimmed);
    i++;
  }
  flushPara();
  return html.join('');
}

export default function Markdown({ src, className = 'markdown' }) {
  if (!src) return null;
  // eslint-disable-next-line react/no-danger
  return <div className={className} dangerouslySetInnerHTML={{ __html: renderMarkdown(src) }} />;
}

// Editor: textarea + live preview toggle.
export function MarkdownEditor({ value, onChange, rows = 4, placeholder = '' }) {
  const [mode, setMode] = useState('edit'); // 'edit' | 'preview'
  return (
    <div className="markdown-editor">
      <div className="markdown-toolbar">
        <button
          type="button"
          className={`markdown-tab ${mode === 'edit' ? 'active' : ''}`}
          onClick={() => setMode('edit')}
        >Write</button>
        <button
          type="button"
          className={`markdown-tab ${mode === 'preview' ? 'active' : ''}`}
          onClick={() => setMode('preview')}
        >Preview</button>
        <span className="muted small" style={{ marginLeft: 'auto' }}>
          Markdown supported: **bold**, *italic*, [link](url), lists, tables, `code`, &gt; quote, ---
        </span>
      </div>
      {mode === 'edit' ? (
        <textarea
          className="textarea markdown-textarea"
          rows={rows}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <div className="markdown-preview">
          {value
            ? <Markdown src={value} />
            : <p className="muted small">Nothing to preview yet.</p>}
        </div>
      )}
    </div>
  );
}
