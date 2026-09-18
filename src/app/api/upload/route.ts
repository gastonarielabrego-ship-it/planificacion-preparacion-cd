import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { ingestRows, TipoCarga, PickingMapping } from '@/lib/ingest'
import { workbookARecords } from '@/lib/xlsx'

export const runtime = 'nodejs'
export const maxDuration = 300

const TIPOS: TipoCarga[] = ['ola', 'h61', 'tm', 'picking']

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const tipo = form.get('tipo') as string
    const file = form.get('file') as File | null
    const mappingRaw = form.get('mapping') as string | null
    if (!TIPOS.includes(tipo as TipoCarga)) return NextResponse.json({ error: `tipo invalido: usar ${TIPOS.join('|')}` }, { status: 400 })
    if (!file) return NextResponse.json({ error: 'falta archivo' }, { status: 400 })

    const buf = Buffer.from(await file.arrayBuffer())
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
    const records = workbookARecords(tipo as TipoCarga, wb)
    if (!records.length) return NextResponse.json({ error: 'el archivo no contiene filas legibles' }, { status: 400 })

    let mapping: PickingMapping | null = null
    if (mappingRaw) { try { mapping = JSON.parse(mappingRaw) } catch { mapping = null } }

    const batchId = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const res = await ingestRows(tipo as TipoCarga, records, { batchId, filename: file.name, mapping })
    return NextResponse.json({ ok: true, ...res })
  } catch (e) {
    console.error('upload error', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error procesando archivo' }, { status: 500 })
  }
}
