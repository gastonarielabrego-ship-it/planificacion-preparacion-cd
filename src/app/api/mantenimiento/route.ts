import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 120

// Mantenimiento de la base (Neon tiene un tope duro de proyecto de 512 MB;
// al superarlo Postgres rechaza todo INSERT con el error 53100 "could not
// extend file ... project size limit").
//
//  GET  -> diagnóstico: ocupación por tabla, filas de staging y tamaño de la base.
//  POST -> limpieza: borra UploadChunk y UploadStage (staging transitorio de
//          subidas: si quedaron de intentos abortados solo ocupan espacio) y
//          ejecuta VACUUM ANALYZE para que Postgres reutilice el espacio libre
//          dentro de los archivos existentes (el tope bloquea extender archivos,
//          no reutilizar páginas libres). NUNCA toca tablas de datos.
//
// Las consultas de tamaño son específicas de Postgres: en el sandbox (SQLite)
// se devuelven solo los conteos.

const TABLAS: { model: string; nombre: string }[] = [
  { model: 'olaDia', nombre: 'OlaDia' },
  { model: 'h61OpDia', nombre: 'H61OpDia' },
  { model: 'h61TurnoHora', nombre: 'H61TurnoHora' },
  { model: 'h61OpHora', nombre: 'H61OpHora' },
  { model: 'h61Circuito', nombre: 'H61Circuito' },
  { model: 'h61Actividad', nombre: 'H61Actividad' },
  { model: 'maqOpNave', nombre: 'MaqOpNave' },
  { model: 'maqAct', nombre: 'MaqAct' },
  { model: 'maqNave', nombre: 'MaqNave' },
  { model: 'tiempoMuerto', nombre: 'TiempoMuerto' },
  { model: 'pickingEvento', nombre: 'PickingEvento' },
  { model: 'feriado', nombre: 'Feriado' },
  { model: 'uploadBatch', nombre: 'UploadBatch' },
  { model: 'uploadChunk', nombre: 'UploadChunk' },
  { model: 'uploadStage', nombre: 'UploadStage' },
]

async function tamanosPostgres(): Promise<{ base: number | null; tablas: FilaTam[] }> {
  try {
    const baseQ = await db.$queryRawUnsafe<{ size: bigint | number }[]>(`SELECT pg_database_size(current_database()) AS size`)
    const tablasQ = await db.$queryRawUnsafe<{ tabla: string; bytes: bigint | number }[]>(`
      SELECT c.relname AS tabla, pg_total_relation_size(c.oid) AS bytes
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC`)
    return {
      base: Number(baseQ[0]?.size ?? 0),
      tablas: tablasQ.map((r) => ({ tabla: r.tabla, bytes: Number(r.bytes) })),
    }
  } catch {
    return { base: null, tablas: [] } // sandbox SQLite u otra base sin esas funciones
  }
}

type FilaTam = { tabla: string; bytes: number }

async function conteos() {
  const out: Record<string, number> = {}
  for (const t of TABLAS) {
    try {
      out[t.nombre] = await (db as unknown as Record<string, { count: () => Promise<number> }>)[t.model].count()
    } catch {
      out[t.nombre] = -1 // tabla inexistente (aún no migrada)
    }
  }
  return out
}

const mb = (b: number | null) => (b === null ? null : Math.round((b / 1024 / 1024) * 10) / 10)

export async function GET() {
  try {
    const [tam, conteosOut] = await Promise.all([tamanosPostgres(), conteos()])
    return NextResponse.json({
      ok: true,
      baseBytes: tam.base,
      baseMB: mb(tam.base),
      topeMB: 512,
      tablas: tam.tablas.map((t) => ({ tabla: t.tabla, MB: mb(t.bytes) })),
      filas: conteosOut,
      staging: {
        chunks: conteosOut.UploadChunk,
        stage: conteosOut.UploadStage,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 500 })
  }
}

export async function POST() {
  try {
    // Limpieza del staging transitorio de subidas. Si quedaron partes/tandas de
    // intentos abortados solo ocupan espacio: cada reintento re-submite todo.
    const chunks = await db.uploadChunk.deleteMany({}).then((r) => r.count)
    const tandas = await db.uploadStage.deleteMany({}).then((r) => r.count)

    // VACUUM: marca el espacio de las filas borradas como reutilizable (no
    // puede correr dentro de una transacción; Prisma lo ejecuta en autocommit)
    const vacuums: string[] = []
    for (const t of ['UploadChunk', 'UploadStage', 'UploadBatch']) {
      try {
        await db.$executeRawUnsafe(`VACUUM ANALYZE "${t}"`)
        vacuums.push(t)
      } catch {
        // sandbox SQLite o pooler que lo rechace: la limpieza DELETE ya ayudó
      }
    }

    const tam = await tamanosPostgres()
    return NextResponse.json({
      ok: true,
      borrado: { UploadChunk: chunks, UploadStage: tandas },
      vacuums,
      baseBytes: tam.base,
      baseMB: mb(tam.base),
      tablas: tam.tablas.map((t) => ({ tabla: t.tabla, MB: mb(t.bytes) })),
      mensaje: `Staging vaciado (partes: ${chunks}, tandas: ${tandas}). El espacio quedó disponible para nuevas cargas.`,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 500 })
  }
}
