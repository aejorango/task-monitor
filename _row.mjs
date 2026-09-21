import ExcelJS from 'exceljs';
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile('audit-and-task-2026-09-21.xlsx');
const ws = wb.getWorksheet('Tasks');
const H = ['A TaskID','B SourceID','C Release','D Priority','E Category','F Area','G Title','H Instructions','I Acceptance','J Files','K Deps','L Estimate','M Test','N Done','O Notes','P Location','Q Risk','R Rec','S Cost'];
const want = new Set(process.argv.slice(2));
ws.eachRow((row, i) => {
  if (i === 1) return;
  const v = (n) => { const c = row.getCell(n).value; return c == null ? '' : (typeof c === 'object' ? (c.text || c.result || JSON.stringify(c)) : String(c)); };
  if (!want.has(v(1))) return;
  console.log('='.repeat(70));
  for (let n = 1; n <= 19; n++) console.log(`--- ${H[n-1]}:\n${v(n)}`);
});
