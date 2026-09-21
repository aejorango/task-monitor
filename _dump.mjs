import ExcelJS from 'exceljs';
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile('audit-and-task-2026-09-21.xlsx');
const ws = wb.getWorksheet('Tasks');
const out = [];
ws.eachRow((row, i) => {
  if (i === 1) return;
  const v = (n) => { const c = row.getCell(n).value; return c == null ? '' : (typeof c === 'object' ? (c.text || c.result || JSON.stringify(c)) : String(c)); };
  out.push({ id: v(1), src: v(2), pri: v(4), cat: v(5), area: v(6), title: v(7), deps: v(11), done: v(14), rec: v(18) });
});
const args = process.argv.slice(2);
for (const r of out) {
  if (args.length && !args.includes(r.id)) continue;
  console.log([r.id, r.src, r.done, r.rec, r.deps, r.title].join(' | '));
}
