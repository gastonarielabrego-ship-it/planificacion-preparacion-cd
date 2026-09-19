import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { listarFeriados } from '@/lib/feriados'

export const runtime = 'nodejs'
export const maxDuration = 60

// Años presentes en los datos cargados (H61 y Ola); si no hay datos, el año actual.
async function aniosDeDatos(): Promise<number[]> {
  const anios = new Set<number>()
  const extremos = await Promise.all([
    db.h61OpDia.aggregate({ _min: { fecha: true }, _max: { fecha: true } }),
    db.olaDia.aggregate({ _min: { fecha: true }, _max: { fecha: true } }),
  ])
  for (const ex of extremos) {
    for (const f of [ex._min.fecha, ex._max.fecha]) {
      if (f) anios.add(f.getUTCFullYear())
    }
  }
  if (!anios.size) anios.add(new Date().getUTCFullYear())
  return [...anios].sort()
}

export async function GET(req: NextRequest) {
  try {
    const anioParam = req.nextUrl.searchParams.get('anio')
    const forzar = req.nextUrl.searchParams.get('sync') === '1'
    const anios = anioParam ? [parseInt(anioParam, 10)].filter((a) => !isNaN(a) && a > 2000 && a < 2100) : await aniosDeDatos()
    const feriados = await listarFeriados(anios, forzar)
    return NextResponse.json({ anios, total: feriados.length, feriados, fuente: 'api.argentinadatos.com.ar (fallback embebido si la API no responde)' })
  } catch (e) {
    console.error('feriados error', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error consultando feriados' }, { status: 500 })
  }
}

// Re-sincroniza desde la API (útil si se publican cambios en el calendario).
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { anio?: number }
    const anios = body.anio ? [body.anio] : await aniosDeDatos()
    const feriados = await listarFeriados(anios, true)
    return NextResponse.json({ ok: true, anios, total: feriados.length, feriados })
  } catch (e) {
    console.error('feriados sync error', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error sincronizando feriados' }, { status: 500 })
  }
}
