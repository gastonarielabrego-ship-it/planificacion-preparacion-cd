// Inspección del archivo fuente de Ola: estructura y filas de mayo
import * as XLSX from 'xlsx'
import { readFileSync } from 'fs'

const buf = readFileSync('data/Ola y Pendiente (1).xlsx')
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
console.log('Hojas:', wb.SheetNames)
for (const sn of wb.SheetNames) {
  const ws = wb.Sheets[sn]
  const ref = ws['!ref']
  console.log(`\n== Hoja "${sn}" ref=${ref} ==`)
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
  console.log('filas:', rows.length)
  console.log('columnas:', rows.length ? Object.keys(rows[0]).join(' | ') : '(vacía)')
  console.log('primeras 5:', JSON.stringify(rows.slice(0, 5), null, 1).slice(0, 900))
  // filas de mayo 2026
  const esMayo = (r: Record<string, unknown>) => {
    const f = (r.FECHA ?? r.Fecha ?? r.fecha) as unknown
    if (f instanceof Date) return f.toISOString().slice(0, 7) === '2026-05'
    return String(f ?? '').includes('05/2026') || String(f ?? '').includes('05-2026')
  }
  const mayo = rows.filter(esMayo)
  console.log(`\nfilas mayo 2026 detectadas: ${mayo.length}`)
  for (const r of mayo.slice(0, 40)) console.log(JSON.stringify(r))
}
