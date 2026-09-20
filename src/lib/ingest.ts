// Ingesta de datos: convierte registros crudos (de xlsx o JSON del script Python)
// a modelos de DB, pre-agrega H61 y normaliza motivos de tiempos muertos.
import { db } from '@/lib/db'
import { clasificarMotivo } from '@/lib/normaliza'

export type TipoCarga = 'ola' | 'h61' | 'tm' | 'picking' | 'prodcirc'

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

export function fechaDesdeYYYYMMDD(v: unknown): Date | null {
  if (v == null) return null
  if (typeof v === 'number') {
    const s = String(Math.floor(v))
    if (s.length !== 8) return null
    const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)))
    return isNaN(d.getTime()) ? null : d
  }
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()))
  if (typeof v === 'string') {
    const s = v.trim()
    let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s)
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(s)
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]))
    m = /^(\d{8})$/.exec(s)
    if (m) return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)))
  }
  return null
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}
function str(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

// ============ MAPPERS ============

function mapOla(r: Record<string, unknown>) {
  const fecha = fechaDesdeYYYYMMDD(r.fecha ?? r.FECHA ?? r.Fecha)
  if (!fecha) return null
  const ola = num(r.ola ?? r.olaTotal ?? r.OLA) ?? 0
  const pendiente = num(r.pendiente ?? r.PENDIENTE) ?? 0
  const total = num(r.total ?? r.TOTAL) ?? ola + pendiente
  return { fecha, ola, pendiente, total }
}

interface H61Row {
  FUNCION?: unknown
  FECHA?: unknown
  TURNO?: unknown
  OPERARIO?: unknown
  NOMBRE?: unknown
  ACTIVIDAD?: unknown
  CIRCUITO?: unknown
  TOTAL?: unknown
  [k: string]: unknown
}
const HORAS = Array.from({ length: 24 }, (_, i) => `HORA_${String(i).padStart(2, '0')}`)

function mapTM(r: Record<string, unknown>) {
  const fecha = fechaDesdeYYYYMMDD(r.FECHA ?? r.fecha)
  if (!fecha) return null
  const operario = str(r.OPERARIO ?? r.operario)
  if (!operario) return null
  const minutos = Math.round(num(r.MINUTOS) ?? 0)
  const minutosAj = Math.round(num(r.MINUTOS_AJUSTE) ?? 0)
  const code = num(r.MOTIVO)
  const obs = str(r.OBSERVACION)
  const cl = clasificarMotivo(obs, code == null ? null : Math.round(code))
  const estado = str(r.ESTADO)
  let hd = num(r.HORA_MIN_DESDE)
  let horaDesde: number | null = null
  if (hd != null && hd > 0) {
    const s = String(Math.floor(hd))
    horaDesde = s.length <= 2 ? 0 : Math.floor(parseInt(s.slice(0, s.length - 2), 10) * 60 + parseInt(s.slice(-2), 10))
    if (horaDesde > 1440) horaDesde = null
  }
  return {
    fecha,
    turno: str(r.TURNO) ?? '?',
    operario,
    nombre: str(r.NOMBRE),
    motivoCode: code == null ? null : Math.round(code),
    categoria: cl.categoria,
    detalle: cl.detalle,
    nave: cl.nave,
    pasillo: cl.pasillo,
    posicion: cl.posicion,
    minutos,
    minutosAj,
    minutosEf: minutosAj > 0 ? minutosAj : minutos,
    horaDesde,
    estado,
    obs,
  }
}

function mapPicking(r: Record<string, unknown>, mapping: PickingMapping | null) {
  const src = (k: keyof PickingMapping): unknown =>
    mapping && mapping[k] ? r[mapping[k] as string] : r[k]
  const fecha = fechaDesdeYYYYMMDD(src('fecha'))
  if (!fecha) return null
  const operario = str(src('operario'))
  if (!operario) return null
  let horaMin: number | null = null
  const hmRaw = src('horaMin')
  if (hmRaw != null && hmRaw !== '') {
    // 1) formato "HH:MM" u "HH:MM:SS" (string) — conserva segundos como fraccion de minuto
    const hm = String(hmRaw).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{1,2}))?/)
    if (hm) {
      horaMin = parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10) + (hm[3] ? parseInt(hm[3], 10) / 60 : 0)
    } else {
      const n = num(hmRaw)
      if (n != null) {
        if (n < 24 && Number.isInteger(n) && String(Math.floor(n)).length <= 2) horaMin = Math.round(n * 60)
        else if (n < 1440) horaMin = Math.round(n)
        else {
          const s = String(Math.floor(n))
          horaMin = parseInt(s.slice(0, s.length - 2), 10) * 60 + parseInt(s.slice(-2), 10)
        }
        if (horaMin != null && (horaMin < 0 || horaMin > 1440)) horaMin = null
      }
    }
    if (horaMin != null && (horaMin < 0 || horaMin > 1440)) horaMin = null
  }
  return {
    fecha,
    operario,
    horaMin,
    bultos: num(src('bultos')) == null ? null : Math.round(num(src('bultos')) as number),
    soporte: str(src('soporte')),
    circuito: str(src('circuito')),
    raw: JSON.stringify(r).slice(0, 2000),
  }
}

export interface PickingMapping {
  fecha?: string
  operario?: string
  horaMin?: string
  bultos?: string
  soporte?: string
  circuito?: string
}

// ============ INGESTA ============

export interface ResultadoCarga {
  tipo: TipoCarga
  filas: number
  insertados: number
  errores: number
  desde?: string
  hasta?: string
}

async function clearTipo(tipo: TipoCarga) {
  if (tipo === 'ola') await db.olaDia.deleteMany({})
  else if (tipo === 'h61') {
    await db.h61OpDia.deleteMany({})
    await db.h61TurnoHora.deleteMany({})
    await db.h61OpHora.deleteMany({})
    await db.h61Circuito.deleteMany({})
    await db.h61Actividad.deleteMany({})
  } else if (tipo === 'tm') await db.tiempoMuerto.deleteMany({})
  else if (tipo === 'picking') await db.pickingEvento.deleteMany({})
  else if (tipo === 'prodcirc') await db.prodCircuito.deleteMany({})
}

// Ingesta de OLA (fila por dia)
async function ingestOla(records: Iterable<Record<string, unknown>>) {
  const vistos = new Map<string, { fecha: Date; ola: number; pendiente: number; total: number }>()
  let errores = 0
  for (const r of records) {
    const m = mapOla(r)
    if (!m) { errores++; continue }
    vistos.set(m.fecha.toISOString().slice(0, 10), m)
  }
  const rows = [...vistos.values()].sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
  await db.olaDia.deleteMany({})
  for (const c of chunk(rows, 400)) await db.olaDia.createMany({ data: c })
  return { insertados: rows.length, errores, rows }
}

// Ingesta de H61 (filas crudas por operario-circuito-actividad): pre-agrega

// Ventana de jornada base por turno (buckets = hora de inicio de cada hora):
// - TM (M): 6 a 14 -> buckets 6..13. Extras posibles hasta las 18 (buckets 14..17).
// - TT (T): 14 a 22 -> buckets 14..21. Extras pueden empezar a las 10 (10..13) o pasar las 22.
// - TN (N): 23 a 06 -> buckets 23 y 0..5 (7 h). Extras posibles desde las 18 (18..22) o hasta las 10 (6..9).
// La jornada del TN (23:00 del dia D + 00:00-06:00 del D+1) queda agrupada bajo la fecha D del archivo.
function ventanaTurno(turno: string): Set<number> | null {
  if (turno === 'M') return new Set([6, 7, 8, 9, 10, 11, 12, 13])
  if (turno === 'T') return new Set([14, 15, 16, 17, 18, 19, 20, 21])
  if (turno === 'N') return new Set([23, 0, 1, 2, 3, 4, 5])
  return null
}

// Turno propio del operario en el dia: el bloque con MAS horas activas.
// El TURNO de la primera fila puede mentir (ej. bloque previo de extras de un
// TT que arranca a las 10 viene etiquetado M): el turno real es el dominante.
function turnoDominante(horasPorTurno: Map<string, number>, fallback: string): string {
  let best = fallback
  let max = -1
  for (const [t, n] of horasPorTurno) if (n > max) { max = n; best = t }
  return best
}

// Indices de horas activas que cuentan como extras para un operario-dia:
// con turno conocido, toda hora activa fuera de la ventana de su turno
// (antes o despues de la jornada base); con turno desconocido, regla general
// de las primeras 8 horas activas = jornada y el resto = extras.
function horasExtrasDe(horas: boolean[], turno: string): number[] {
  const ventana = ventanaTurno(turno)
  const activas: number[] = []
  horas.forEach((v, i) => { if (v) activas.push(i) })
  if (ventana) return activas.filter((h) => !ventana.has(h))
  const orden = ordenarHorasActivas(horas)
  return orden.slice(Math.max(0, orden.length - Math.max(0, orden.length - 8)))
}

// Ordena las horas activas de un operario-dia en orden cronologico del turno.
// Si las horas cruzan la medianoche (turno noche: >=18 y <=5), el dia arranca
// por la tarde/noche y continua en la madrugada: [19..23, 0..5].
function ordenarHorasActivas(horas: boolean[]): number[] {
  const activas: number[] = []
  horas.forEach((v, i) => { if (v) activas.push(i) }) // ya quedan ascendentes
  if (!activas.length) return activas
  const cruzaMedianoche = activas[0] <= 5 && activas[activas.length - 1] >= 18
  if (!cruzaMedianoche) return activas
  return [...activas.filter((h) => h >= 18), ...activas.filter((h) => h <= 5)]
}

async function ingestH61(records: Iterable<Record<string, unknown>>) {
  // acumuladores
  const op = new Map<string, { fecha: Date; operario: string; nombre: string | null; funcion: string; turno: string; horas: boolean[]; bultosHora: number[]; bultos: number; horasPorTurno: Map<string, number> }>()
  const th = new Map<string, { fecha: Date; turno: string; hora: number; bultos: number; ops: Set<string> }>()
  const ci = new Map<string, { fecha: Date; circuito: string; funcion: string; bultos: number }>()
  // por actividad (columna ACTIVIDAD: 2, 3, 4, JAULA...): bultos, operarios y horas-hombre
  // (horas por operario con horas activas distintas, para no duplicar si comparte hora entre circuitos)
  const act = new Map<string, { fecha: Date; actividad: string; bultos: number; ops: Set<string>; horasPorOp: Map<string, Set<number>> }>()
  let errores = 0

  for (const r of records) {
    const row = r as H61Row
    const fecha = fechaDesdeYYYYMMDD(row.FECHA ?? row.fecha)
    const operario = str(row.OPERARIO ?? row.operario)
    if (!fecha || !operario) { errores++; continue }
    const turno = (str(row.TURNO ?? row.turno) ?? '?').toUpperCase()
    const funcion = (str(row.FUNCION ?? row.funcion) ?? '?').toUpperCase()
    const nombre = str(row.NOMBRE ?? row.nombre)
    const horasRow = HORAS.map((h) => Math.round(num(row[h]) ?? 0))
    let totalRow = Math.round(num(row.TOTAL ?? row.total) ?? 0)
    const sumaHoras = horasRow.reduce((a, b) => a + Math.max(0, b), 0)
    if (totalRow === 0 && sumaHoras > 0) totalRow = sumaHoras
    const circuito = str(row.CIRCUITO ?? row.circuito) ?? '?'
    const actividad = (str(row.ACTIVIDAD ?? row.actividad) ?? '?').toUpperCase()

    // por operario-dia: sumar horas (pueden solaparse filas por circuito)
    const key = `${fecha.toISOString().slice(0, 10)}|${operario}`
    let o = op.get(key)
    if (!o) {
      o = { fecha, operario, nombre, funcion, turno, horas: new Array(24).fill(false), bultosHora: new Array(24).fill(0), bultos: 0, horasPorTurno: new Map() }
      op.set(key, o)
    }
    if (nombre && !o.nombre) o.nombre = nombre
    o.bultos += totalRow
    horasRow.forEach((v, i) => {
      if (v !== 0) {
        if (!o!.horas[i]) {
          o!.horas[i] = true
          o!.horasPorTurno.set(turno, (o.horasPorTurno.get(turno) ?? 0) + 1)
        }
        o!.bultosHora[i] += v
      }
    })

    // por turno-hora-fecha
    horasRow.forEach((v, i) => {
      if (v === 0) return
      const k2 = `${fecha.toISOString().slice(0, 10)}|${turno}|${i}`
      let t = th.get(k2)
      if (!t) { t = { fecha, turno, hora: i, bultos: 0, ops: new Set() }; th.set(k2, t) }
      t.bultos += v
      t.ops.add(operario)
    })

    // por circuito-funcion-fecha
    const k3 = `${fecha.toISOString().slice(0, 10)}|${circuito}|${funcion}`
    let c = ci.get(k3)
    if (!c) { c = { fecha, circuito, funcion, bultos: 0 }; ci.set(k3, c) }
    c.bultos += totalRow

    // por actividad-fecha
    const k4 = `${fecha.toISOString().slice(0, 10)}|${actividad}`
    let a = act.get(k4)
    if (!a) { a = { fecha, actividad, bultos: 0, ops: new Set(), horasPorOp: new Map() }; act.set(k4, a) }
    a.bultos += totalRow
    a.ops.add(operario)
    let hs = a.horasPorOp.get(operario)
    if (!hs) { hs = new Set(); a.horasPorOp.set(operario, hs) }
    horasRow.forEach((v, i) => { if (v !== 0) hs!.add(i) })
  }

  // construir filas finales
  const ops = [...op.values()].map((o) => {
    const horasActivas = o.horas.filter(Boolean).length
    // turno propio del operario: bloque dominante (el de mas horas activas)
    const turnoPropio = turnoDominante(o.horasPorTurno, o.turno)
    // bultos en extras: horas activas fuera de la ventana del turno propio
    const extrasIdx = horasExtrasDe(o.horas, turnoPropio)
    const extras = extrasIdx.length
    const bultosExtras = extrasIdx.reduce((a, i) => a + Math.max(0, o!.bultosHora[i]), 0)
    return {
      fecha: o.fecha,
      operario: o.operario,
      nombre: o.nombre,
      funcion: o.funcion,
      turno: turnoPropio,
      horasActivas,
      bultos: o.bultos,
      bultosBase: Math.max(0, o.bultos - bultosExtras),
      bultosExtras,
      extras,
    }
  })
  // detalle operario x hora: horas dentro de la ventana del turno propio = jornada, fuera = extras
  const opHoraRows: { fecha: Date; operario: string; turno: string; hora: number; bultos: number; esExtra: boolean }[] = []
  for (const o of op.values()) {
    const turnoPropio = turnoDominante(o.horasPorTurno, o.turno)
    const extrasSet = new Set(horasExtrasDe(o.horas, turnoPropio))
    const orden = ordenarHorasActivas(o.horas)
    for (const h of orden) {
      opHoraRows.push({ fecha: o.fecha, operario: o.operario, turno: turnoPropio, hora: h, bultos: Math.max(0, o.bultosHora[h]), esExtra: extrasSet.has(h) })
    }
  }
  const thRows = [...th.values()].map((t) => ({ fecha: t.fecha, turno: t.turno, hora: t.hora, bultos: t.bultos, operarios: t.ops.size }))
  const ciRows = [...ci.values()]
  const actRows = [...act.values()].map((a) => ({
    fecha: a.fecha,
    actividad: a.actividad,
    bultos: a.bultos,
    operarios: a.ops.size,
    horas: [...a.horasPorOp.values()].reduce((acc, s) => acc + s.size, 0),
  }))

  await clearTipo('h61')
  for (const c of chunk(ops, 400)) await db.h61OpDia.createMany({ data: c })
  for (const c of chunk(thRows, 400)) await db.h61TurnoHora.createMany({ data: c })
  for (const c of chunk(opHoraRows, 400)) await db.h61OpHora.createMany({ data: c })
  for (const c of chunk(ciRows, 400)) await db.h61Circuito.createMany({ data: c })
  for (const c of chunk(actRows, 400)) await db.h61Actividad.createMany({ data: c })

  return { insertados: ops.length, errores, rows: ops }
}

async function ingestTM(records: Iterable<Record<string, unknown>>) {
  const rows: ReturnType<typeof mapTM>[] = []
  let errores = 0
  for (const r of records) {
    const m = mapTM(r)
    if (!m) { errores++; continue }
    rows.push(m)
  }
  await clearTipo('tm')
  for (const c of chunk(rows, 400)) await db.tiempoMuerto.createMany({ data: c as never })
  return { insertados: rows.length, errores, rows }
}

async function ingestPicking(records: Iterable<Record<string, unknown>>, mapping: PickingMapping | null, batch: string) {
  const rows: ReturnType<typeof mapPicking>[] = []
  let errores = 0
  for (const r of records) {
    const m = mapPicking(r, mapping)
    if (!m) { errores++; continue }
    rows.push({ ...m, batch })
  }
  for (const c of chunk(rows, 400)) await db.pickingEvento.createMany({ data: c as never })
  return { insertados: rows.length, errores, rows }
}

// Ingesta de PRODUCTIVIDAD POR CIRCUITO/SECTOR ("Productividad X Circuito", "Tiempos E-8"):
// fila por colaborador-dia-turno-sector con tiempos (total/muerto/neto/super neto) y produccion.
// Acepta los encabezados originales (Columna1, NOMUTI, 'Tiempo Muerto', PROD_TOTAL, ...) o canonicos.
function mapProdCirc(r: Record<string, unknown>) {
  // lookup insensible a mayusculas/espacios/guiones bajos
  const norm: Record<string, unknown> = {}
  for (const k of Object.keys(r)) norm[k.toUpperCase().replace(/[\s_]/g, '')] = r[k]
  const g = (...claves: string[]): unknown => {
    for (const c of claves) {
      const v = norm[c.toUpperCase().replace(/[\s_]/g, '')]
      if (v != null && v !== '') return v
    }
    return undefined
  }
  const fecha = fechaDesdeYYYYMMDD(g('Columna1', 'FECHA', 'DIA', 'fecha'))
  if (!fecha) return null
  const operario = str(g('OPERARIO', 'CODUTI', 'operario'))
  if (!operario) return null
  const nro = (...c: string[]) => num(g(...c))
  return {
    fecha,
    turno: (str(g('TURNO', 'turno')) ?? '').toUpperCase(),
    operario,
    nombre: str(g('NOMUTI', 'NOMBRE', 'nombre')),
    sector: (str(g('SECTOR', 'CIRCUITO', 'sector', 'circuito')) ?? '').toUpperCase(),
    tipo: (str(g('TIPO', 'tipo')) ?? '').toUpperCase(),
    soportes: nro('SOPORTES'),
    lineas: nro('LINEAS'),
    bultos: nro('BULTOS'),
    tiempoTotal: nro('TIEMPO TOTAL'),
    tiempoMuerto: nro('TIEMPO MUERTO'),
    tiempoNeto: nro('TIEMPO NETO'),
    tiempoSuperNeto: nro('TIEMPO SUPER NETO'),
    prodTotal: nro('PROD TOTAL'),
    prodNeto: nro('PROD NETO'),
    prodSuperNeto: nro('PROD SUPER NETO'),
  }
}

async function ingestProdCirc(records: Iterable<Record<string, unknown>>) {
  const rows: NonNullable<ReturnType<typeof mapProdCirc>>[] = []
  let errores = 0
  for (const r of records) {
    const m = mapProdCirc(r)
    if (!m) { errores++; continue }
    rows.push(m)
  }
  if (!rows.length) return { insertados: 0, errores, rows }

  // dedup: clave fecha+turno+operario+sector+tipo contra la base y dentro del archivo
  // (Prisma 6 ya no soporta skipDuplicates en createMany)
  let minT = Infinity, maxT = -Infinity
  for (const r of rows) { const t = r.fecha.getTime(); if (t < minT) minT = t; if (t > maxT) maxT = t }
  const clave = (f: string, t: string, o: string, s: string, ti: string) => `${f}|${t}|${o}|${s}|${ti}`
  const existentes = await db.prodCircuito.findMany({
    where: { fecha: { gte: new Date(minT), lte: new Date(maxT) } },
    select: { fecha: true, turno: true, operario: true, sector: true, tipo: true },
  })
  const vistos = new Set(existentes.map((e) => clave(e.fecha.toISOString().slice(0, 10), e.turno, e.operario, e.sector, e.tipo)))
  const nuevos: typeof rows = []
  for (const r of rows) {
    const k = clave(r.fecha.toISOString().slice(0, 10), r.turno, r.operario, r.sector, r.tipo)
    if (vistos.has(k)) continue
    vistos.add(k)
    nuevos.push(r)
  }
  for (const c of chunk(nuevos, 400)) await db.prodCircuito.createMany({ data: c as never })
  return { insertados: nuevos.length, errores, rows }
}

export async function ingestRows(
  tipo: TipoCarga,
  records: Iterable<Record<string, unknown>>,
  opts: { batchId: string; filename?: string; mapping?: PickingMapping | null; reemplazar?: boolean } = { batchId: 'manual' },
): Promise<ResultadoCarga> {
  // Acepta arrays o generadores de streaming; cuenta las filas en el mismo pase
  // (un generador no tiene .length). Cada ingesta consume los records UNA vez.
  let filasLeidas = 0
  function* contando(): Generator<Record<string, unknown>> {
    for (const r of records) {
      filasLeidas++
      yield r
    }
  }
  let res: { insertados: number; errores: number; rows: unknown[] }
  if (tipo === 'ola') res = await ingestOla(contando())
  else if (tipo === 'h61') res = await ingestH61(contando())
  else if (tipo === 'tm') res = await ingestTM(contando())
  else if (tipo === 'prodcirc') res = await ingestProdCirc(contando())
  else res = await ingestPicking(contando(), opts.mapping ?? null, opts.batchId)

  const fechas = (res.rows as { fecha: Date }[]).map((r) => r.fecha.getTime())
  let minT = Infinity, maxT = -Infinity
  for (const t of fechas) { if (t < minT) minT = t; if (t > maxT) maxT = t }
  const desde = fechas.length ? new Date(minT).toISOString().slice(0, 10) : undefined
  const hasta = fechas.length ? new Date(maxT).toISOString().slice(0, 10) : undefined

  // upsert: las cargas incrementales (picking/prodcirc) reutilizan el mismo batchId por lote
  await db.uploadBatch.upsert({
    where: { id: opts.batchId },
    create: {
      id: opts.batchId,
      tipo,
      filename: opts.filename ?? null,
      rows: res.insertados,
      meta: JSON.stringify({ errores: res.errores, desde, hasta }),
    },
    update: {
      rows: { increment: res.insertados },
      meta: JSON.stringify({ errores: res.errores, desde, hasta }),
    },
  })

  return { tipo, filas: filasLeidas, insertados: res.insertados, errores: res.errores, desde, hasta }
}

export async function resetTipo(tipo: TipoCarga) {
  await clearTipo(tipo)
  await db.uploadBatch.deleteMany({ where: { tipo } })
}
