import { NextRequest, NextResponse } from 'next/server'
import { ingestRows, TipoCarga, PickingMapping } from '@/lib/ingest'

export const runtime = 'nodejs'
export const maxDuration = 300

// Endpoint para el script Python: recibe lotes JSON de filas crudas.
// Body: { tipo: 'ola'|'h61'|'tm'|'picking'|'prodcirc', rows: [...], filename?, mapping?, batchId?, final? }
// Con reemplazar=true borra los datos previos del tipo antes de insertar (primer lote).

interface BatchBody {
  tipo?: string
  rows?: Record<string, unknown>[]
  filename?: string
  mapping?: PickingMapping
  batchId?: string
  final?: boolean
  reemplazar?: boolean
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BatchBody
    const tipo = body.tipo as TipoCarga
    if (!tipo || !['ola', 'h61', 'tm', 'picking', 'prodcirc'].includes(tipo)) {
      return NextResponse.json({ error: 'tipo invalido: usar ola|h61|tm|picking|prodcirc' }, { status: 400 })
    }
    if (!Array.isArray(body.rows)) return NextResponse.json({ error: 'falta rows[]' }, { status: 400 })

    const batchId = body.batchId ?? `py-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const reemplazar = body.reemplazar === true
    let res = { insertados: 0, errores: 0 }

    if (reemplazar) {
      // borrar datos previos del tipo e insertar solo este lote
      const { resetTipo } = await import('@/lib/ingest')
      await resetTipo(tipo)
      res = await ingestRows(tipo, body.rows, { batchId, filename: body.filename, mapping: body.mapping ?? null })
      // ingestRows ya registra el batch; para h61 la pre-agregacion se hace completa en cada llamada,
      // por lo que con reemplazar=true el lote debe ser unico (el script usa esa modalidad para h61)
    } else if (tipo === 'picking' || tipo === 'prodcirc') {
      // picking/prodcirc: insercion incremental por lotes (prodcirc deduplica por clave unica)
      const r = await ingestRows(tipo, body.rows, { batchId, filename: body.filename, mapping: body.mapping ?? null })
      res = { insertados: r.insertados, errores: r.errores }
      if (body.final) {
        await (await import('@/lib/db')).db.uploadBatch.create({
          data: { id: `${batchId}-meta`, tipo, filename: body.filename ?? null, rows: res.insertados, meta: 'cierre de carga incremental' },
        })
      }
    } else {
      // ola/h61/tm requieren pre-agregacion o reemplazo: acoplan los lotes en memoria del servidor
      // (el script Python los envia con reemplazar=true en un solo envio o usa la via de archivo)
      return NextResponse.json({ error: `el tipo ${tipo} debe cargarse con reemplazar=true en un unico lote, o via /api/upload` }, { status: 400 })
    }

    return NextResponse.json({ ok: true, batchId, insertados: res.insertados, errores: res.errores })
  } catch (e) {
    console.error('batch error', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error en batch' }, { status: 500 })
  }
}
