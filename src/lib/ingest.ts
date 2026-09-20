// Ingesta de datos: convierte registros crudos (de xlsx o JSON del script Python)
// a modelos de DB, pre-agrega H61 y normaliza motivos de tiempos muertos.
import { db } from '@/lib/db'
import { clasificarMotivo } from '@/lib/normaliza'

export type TipoCarga = 'ola' | 'h61' | 'tm' | 'picking' | 'maq'

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

// Auto-detección server-side de columnas de picking (cuando no hay mapping explícito,
// ej. subida web directa). Soporta DOS granos del reporte E-8:
//
// 1) DETALLE (log WMS evento a evento): CODUTI, NOMUTI, FECHA, HORA, CODACT,
//    ZONSTS, ALLSTS, DPLSTS, NIVSTS, CODPRO, PCBPRO, BULTOS, MINUTOS, ALERTA.
// 2) RESUMEN ("Colaborador", el Tiempos E-8 clasico): TURNO, Columna1 (fecha),
//    OPERARIO, NOMUTI, Sector (circuito ACT2/ACT4/JAULA/XD), Tipo (Soporte/Notas),
//    Soportes, Lineas, Bultos, Tiempo Total/Muerto/Neto/Super Neto (HORAS), PROD_*.
//    Cada fila se guarda como un "bloque" sin hora; getPicking detecta el grano.
export function autoMapPicking(muestra: Record<string, unknown>): PickingMapping {
  const cols = Object.keys(muestra).map((k) => k.toUpperCase().replace(/[\s_]/g, ''))
  const buscar = (...candidatos: string[]): string | undefined => {
    for (const cand of candidatos) {
      const hit = cols.find((c) => c.includes(cand))
      if (hit != null) return Object.keys(muestra).find((k) => k.toUpperCase().replace(/[\s_]/g, '') === hit)
    }
    return undefined
  }
  const soportesCol = buscar('SOPORTES', 'SOPORT')
  return {
    fecha: buscar('FECHA', 'DIA', 'DATE', 'FEC', 'COLUMNA1', 'COLUMN1'),
    operario: buscar('CODUTI', 'OPERARIO', 'LEGAJO', 'USUARIO'),
    nombre: buscar('NOMUTI', 'NOMBRE'),
    horaMin: buscar('HORA', 'TIME', 'TIMESTAMP'),
    bultos: buscar('BULTO', 'CANTIDAD', 'UNIDAD', 'CANT', 'QTY'),
    // en el resumen "Soportes" es una CANTIDAD (grano resumen), no el ID del pallet:
    // si el archivo trae la columna de cantidad, soporte solo busca ID de pallet
    soporte: soportesCol ? buscar('LPN', 'PALLET') : buscar('SOPORTE', 'PALLET', 'LPN'),
    circuito: buscar('CODACT', 'CIRCUITO', 'CIRCU', 'SECTOR'),
    actividad: buscar('CODACT', 'ACTIVIDAD', 'TIPO'),
    zona: buscar('ZONSTS', 'ZONA', 'NAVE', 'SECTOR'),
    ubicacion: buscar('ALLSTS', 'UBICACION', 'PASILLO', 'CALLE'),
    nivel: buscar('NIVSTS', 'NIVEL'),
    minutos: buscar('MINUTOS', 'DURACION'),
    turno: buscar('TURNO', 'SHIFT'),
    lineas: buscar('LINEAS', 'LINEA'),
    muerto: buscar('TIEMPOMUERTO', 'MUERTO'),
    neto: buscar('TIEMPONETO'),
    superNeto: buscar('SUPERNETO'),
    totalTiempo: buscar('TIEMPOTOTAL'),
    // soportes va al final (ya calculado arriba para el guard de soporte)
    soportes: soportesCol,
  }
}

export function mapPicking(r: Record<string, unknown>, mapping: PickingMapping | null) {
  const map = mapping ?? autoMapPicking(r)
  const src = (k: keyof PickingMapping): unknown =>
    map && map[k] ? r[map[k] as string] : r[k]
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
    nombre: str(src('nombre')),
    horaMin,
    bultos: num(src('bultos')) == null ? null : Math.round(num(src('bultos')) as number),
    soporte: str(src('soporte')),
    circuito: str(src('circuito')),
    actividad: str(src('actividad')),
    zona: str(src('zona')),
    ubicacion: str(src('ubicacion')),
    nivel: str(src('nivel')),
    // evento: MINUTOS (duracion de la operacion); resumen: Tiempo Total (horas) -> minutos
    minutos: num(src('minutos')) ?? horasAMin(src('totalTiempo')),
    // ---- grano resumen (E-8 "Colaborador"): tiempos en HORAS se pasan a minutos
    turno: str(src('turno')),
    soportes: num(src('soportes')) == null ? null : Math.round(num(src('soportes')) as number),
    lineas: num(src('lineas')) == null ? null : Math.round(num(src('lineas')) as number),
    muertoMin: horasAMin(src('muerto')),
    netoMin: horasAMin(src('neto')),
    superNetoMin: horasAMin(src('superNeto')),
  }
}

// horas ("Tiempo Total" del resumen) -> minutos; null si no hay valor
function horasAMin(v: unknown): number | null {
  const n = num(v)
  return n == null ? null : +(n * 60).toFixed(2)
}

export interface PickingMapping {
  fecha?: string
  operario?: string
  nombre?: string
  horaMin?: string
  bultos?: string
  soporte?: string
  circuito?: string
  actividad?: string
  zona?: string
  ubicacion?: string
  nivel?: string
  minutos?: string
  // grano resumen (E-8 Colaborador)
  turno?: string
  soportes?: string
  lineas?: string
  muerto?: string
  neto?: string
  superNeto?: string
  totalTiempo?: string
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
  else if (tipo === 'maq') {
    await db.maqOpNave.deleteMany({})
    await db.maqAct.deleteMany({})
    await db.maqNave.deleteMany({})
  }
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

// H61 de MAQUINISTAS (clarkistas): fila por operario x fecha x turno x actividad x CIRCUITO (nave).
// Encabezados reales: FUNCION, FUNCION_DESC, FECHA, TURNO, TURNO_DESC, OPERARIO, NOIMBRE,
// ACTIVIDAD, CIRCUITO, TIEMPO_MUE, HORA_00..23, TOTAL, TOT_* y TOT_BULTOS.
// total = movimientos de clark (TOTAL o suma de horas), bultos = TOT_BULTOS,
// horas = horas activas distintas (las filas pueden repetir la combinacion).
function mapMaq(r: Record<string, unknown>) {
  const fecha = fechaDesdeYYYYMMDD(r.FECHA ?? r.fecha)
  const operario = str(r.OPERARIO ?? r.operario)
  if (!fecha || !operario) return null
  const turno = (str(r.TURNO ?? r.turno) ?? '?').toUpperCase()
  // el archivo trae "NOIMBRE" (typo de NOMBRE)
  const nombre = str(r.NOIMBRE ?? r.NOMBRE ?? r.nombre)
  const actividad = (str(r.ACTIVIDAD ?? r.actividad) ?? '?').toUpperCase()
  const nave = (str(r.CIRCUITO ?? r.circuito) ?? '?').toUpperCase()
  const horasRow = HORAS.map((h) => Math.round(num(r[h]) ?? 0))
  let total = Math.round(num(r.TOTAL ?? r.total) ?? 0)
  const sumaHoras = horasRow.reduce((a, b) => a + Math.max(0, b), 0)
  if (total === 0 && sumaHoras > 0) total = sumaHoras
  const bultos = Math.round(num(r.TOT_BULTOS ?? r.bultos) ?? 0)
  // TAREAS: aprontamiento (TOT_APROS + TOT_APROS_PARCIAL; TOT_APROS_TOTAL del
  // reporte a veces viene en 0 con componentes > 0) y homogeneización
  // (TOT_HOMOGENEOS = STD + REALMAC_XD + REALMAC_STD, verificado 1 a 1)
  const apros = Math.max(0, Math.round(num(r.TOT_APROS) ?? 0)) + Math.max(0, Math.round(num(r.TOT_APROS_PARCIAL) ?? 0))
  const homogeneos = Math.max(0, Math.round(num(r.TOT_HOMOGENEOS) ?? 0))
  const horasIdx: number[] = []
  horasRow.forEach((v, i) => { if (v !== 0) horasIdx.push(i) })
  // vector de movimientos por hora (acotado a >= 0); Σ horasVec == total
  const horasVec = horasRow.map((v) => Math.max(0, v))
  return { fecha, turno, operario, nombre, actividad, nave, total, bultos, apros, homogeneos, horasIdx, horasVec }
}

async function ingestMaq(records: Iterable<Record<string, unknown>>) {
  // clave = fecha|turno|operario|actividad|nave: el archivo puede traer varias filas
  // para la misma combinacion (distintos aperos/bloques) — se suman y las horas se deduplican
  const opNave = new Map<string, { fecha: Date; turno: string; operario: string; nombre: string | null; actividad: string; nave: string; total: number; bultos: number; apros: number; homogeneos: number; horasSet: Set<number>; horasVec: number[] }>()
  // pre-agregados por fecha x actividad y fecha x nave: horas unicas por operario
  const act = new Map<string, { fecha: Date; actividad: string; bultos: number; ops: Set<string>; horasPorOp: Map<string, Set<number>> }>()
  const nav = new Map<string, { fecha: Date; nave: string; bultos: number; ops: Set<string>; horasPorOp: Map<string, Set<number>> }>()
  let errores = 0

  for (const r of records) {
    const m = mapMaq(r)
    if (!m) { errores++; continue }
    const fISO = m.fecha.toISOString().slice(0, 10)

    const k = `${fISO}|${m.turno}|${m.operario}|${m.actividad}|${m.nave}`
    let o = opNave.get(k)
    if (!o) {
      o = { fecha: m.fecha, turno: m.turno, operario: m.operario, nombre: m.nombre, actividad: m.actividad, nave: m.nave, total: 0, bultos: 0, apros: 0, homogeneos: 0, horasSet: new Set(), horasVec: new Array(24).fill(0) }
      opNave.set(k, o)
    }
    if (!o.nombre && m.nombre) o.nombre = m.nombre
    o.total += m.total
    o.bultos += m.bultos
    o.apros += m.apros
    o.homogeneos += m.homogeneos
    for (const h of m.horasIdx) o.horasSet.add(h)
    for (let i = 0; i < 24; i++) o.horasVec[i] += m.horasVec[i]

    const ka = `${fISO}|${m.actividad}`
    let a = act.get(ka)
    if (!a) { a = { fecha: m.fecha, actividad: m.actividad, bultos: 0, ops: new Set(), horasPorOp: new Map() }; act.set(ka, a) }
    a.bultos += m.bultos
    a.ops.add(m.operario)
    let ha = a.horasPorOp.get(m.operario)
    if (!ha) { ha = new Set(); a.horasPorOp.set(m.operario, ha) }
    for (const h of m.horasIdx) ha.add(h)

    const kn = `${fISO}|${m.nave}`
    let nv = nav.get(kn)
    if (!nv) { nv = { fecha: m.fecha, nave: m.nave, bultos: 0, ops: new Set(), horasPorOp: new Map() }; nav.set(kn, nv) }
    nv.bultos += m.bultos
    nv.ops.add(m.operario)
    let hn = nv.horasPorOp.get(m.operario)
    if (!hn) { hn = new Set(); nv.horasPorOp.set(m.operario, hn) }
    for (const h of m.horasIdx) hn.add(h)
  }

  const opRows = [...opNave.values()].map((o) => ({
    fecha: o.fecha, turno: o.turno, operario: o.operario, nombre: o.nombre, actividad: o.actividad, nave: o.nave,
    total: o.total, bultos: o.bultos, apros: o.apros, homogeneos: o.homogeneos, horas: o.horasSet.size,
    hora00: o.horasVec[0], hora01: o.horasVec[1], hora02: o.horasVec[2], hora03: o.horasVec[3],
    hora04: o.horasVec[4], hora05: o.horasVec[5], hora06: o.horasVec[6], hora07: o.horasVec[7],
    hora08: o.horasVec[8], hora09: o.horasVec[9], hora10: o.horasVec[10], hora11: o.horasVec[11],
    hora12: o.horasVec[12], hora13: o.horasVec[13], hora14: o.horasVec[14], hora15: o.horasVec[15],
    hora16: o.horasVec[16], hora17: o.horasVec[17], hora18: o.horasVec[18], hora19: o.horasVec[19],
    hora20: o.horasVec[20], hora21: o.horasVec[21], hora22: o.horasVec[22], hora23: o.horasVec[23],
  }))
  const actRows = [...act.values()].map((a) => ({ fecha: a.fecha, actividad: a.actividad, bultos: a.bultos, operarios: a.ops.size, horas: [...a.horasPorOp.values()].reduce((acc, s) => acc + s.size, 0) }))
  const navRows = [...nav.values()].map((v) => ({ fecha: v.fecha, nave: v.nave, bultos: v.bultos, operarios: v.ops.size, horas: [...v.horasPorOp.values()].reduce((acc, s) => acc + s.size, 0) }))

  await clearTipo('maq')
  for (const c of chunk(opRows, 400)) await db.maqOpNave.createMany({ data: c })
  for (const c of chunk(actRows, 400)) await db.maqAct.createMany({ data: c })
  for (const c of chunk(navRows, 400)) await db.maqNave.createMany({ data: c })

  return { insertados: opRows.length, errores, rows: opRows }
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
  const rows: (ReturnType<typeof mapPicking> & { batch: string })[] = []
  let errores = 0
  // sin mapping explícito se auto-detecta una vez con la primera fila (mismo archivo = mismas columnas)
  let mapResuelto = mapping
  for (const r of records) {
    if (!mapResuelto) mapResuelto = autoMapPicking(r)
    const m = mapPicking(r, mapResuelto)
    if (!m) { errores++; continue }
    rows.push({ ...m, batch })
  }
  for (const c of chunk(rows, 1000)) await db.pickingEvento.createMany({ data: c as never })
  return { insertados: rows.length, errores, rows }
}

// Ingesta de PICKING (reporte E-8 / log WMS): fila por evento de levante.
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
  else if (tipo === 'maq') res = await ingestMaq(contando())
  else res = await ingestPicking(contando(), opts.mapping ?? null, opts.batchId)

  const fechas = (res.rows as { fecha: Date }[]).map((r) => r.fecha.getTime())
  let minT = Infinity, maxT = -Infinity
  for (const t of fechas) { if (t < minT) minT = t; if (t > maxT) maxT = t }
  const desde = fechas.length ? new Date(minT).toISOString().slice(0, 10) : undefined
  const hasta = fechas.length ? new Date(maxT).toISOString().slice(0, 10) : undefined

  // upsert: las cargas incrementales (picking) reutilizan el mismo batchId por lote
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
