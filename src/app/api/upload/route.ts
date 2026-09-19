import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { ingestRows, TipoCarga } from '@/lib/ingest'
import { workbookARecords } from '@/lib/xlsx'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 300

// Carga de archivos por la web con dos modos:
//  1) multipart/form-data con 'tipo' y 'file'  -> archivo completo (chico/mediano).
//  2) JSON { modo:'chunk', tipo, fileId, i, total, data } -> subida por partes
//     para archivos grandes (Vercel limita el body de cada request a ~4,5 MB).
//     Cada parte se guarda en UploadChunk (base64) y cuando están todas se
//     arma el buffer y se procesa igual que el modo 1.
// El script Python (python/subir_archivo.py) sigue disponible via /api/batch.
const TIPOS: TipoCarga[] = ['ola', 'h61', 'tm', 'picking', 'prodcirc']
const LIMITE_B64 = 8 * 1024 * 1024      // tope de base64 por parte (cliente usa ~2,7 MB)
const LIMITE_ARCHIVO = 300 * 1024 * 1024 // tope de seguridad del archivo armado
const TTL_CHUNKS_MS = 6 * 60 * 60 * 1000 // limpieza de partes huérfanas (>6 h)

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
    wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
  } catch {
    return NextResponse.json({ error: 'no se pudo leer el archivo (¿es un Excel/CSV válido?)' }, { status: 400 })
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

      // al iniciar una subida nueva (parte 0) limpiamos partes huérfanas de otros intentos
      if (i === 0) {
        await db.uploadChunk.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - TTL_CHUNKS_MS) } } })
      }

      await db.uploadChunk.upsert({
        where: { fileId_idx: { fileId, idx: i } },
        create: { fileId, idx: i, data },
        update: { data },
      })

      const recibidos = await db.uploadChunk.count({ where: { fileId } })
      if (recibidos < total) {
        return NextResponse.json({ ok: true, fase: 'chunk', recibidos, total })
      }

      // completas: armar el archivo original. IMPORTANTE: decodificar cada parte
      // por separado y concatenar buffers — si se concatenan los strings base64,
      // el padding '=' de cada parte corta la decodificación en la primera parte.
      const partes = await db.uploadChunk.findMany({ where: { fileId }, orderBy: { idx: 'asc' } })
      if (partes.length !== total || partes.some((p, k) => p.idx !== k)) {
        return NextResponse.json({ error: `faltan partes del archivo (${partes.length}/${total})` }, { status: 409 })
      }
      const totalB64 = partes.reduce((a, p) => a + p.data.length, 0)
      if (totalB64 > LIMITE_B64 * total + 1024) {
        return NextResponse.json({ error: 'tamaño total de partes fuera de rango' }, { status: 400 })
      }
      let buf: Buffer
      try {
        buf = Buffer.concat(partes.map((p) => Buffer.from(p.data, 'base64')))
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
