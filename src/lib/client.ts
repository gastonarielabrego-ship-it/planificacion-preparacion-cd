'use client'

// Utilidades cliente: fetch de datos y formateo

export interface FiltrosUI {
  from?: string
  to?: string
  turno?: string
  incluirBajas?: boolean
}

export async function fetchDatos<T>(modulo: string, filtros: FiltrosUI = {}): Promise<T> {
  const p = new URLSearchParams({ modulo })
  if (filtros.from) p.set('from', filtros.from)
  if (filtros.to) p.set('to', filtros.to)
  if (filtros.turno) p.set('turno', filtros.turno)
  if (filtros.incluirBajas) p.set('incluirBajas', 'true')
  const res = await fetch(`/api/data?${p.toString()}`, { cache: 'no-store' })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j.error ?? `Error ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const fmt = new Intl.NumberFormat('es-AR')
export const fmt1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })

export function n(v: number | null | undefined): string {
  if (v == null) return '—'
  return fmt.format(Math.round(v))
}
export function n1(v: number | null | undefined): string {
  if (v == null) return '—'
  return fmt1.format(v)
}
export function pct(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${fmt1.format(v)}%`
}
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y.slice(2)}`
}
export function horasHMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${fmt.format(h)} h ${m} min`
}

// Paleta del dashboard (sin azules/indigo)
export const COLORES = ['#059669', '#d97706', '#dc2626', '#0d9488', '#7c3aed', '#db2777', '#65a30d', '#ea580c', '#0f766e', '#525252', '#a16207', '#9f1239']
