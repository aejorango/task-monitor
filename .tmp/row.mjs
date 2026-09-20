import ExcelJS from 'exceljs'
const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile('audit-and-task-2026-09-20.xlsx')
const ws = wb.getWorksheet('Tasks')
const want = process.argv.slice(2)
ws.eachRow((row, i) => {
  if (i === 1) return
  const v = (c) => { const x = row.getCell(c).value; return x == null ? '' : (typeof x === 'object' ? (x.text ?? x.result ?? JSON.stringify(x)) : String(x)) }
  if (!want.includes(v('A'))) return
  for (const c of 'ABCDEFGHIJKLMNOPQRS') console.log(`--${c}--\n${v(c)}`)
})
