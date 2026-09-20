import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { readFileSync, existsSync, readdirSync } from 'fs'
import path from 'path'
import { ingestRows, TipoCarga } from '@/lib/ingest'
import { workbookARecords } from '@/lib/xlsx'

export const runtime = 'nodejs'
export const maxDuration = 300

// Seed desde carpeta del servidor (util para archivos grandes como H61.xlsx en el sandbox).
// Busca en /home/z/my-project/data un archivo que coincida con el tipo solicitado.
const PATRONES: Record<TipoCarga, RegExp> = {
  ola: /ola/i,
  h61: /h61/i,
  tm: /(muertos|tm)/i,
  picking: /(picking|piking|pickeo|e-?8)/i,
  maq: /(maquinista|clarkista)/i,
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { tipo?: string; filename?: string }
    const tipo = body.tipo as TipoCarga
    if (!tipo || !['ola', 'h61', 'tm', 'picking', 'maq'].includes(tipo)) {
      return NextResponse.json({ error: 'tipo invalido' }, { status: 400 })
    }

    const dir = process.env.SEED_DIR ?? '/home/z/my-project/data'
    if (!existsSync(dir)) return NextResponse.json({ error: `no existe la carpeta ${dir}` }, { status: 400 })
    const files = readdirSync(dir).filter((f) => /\.(xlsx|xls|csv)$/i.test(f))
    const candidato = body.filename
      ? files.find((f) => f === body.filename)
      : files.find((f) => PATRONES[tipo].test(f))
    if (!candidato) return NextResponse.json({ error: `no se encontro archivo para tipo ${tipo} en ${dir}. Archivos: ${files.join(', ')}` }, { status: 404 })

    const buf = readFileSync(path.join(dir, candidato))
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
    const records = workbookARecords(tipo, wb)
    if (!records.length) return NextResponse.json({ error: 'archivo sin filas legibles' }, { status: 400 })

    const batchId = `seed-${Date.now()}`
    const res = await ingestRows(tipo, records, { batchId, filename: candidato })
    return NextResponse.json({ ok: true, ...res })
  } catch (e) {
    console.error('seed error', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error en seed' }, { status: 500 })
  }
}
