// Feriados nacionales de Argentina.
// Fuente primaria: api.argentinadatos.com.ar (API pública, sin clave).
// Fallback embebido 2026: se usa si la API no responde (p. ej. red sin salida).
// Los feriados se persisten en la tabla Feriado para que la app funcione
// incluso cuando la API no esté disponible.

import { db } from '@/lib/db'

export interface FeriadoInfo {
  fecha: string // ISO yyyy-mm-dd
  nombre: string
  tipo: string // inamovible | trasladable | puente
}

const API_BASE = 'https://api.argentinadatos.com.ar/v1/feriados'

// Calendario oficial 2026 (Ley 27.399 + puentes del decreto reglamentario).
const FALLBACK: Record<number, FeriadoInfo[]> = {
  2026: [
    { fecha: '2026-01-01', nombre: 'Año Nuevo', tipo: 'inamovible' },
    { fecha: '2026-02-16', nombre: 'Carnaval', tipo: 'inamovible' },
    { fecha: '2026-02-17', nombre: 'Carnaval', tipo: 'inamovible' },
    { fecha: '2026-03-24', nombre: 'Día Nacional de la Memoria por la Verdad y la Justicia', tipo: 'inamovible' },
    { fecha: '2026-04-02', nombre: 'Día del Veterano y de los Caídos en la Guerra de Malvinas', tipo: 'inamovible' },
    { fecha: '2026-04-03', nombre: 'Viernes Santo', tipo: 'inamovible' },
    { fecha: '2026-05-01', nombre: 'Día del Trabajador', tipo: 'inamovible' },
    { fecha: '2026-05-25', nombre: 'Día de la Revolución de Mayo', tipo: 'inamovible' },
    { fecha: '2026-06-15', nombre: 'Paso a la Inmortalidad del General Güemes', tipo: 'trasladable' },
    { fecha: '2026-06-20', nombre: 'Día de la Bandera', tipo: 'inamovible' },
    { fecha: '2026-07-09', nombre: 'Día de la Independencia', tipo: 'inamovible' },
    { fecha: '2026-08-17', nombre: 'Paso a la Inmortalidad del General San Martín', tipo: 'trasladable' },
    { fecha: '2026-10-12', nombre: 'Respeto a la Diversidad Cultural', tipo: 'trasladable' },
    { fecha: '2026-11-16', nombre: 'Día Nacional de la Soberanía', tipo: 'trasladable' },
    { fecha: '2026-11-23', nombre: 'Feriado con fines turísticos', tipo: 'puente' },
    { fecha: '2026-12-07', nombre: 'Feriado con fines turísticos', tipo: 'puente' },
    { fecha: '2026-12-08', nombre: 'Inmaculada Concepción de María', tipo: 'inamovible' },
    { fecha: '2026-12-25', nombre: 'Navidad', tipo: 'inamovible' },
  ],
}

const isoDe = (d: Date) => d.toISOString().slice(0, 10)

async function fetchApi(anio: number): Promise<FeriadoInfo[]> {
  const res = await fetch(`${API_BASE}/${anio}`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' })
  if (!res.ok) throw new Error(`API feriados HTTP ${res.status}`)
  const raw = (await res.json()) as { dia?: string; nombre?: string; tipo?: string }[]
  const out: FeriadoInfo[] = []
  for (const r of raw) {
    if (!r?.dia || !/^\d{4}-\d{2}-\d{2}/.test(r.dia)) continue
    out.push({ fecha: r.dia.slice(0, 10), nombre: r.nombre ?? 'Feriado', tipo: r.tipo ?? 'inamovible' })
  }
  if (!out.length) throw new Error('API feriados sin datos')
  return out
}

async function upsertFeriados(anio: number, lista: FeriadoInfo[]): Promise<number> {
  const desde = new Date(`${anio}-01-01T00:00:00.000Z`)
  const hasta = new Date(`${anio}-12-31T23:59:59.999Z`)
  await db.feriado.deleteMany({ where: { fecha: { gte: desde, lte: hasta } } })
  const unicos = new Map<string, FeriadoInfo>()
  for (const f of lista) unicos.set(f.fecha, f)
  await db.feriado.createMany({
    data: [...unicos.values()].map((f) => ({ fecha: new Date(`${f.fecha}T00:00:00.000Z`), nombre: f.nombre, tipo: f.tipo })),
  })
  return unicos.size
}

// Sincroniza un año: intenta la API y si falla usa el fallback embebido.
// Devuelve la cantidad de feriados guardados (0 si no se pudo).
export async function sincronizarAnio(anio: number): Promise<number> {
  let lista: FeriadoInfo[] = []
  let ok = false
  try {
    lista = await fetchApi(anio)
    ok = true
  } catch {
    lista = FALLBACK[anio] ?? []
  }
  if (!lista.length) return 0
  const n = await upsertFeriados(anio, lista)
  console.log(`feriados ${anio}: ${n} guardados (${ok ? 'API' : 'fallback'})`)
  return n
}

// Cache en memoria del proceso (serverless: efímero, pero evita repetir
// sincronizaciones dentro de la misma invocación / instancias tibias).
let cache: { map: Map<string, { nombre: string; tipo: string }>; expira: number } | null = null
let enVuelo: Promise<Map<string, { nombre: string; tipo: string }>> | null = null
const TTL_MS = 6 * 60 * 60 * 1000

async function construir(anios: number[], forzar: boolean): Promise<Map<string, { nombre: string; tipo: string }>> {
  for (const anio of anios) {
    const desde = new Date(`${anio}-01-01T00:00:00.000Z`)
    const hasta = new Date(`${anio}-12-31T23:59:59.999Z`)
    const existentes = await db.feriado.count({ where: { fecha: { gte: desde, lte: hasta } } })
    if (existentes === 0 || forzar) await sincronizarAnio(anio)
  }
  const rows = await db.feriado.findMany({ orderBy: { fecha: 'asc' } })
  const map = new Map<string, { nombre: string; tipo: string }>()
  for (const r of rows) map.set(isoDe(r.fecha), { nombre: r.nombre, tipo: r.tipo })
  return map
}

// Mapa de feriados { '2026-08-17': { nombre, tipo } } para los años pedidos.
// Sincroniza automáticamente los años que aún no están en la tabla.
export async function getFeriadosMap(anios: number[], forzar = false): Promise<Map<string, { nombre: string; tipo: string }>> {
  if (!anios.length) return new Map()
  if (!forzar && cache && cache.expira > Date.now()) {
    // años ya cubiertos por el cache
    const faltan = anios.filter((a) => ![...cache!.map.keys()].some((k) => k.startsWith(String(a))))
    if (!faltan.length) return cache.map
  }
  if (!enVuelo) {
    enVuelo = construir(anios, forzar)
      .then((m) => {
        cache = { map: m, expira: Date.now() + TTL_MS }
        return m
      })
      .finally(() => {
        enVuelo = null
      })
  }
  return enVuelo
}

// Lista plana ordenada (para la API de feriados).
export async function listarFeriados(anios: number[], forzar = false): Promise<FeriadoInfo[]> {
  const map = await getFeriadosMap(anios, forzar)
  return [...map.entries()].map(([fecha, v]) => ({ fecha, nombre: v.nombre, tipo: v.tipo })).sort((a, b) => a.fecha.localeCompare(b.fecha))
}
