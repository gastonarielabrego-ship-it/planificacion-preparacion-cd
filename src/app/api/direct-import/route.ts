import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 300

// Importacion directa de filas ya procesadas (volcado del dataset local a produccion).
// Body: { tabla: 'ola'|'h61opdia'|'h61turnohora'|'h61circuito'|'tm', rows: [...], reemplazar?: boolean, batchId?: string, final?: boolean }
// Las filas deben venir en el formato final de la tabla (fechas como 'YYYY-MM-DD').

interface Body {
  tabla?: string
  rows?: Record<string, unknown>[]
  reemplazar?: boolean
  final?: boolean
  batchId?: string
}

const fecha = (v: unknown): Date | null => {
  if (typeof v !== 'string') return null
  const d = new Date(v.length === 10 ? v + 'T00:00:00.000Z' : v)
  return isNaN(d.getTime()) ? null : d
}
const nro = (v: unknown): number => Math.round(Number(v) || 0)
const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v))

function limpiar(tabla: string, r: Record<string, unknown>): Record<string, unknown> | null {
  const f = fecha(r.fecha)
  if (!f) return null
  if (tabla === 'ola') {
    return { fecha: f, ola: nro(r.ola), pendiente: nro(r.pendiente), total: nro(r.total) }
  }
  if (tabla === 'h61opdia') {
    if (!r.operario) return null
    return {
      fecha: f,
      operario: String(r.operario),
      nombre: str(r.nombre),
      funcion: String(r.funcion ?? '?'),
      turno: String(r.turno ?? '?'),
      horasActivas: nro(r.horasActivas),
      bultos: nro(r.bultos),
      bultosBase: nro(r.bultosBase),
      bultosExtras: nro(r.bultosExtras),
      extras: nro(r.extras),
    }
  }
  if (tabla === 'h61turnohora') {
    if (r.turno == null || r.hora == null) return null
    return { fecha: f, turno: String(r.turno), hora: nro(r.hora), bultos: nro(r.bultos), operarios: nro(r.operarios) }
  }
  if (tabla === 'h61circuito') {
    if (!r.circuito) return null
    return { fecha: f, circuito: String(r.circuito), funcion: String(r.funcion ?? '?'), bultos: nro(r.bultos) }
  }
  if (tabla === 'tm') {
    if (!r.operario) return null
    const code = r.motivoCode == null || r.motivoCode === '' ? null : nro(r.motivoCode)
    const hd = r.horaDesde == null || r.horaDesde === '' ? null : nro(r.horaDesde)
    return {
      fecha: f,
      turno: String(r.turno ?? '?'),
      operario: String(r.operario),
      nombre: str(r.nombre),
      motivoCode: code,
      categoria: String(r.categoria ?? 'OTROS'),
      detalle: str(r.detalle),
      nave: str(r.nave),
      pasillo: str(r.pasillo),
      posicion: str(r.posicion),
      minutos: nro(r.minutos),
      minutosAj: nro(r.minutosAj),
      minutosEf: nro(r.minutosEf),
      horaDesde: hd != null && hd >= 0 && hd <= 1440 ? hd : null,
      estado: str(r.estado),
      obs: str(r.obs),
    }
  }
  return null
}

async function borrar(tabla: string) {
  if (tabla === 'ola') await db.olaDia.deleteMany({})
  else if (tabla === 'h61opdia') await db.h61OpDia.deleteMany({})
  else if (tabla === 'h61turnohora') await db.h61TurnoHora.deleteMany({})
  else if (tabla === 'h61circuito') await db.h61Circuito.deleteMany({})
  else if (tabla === 'tm') await db.tiempoMuerto.deleteMany({})
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body
    const tabla = body.tabla ?? ''
    if (!['ola', 'h61opdia', 'h61turnohora', 'h61circuito', 'tm'].includes(tabla)) {
      return NextResponse.json({ error: 'tabla invalida' }, { status: 400 })
    }
    if (!Array.isArray(body.rows)) return NextResponse.json({ error: 'falta rows[]' }, { status: 400 })

    if (body.reemplazar) await borrar(tabla)

    const filas: Record<string, unknown>[] = []
    let descartadas = 0
    for (const r of body.rows) {
      const f = limpiar(tabla, r)
      if (f) filas.push(f)
      else descartadas++
    }

    const TAM = 400
    for (let i = 0; i < filas.length; i += TAM) {
      const c = filas.slice(i, i + TAM)
      if (tabla === 'ola') await db.olaDia.createMany({ data: c as never })
      else if (tabla === 'h61opdia') await db.h61OpDia.createMany({ data: c as never })
      else if (tabla === 'h61turnohora') await db.h61TurnoHora.createMany({ data: c as never })
      else if (tabla === 'h61circuito') await db.h61Circuito.createMany({ data: c as never })
      else await db.tiempoMuerto.createMany({ data: c as never })
    }

    if (body.final) {
      await db.uploadBatch.create({
        data: {
          id: body.batchId ?? `imp-${Date.now()}`,
          tipo: tabla,
          filename: 'importacion directa',
          rows: filas.length,
          meta: 'volcado a produccion',
        },
      })
    }

    return NextResponse.json({ ok: true, insertados: filas.length, descartadas })
  } catch (e) {
    console.error('direct-import error', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 500 })
  }
}
