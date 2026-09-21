// Genera los agregados H61 Circuito + Actividad como JSON (sin DB), para subirlos
// via /api/direct-import (cuando la conexion directa al Neon esta rate-limitada).
// Salida: download/h61-circuito.json, download/h61-actividad.json
// Uso: bun scripts/h61-agregados-json.ts
import * as XLSX from 'xlsx'
import { filasDelWorkbook } from '../src/lib/xlsx'
import { writeFileSync } from 'fs'

const fechaDesde = (v: unknown): Date | null => {
  if (v == null) return null
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()))
  if (typeof v === 'number') {
    const s = String(Math.floor(v))
    if (s.length !== 8) return null
    return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)))
  }
  const s = String(v).trim()
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return null
}
const num = (v: unknown): number | null => (v == null || v === '' ? null : (isNaN(parseFloat(String(v))) ? null : parseFloat(String(v))))
const str = (v: unknown): string | null => (v == null || String(v).trim() === '' ? null : String(v).trim())
const HORAS = Array.from({ length: 24 }, (_, i) => `HORA_${String(i).padStart(2, '0')}`)

const wb = XLSX.readFile('upload/H61.xlsx', { dense: true, cellDates: true })
const ci = new Map<string, { fecha: string; circuito: string; funcion: string; bultos: number }>()
const act = new Map<string, { fecha: string; actividad: string; bultos: number; operarios: number; horas: number; _ops: Set<string>; _h: Map<string, Set<number>> }>()

for (const r of filasDelWorkbook(wb)) {
  const fecha = fechaDesde(r.FECHA ?? r.fecha)
  const operario = str(r.OPERARIO ?? r.operario)
  if (!fecha || !operario) continue
  const funcion = (str(r.FUNCION ?? r.funcion) ?? '?').toUpperCase()
  const circuito = str(r.CIRCUITO ?? r.circuito) ?? '?'
  const actividad = (str(r.ACTIVIDAD ?? r.actividad) ?? '?').toUpperCase()
  const horasRow = HORAS.map((h) => Math.round(num(r[h]) ?? 0))
  let totalRow = Math.round(num(r.TOTAL ?? r.total) ?? 0)
  const sumaHoras = horasRow.reduce((a, b) => a + Math.max(0, b), 0)
  if (totalRow === 0 && sumaHoras > 0) totalRow = sumaHoras
  const fISO = fecha.toISOString().slice(0, 10)

  const k3 = `${fISO}|${circuito}|${funcion}`
  const c = ci.get(k3)
  if (c) c.bultos += totalRow
  else ci.set(k3, { fecha: fISO, circuito, funcion, bultos: totalRow })

  const k4 = `${fISO}|${actividad}`
  let a = act.get(k4)
  if (!a) { a = { fecha: fISO, actividad, bultos: 0, operarios: 0, horas: 0, _ops: new Set(), _h: new Map() }; act.set(k4, a) }
  a.bultos += totalRow
  a._ops.add(operario)
  let hs = a._h.get(operario)
  if (!hs) { hs = new Set(); a._h.set(operario, hs) }
  horasRow.forEach((v, i) => { if (v !== 0) hs!.add(i) })
}

const circuitoRows = [...ci.values()]
const actividadRows = [...act.values()].map(({ _ops, _h, ...a }) => ({ ...a, operarios: _ops.size, horas: [..._h.values()].reduce((acc, s) => acc + s.size, 0) }))
writeFileSync('/home/z/my-project/download/h61-circuito.json', JSON.stringify({ tabla: 'h61circuito', rows: circuitoRows }))
writeFileSync('/home/z/my-project/download/h61-actividad.json', JSON.stringify({ tabla: 'h61actividad', rows: actividadRows }))
console.log(`circuito=${circuitoRows.length} actividad=${actividadRows.length}`)
