import ExcelJS from 'exceljs'
const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile('audit-and-task-2026-09-20.xlsx')
const ws = wb.getWorksheet('Tasks')
ws.eachRow((row, i) => {
  if (i === 1) return
  const v = (c) => { const x = row.getCell(c).value; return x == null ? '' : (typeof x === 'object' ? (x.text ?? x.result ?? JSON.stringify(x)) : String(x)) }
  console.log(JSON.stringify({ n: i, A: v('A'), B: v('B'), C: v('C'), D: v('D'), E: v('E'), G: v('G'), K: v('K'), N: v('N'), Q: v('Q'), R: v('R') }))
})
