import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { ingestRows, TipoCarga } from '@/lib/ingest'
import { workbookARecords } from '@/lib/xlsx'

export const runtime = 'nodejs'
export const maxDuration = 300

// Carga de archivos por la web (multipart/form-data con 'tipo' y 'file').
// Complementa la via del script Python para archivos chicos/medianos; en
// Vercel el body tiene un limite de ~4,5 MB, para archivos grandes usar
// python/subir_archivo.py contra /api/batch.
const TIPOS: TipoCarga[] = ['ola', 'h61', 'tm', 'picking', 'prodcirc']

export async function POST(req: NextRequest) {
  try {
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
    let wb: XLSX.WorkBook
    try {
      wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
    } catch {
      return NextResponse.json({ error: 'no se pudo leer el archivo (¿es un Excel/CSV válido?)' }, { status: 400 })
    }
    const records = workbookARecords(tipo as TipoCarga, wb)
    if (!records.length) {
      return NextResponse.json({ error: 'el archivo no tiene filas legibles' }, { status: 400 })
    }

    const res = await ingestRows(tipo as TipoCarga, records, { batchId: `up-${Date.now()}`, filename: file.name })
    return NextResponse.json({ ok: true, tipo, insertados: res.insertados, errores: res.errores, desde: res.desde, hasta: res.hasta })
  } catch (e) {
    console.error('upload error', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error procesando el archivo' }, { status: 500 })
  }
}
