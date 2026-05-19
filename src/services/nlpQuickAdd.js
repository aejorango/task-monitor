// src/services/nlpQuickAdd.js — parse a free-text quick-add string into
// structured task fields.
//
// Supported syntax (any order, anywhere in the string):
//   "draft proposal next Friday !urgent #client @mark"
//   "ship beta tomorrow !high #release @alex"
//   "review PR in 3 days"
//   "kickoff on 2026-06-01 !low"
//
// Tokens consumed:
//   !urgent / !high / !low / !p0..!p3 → priority
//   #tag                              → adds to tags
//   @name                             → requestedBy
//   today / tomorrow / yesterday      → plan.endDate
//   next <weekday>                    → plan.endDate (next occurrence)
//   <weekday>                         → plan.endDate (next occurrence)
//   in N day(s) / week(s) / month(s)  → plan.endDate (today + N units)
//   on YYYY-MM-DD / by YYYY-MM-DD     → plan.endDate
//   MM/DD or MM/DD/YYYY               → plan.endDate
//
// Everything else stays in the `title`. Returns:
//   { title, priority?, tags: [], requestedBy?, plan: { endDate? }, tokens: [{kind, raw, value}] }

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_RE = WEEKDAYS.join('|');

function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function nextWeekday(target, fromDate = new Date(), forceNext = false) {
  const today = fromDate.getDay();
  let delta = (target - today + 7) % 7;
  if (delta === 0) delta = forceNext ? 7 : 0;
  return addDays(fromDate, delta);
}

export function parseQuickAdd(input) {
  let s = String(input || '');
  const tokens = [];
  const result = {
    title: '',
    priority: null,
    tags: [],
    requestedBy: '',
    plan: {},
  };

  // 1. Priority: !urgent !high !med !low !p0..!p3
  s = s.replace(/!\s*(urgent|high|hi|p0|p1)\b/gi, (m) => {
    result.priority = 'high';
    tokens.push({ kind: 'priority', raw: m.trim(), value: 'high' });
    return ' ';
  });
  s = s.replace(/!\s*(low|lo|p3)\b/gi, (m) => {
    result.priority = 'low';
    tokens.push({ kind: 'priority', raw: m.trim(), value: 'low' });
    return ' ';
  });
  s = s.replace(/!\s*(med|medium|p2)\b/gi, (m) => {
    result.priority = 'medium';
    tokens.push({ kind: 'priority', raw: m.trim(), value: 'medium' });
    return ' ';
  });

  // 2. Tags: #foo
  s = s.replace(/#([\w-]+)/g, (m, t) => {
    result.tags.push(t);
    tokens.push({ kind: 'tag', raw: m, value: t });
    return ' ';
  });

  // 3. Requested by: @name (capture until whitespace; allow dot/dash/underscore)
  s = s.replace(/@([A-Za-z][\w.\-]{0,30})/g, (m, name) => {
    // If multiple @s, last one wins; collect all into a comma list.
    result.requestedBy = result.requestedBy ? `${result.requestedBy}, ${name}` : name;
    tokens.push({ kind: 'requestedBy', raw: m, value: name });
    return ' ';
  });

  // 4. Dates — try most specific patterns first.
  const today = new Date();

  // "on YYYY-MM-DD" / "by YYYY-MM-DD"
  s = s.replace(/\b(on|by|due)\s+(\d{4}-\d{2}-\d{2})\b/gi, (m, _, ymd) => {
    result.plan.endDate = ymd;
    tokens.push({ kind: 'date', raw: m, value: ymd });
    return ' ';
  });

  // standalone YYYY-MM-DD
  if (!result.plan.endDate) {
    s = s.replace(/\b(\d{4}-\d{2}-\d{2})\b/, (m, ymd) => {
      result.plan.endDate = ymd;
      tokens.push({ kind: 'date', raw: m, value: ymd });
      return ' ';
    });
  }

  // MM/DD/YYYY or MM/DD
  if (!result.plan.endDate) {
    s = s.replace(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])(?:\/(\d{2,4}))?\b/, (m, mo, da, yr) => {
      const yyyy = yr ? (yr.length === 2 ? `20${yr}` : yr) : String(today.getFullYear());
      const ymd = `${yyyy}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
      result.plan.endDate = ymd;
      tokens.push({ kind: 'date', raw: m, value: ymd });
      return ' ';
    });
  }

  // "in N day(s)/week(s)/month(s)"
  if (!result.plan.endDate) {
    s = s.replace(/\bin\s+(\d{1,3})\s+(day|days|week|weeks|month|months)\b/i, (m, n, unit) => {
      const num = Number(n);
      const d = new Date(today);
      if (/day/i.test(unit))   d.setDate(d.getDate() + num);
      if (/week/i.test(unit))  d.setDate(d.getDate() + num * 7);
      if (/month/i.test(unit)) d.setMonth(d.getMonth() + num);
      const ymd = isoOf(d);
      result.plan.endDate = ymd;
      tokens.push({ kind: 'date', raw: m, value: ymd });
      return ' ';
    });
  }

  // "today" / "tomorrow" / "yesterday"
  if (!result.plan.endDate) {
    s = s.replace(/\b(today|tomorrow|yesterday)\b/i, (m, word) => {
      const offset = { today: 0, tomorrow: 1, yesterday: -1 }[word.toLowerCase()];
      const ymd = isoOf(addDays(today, offset));
      result.plan.endDate = ymd;
      tokens.push({ kind: 'date', raw: m, value: ymd });
      return ' ';
    });
  }

  // "next Friday" — force next-week occurrence even if today is Friday
  if (!result.plan.endDate) {
    s = s.replace(new RegExp(`\\bnext\\s+(${WEEKDAY_RE})\\b`, 'i'), (m, name) => {
      const target = WEEKDAYS.indexOf(name.toLowerCase());
      const ymd = isoOf(nextWeekday(target, today, true));
      result.plan.endDate = ymd;
      tokens.push({ kind: 'date', raw: m, value: ymd });
      return ' ';
    });
  }

  // bare "Friday" — next occurrence (today counts as today)
  if (!result.plan.endDate) {
    s = s.replace(new RegExp(`\\b(${WEEKDAY_RE})\\b`, 'i'), (m, name) => {
      const target = WEEKDAYS.indexOf(name.toLowerCase());
      const ymd = isoOf(nextWeekday(target, today, false));
      result.plan.endDate = ymd;
      tokens.push({ kind: 'date', raw: m, value: ymd });
      return ' ';
    });
  }

  // Whatever's left (collapsed whitespace) is the title.
  result.title = s.replace(/\s+/g, ' ').trim();
  result.tokens = tokens;
  return result;
}
