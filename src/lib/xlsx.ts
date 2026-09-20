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

// Itera las filas de un workbook leído en modo denso como GENERADOR: crea un
// objeto {encabezado: valor} por fila (transitorio, GC al avanzar) y libera la
// fila del sheet a medida que se consume. Evita materializar el array completo
// de records: el H61 real (~26 MB) necesita >2 GB si se materializa todo y
// voltea la función serverless; con streaming el pico queda en el workbook.
// Formatos densos soportados: '!data' (versiones nuevas) y claves numéricas
// por fila (SheetJS 0.18.5). Fallback: workbook no denso -> sheet_to_json.
type FilaDensa = (XLSX.CellObject | undefined)[]

function* filasDeHojaDensa(
  cantFilas: number,
  leer: (r: number) => FilaDensa | undefined,
  liberar: (r: number) => void,
): Generator<Record<string, unknown>> {
  let headers: string[] | null = null
  for (let r = 0; r < cantFilas; r++) {
    const fila = leer(r)
    liberar(r) // libera la fila ya consumida (GC progresivo)
    if (!fila) continue
    if (!headers) {
      headers = fila.map((c) => (c && c.v != null ? String(c.v).trim() : ''))
      continue
    }
    const obj: Record<string, unknown> = {}
    let conValor = false
    for (let c = 0; c < fila.length; c++) {
      const cel = fila[c]
      if (!cel || cel.v == null) continue
      const h = headers[c]
      if (h) obj[h] = cel.v
      conValor = true
    }
    if (!conValor) continue // fila totalmente vacía: igual que sheet_to_json (blankrows: false)
    if (!Object.keys(obj).length) continue // celdas con valor pero bajo encabezados vacíos: no aporta nada y haría fallar la primera-fila
    yield obj
  }
}

// Variante para hojas guardadas estilo SPARSE (claves "A1", "B2", ...): arma
// cada fila leyendo celdas por dirección dentro del rango del !ref. Cubre
// workbooks que no quedan en modo denso (otras versiones/formatos de SheetJS).
function* filasDeHojaPorCeldas(
  sheet: XLSX.WorkSheet,
  rango: { s: { r: number; c: number }; e: { r: number; c: number } },
): Generator<Record<string, unknown>> {
  let headers: string[] | null = null
  for (let r = rango.s.r; r <= rango.e.r; r++) {
    let conValor = false
    const fila: (XLSX.CellObject | undefined)[] = []
    for (let c = rango.s.c; c <= rango.e.c; c++) {
      const cel = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined
      if (cel && cel.v != null) {
        fila[c - rango.s.c] = cel
        conValor = true
      }
    }
    if (!conValor) continue
    if (!headers) {
      headers = fila.map((c) => (c && c.v != null ? String(c.v).trim() : ''))
      continue
    }
    const obj: Record<string, unknown> = {}
    for (let c = 0; c < fila.length; c++) {
      const cel = fila[c]
      if (!cel || cel.v == null) continue
      const h = headers[c]
      if (h) obj[h] = cel.v
    }
    if (!Object.keys(obj).length) continue
    yield obj
  }
}

export function* filasDelWorkbook(wb: XLSX.WorkBook): Generator<Record<string, unknown>> {
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName] as (XLSX.WorkSheet & { '!data'?: FilaDensa[] }) | undefined
    if (!sheet) continue
    const data = sheet['!data']
    if (data) {
      yield* filasDeHojaDensa(data.length, (r) => data[r], (r) => { data[r] = undefined })
      continue
    }
    if (!sheet['!ref']) continue
    const rango = XLSX.utils.decode_range(sheet['!ref'])
    // Dos estilos posibles de hoja sin '!data':
    //  - denso viejo (SheetJS 0.18.5): filas bajo claves numéricas "0", "1"...
    //  - sparse clásico: celdas bajo claves "A1", "B2"...
    // Detectamos el estilo con las claves reales de la hoja; el fallback por
    // direcciones cubre el caso que antes devolvía cero filas.
    let usaDirecciones = false
    for (const k of Object.keys(sheet)) {
      if (k.charCodeAt(0) === 33 /* '!' */) continue
      if (/^[A-Z]{1,3}[0-9]+$/.test(k)) { usaDirecciones = true; break }
    }
    if (usaDirecciones) {
      yield* filasDeHojaPorCeldas(sheet, rango)
      continue
    }
    yield* filasDeHojaDensa(
      rango.e.r + 1,
      (r) => sheet[String(r)] as FilaDensa | undefined,
      (r) => { sheet[String(r)] = undefined },
    )
  }
}
