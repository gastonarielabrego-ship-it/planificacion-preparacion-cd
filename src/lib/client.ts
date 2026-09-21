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

// Paleta institucional Grupo Gestion: verde #7CB93E, naranja #F08A00, gris #58595B
export const GG_VERDE = '#7CB93E'
export const GG_NARANJA = '#F08A00'
export const GG_GRIS = '#58595B'
export const GG_VERDE_OSCURO = '#5C9429'
export const COLORES = [GG_VERDE, GG_NARANJA, GG_GRIS, '#0d9488', '#dc2626', '#7c3aed', GG_VERDE_OSCURO, '#ea580c', '#a3a3a3', '#65a30d', '#a16207', '#9f1239']
