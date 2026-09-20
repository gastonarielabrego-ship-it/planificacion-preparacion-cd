import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { db } from '@/lib/db'
import { filasDelWorkbook } from '@/lib/xlsx'
import { autoMapPicking, mapPicking, PickingMapping } from '@/lib/ingest'
import { guardarTanda, insertarTandaPicking, PickingMapeada, tamTandaFilas } from '@/lib/stage'

export const runtime = 'nodejs'
export const maxDuration = 300

// Procesamiento POR PASOS de un picking subido por partes (ver /api/upload):
// el archivo de eventos E-8 puede tener cientos de miles de filas y procesarlo
// entero en la llamada que sube la última parte supera el timeout de la
// plataforma (HTTP 504). El cliente dirige:
//   paso=parseo   -> arma el buffer desde UploadChunk, lee el Excel en modo
//                    denso con streaming, mapea cada fila y la guarda en
//                    UploadStage (JSON compacto por tandas de 2000).
//   paso=insertar -> mueve una tanda de filas de UploadStage a PickingEvento
//                    (transaccional: inserta y borra del stage junto).
//   paso=cerrar   -> marca el batch como cerrado cuando no queda nada en stage.
// Cada paso es reanudable: si una llamada falla o se pierde la respuesta, se
// puede repetir sin duplicar ni perder filas.
const LIMITE_ARCHIVO = 300 * 1024 * 1024
const TTL_STAGE_MS = 6 * 60 * 60 * 1000

interface PasoBody {
  paso?: string
  fileId?: string
  nombre?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PasoBody
    const fileId = String(body.fileId ?? '').slice(0, 120)
    if (!fileId) {
      return NextResponse.json({ error: 'falta fileId' }, { status: 400 })
    }

    if (body.paso === 'parseo') return await pasoParseo(fileId, String(body.nombre ?? fileId).slice(0, 200))
    if (body.paso === 'insertar') return await pasoInsertar(fileId)
    if (body.paso === 'cerrar') return await pasoCerrar(fileId)
    return NextResponse.json({ error: 'paso invalido: usar parseo|insertar|cerrar' }, { status: 400 })
  } catch (e) {
    console.error('upload/procesar error', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error procesando el archivo' }, { status: 500 })
  }
}

async function pasoParseo(fileId: string, nombre: string) {
  // reintentos y restos de intentos anteriores de este mismo fileId: empezar limpio
  await db.uploadStage.deleteMany({ where: { fileId } })
  // tandas huérfanas de otros intentos (>6 h)
  await db.uploadStage.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - TTL_STAGE_MS) } } })

  // Armar el buffer PAGINANDO las partes (6 por vez): cargarlas todas juntas
  // duplicaba la memoria (strings base64 + buffers decodificados) y con
  // archivos grandes contribuyó a un OOM en el parseo.
  const bufParts: Buffer[] = []
  let desdeIdx = 0
  let esperado = 0
  while (true) {
    const page = await db.uploadChunk.findMany({
      where: { fileId, idx: { gte: desdeIdx } },
      orderBy: { idx: 'asc' },
      take: 6,
    })
    if (!page.length) break
    for (const p of page) {
      if (p.idx !== esperado) {
        return NextResponse.json({ error: `faltan partes del archivo (desde la ${esperado})` }, { status: 409 })
      }
      bufParts.push(Buffer.from(p.data, 'base64'))
      esperado++
    }
    desdeIdx = page[page.length - 1].idx + 1
    if (page.length < 6) break
  }
  if (esperado === 0) {
    return NextResponse.json({ error: 'no hay partes de archivo para ese fileId (¿ya fue procesado?)' }, { status: 404 })
  }
  const buf = Buffer.concat(bufParts)
  bufParts.length = 0 // libera los buffers intermedios antes del read
  if (buf.length < 1 || buf.length > LIMITE_ARCHIVO) {
    await db.uploadChunk.deleteMany({ where: { fileId } })
    return NextResponse.json({ error: `tamaño de archivo fuera de rango (${Math.round(buf.length / 1024)} KB)` }, { status: 400 })
  }

  let wb: XLSX.WorkBook
  try {
    // dense: celdas en arrays compactos — imprescindible para archivos grandes
    wb = XLSX.read(buf, { type: 'buffer', cellDates: true, dense: true })
  } catch {
    await db.uploadChunk.deleteMany({ where: { fileId } })
    return NextResponse.json({ error: 'no se pudo leer el archivo (¿es un Excel/CSV válido?)' }, { status: 400 })
  }

  const it = filasDelWorkbook(wb)
  const primera = it.next()
  if (primera.done || !primera.value || !Object.keys(primera.value).length) {
    await db.uploadChunk.deleteMany({ where: { fileId } })
    return NextResponse.json({ error: 'el archivo no tiene filas legibles' }, { status: 400 })
  }

  // auto-detección de columnas una sola vez con la primera fila (mismo archivo = mismas columnas)
  const mapping: PickingMapping = autoMapPicking(primera.value)
  if (!mapping.fecha || !mapping.operario) {
    await db.uploadChunk.deleteMany({ where: { fileId } })
    return NextResponse.json({ error: 'no se detectaron las columnas FECHA y OPERARIO/CODUTI en el archivo' }, { status: 400 })
  }

  let filas = 0
  let errores = 0
  let minT = Infinity
  let maxT = -Infinity
  let tanda: PickingMapeada[] = []
  const procesar = (m: ReturnType<typeof mapPicking>) => {
    if (!m) { errores++; return }
    filas++
    const t = m.fecha.getTime()
    if (t < minT) minT = t
    if (t > maxT) maxT = t
    tanda.push(m)
    if (tanda.length >= tamTandaFilas) {
      const t2 = tanda
      tanda = []
      return guardarTanda(fileId, t2)
    }
    return undefined
  }

  procesar(mapPicking(primera.value, mapping))
  for (const r of it) {
    const espera = procesar(mapPicking(r, mapping))
    if (espera) await espera // guardar la tanda mientras el generador sigue avanzando
  }
  if (tanda.length) await guardarTanda(fileId, tanda)

  await db.uploadChunk.deleteMany({ where: { fileId } })

  if (filas === 0) {
    await db.uploadStage.deleteMany({ where: { fileId } })
    return NextResponse.json({ error: `el archivo no tuvo filas utilizables (${errores} descartadas — ¿faltan FECHA u OPERARIO?)` }, { status: 400 })
  }

  // Semántica de REEMPLAZO (coherente con el texto de la web "cada carga
  // reemplaza los datos previos"): si el archivo ya parseó bien, se limpia el
  // picking anterior. Así re-subir el archivo (ej. export actualizado) no
  // DUPLICA eventos — el riesgo más grave con un log de eventos append-only.
  // Solo se toca si el parseo fue exitoso: si falla, los datos viejos quedan.
  await db.pickingEvento.deleteMany({})
  await db.uploadBatch.deleteMany({ where: { tipo: 'picking' } })

  const desde = new Date(minT).toISOString().slice(0, 10)
  const hasta = new Date(maxT).toISOString().slice(0, 10)
  await db.uploadBatch.upsert({
    where: { id: fileId },
    create: {
      id: fileId,
      tipo: 'picking',
      filename: nombre,
      rows: filas,
      meta: JSON.stringify({ errores, desde, hasta, fase: 'parseado' }),
    },
    update: {
      filename: nombre,
      rows: filas,
      meta: JSON.stringify({ errores, desde, hasta, fase: 'parseado' }),
    },
  })

  return NextResponse.json({ ok: true, fase: 'parseado', filas, errores, desde, hasta })
}

async function pasoInsertar(fileId: string) {
  const { insertados, restantes } = await insertarTandaPicking(fileId)
  return NextResponse.json({ ok: true, fase: 'insertando', insertados, restantes })
}

async function pasoCerrar(fileId: string) {
  const restantes = await db.uploadStage.count({ where: { fileId } })
  if (restantes > 0) {
    return NextResponse.json({ error: `quedan ${restantes} filas por insertar (llamá a insertar primero)` }, { status: 409 })
  }
  const batch = await db.uploadBatch.findUnique({ where: { id: fileId } })
  if (!batch) {
    return NextResponse.json({ error: 'no hay un batch parseado para ese fileId' }, { status: 404 })
  }
  let meta: Record<string, unknown> = { fase: 'cerrado' }
  try {
    meta = { ...JSON.parse(batch.meta ?? '{}'), fase: 'cerrado' }
  } catch { /* meta por defecto */ }
  await db.uploadBatch.update({
    where: { id: fileId },
    data: { meta: JSON.stringify(meta) },
  })
  return NextResponse.json({ ok: true, fase: 'cerrado', insertados: batch.rows })
}
