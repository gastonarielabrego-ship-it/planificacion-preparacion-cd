// Compara producción vs parse del archivo local, y revisa la hoja Julio 2026
import * as XLSX from 'xlsx'
import { readFileSync } from 'fs'

const prod = JSON.parse(readFileSync('/tmp/ola-prod.json', 'utf8'))
const serie = prod.serie ?? prod
const prodMap = new Map<string, { ola: number; pendiente: number }>(serie.map((s: { fecha: string; ola: number; pendiente: number }) => [s.fecha, { ola: s.ola, pendiente: s.pendiente }]))

const wb = XLSX.read(readFileSync('data/Ola y Pendiente (1).xlsx'), { type: 'buffer', cellDates: true })
const fechaDeCelda = (v: unknown): Date | null => (v instanceof Date ? v : null)
const fechaValida = (d: Date | null): boolean => !!d && d.getTime() >= Date.UTC(2000, 0, 1) && d.getTime() < Date.UTC(2100, 0, 1)
const numDe = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}

// parse igual a matrizOlaARecords
const out = new Map<string, { ola: number; pendiente: number }>()
for (const sheetName of wb.SheetNames) {
  const sheet = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true })
  if (!rows.length) continue
  let idxOla = -1
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const et = String(rows[i]?.[0] ?? '').trim().toUpperCase()
    if (et === 'OLA TOTAL' || et === 'OLA') { idxOla = i; break }
  }
  if (idxOla < 0) continue
  let filaFechas: (Date | null)[] | null = null
  for (let i = idxOla - 1; i >= 0; i--) {
    const fechas = (rows[i] ?? []).slice(1).map((c) => fechaDeCelda(c))
    if (fechas.filter((f) => fechaValida(f)).length >= 10) { filaFechas = fechas; break }
  }
  if (!filaFechas) continue
  let ola: number[] | null = null, pend: number[] | null = null
  for (const r of rows) {
    const etiqueta = String(r?.[0] ?? '').trim().toUpperCase()
    const vals = (r ?? []).slice(1).map((c) => numDe(c))
    if (etiqueta === 'OLA TOTAL' || etiqueta === 'OLA') ola = vals
    else if (etiqueta === 'PENDIENTE') pend = vals
  }
  filaFechas.forEach((f, i) => {
    if (!fechaValida(f)) return
    out.set(f.toISOString().slice(0, 10), { ola: ola?.[i] ?? 0, pendiente: pend?.[i] ?? 0 })
  })
}
console.log('parse local:', out.size, 'días; producción:', prodMap.size, 'días')

// comparar 2026
let iguales = 0, distintas: string[] = []
for (const [f, v] of out) {
  if (!f.startsWith('2026')) continue
  const p = prodMap.get(f)
  if (!p) { distintas.push(`${f} falta en prod`); continue }
  if (Math.round(p.ola) === Math.round(v.ola) && Math.round(p.pendiente) === Math.round(v.pendiente)) iguales++
  else distintas.push(`${f} prod(O=${Math.round(p.ola)},P=${Math.round(p.pendiente)}) vs archivo(O=${Math.round(v.ola)},P=${Math.round(v.pendiente)})`)
}
console.log(`2026: ${iguales} días idénticos, ${distintas.length} distintos`)
console.log(distintas.slice(0, 12).join('\n'))

// hoja Julio 2026
console.log('\n===== Hoja "Julio 2026" =====')
const ws = wb.Sheets['Julio 2026']
const rowsJ = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true })
console.log('ref:', ws['!ref'], 'filas:', rowsJ.length)
for (const r of rowsJ.slice(0, 8)) console.log(JSON.stringify((r ?? []).slice(0, 10)))
