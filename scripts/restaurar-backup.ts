// RESTAURACION del backup NDJSON (download/backup-neon-2026-09-21/) a cualquier
// base Postgres (p.ej. un proyecto Neon propio del usuario). Requiere que el
// schema exista antes:  npx prisma db push --schema prisma/schema.postgres.prisma
//
// Uso:  DATABASE_URL='postgresql://...' bun scripts/restaurar-backup.ts
import { Client } from 'pg'
import { readFileSync, readdirSync } from 'fs'
import * as zlib from 'zlib'

const URL_DESTINO = process.env.DATABASE_URL
if (!URL_DESTINO) { console.error('falta DATABASE_URL'); process.exit(1) }
const DIR = '/home/z/my-project/download/backup-neon-2026-09-21'

// orden: primero tablas cabecera/dimension, luego las grandes (sin FKs reales, cualquier orden vale)
const ORDEN = ['OlaDia', 'Feriado', 'H61OpDia', 'H61TurnoHora', 'H61OpHora', 'H61Circuito', 'H61Actividad', 'MaqOpNave', 'MaqAct', 'MaqNave', 'TiempoMuerto', 'PickingEvento', 'UploadBatch']
const CHUNK = 400

async function main() {
  const cli = new Client({ connectionString: URL_DESTINO, connectionTimeoutMillis: 30000, ssl: { rejectUnauthorized: false } })
  await cli.connect()
  const archivos = readdirSync(DIR).filter((f) => f.endsWith('.ndjson.gz'))
  for (const tabla of ORDEN) {
    const file = `${DIR}/${tabla}.ndjson.gz`
    const texto = zlib.gunzipSync(readFileSync(file)).toString('utf8')
    const filas = texto.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
    if (!filas.length) { console.log(`${tabla}: 0 filas`); continue }
    const cols = Object.keys(filas[0])
    const colList = cols.map((c) => `"${c}"`).join(', ')
    let insertadas = 0
    for (let i = 0; i < filas.length; i += CHUNK) {
      const lote = filas.slice(i, i + CHUNK)
      const valores: unknown[] = []
      const tuples = lote.map((r, k) => '(' + cols.map((c, j) => { valores.push(r[c] ?? null); return `$${k * cols.length + j + 1}` }).join(', ') + ')')
      // ids preservados: reinicia la secuencia al final de cada tabla
      const res = await cli.query(`INSERT INTO "${tabla}" (${colList}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`, valores)
      insertadas += res.rowCount ?? 0
    }
    // secuencia de id
    if (cols.includes('id')) {
      await cli.query(`SELECT setval(pg_get_serial_sequence('"${tabla}"', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM "${tabla}"), 1), 1))`)
    }
    console.log(`${tabla.padEnd(14)} ${insertadas}/${filas.length} insertadas`)
  }
  await cli.end()
  console.log('RESTAURACION COMPLETA')
}
main().catch((e) => { console.error('ERROR:', String(e?.message ?? e).split('\n')[0]); process.exit(1) })
