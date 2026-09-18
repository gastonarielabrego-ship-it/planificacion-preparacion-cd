import { NextRequest, NextResponse } from 'next/server'
import { resetTipo, TipoCarga } from '@/lib/ingest'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { tipo?: string; todo?: boolean }
    if (body.todo) {
      for (const t of ['ola', 'h61', 'tm', 'picking'] as TipoCarga[]) await resetTipo(t)
      return NextResponse.json({ ok: true, mensaje: 'todos los datos eliminados' })
    }
    const tipo = body.tipo as TipoCarga
    if (!tipo || !['ola', 'h61', 'tm', 'picking'].includes(tipo)) {
      return NextResponse.json({ error: 'tipo invalido' }, { status: 400 })
    }
    await resetTipo(tipo)
    return NextResponse.json({ ok: true, mensaje: `datos ${tipo} eliminados` })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 500 })
  }
}
