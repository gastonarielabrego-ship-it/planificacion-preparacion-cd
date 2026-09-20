// Mide el pico de RSS del pipeline de procesamiento H61 por etapas,
// con lectura estándar vs dense, para replicar el OOM de Vercel.
const fs = require('fs')
const XLSX = require('xlsx')

const ruta = process.argv[2] || 'tmp/H61_26MB_TEST.xlsx'
const MODO = process.argv[3] || 'standard' // standard | dense
const CON_RECORDS = process.argv[4] !== 'norecords'
const CON_AGREG = process.argv[5] !== 'noagreg'

const mb = (b) => (b / 1024 / 1024).toFixed(0)
const etapa = (nombre) => {
  const m = process.memoryUsage()
  console.log(`  ${nombre.padEnd(38)} rss=${mb(m.rss)}MB heap=${mb(m.heapUsed)}MB`)
}
const picoReal = () => {
  const st = fs.readFileSync('/proc/self/status', 'utf8')
  const m = /VmHWM:\s+(\d+)/.exec(st)
  return m ? mb(+m[1] * 1024) : '?'
}

let samplerSafe = null
console.log(`archivo=${ruta} (${mb(fs.statSync(ruta).size)}MB) modo=${MODO} records=${CON_RECORDS} agreg=${CON_AGREG}`)
etapa('inicio')

const raw = fs.readFileSync(ruta)
etapa('buffer leído')

const t0 = Date.now()
const wb = XLSX.read(raw, { type: 'buffer', cellDates: true, dense: MODO === 'dense' })
console.log(`  XLSX.read: ${(Date.now() - t0) / 1000}s; hoja=${wb.SheetNames[0]}`)
etapa('workbook en memoria')

if (CON_RECORDS) {
  const t1 = Date.now()
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const json = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true })
  console.log(`  sheet_to_json: ${(Date.now() - t1) / 1000}s; filas=${json.length}`)
  etapa('records (objetos) generados')

  if (CON_AGREG) {
    // replica el agregado de ingestH61 sin escribir a DB
    const HORAS = Array.from({ length: 24 }, (_, i) => `HORA_${String(i).padStart(2, '0')}`)
    const op = new Map(); const th = new Map(); const act = new Map()
    const t2 = Date.now()
    for (const row of json) {
      const fecha = row.FECHA; const operario = row.OPERARIO
      if (!fecha || !operario) continue
      const key = `${fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha).slice(0, 10)}|${operario}`
      const turno = String(row.TURNO ?? '?')
      let o = op.get(key)
      if (!o) { o = { fecha, operario, turno, horas: new Array(24).fill(false), bultosHora: new Array(24).fill(0), bultos: 0 }; op.set(key, o) }
      const horasRow = HORAS.map((h) => Math.round(Number(row[h]) || 0))
      o.bultos += Math.round(Number(row.TOTAL) || 0)
      horasRow.forEach((v, i) => { if (v !== 0) { o.horas[i] = true; o.bultosHora[i] += v } })
      const k2 = `${key}|${turno}`
      horasRow.forEach((v, i) => { if (v !== 0) { let t = th.get(k2); if (!t) { t = { bultos: 0, ops: new Set() }; th.set(k2, t) } t.bultos += v; t.ops.add(operario) } })
      const k4 = `${key}|${row.ACTIVIDAD}`
      let a = act.get(k4)
      if (!a) { a = { bultos: 0, ops: new Set() }; act.set(k4, a) }
      a.bultos += Math.round(Number(row.TOTAL) || 0); a.ops.add(operario)
    }
    console.log(`  agregación: ${(Date.now() - t2) / 1000}s; opDías=${op.size} turnoHora=${th.size} actividad=${act.size}`)
    etapa('agregación completa')
  }
}

clearInterval(samplerSafe)
setTimeout(() => {
  console.log(`PICO RSS real (VmHWM): ${picoReal()} MB  (tiempo total ${(Date.now() - t0) / 1000}s)`)
  process.exit(0)
}, 150)
