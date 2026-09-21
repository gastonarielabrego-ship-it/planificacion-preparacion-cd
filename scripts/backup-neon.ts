// BACKUP COMPLETO de la base limpia de Neon -> NDJSON comprimido por tabla.
// Salida: /home/z/my-project/download/backup-neon-2026-09-21/<tabla>.ndjson.gz
// Restaurar con: bun scripts/restaurar-backup.ts <DATABASE_URL> (tras prisma db push)
// Uso: bun scripts/backup-neon.ts
import { Client } from 'pg'
import { readFileSync, mkdirSync, createWriteStream, writeFileSync } from 'fs'
import * as zlib from 'zlib'
import { pipeline } from 'stream'
const OUT = '/home/z/my-project/download/backup-neon-2026-09-21'
const SOLO = process.argv[2] ? process.argv[2].split(',') : null

const env = readFileSync('/tmp/neon-limpia-remap.env', 'utf8')
const get = (k: string): string => {
  const line = env.split('\n').find((l) => l.startsWith(k + '=')) ?? ''
  return line.slice(k.length + 1).replace(/^['"]/, '').replace(/['"]$/, '')
}

const TABLAS = [
  'OlaDia', 'Feriado',
  'H61OpDia', 'H61TurnoHora', 'H61OpHora', 'H61Circuito', 'H61Actividad',
  'MaqOpNave', 'MaqAct', 'MaqNave',
  'TiempoMuerto', 'PickingEvento', 'UploadBatch',
]
const CHUNK = 20000

async function main() {
  mkdirSync(OUT, { recursive: true })
  const cli = new Client({ connectionString: get('POSTGRES_PRISMA_URL'), connectionTimeoutMillis: 30000, ssl: { rejectUnauthorized: false } })
  for (let i = 1; i <= 8; i++) {
    try { await cli.connect(); break } catch (e) { console.log(`conexion intento ${i} fallo`); await new Promise(r => setTimeout(r, 6000)) }
  }
  const manifiesto: string[] = ['# Backup Neon - base limpia (ep-flat-cell-b4mvnhol) - ' + new Date().toISOString(), '# Restaurar: prisma db push (schema.postgres.prisma) + bun scripts/restaurar-backup.ts <URL>', '']
  for (const t of TABLAS) {
    if (SOLO && !SOLO.includes(t)) continue
    const { rows: cnt } = await cli.query(`SELECT COUNT(*)::int n FROM "${t}"`)
    const total = cnt[0].n
    if (total === 0) { console.log(`${t.padEnd(14)} 0 filas (omitida)`); continue }
    const file = `${OUT}/${t}.ndjson.gz`
    const gz = zlib.createGzip({ level: 6 })
    const ws = createWriteStream(file)
    gz.pipe(ws)
    let offset = 0
    while (offset < total) {
      const { rows } = await cli.query(`SELECT * FROM "${t}" ORDER BY 1 LIMIT ${CHUNK} OFFSET ${offset}`)
      if (!rows.length) break
      const texto = rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
      if (!gz.write(Buffer.from(texto))) await new Promise<void>((res) => gz.once('drain', () => res()))
      offset += rows.length
    }
    gz.end()
    await new Promise<void>((res) => ws.on('close', () => res()))
    console.log(`${t.padEnd(14)} ${String(total).padStart(7)} filas`)
    manifiesto.push(`${t}: ${total} filas -> ${t}.ndjson.gz`)
  }
  writeFileSync(`${OUT}/MANIFIESTO.txt`, manifiesto.join('\n') + '\n')
  console.log('OK backup en', OUT)
  await cli.end()
}
main().catch((e) => { console.error('ERROR:', String(e?.message ?? e).split('\n')[0]); process.exit(1) })
