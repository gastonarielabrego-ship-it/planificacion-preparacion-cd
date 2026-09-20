// Diagnóstico de archivos rechazados por "no tiene filas legibles".
// Cuando el parseo no encuentra ni una fila útil, guardamos una descripción
// compacta del archivo (tipo real, hojas, rangos, cantidad de celdas, muestra
// de celdas, bytes de cabeza/cola) en UploadStage con fileId "diag:<id>".
// Así el fallo se puede analizar a distancia (GET /api/upload/diag) sin pedir
// al usuario que reenvíe nada, y las partes quedan en UploadChunk para poder
// descargar una porción del archivo original si hace falta ver más.

import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { db } from '@/lib/db'

const TAM_MUESTRA_BYTES = 4 * 1024 // cabeza/cola guardadas en el diag (base64)

function sniffTipo(buf: Buffer): string {
  const head = buf.subarray(0, 8)
  const hex = head.toString('hex').toUpperCase()
  const asci = buf.subarray(0, 512).toString('latin1')
  if (hex.startsWith('504B0304') || hex.startsWith('504B0506') || hex.startsWith('504B0708')) return 'ZIP (xlsx/xlsm/xlsb/ods)'
  if (hex.startsWith('D0CF11E0A1B11AE1')) return 'XLS binario (BIFF/OLE)'
  if (hex.startsWith('1F8B')) return 'GZIP comprimido'
  if (asci.startsWith('%PDF')) return 'PDF'
  if (/<(!DOCTYPE|html|\?xml)/i.test(asci)) {
    return /spreadsheet/i.test(asci) ? 'XML Spreadsheet 2003' : 'HTML/XML (no es un Excel real)'
  }
  if (head.every((b) => b === 0)) return 'vacío (todo ceros)'
  // ¿texto plano? (CSV)
  const imprimibles = buf.subarray(0, 1024).filter((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 160).length
  if (buf.subarray(0, 1024).length > 0 && imprimibles / Math.min(buf.length, 1024) > 0.85) return 'texto plano (¿CSV?)'
  return `desconocido (cabeza ${hex.slice(0, 16)})`
}

interface CeldaMuestra { v?: unknown; f?: string; t?: string }

// Detecta el estilo de la hoja: '!data' (denso nuevo), claves numéricas por
// fila (denso de SheetJS 0.18.5, el caso real en producción) o direcciones
// "A1" (sparse clásico). Devuelve la fila r como array de celdas.
function filaCrudaDeHoja(
  sheet: XLSX.WorkSheet,
  r: number,
  rango: { s: { r: number; c: number }; e: { r: number; c: number } },
): (XLSX.CellObject | undefined)[] | undefined {
  const d = (sheet as { '!data'?: (XLSX.CellObject | undefined)[][] })['!data']
  if (d) return d[r]
  const porNumero = sheet[String(r)] as (XLSX.CellObject | undefined)[] | undefined
  if (porNumero) return porNumero
  if (r >= rango.s.r && r <= rango.e.r) {
    const out: (XLSX.CellObject | undefined)[] = []
    for (let c = rango.s.c; c <= rango.e.c; c++) {
      const cel = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined
      if (cel) out[c - rango.s.c] = cel
    }
    if (out.length) return out
  }
  return undefined
}

function muestraDeHoja(sheet: XLSX.WorkSheet, maxFilas = 4, maxCols = 10): CeldaMuestra[][] {
  const out: CeldaMuestra[][] = []
  const ref = sheet['!ref']
  if (!ref) return out
  const rango = XLSX.utils.decode_range(ref)
  for (let r = rango.s.r; r <= rango.e.r && out.length < maxFilas; r++) {
    const fila = filaCrudaDeHoja(sheet, r, rango)
    const celdas: CeldaMuestra[] = []
    for (let c = 0; c < maxCols; c++) {
      const cel = fila?.[c]
      celdas.push(cel ? ({ v: cel.v ?? null, ...(cel.f ? { f: cel.f } : {}), ...(cel.t ? { t: cel.t } : {}) }) : (null as unknown as CeldaMuestra))
    }
    out.push(celdas)
  }
  return out
}

export interface DiagArchivo {
  nombre: string
  bytes: number
  tipo: string
  cabezaHex: string
  hojas: { nombre: string; ref: string | null; celdas: number; nota?: string }[]
  muestra?: CeldaMuestra[][]
  detalle: string
}

// Arma el diagnóstico a partir del buffer crudo + workbook ya leído.
// IMPORTANTE: si el workbook ya fue recorrido por el iterador de filas, las
// filas consumidas están destruidas (el iterador las libera al avanzar); en
// ese caso pasá `wbFresco` re-leyendo el buffer (ver respuestaSinFilas).
export function armarDiagArchivo(buf: Buffer, wb: XLSX.WorkBook, nombre: string): DiagArchivo {
  const tipo = sniffTipo(buf)
  const hojas: DiagArchivo['hojas'] = []
  for (const n of wb.SheetNames) {
    const s = wb.Sheets[n]
    if (!s) { hojas.push({ nombre: n, ref: null, celdas: 0, nota: 'hoja inaccesible' }); continue }
    let celdas = 0
    let conValores = 0
    let formulasSinValor = 0
    let filasVistas = 0
    const ref = s['!ref']
    if (ref) {
      const rango = XLSX.utils.decode_range(ref)
      const limite = Math.min(rango.e.r + 1, rango.s.r + 5000)
      for (let r = rango.s.r; r < limite; r++) {
        const fila = filaCrudaDeHoja(s, r, rango)
        if (!fila) continue
        filasVistas++
        for (const cel of fila) {
          if (!cel) continue
          celdas++
          if (cel.v != null) conValores++
          else if (cel.f) formulasSinValor++
        }
      }
    }
    let nota: string | undefined
    if (celdas === 0) nota = 'SIN CELDAS con contenido'
    else if (conValores === 0 && formulasSinValor > 0) nota = `fórmulas sin valores calculados (${formulasSinValor}+ celdas)`
    else if (conValores === 0) nota = `celdas sin valores legibles (${celdas} contadas)`
    else if (filasVistas <= 1) nota = `solo encabezados, sin filas de datos (${conValores} celdas en la fila 1)`
    hojas.push({ nombre: n, ref: ref ?? null, celdas, ...(nota ? { nota } : {}) })
  }
  const detalleHojas = hojas
    .map((h) => `${h.nombre}[${h.ref ?? 'sin rango'}]${h.nota ? ` — ${h.nota}` : h.celdas ? ` ${h.celdas >= 20000 ? '20000+' : h.celdas} celdas` : ' SIN CELDAS'}`)
    .join(' | ')
  return {
    nombre,
    bytes: buf.length,
    tipo,
    cabezaHex: buf.subarray(0, 16).toString('hex').toUpperCase(),
    hojas,
    muestra: muestraDeHoja(wb.Sheets[wb.SheetNames[0]] ?? {}),
    detalle: `${tipo}; ${(buf.length / 1024).toFixed(1)} KB; ${wb.SheetNames.length} hoja(s): ${detalleHojas || '(sin hojas)'}`,
  }
}

// Respuesta para el caso aún peor: XLSX.read lanzó excepción. Guardamos el
// diagnóstico del buffer crudo (tipo real, cabeza/cola) + el mensaje del error.
export async function respuestaLecturaFallida(
  buf: Buffer,
  fileId: string,
  nombre: string,
  e: unknown,
): Promise<NextResponse> {
  const msg = e instanceof Error ? e.message : String(e)
  const tipo = sniffTipo(buf)
  const diag: DiagArchivo = {
    nombre,
    bytes: buf.length,
    tipo,
    cabezaHex: buf.subarray(0, 16).toString('hex').toUpperCase(),
    hojas: [],
    detalle: `${tipo}; ${(buf.length / 1024).toFixed(1)} KB; XLSX.read falló: ${msg.slice(0, 180)}`,
  }
  try {
    await db.uploadStage.create({
      data: {
        fileId: `diag:${fileId}`,
        data: JSON.stringify({
          diag,
          headB64: buf.subarray(0, TAM_MUESTRA_BYTES).toString('base64'),
          tailB64: buf.subarray(Math.max(0, buf.length - TAM_MUESTRA_BYTES)).toString('base64'),
          cuando: new Date().toISOString(),
        }),
      },
    })
  } catch { /* diag es best-effort */ }
  return NextResponse.json(
    { error: `no se pudo leer el archivo (¿es un Excel/CSV válido?) — ${tipo}, ${(buf.length / 1024).toFixed(1)} KB — detalle: ${msg.slice(0, 160)}`, diag },
    { status: 400, headers: { 'x-sin-filas': '1' } },
  )
}

// Respuesta estándar "el archivo no tiene filas legibles" con diagnóstico.
// Marca la respuesta con x-sin-filas para que quien subió por partes CONSERVE
// los chunks (se pueden descargar por /api/upload/diag para analizar más).
export async function respuestaSinFilas(
  buf: Buffer,
  wb: XLSX.WorkBook,
  fileId: string,
  nombre: string,
): Promise<NextResponse> {
  // El workbook recibido puede venir consumido por el iterador (que libera las
  // filas a medida que avanza): re-leer fresco para que la muestra y los
  // conteos del diagnóstico reflejen el archivo real.
  let wbDiag = wb
  try {
    wbDiag = XLSX.read(buf, { type: 'buffer', cellDates: true, dense: true })
  } catch { /* si falla, usamos el que llegó (aunque esté consumido) */ }
  const diag = armarDiagArchivo(buf, wbDiag, nombre)
  try {
    // best-effort: si la base está llena o falla, el error principal es más importante
    await db.uploadStage.create({
      data: {
        fileId: `diag:${fileId}`,
        data: JSON.stringify({
          diag,
          headB64: buf.subarray(0, TAM_MUESTRA_BYTES).toString('base64'),
          tailB64: buf.subarray(Math.max(0, buf.length - TAM_MUESTRA_BYTES)).toString('base64'),
          cuando: new Date().toISOString(),
        }),
      },
    })
  } catch { /* diag es best-effort */ }
  return NextResponse.json(
    {
      error: `el archivo no tiene filas legibles (${diag.detalle})`,
      diag,
    },
    { status: 400, headers: { 'x-sin-filas': '1' } },
  )
}

// -------- lectura de diagnósticos (endpoint /api/upload/diag) --------

export interface DiagGuardado {
  fileId: string
  cuando: string
  diag: DiagArchivo
  headB64?: string
  tailB64?: string
}

export async function listarDiags(limite = 10): Promise<DiagGuardado[]> {
  const filas = await db.uploadStage.findMany({
    where: { fileId: { startsWith: 'diag:' } },
    orderBy: { id: 'desc' },
    take: limite,
  })
  const out: DiagGuardado[] = []
  for (const f of filas) {
    try {
      const j = JSON.parse(f.data) as { diag: DiagArchivo; headB64?: string; tailB64?: string; cuando?: string }
      out.push({ fileId: f.fileId.slice(5), cuando: j.cuando ?? f.createdAt.toISOString(), diag: j.diag, headB64: j.headB64, tailB64: j.tailB64 })
    } catch { /* registro dañado: ignorar */ }
  }
  return out
}

// Devuelve una porción del archivo original armado desde las partes guardadas
// (solo funciona si el usuario todavía no reintentó la subida: cada intento
// nuevo borra los chunks anteriores).
export async function bytesDeArchivo(fileId: string, maxBytes: number): Promise<{ total: number; partes: number; b64: string } | null> {
  const bufParts: Buffer[] = []
  let desdeIdx = 0
  let total = 0
  while (bufParts.reduce((a, b) => a + b.length, 0) < maxBytes) {
    const page = await db.uploadChunk.findMany({
      where: { fileId, idx: { gte: desdeIdx } },
      orderBy: { idx: 'asc' },
      take: 6,
    })
    if (!page.length) break
    for (const p of page) {
      bufParts.push(Buffer.from(p.data as unknown as Uint8Array))
      total += p.data.length
      desdeIdx = p.idx + 1
    }
    if (page.length < 6) break
  }
  if (!bufParts.length) return null
  const buf = Buffer.concat(bufParts).subarray(0, maxBytes)
  return { total, partes: desdeIdx, b64: buf.toString('base64') }
}
