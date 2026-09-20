import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { ingestRows, TipoCarga } from '@/lib/ingest'
import { workbookARecords, filasDelWorkbook } from '@/lib/xlsx'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 300

// Carga de archivos por la web con dos modos:
//  1) multipart/form-data con 'tipo' y 'file'  -> archivo completo (chico/mediano).
//  2) JSON { modo:'chunk', tipo, fileId, i, total, data } -> subida por partes
//     para archivos grandes (Vercel limita el body de cada request a ~4,5 MB).
//     Cada parte se guarda en UploadChunk. Para los tipos con agregación
//     (ola/h61/tm/maq) al completarse se arma el buffer y se procesa acá.
//     Para PICKING (E-8, cientos de miles de eventos) NO se procesa acá: se
//     responde fase:'armado' y el cliente dirige /api/upload/procesar por
//     pasos (parseo -> insertar -> cerrar); procesar todo en esta llamada
//     superaba el timeout de Vercel (HTTP 504).
// El script Python (python/subir_archivo.py) sigue disponible via /api/batch.
const TIPOS: TipoCarga[] = ['ola', 'h61', 'tm', 'picking', 'maq']
const LIMITE_B64 = 8 * 1024 * 1024      // tope de base64 por parte (cliente usa ~2,7 MB)
const LIMITE_ARCHIVO = 200 * 1024 * 1024 // tope de seguridad del archivo armado (la base Neon tiene tope 512 MB)
const TTL_STAGE_MS = 2 * 60 * 60 * 1000  // tandas de stage huérfanas (>2 h)

// La base Neon tiene un tope duro de proyecto (512 MB). Si se supera, Postgres
// rechaza cualquier INSERT/UPDATE con el código 53100. Traducimos eso a un
// mensaje claro (HTTP 507) en lugar del error críptico de Prisma.
function esBaseLlena(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.message} ${String((e as { meta?: unknown }).meta ?? '')}` : String(e)
  return msg.includes('53100') || msg.includes('size limit') || msg.includes('512 MB')
}
function respuestaBaseLlena() {
  return NextResponse.json({
    error: 'La base de datos alcanzó su límite de espacio (512 MB). Entra a Carga de Datos y usá el botón "Liberar espacio" (mantenimiento); después reintentá la subida.',
  }, { status: 507 })
}

interface ChunkBody {
  modo?: string
  tipo?: string
  fileId?: string
  nombre?: string
  i?: number
  total?: number
  data?: string
}

async function procesarBuffer(tipo: TipoCarga, buf: Buffer, nombre: string) {
  let wb: XLSX.WorkBook
  try {
    // dense: celdas en arrays compactos — imprescindible para archivos grandes
    // (el H61 real ~26 MB consume >2 GB con lectura estándar y voltea la función)
    wb = XLSX.read(buf, { type: 'buffer', cellDates: true, dense: true })
  } catch {
    return NextResponse.json({ error: 'no se pudo leer el archivo (¿es un Excel/CSV válido?)' }, { status: 400 })
  }

  if (tipo === 'h61' || tipo === 'maq' || tipo === 'picking') {
    // Tipos con muchas filas: streaming con generador (una fila viva por vez)
    // en lugar del array completo de records.
    const it = filasDelWorkbook(wb)
    const primera = it.next()
    if (primera.done || !primera.value || !Object.keys(primera.value).length) {
      return NextResponse.json({ error: 'el archivo no tiene filas legibles' }, { status: 400 })
    }
    function* filas(): Generator<Record<string, unknown>> {
      yield primera.value
      yield* it
    }
    const res = await ingestRows(tipo, filas(), { batchId: `up-${Date.now()}`, filename: nombre })
    if (res.insertados === 0) {
      return NextResponse.json({ error: `el archivo no tuvo filas utilizables (${res.errores} descartadas — ¿faltan FECHA u OPERARIO?)` }, { status: 400 })
    }
    return NextResponse.json({ ok: true, tipo, insertados: res.insertados, errores: res.errores, desde: res.desde, hasta: res.hasta })
  }

  const records = workbookARecords(tipo, wb)
  if (!records.length) {
    return NextResponse.json({ error: 'el archivo no tiene filas legibles' }, { status: 400 })
  }
  const res = await ingestRows(tipo, records, { batchId: `up-${Date.now()}`, filename: nombre })
  return NextResponse.json({ ok: true, tipo, insertados: res.insertados, errores: res.errores, desde: res.desde, hasta: res.hasta })
}

export async function POST(req: NextRequest) {
  try {
    const ctype = req.headers.get('content-type') ?? ''

    // ---------- MODO 2: subida por chunks (JSON) ----------
    if (ctype.includes('application/json')) {
      const body = (await req.json()) as ChunkBody
      const tipo = String(body.tipo ?? '') as TipoCarga
      if (!TIPOS.includes(tipo)) {
        return NextResponse.json({ error: `tipo invalido: ${body.tipo || '(vacío)'}` }, { status: 400 })
      }
      const fileId = String(body.fileId ?? '').slice(0, 120)
      const i = Number(body.i)
      const total = Number(body.total)
      const data = typeof body.data === 'string' ? body.data : ''
      if (!fileId || !Number.isInteger(i) || !Number.isInteger(total) || total < 1 || total > 2000 || i < 0 || i >= total) {
        return NextResponse.json({ error: 'parámetros de chunk invalidos' }, { status: 400 })
      }
      if (!data || data.length > LIMITE_B64) {
        return NextResponse.json({ error: `parte fuera de rango (tamaño ${data.length})` }, { status: 400 })
      }

      // al iniciar una subida nueva (parte 0) limpiamos TODO lo que quedó de
      // intentos anteriores: cada reintento re-suben todas las partes desde
      // cero, así que ninguna parte vieja sirve. Con el TTL de 6 h viejo, dos
      // o tres reintentos del mismo archivo llenaban la base (512 MB, error
      // 53100). También tandas de stage huérfanas de parseos abandonados.
      if (i === 0) {
        try {
          await db.uploadChunk.deleteMany({})
          await db.uploadStage.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - TTL_STAGE_MS) } } })
        } catch (e) {
          if (esBaseLlena(e)) return respuestaBaseLlena()
          throw e
        }
      }

      try {
        await db.uploadChunk.upsert({
          where: { fileId_idx: { fileId, idx: i } },
          create: { fileId, idx: i, data: Buffer.from(data, 'base64') },
          update: { data: Buffer.from(data, 'base64') },
        })
      } catch (e) {
        if (esBaseLlena(e)) return respuestaBaseLlena()
        throw e
      }

      const recibidos = await db.uploadChunk.count({ where: { fileId } })
      if (recibidos < total) {
        return NextResponse.json({ ok: true, fase: 'chunk', recibidos, total })
      }

      // PICKING: validación liviana (solo índices, sin cargar los datos) y el
      // cliente continúa por pasos en /api/upload/procesar. Las partes se
      // conservan: las consume el paso 'parseo' y ahí se borran.
      if (tipo === 'picking') {
        const idxs = await db.uploadChunk.findMany({ where: { fileId }, orderBy: { idx: 'asc' }, select: { idx: true } })
        if (idxs.length !== total || idxs.some((p, k) => p.idx !== k)) {
          return NextResponse.json({ error: `faltan partes del archivo (${idxs.length}/${total})` }, { status: 409 })
        }
        return NextResponse.json({ ok: true, fase: 'armado', fileId, total, tipo })
      }

      // completas: armar el archivo original. IMPORTANTE: decodificar cada parte
      // por separado y concatenar buffers — si se concatenan los strings base64,
      // el padding '=' de cada parte corta la decodificación en la primera parte.
      const partes = await db.uploadChunk.findMany({ where: { fileId }, orderBy: { idx: 'asc' } })
      if (partes.length !== total || partes.some((p, k) => p.idx !== k)) {
        return NextResponse.json({ error: `faltan partes del archivo (${partes.length}/${total})` }, { status: 409 })
      }
      const totalBytes = partes.reduce((a, p) => a + p.data.length, 0)
      if (totalBytes > LIMITE_B64 * total + 1024) {
        return NextResponse.json({ error: 'tamaño total de partes fuera de rango' }, { status: 400 })
      }
      let buf: Buffer
      try {
        // data ahora es Bytes (bytea/blob): Prisma lo devuelve como Uint8Array/Buffer
        buf = Buffer.concat(partes.map((p) => Buffer.from(p.data as unknown as Uint8Array)))
      } catch {
        return NextResponse.json({ error: 'no se pudo decodificar el archivo' }, { status: 400 })
      }
      if (buf.length < 1 || buf.length > LIMITE_ARCHIVO) {
        return NextResponse.json({ error: `tamaño de archivo fuera de rango (${Math.round(buf.length / 1024)} KB)` }, { status: 400 })
      }
      try {
        return await procesarBuffer(tipo, buf, String(body.nombre ?? fileId).slice(0, 200))
      } finally {
        // las partes ya no se necesitan (el reintento vuelve a subir todo)
        await db.uploadChunk.deleteMany({ where: { fileId } })
      }
    }

    // ---------- MODO 1: archivo completo (multipart, sin cambios) ----------
    const fd = await req.formData()
    const tipo = String(fd.get('tipo') ?? '')
    const file = fd.get('file')
    if (!TIPOS.includes(tipo as TipoCarga)) {
      return NextResponse.json({ error: `tipo invalido: ${tipo || '(vacío)'}` }, { status: 400 })
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'falta el archivo' }, { status: 400 })
    }

    const buf = Buffer.from(await file.arrayBuffer())
    return await procesarBuffer(tipo as TipoCarga, buf, file.name)
  } catch (e) {
    console.error('upload error', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error procesando el archivo' }, { status: 500 })
  }
}
