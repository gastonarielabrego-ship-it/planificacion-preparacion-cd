// MIGRACION COMPLETA: Neon original (bloqueado por cuota) -> proyecto Neon limpio.
// EJECUTAR SOLO CUANDO EL PROYECTO ORIGINAL ESTE DESBLOQUEADO (plan mejorado).
//
//   node --experimental-strip-types scripts/migrar-original-a-limpia.ts
//   (o: bun scripts/migrar-original-a-limpia.ts)
//
// Lee:  fuente = /tmp/.env.vercel-original  (POSTGRES_PRISMA_URL del proyecto original)
// Escribe: destino = /tmp/neon-limpia-remap.env (POSTGRES_PRISMA_URL del proyecto limpio)
// Estrategia: por tabla, lee por lotes de la fuente e inserta en el destino
// preservando ids; al final ajusta las secuencias. OlaDia/Feriado ya cargados
// quedan intactos (ON CONFLICT DO NOTHING).
import { readFileSync } from 'fs'
import pg from 'pg'

const leerEnv = (file: string, key: string): string => {
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(key + '='))
  if (!line) throw new Error(`falta ${key} en ${file}`)
  return line.slice(key.length + 1).replace(/^["']/, '').replace(/["']$/, '')
}

const SRC = new pg.Client({ connectionString: leerEnv('/tmp/.env.vercel-original', 'POSTGRES_PRISMA_URL'), ssl: { rejectUnauthorized: false } })
const DST = new pg.Client({ connectionString: leerEnv('/tmp/neon-limpia-remap.env', 'POSTGRES_PRISMA_URL'), ssl: { rejectUnauthorized: false } })

// tablas en orden dependiente-natural (sin FKs reales, cualquier orden vale)
const TABLAS: { nombre: string; conflict: string; cols: (r: Record<string, unknown>) => string[] }[] = [
  { nombre: 'OlaDia', conflict: '("fecha")', cols: () => ['fecha', 'ola', 'pendiente', 'total'] },
  { nombre: 'Feriado', conflict: '("fecha")', cols: () => ['fecha', 'nombre', 'tipo'] },
  { nombre: 'H61OpDia', conflict: '("id")', cols: () => null as never }, // columnas dinamicas desde information_schema
  { nombre: 'H61TurnoHora', conflict: '("id")', cols: () => null as never },
  { nombre: 'H61OpHora', conflict: '("id")', cols: () => null as never },
  { nombre: 'H61Circuito', conflict: '("id")', cols: () => null as never },
  { nombre: 'H61Actividad', conflict: '("id")', cols: () => null as never },
  { nombre: 'MaqOpNave', conflict: '("fecha","turno","operario","actividad","nave")', cols: () => null as never },
  { nombre: 'MaqAct', conflict: '("id")', cols: () => null as never },
  { nombre: 'MaqNave', conflict: '("id")', cols: () => null as never },
  { nombre: 'TiempoMuerto', conflict: '("id")', cols: () => null as never },
  { nombre: 'PickingEvento', conflict: '("id")', cols: () => null as never },
  { nombre: 'UploadBatch', conflict: '("id")', cols: () => null as never },
]

const CHUNK = 500

async function columnas(cli: pg.Client, tabla: string): Promise<string[]> {
  const r = await cli.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' ORDER BY ordinal_position`,
    [tabla],
  )
  return r.rows.map((x) => x.column_name)
}

const q = (s: string) => '"' + s + '"'

async function migrarTabla(tabla: string, conflict: string) {
  const cols = await columnas(SRC, tabla)
  const colList = cols.map(q).join(', ')
  const { rows: cnt } = await SRC.query(`SELECT COUNT(*)::int n FROM ${q(tabla)}`)
  const total = cnt[0].n
  if (total === 0) { console.log(`${tabla}: 0 filas (omitida)`); return }
  let insertadas = 0
  for (let off = 0; off < total; off += CHUNK) {
    const { rows } = await SRC.query(`SELECT ${colList} FROM ${q(tabla)} ORDER BY 1 LIMIT ${CHUNK} OFFSET ${off}`)
    if (!rows.length) break
    const valores: unknown[] = []
    const tuples = rows.map((r, i) => {
      const ph = cols.map((c, j) => {
        valores.push(r[c])
        return `$${i * cols.length + j + 1}`
      })
      return '(' + ph.join(', ') + ')'
    })
    const sql = `INSERT INTO ${q(tabla)} (${colList}) VALUES ${tuples.join(', ')} ON CONFLICT ${conflict} DO NOTHING`
    const res = await DST.query(sql, valores)
    insertadas += res.rowCount ?? 0
  }
  console.log(`${tabla}: ${total} leidas, ${insertadas} insertadas`)
}

async function ajustarSecuencias() {
  const { rows } = await DST.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='id' AND table_name NOT IN ('UploadBatch') AND column_default LIKE 'nextval%' GROUP BY table_name`)
  for (const { table_name } of rows) {
    await DST.query(`SELECT setval(pg_get_serial_sequence('${table_name}', 'id'), COALESCE((SELECT MAX(id) FROM ${q(table_name)}), 1))`)
  }
  console.log(`secuencias ajustadas: ${rows.length} tablas`)
}

;(async () => {
  console.log('conectando...')
  await SRC.connect()
  await DST.connect()
  console.log('migrando (original -> limpia)...')
  for (const t of TABLAS) await migrarTabla(t.nombre, t.conflict)
  await ajustarSecuencias()
  const ver = await DST.query(`SELECT 'OlaDia' t, COUNT(*)::int n FROM "OlaDia" UNION ALL SELECT 'H61OpDia', COUNT(*)::int FROM "H61OpDia" UNION ALL SELECT 'TiempoMuerto', COUNT(*)::int FROM "TiempoMuerto" UNION ALL SELECT 'PickingEvento', COUNT(*)::int FROM "PickingEvento" UNION ALL SELECT 'MaqOpNave', COUNT(*)::int FROM "MaqOpNave" UNION ALL SELECT 'UploadBatch', COUNT(*)::int FROM "UploadBatch"`)
  console.log('VERIFICACION DESTINO:', ver.rows.map((r) => `${r.t}=${r.n}`).join(' | '))
  await SRC.end()
  await DST.end()
  console.log('MIGRACION COMPLETA ✓')
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
