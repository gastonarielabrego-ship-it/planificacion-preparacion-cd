import { NextRequest, NextResponse } from 'next/server'
import { getResumen, getPlanificacion, getH61, getTM, getPicking, getOla, getCapacidad, getMaquinistas, getPlanificador } from '@/lib/agg'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const modulo = sp.get('modulo') ?? 'resumen'
    const filtros = {
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      turno: sp.get('turno') ?? undefined,
      funcion: sp.get('funcion') ?? undefined,
      incluirBajas: sp.get('incluirBajas') === 'true',
    }
    let data: unknown
    switch (modulo) {
      case 'resumen': data = await getResumen(); break
      case 'planificacion': data = await getPlanificacion(filtros); break
      case 'ola': data = await getOla(filtros); break
      case 'h61': data = await getH61(filtros); break
      case 'capacidad': data = await getCapacidad(filtros); break
      case 'tm': data = await getTM(filtros); break
      case 'picking': data = await getPicking(filtros); break
      case 'maq': data = await getMaquinistas(filtros); break
      case 'planificador': data = await getPlanificador(); break
      default: return NextResponse.json({ error: `modulo invalido: ${modulo}` }, { status: 400 })
    }
    return NextResponse.json(data)
  } catch (e) {
    console.error('data error', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error consultando datos' }, { status: 500 })
  }
}
