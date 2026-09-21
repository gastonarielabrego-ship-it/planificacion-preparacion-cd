// Completa H61Circuito + H61Actividad (lo unico que fallo por el limite de 100 MB
// del proyecto claim). Misma logica de agregacion que ingestH61 (src/lib/ingest.ts).
// Usa pg directo (URL no pooling) con chunks chicos + ON CONFLICT DO NOTHING.
import * as XLSX from 'xlsx'
import { filasDelWorkbook } from '../src/lib/xlsx'
import { readFileSync } from 'fs'
import pg from 'pg'

const env = readFileSync('/tmp/neon-limpia-remap.env', 'utf8')
const get = (k: string): string => {
  const line = env.split('\n').find((l) => l.startsWith(k + '=')) ?? ''
  return line.slice(k.length + 1).replace(/^['"]/, '').replace(/['"]$/, '')
}

const fechaDesde = (v: unknown): Date | null => {
  if (v == null) return null
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()))
  if (typeof v === 'number') {
    const s = String(Math.floor(v))
    if (s.length !== 8) return null
    return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)))
  }
  const s = String(v).trim()
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return null
}
const num = (v: unknown): number | null => (v == null || v === '' ? (typeof v === 'number' ? v : null) : (isNaN(parseFloat(String(v))) ? null : parseFloat(String(v))))
const str = (v: unknown): string | null => (v == null || String(v).trim() === '' ? null : String(v).trim())

const HORAS = Array.from({ length: 24 }, (_, i) => `HORA_${String(i).padStart(2, '0')}`)

async function main() {
  // VACUUM para reutilizar el espacio muerto del intento fallido
  const cli = new pg.Client({ connectionString: get('POSTGRES_URL_NON_POOLING'), connectionTimeoutMillis: 25000, ssl: { rejectUnauthorized: false } })
  await cli.connect()
  console.log('conectado (directo)')
  await cli.query('VACUUM ANALYZE "H61OpHora", "H61OpDia", "H61TurnoHora"')
  const previo = await cli.query('SELECT (SELECT COUNT(*) FROM "H61Circuito") ci, (SELECT COUNT(*) FROM "H61Actividad") act')
  console.log(`previo: Circuito=${previo.rows[0].ci} Actividad=${previo.rows[0].act}`)

  const wb = XLSX.readFile('upload/H61.xlsx', { dense: true, cellDates: true })
  const ci = new Map<string, { fecha: Date; circuito: string; funcion: string; bultos: number }>()
  const act = new Map<string, { fecha: Date; actividad: string; bultos: number; ops: Set<string>; horasPorOp: Map<string, Set<number>> }>()

  let leidas = 0
  for (const r of filasDelWorkbook(wb)) {
    leidas++
    const fecha = fechaDesde(r.FECHA ?? r.fecha)
    const operario = str(r.OPERARIO ?? r.operario)
    if (!fecha || !operario) continue
    const funcion = (str(r.FUNCION ?? r.funcion) ?? '?').toUpperCase()
    const circuito = str(r.CIRCUITO ?? r.circuito) ?? '?'
    const actividad = (str(r.ACTIVIDAD ?? r.actividad) ?? '?').toUpperCase()
    const horasRow = HORAS.map((h) => Math.round(num(r[h]) ?? 0))
    let totalRow = Math.round(num(r.TOTAL ?? r.total) ?? 0)
    const sumaHoras = horasRow.reduce((a, b) => a + Math.max(0, b), 0)
    if (totalRow === 0 && sumaHoras > 0) totalRow = sumaHoras
    const fISO = fecha.toISOString().slice(0, 10)

    const k3 = `${fISO}|${circuito}|${funcion}`
    const c = ci.get(k3)
    if (c) c.bultos += totalRow
    else ci.set(k3, { fecha, circuito, funcion, bultos: totalRow })

    const k4 = `${fISO}|${actividad}`
    let a = act.get(k4)
    if (!a) { a = { fecha, actividad, bultos: 0, ops: new Set(), horasPorOp: new Map() }; act.set(k4, a) }
    a.bultos += totalRow
    a.ops.add(operario)
    let hs = a.horasPorOp.get(operario)
    if (!hs) { hs = new Set(); a.horasPorOp.set(operario, hs) }
    horasRow.forEach((v, i) => { if (v !== 0) hs!.add(i) })
  }
  console.log(`filas crudas: ${leidas} | agregados: Circuito=${ci.size} Actividad=${act.size}`)

  const insC = 'INSERT INTO "H61Circuito" ("fecha","circuito","funcion","bultos") VALUES '
  let i = 0
  for (const c of ci.values()) {
    await cli.query(`${insC}($1,$2,$3,$4) ON CONFLICT ("fecha","circuito","funcion") DO NOTHING`, [c.fecha, c.circuito, c.funcion, c.bultos])
    if (++i % 2000 === 0) console.log(`circuito ${i}/${ci.size}`)
  }
  const insA = 'INSERT INTO "H61Actividad" ("fecha","actividad","bultos","operarios","horas") VALUES '
  i = 0
  for (const a of act.values()) {
    const horas = [...a.horasPorOp.values()].reduce((acc, s) => acc + s.size, 0)
    await cli.query(`${insA}($1,$2,$3,$4,$5) ON CONFLICT ("fecha","actividad") DO NOTHING`, [a.fecha, a.actividad, a.bultos, a.ops.size, horas])
    if (++i % 500 === 0) console.log(`actividad ${i}/${act.size}`)
  }

  // ajustar secuencias
  for (const t of ['H61Circuito', 'H61Actividad']) {
    await cli.query(`SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), COALESCE((SELECT MAX(id) FROM "${t}"), 1))`)
  }
  const fin = await cli.query(`SELECT (SELECT COUNT(*) FROM "H61Circuito") ci, (SELECT COUNT(*) FROM "H61Actividad") act, pg_size_pretty(pg_database_size(current_database())) sz`)
  console.log(`FINAL: Circuito=${fin.rows[0].ci} Actividad=${fin.rows[0].act} | DB=${fin.rows[0].sz}`)
  await cli.end()
}

main().catch((e) => { console.error('ERROR:', String(e?.message ?? e).split('\n')[0]); process.exit(1) })
