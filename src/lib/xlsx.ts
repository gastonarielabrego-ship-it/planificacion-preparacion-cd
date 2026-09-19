// Parseo de workbooks Excel a registros planos.
// Caso especial "ola": el archivo es una matriz mensual (fechas en columnas,
// conceptos 'Ola total' / 'Pendiente' / 'Total' en filas, fechas reales en la fila 1).
import * as XLSX from 'xlsx'
import { TipoCarga } from '@/lib/ingest'

const fechaDeCelda = (v: unknown): Date | null => {
  if (v == null) return null
  if (v instanceof Date && !isNaN(v.getTime())) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()))
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // serial de Excel (dias desde 1899-12-30)
    const ms = Math.round((v - 25569) * 86400 * 1000)
    const d = new Date(ms)
    return isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  }
  if (typeof v === 'string') {
    const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(v.trim())
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    const m2 = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(v.trim())
    if (m2) return new Date(Date.UTC(+m2[3], +m2[2] - 1, +m2[1]))
  }
  return null
}

const numDe = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}

// Convierte la matriz mensual de "Ola y Pendiente" a registros {fecha, ola, pendiente, total}
export function matrizOlaARecords(wb: XLSX.WorkBook): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const fechaValida = (d: Date | null): boolean => !!d && d.getTime() >= Date.UTC(2000, 0, 1) && d.getTime() < Date.UTC(2100, 0, 1)
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true })
    if (!rows.length) continue

    // ubicar fila "Ola total" (o "Ola")
    let idxOla = -1
    for (let i = 0; i < Math.min(rows.length, 12); i++) {
      const et = String(rows[i]?.[0] ?? '').trim().toUpperCase()
      if (et === 'OLA TOTAL' || et === 'OLA') { idxOla = i; break }
    }
    if (idxOla < 0) continue

    // fechas reales: primera fila con >=10 fechas escaneando HACIA ARRIBA desde "Ola total"
    // (la fila de encabezado del Excel contiene fechas placeholder, la real esta justo encima de los conceptos)
    let filaFechas: (Date | null)[] | null = null
    for (let i = idxOla - 1; i >= 0; i--) {
      // slice(1): descarta la columna de etiquetas para alinear indices con los valores de conceptos
      const fechas = (rows[i] ?? []).slice(1).map((c) => fechaDeCelda(c))
      const validas = fechas.filter((f) => fechaValida(f)).length
      if (validas >= 10) { filaFechas = fechas; break }
    }
    if (!filaFechas) continue

    // filas de conceptos
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
    if (!ola) continue

    filaFechas.forEach((f, i) => {
      if (!fechaValida(f)) return
      const o = ola?.[i] ?? 0
      const p = pend?.[i] ?? 0
      const t = tot?.[i] ?? o + p
      out.push({ fecha: f!.toISOString().slice(0, 10), ola: o, pendiente: p, total: t, hoja: sheetName })
    })
  }
  return out
}

// Parsea un workbook segun el tipo de carga
export function workbookARecords(tipo: TipoCarga, wb: XLSX.WorkBook): Record<string, unknown>[] {
  if (tipo === 'ola') return matrizOlaARecords(wb)
  const records: Record<string, unknown>[] = []
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true })
    for (const r of json) records.push(r) // push iterativo: el spread con >100k filas desborda el stack
  }
  return records
}
