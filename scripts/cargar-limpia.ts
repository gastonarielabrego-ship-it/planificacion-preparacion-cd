// Carga los datos reales disponibles localmente al proyecto Neon limpio:
//  - OLA 2026 (serie diaria corregida, 212 dias) desde tmp/ola-2026-corregida.json
//  - Feriados Argentina 2026 desde el espejo SQLite del sandbox
// Requiere POSTGRES_PRISMA_URL apuntando al proyecto NUEVO (limpio).
import { Database } from 'bun:sqlite'
import { readFileSync } from 'fs'
import pg from 'pg'

// leer env remapeado (valores entre comillas simples)
const envSrc = readFileSync('/tmp/neon-limpia-remap.env', 'utf8')
const getEnv = (k) => {
  const line = envSrc.split('\n').find((l) => l.startsWith(k + '='))
  if (!line) throw new Error('falta ' + k)
  return line.slice(k.length + 1).replace(/^'/, '').replace(/'$/, '')
}

const client = new pg.Client({ connectionString: getEnv('POSTGRES_PRISMA_URL'), ssl: { rejectUnauthorized: false } })
await client.connect()

// --- OLA 2026 (real) ---
const olaJson = JSON.parse(readFileSync('/home/z/my-project/tmp/ola-2026-corregida.json', 'utf8'))
const rows = olaJson.rows
await client.query('TRUNCATE "OlaDia" RESTART IDENTITY')
let n = 0
for (const r of rows) {
  await client.query(
    'INSERT INTO "OlaDia" (fecha, ola, pendiente, total) VALUES ($1, $2, $3, $4) ON CONFLICT (fecha) DO UPDATE SET ola = EXCLUDED.ola, pendiente = EXCLUDED.pendiente, total = EXCLUDED.total',
    [r.fecha + 'T00:00:00.000Z', r.ola, r.pendiente, r.total],
  )
  n++
}
console.log(`OlaDia: ${n} filas insertadas (${rows[0].fecha} a ${rows[rows.length - 1].fecha})`)

// --- FERIADOS (reales Argentina 2026) ---
const sqlite = new Database('/home/z/my-project/db/custom.db', { readonly: true })
const fer = sqlite.query('SELECT CAST(fecha as INTEGER) ts, nombre, tipo FROM Feriado ORDER BY fecha').all()
await client.query('TRUNCATE "Feriado" RESTART IDENTITY')
let f = 0
for (const r of fer) {
  // el espejo SQLite guarda fecha como epoch millis en TEXT; normalizar a medianoche UTC del dia
  const d = new Date(typeof r.ts === 'number' ? r.ts : parseInt(String(r.ts), 10))
  const iso = d.toISOString().slice(0, 10) + 'T00:00:00.000Z'
  await client.query(
    'INSERT INTO "Feriado" (fecha, nombre, tipo) VALUES ($1, $2, $3) ON CONFLICT (fecha) DO UPDATE SET nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo',
    [iso, r.nombre, r.tipo],
  )
  f++
}
console.log(`Feriado: ${f} filas insertadas`)

// --- verificacion ---
const v1 = await client.query('SELECT COUNT(*)::int n FROM "OlaDia"')
const v2 = await client.query('SELECT COUNT(*)::int n FROM "Feriado"')
const v3 = await client.query('SELECT COUNT(*)::int n FROM "H61OpDia"')
console.log(`Verificacion -> OlaDia: ${v1.rows[0].n} | Feriado: ${v2.rows[0].n} | H61OpDia: ${v3.rows[0].n} (sin datos reales aun)`)

await client.end()
