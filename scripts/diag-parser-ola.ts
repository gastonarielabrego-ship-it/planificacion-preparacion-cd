// Simula exactamente matrizOlaARecords para Mayo 2026 y muestra el alineamiento
import * as XLSX from 'xlsx'
import { readFileSync } from 'fs'

const MODO = process.argv[2] === 'dense' ? { type: 'buffer' as const, cellDates: true, dense: true } : { type: 'buffer' as const, cellDates: true }
const wb = XLSX.read(readFileSync('data/Ola y Pendiente (1).xlsx'), MODO)
console.log('modo lectura:', process.argv[2] ?? 'normal')

const fechaDeCelda = (v: unknown): Date | null => {
  if (v instanceof Date) return v
  return null
}
const fechaValida = (d: Date | null): boolean => !!d && d.getTime() >= Date.UTC(2000, 0, 1) && d.getTime() < Date.UTC(2100, 0, 1)
const numDe = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}

for (const nombre of ['Mayo 2026', 'Abril 2026', 'Diciembre']) {
  const sheet = wb.Sheets[nombre]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true })
  console.log(`\n===== ${nombre} ===== ref=${sheet['!ref']} filas_con_header1=${rows.length}`)
  let idxOla = -1
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const et = String(rows[i]?.[0] ?? '').trim().toUpperCase()
    if (et === 'OLA TOTAL' || et === 'OLA') { idxOla = i; break }
  }
  console.log('idxOla:', idxOla)
  if (idxOla < 0) continue
  let filaFechas: (Date | null)[] | null = null
  let filaFechasIdx = -1
  for (let i = idxOla - 1; i >= 0; i--) {
    const fechas = (rows[i] ?? []).slice(1).map((c) => fechaDeCelda(c))
    const validas = fechas.filter((f) => fechaValida(f)).length
    if (validas >= 10) { filaFechas = fechas; filaFechasIdx = i; break }
  }
  console.log('filaFechasIdx:', filaFechasIdx)
  let ola: number[] | null = null
  let pend: number[] | null = null
  let tot: number[] | null = null
  for (const r of rows) {
    const etiqueta = String(r?.[0] ?? '').trim().toUpperCase()
    const vals = (r ?? []).slice(1).map((c) => numDe(c))
    if (etiqueta === 'OLA TOTAL' || etiqueta === 'OLA') ola = vals
    else if (etiqueta === 'PENDIENTE') pend = vals
    else if (etiqueta === 'TOTAL') tot = vals
  }
  console.log('largo fechas:', filaFechas?.length, 'largo ola:', ola?.length, 'largo pend:', pend?.length)
  // muestra el mapeo resultante fecha -> ola/pend
  const out: string[] = []
  filaFechas?.forEach((f, i) => {
    if (!fechaValida(f)) return
    const o = ola?.[i] ?? 0
    const p = pend?.[i] ?? 0
    out.push(`${f.toISOString().slice(5, 10)}: O=${Math.round(o)} P=${Math.round(p)}`)
  })
  console.log(out.join('  |  '))
}
