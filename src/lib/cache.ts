// Cache de agregados para minimizar la transferencia de datos desde Neon.
//
// PROBLEMA: los modulos del dashboard procesan ~250k filas por request
// (maq 76k filas x 24 columnas de hora, h61 ~38k, picking ~42k, etc.) y las
// agregan en memoria. Cada vista del dashboard transferia decenas de MB desde
// Neon hacia Vercel, lo que agota la cuota mensual de "Data transfer" del plan
// gratuito de Neon (0.5 GB) en poquisimas visitas.
//
// SOLUCION: cachear el RESULTADO agregado de cada modulo (JSON chico, decenas
// de KB) con next/cache (unstable_cache). Solo la primera peticion consulta
// las tablas completas; el resto sirve el cache sin tocar Neon.
//
// INVALIDACION AUTOMATICA: la clave del cache incluye la "version de datos",
// derivada de UploadBatch (max id + cantidad). Al subir o borrar informacion
// la version cambia, la clave vieja nunca vuelve a coincidir y el modulo se
// recalcula solito. No hace falta invalidar manualmente en el flujo de carga.
import { unstable_cache } from 'next/cache'
import { db } from './db'

// Gracia maxima de un entry aunque la version no cambie (1 hora).
const TTL_SEG = 60 * 60

// Memo corto de la version para no repetir la consulta de version en cada
// modulo de una misma vista (6 modulos x 2 queries = 12 queries minusculas).
let memVersion: { v: string; at: number } | null = null

export async function dataVersion(): Promise<string> {
  if (memVersion && Date.now() - memVersion.at < 30_000) return memVersion.v
  // max id + count + sum(rows) + max(createdAt) cubre todos los flujos:
  // alta de batch (id/createdAt ↑), borrado (count ↓), carga incremental
  // picking (upsert que incrementa rows sin cambiar id). El count de feriados
  // porque su alta tambien afecta agregados (capacidad) sin pasar por batches.
  const [mx, cnt, sum, ct, fer] = await Promise.all([
    db.uploadBatch.aggregate({ _max: { id: true } }),
    db.uploadBatch.count(),
    db.uploadBatch.aggregate({ _sum: { rows: true } }),
    db.uploadBatch.aggregate({ _max: { createdAt: true } }),
    db.feriado.aggregate({ _count: true }),
  ])
  const v = `v${mx._max.id ?? 0}-${cnt}-${sum._sum.rows ?? 0}-${ct._max.createdAt?.getTime() ?? 0}-${fer._count}`
  memVersion = { v, at: Date.now() }
  return v
}

// Ultimo resultado valido por modulo|clave (en memoria del lambda). Si Neon
// queda inaccesible (cuota agotada, outage, cold start sin red), servimos el
// ultimo agregado conocido en vez de romper el dashboard con un 500.
const ultimoBueno = new Map<string, unknown>()

// Normaliza Dates a ISO strings ANTES de cachear: unstable_cache serializa a
// JSON, y asi el valor cacheado y el recien calculado tienen EXACTAMENTE la
// misma forma (sin Dates la primera vez y strings la segunda).
function aJsonSeguro<T>(v: T): T {
  if (v == null) return v
  if (v instanceof Date) return v.toISOString() as unknown as T
  if (Array.isArray(v)) return v.map(aJsonSeguro) as unknown as T
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = aJsonSeguro(val)
    return out as T
  }
  return v
}

export async function cachedAgg<T>(modulo: string, clave: string, fn: () => Promise<T>): Promise<T> {
  const k = `${modulo}|${clave || '-'}`
  let version: string
  try {
    version = await dataVersion()
  } catch {
    // sin conexion para ni leer la version: directos al ultimo bueno
    version = 'sin-conexion'
  }
  const wrapper = unstable_cache(
    async () => aJsonSeguro(await fn()),
    [`agg-${modulo}-${version}-${clave || '-'}`],
    { revalidate: TTL_SEG, tags: ['datos'] },
  )
  try {
    const r = await wrapper()
    ultimoBueno.set(k, r)
    return r
  } catch (e) {
    const fallback = ultimoBueno.get(k)
    if (fallback !== undefined) {
      console.warn(`cachedAgg: Neon inaccesible, sirviendo ultimo agregado conocido de ${modulo}`)
      return fallback as T
    }
    throw e
  }
}
