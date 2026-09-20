// Mide el pico de memoria del NUEVO pipeline de streaming H61:
// XLSX.read dense + generador fila a fila con liberación progresiva (como /api/upload).
const fs = require('fs')
const XLSX = require('xlsx')

const ruta = process.argv[2] || 'tmp/H61_26MB_TEST.xlsx'
const mb = (b) => (b / 1024 / 1024).toFixed(0)
const picoReal = () => {
  const st = fs.readFileSync('/proc/self/status', 'utf8')
  const m = /VmHWM:\s+(\d+)/.exec(st)
  return m ? mb(+m[1] * 1024) : '?'
}
const etapa = (nombre) => {
  const m = process.memoryUsage()
  console.log(`  ${nombre.padEnd(38)} rss=${mb(m.rss)}MB heap=${mb(m.heapUsed)}MB`)
}

console.log(`[streaming] archivo=${ruta} (${mb(fs.statSync(ruta).size)}MB)`)
etapa('inicio')
const t0 = Date.now()

const raw = fs.readFileSync(ruta)
const wb = XLSX.read(raw, { type: 'buffer', cellDates: true, dense: true })
console.log(`  XLSX.read dense: ${(Date.now() - t0) / 1000}s`)
etapa('workbook denso en memoria')

// replica filasDelWorkbook (xlsx.ts) + agregación de ingestH61 (sin DB)
function* filasDelWorkbook(wb) {
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    const data = sheet['!data']
    if (Array.isArray(data)) {
      yield* filasDeHojaDensa(data.length, (r) => data[r], (r) => { data[r] = undefined })
      continue
    }
    if (!sheet['!ref']) continue
    const rango = XLSX.utils.decode_range(sheet['!ref'])
    yield* filasDeHojaDensa(rango.e.r + 1, (r) => sheet[String(r)], (r) => { sheet[String(r)] = undefined })
  }
}

function* filasDeHojaDensa(cantFilas, leer, liberar) {
  let headers = null
  for (let r = 0; r < cantFilas; r++) {
    const fila = leer(r)
    liberar(r)
    if (!fila) continue
    if (!headers) {
      headers = fila.map((c) => (c && c.v != null ? String(c.v).trim() : ''))
      continue
    }
    const obj = {}
    let conValor = false
    for (let c = 0; c < fila.length; c++) {
      const cel = fila[c]
      if (!cel || cel.v == null) continue
      const h = headers[c]
      if (h) obj[h] = cel.v
      conValor = true
    }
    if (!conValor) continue
    yield obj
  }
}

const HORAS = Array.from({ length: 24 }, (_, i) => `HORA_${String(i).padStart(2, '0')}`)
const op = new Map(); const th = new Map(); const act = new Map()
let leidas = 0
for (const row of filasDelWorkbook(wb)) {
  leidas++
  const fecha = row.FECHA; const operario = row.OPERARIO
  if (!fecha || !operario) continue
  const fd = fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha).slice(0, 10)
  const key = `${fd}|${operario}`
  const turno = String(row.TURNO ?? '?')
  let o = op.get(key)
  if (!o) { o = { fecha, operario, turno, horas: new Array(24).fill(false), bultosHora: new Array(24).fill(0), bultos: 0 }; op.set(key, o) }
  const total = Math.round(Number(row.TOTAL) || 0)
  o.bultos += total
  for (let i = 0; i < 24; i++) {
    const v = Math.round(Number(row[HORAS[i]]) || 0)
    if (v !== 0) { o.horas[i] = true; o.bultosHora[i] += v; const k2 = `${fd}|${turno}|${i}`; let t = th.get(k2); if (!t) { t = { bultos: 0, ops: new Set() }; th.set(k2, t) } t.bultos += v; t.ops.add(operario) }
  }
  const k4 = `${fd}|${row.ACTIVIDAD}`
  let a = act.get(k4)
  if (!a) { a = { bultos: 0, ops: new Set() }; act.set(k4, a) }
  a.bultos += total; a.ops.add(operario)
}
console.log(`  filas procesadas: ${leidas.toLocaleString('es-ar')}; opDías=${op.size} turnoHora=${th.size} actividad=${act.size}`)
etapa('agregación completa (workbook liberándose)')
setTimeout(() => {
  console.log(`PICO RSS real (VmHWM): ${picoReal()} MB  (tiempo total ${(Date.now() - t0) / 1000}s)`)
  process.exit(0)
}, 300)
