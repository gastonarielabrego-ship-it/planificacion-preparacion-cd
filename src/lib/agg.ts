// Agregaciones server-side para los modulos del dashboard.
// Los volumenes (H61 ~39k op-dias, TM ~12k, Ola ~1k, Picking <=1M) se procesan en memoria.
import { db } from '@/lib/db'

export interface Filtros {
  from?: string
  to?: string
  turno?: string
  funcion?: string
}

function rango(f: Filtros): { gte?: Date; lte?: Date } {
  const r: { gte?: Date; lte?: Date } = {}
  if (f.from) r.gte = new Date(f.from + 'T00:00:00.000Z')
  if (f.to) r.lte = new Date(f.to + 'T23:59:59.999Z')
  return r
}
const dia = (d: Date) => d.toISOString().slice(0, 10)

// ============ RESUMEN EJECUTIVO ============
export async function getResumen() {
  const [olaCount, h61Count, tmCount, pickCount, batches] = await Promise.all([
    db.olaDia.aggregate({ _count: true, _min: { fecha: true }, _max: { fecha: true }, _avg: { ola: true, total: true } }),
    db.h61OpDia.aggregate({ _count: true, _min: { fecha: true }, _max: { fecha: true }, _sum: { bultos: true, horasActivas: true, extras: true, bultosExtras: true } }),
    db.tiempoMuerto.aggregate({ _count: true, _min: { fecha: true }, _max: { fecha: true }, _sum: { minutos: true, minutosEf: true } }),
    db.pickingEvento.aggregate({ _count: true, _min: { fecha: true }, _max: { fecha: true } }),
    db.uploadBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
  ])

  const opsUnicos = await db.h61OpDia.findMany({ select: { operario: true }, distinct: ['operario'] })

  // top categorias TM (excluye bajas ESTADO B; OR con null es clave: NOT excludes NULLs en SQL)
  const tmCats = await db.tiempoMuerto.groupBy({
    by: ['categoria'],
    _sum: { minutosEf: true },
    _count: true,
    where: { OR: [{ estado: null }, { estado: { not: 'B' } }] },
    orderBy: { _sum: { minutosEf: 'desc' } },
  })

  const horasTotales = h61Count._sum.horasActivas ?? 0
  const bultos = h61Count._sum.bultos ?? 0
  const bultosExtras = h61Count._sum.bultosExtras ?? 0
  const totalMinTM = tmCats.reduce((a, c) => a + (c._sum.minutosEf ?? 0), 0)

  return {
    datasets: {
      ola: { registros: olaCount._count, desde: olaCount._min.fecha, hasta: olaCount._max.fecha, olaMedia: Math.round(olaCount._avg.ola ?? 0), totalMedia: Math.round(olaCount._avg.total ?? 0) },
      h61: { registros: h61Count._count, desde: h61Count._min.fecha, hasta: h61Count._max.fecha, bultos, horas: horasTotales, productividad: horasTotales ? +(bultos / horasTotales).toFixed(1) : 0, operarios: opsUnicos.length, extrasHoras: h61Count._sum.extras ?? 0, bultosExtras, pctBultosExtras: bultos ? +((bultosExtras / bultos) * 100).toFixed(1) : 0 },
      tm: { registros: tmCount._count, desde: tmCount._min.fecha, hasta: tmCount._max.fecha, minutos: totalMinTM, horas: +(totalMinTM / 60).toFixed(0), pctSobreHorasH61: horasTotales ? +(((totalMinTM / 60) / horasTotales) * 100).toFixed(1) : 0 },
      picking: { registros: pickCount._count, desde: pickCount._min.fecha, hasta: pickCount._max.fecha },
    },
    topCategoriasTM: tmCats.slice(0, 6).map((c) => ({ categoria: c.categoria, minutos: c._sum.minutosEf ?? 0, registros: c._count })),
    batches: batches.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() })),
  }
}

// ============ OLA / PLANIFICACION ============
export async function getPlanificacion(f: Filtros) {
  const where = { fecha: rango(f) }
  const [ola, h61] = await Promise.all([
    db.olaDia.findMany({ where, orderBy: { fecha: 'asc' } }),
    db.h61OpDia.findMany({ where: { fecha: rango(f) }, select: { fecha: true, operario: true, horasActivas: true, bultos: true, bultosBase: true, bultosExtras: true, extras: true, turno: true, funcion: true } }),
  ])

  const porDia = new Map<string, { ops: number; opsExtras: number; horas: number; horasExtras: number; bultos: number; bultosBase: number; bultosExtras: number }>()
  for (const r of h61) {
    const k = dia(r.fecha)
    let p = porDia.get(k)
    if (!p) { p = { ops: 0, opsExtras: 0, horas: 0, horasExtras: 0, bultos: 0, bultosBase: 0, bultosExtras: 0 }; porDia.set(k, p) }
    p.ops += 1
    if (r.extras > 0) p.opsExtras += 1
    p.horas += r.horasActivas
    p.horasExtras += r.extras
    p.bultos += r.bultos
    p.bultosBase += r.bultosBase
    p.bultosExtras += r.bultosExtras
  }

  const fechas = new Set<string>([...ola.map((o) => dia(o.fecha)), ...porDia.keys()])
  const serie = [...fechas].sort().map((k) => {
    const o = ola.find((x) => dia(x.fecha) === k)
    const p = porDia.get(k)
    const demanda = o?.total ?? null
    const prodHora = p && p.horas ? p.bultos / p.horas : null
    // capacidad si se suprimen extras: mantiene bultosBase (produccion en <=8h por operario)
    const faltanteSinExtras = p && demanda != null ? Math.max(0, demanda - p.bultosBase) : null
    return {
      fecha: k,
      ola: o?.ola ?? null,
      pendiente: o?.pendiente ?? null,
      demanda,
      preparado: p?.bultos ?? null,
      ops: p?.ops ?? null,
      opsExtras: p?.opsExtras ?? null,
      horas: p ? +p.horas.toFixed(1) : null,
      horasExtras: p?.horasExtras ?? 0,
      prodHora: prodHora != null ? +prodHora.toFixed(1) : null,
      bultosBase: p?.bultosBase ?? null,
      bultosExtras: p?.bultosExtras ?? null,
      faltanteSinExtras: faltanteSinExtras != null ? Math.round(faltanteSinExtras) : null,
    }
  })

  // agregados por mes
  const porMes = new Map<string, { ola: number; demanda: number; preparado: number; dias: number; diasExtras: number; horasExtras: number; faltante: number }>()
  for (const s of serie) {
    const k = s.fecha.slice(0, 7)
    let m = porMes.get(k)
    if (!m) { m = { ola: 0, demanda: 0, preparado: 0, dias: 0, diasExtras: 0, horasExtras: 0, faltante: 0 }; porMes.set(k, m) }
    m.dias += 1
    if (s.demanda != null) m.demanda += s.demanda
    if (s.ola != null) m.ola += s.ola
    if (s.preparado != null) m.preparado += s.preparado
    if ((s.opsExtras ?? 0) > 0) m.diasExtras += 1
    m.horasExtras += s.horasExtras ?? 0
    if (s.faltanteSinExtras != null) m.faltante += s.faltanteSinExtras
  }
  const meses = [...porMes.entries()].sort().map(([mes, v]) => ({ mes, ...v }))

  const conExtras = serie.filter((s) => (s.opsExtras ?? 0) > 0)
  const resumen = {
    dias: serie.length,
    diasConExtras: conExtras.length,
    pctDiasConExtras: serie.length ? +((conExtras.length / serie.length) * 100).toFixed(1) : 0,
    faltantePromedioSinExtras: conExtras.length ? Math.round(conExtras.reduce((a, s) => a + (s.faltanteSinExtras ?? 0), 0) / conExtras.length) : 0,
    faltanteTotalSinExtras: conExtras.reduce((a, s) => a + (s.faltanteSinExtras ?? 0), 0),
    horasExtrasTotales: serie.reduce((a, s) => a + (s.horasExtras ?? 0), 0),
    bultosExtrasTotales: serie.reduce((a, s) => a + (s.bultosExtras ?? 0), 0),
    prodHoraMedia: (() => {
      const vals = serie.filter((s) => s.prodHora != null && s.preparado != null && (s.preparado ?? 0) > 0)
      const totB = vals.reduce((a, s) => a + (s.preparado ?? 0), 0)
      const totH = vals.reduce((a, s) => a + (s.horas ?? 0), 0)
      return totH ? +(totB / totH).toFixed(1) : null
    })(),
  }

  return { serie, meses, resumen }
}

// ============ OLA (analisis exclusivo de ola y pendientes) ============
// Serie diaria cruda + lunes de cada semana ISO. Los agregados (mes/semana/dia de
// semana, promedio y mediana) se recalculan en el cliente para que los filtros
// mensual/semanal/diario sean consistentes entre si.
const DIAS_SEM = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

export async function getOla(f: Filtros) {
  const rows = await db.olaDia.findMany({ where: { fecha: rango(f) }, orderBy: { fecha: 'asc' } })
  const serie = rows.map((r) => {
    const k = dia(r.fecha)
    const d = new Date(k + 'T00:00:00.000Z')
    const dow = d.getUTCDay() // 0=domingo
    const lun = new Date(d)
    lun.setUTCDate(lun.getUTCDate() - ((dow + 6) % 7)) // lunes de la semana
    const ola = r.ola ?? 0
    const pendiente = r.pendiente ?? 0
    return {
      fecha: k,
      diaSemana: DIAS_SEM[dow],
      esFinde: dow === 0 || dow === 6,
      semana: lun.toISOString().slice(0, 10),
      ola,
      pendiente,
      total: ola + pendiente,
    }
  })
  return { serie }
}

// ============ PRODUCTIVIDAD H61 ============
export async function getH61(f: Filtros) {
  const where: Record<string, unknown> = { fecha: rango(f) }
  if (f.turno) where.turno = f.turno
  if (f.funcion) where.funcion = f.funcion

  const [ops, th, ci] = await Promise.all([
    db.h61OpDia.findMany({ where }),
    db.h61TurnoHora.findMany({ where: { fecha: rango(f) } }),
    db.h61Circuito.findMany({ where: { fecha: rango(f) } }),
  ])

  // Perfil 24h: horas 0-5 del turno noche (N) pertenecen al dia calendario siguiente
  const porHora = Array.from({ length: 24 }, () => ({ bultos: 0, operarios: new Set<string>() }))
  const opSeen = new Map<string, Set<number>>() // fecha|op -> horas
  for (const r of th) {
    const fechaBase = new Date(r.fecha)
    const esNocheMadrugada = r.turno === 'N' && r.hora <= 5
    if (esNocheMadrugada) fechaBase.setUTCDate(fechaBase.getUTCDate() + 1)
    const h = porHora[r.hora]
    h.bultos += r.bultos
    const k = `${dia(fechaBase)}|${r.turno}`
    // operarios por hora aproximamos con el maximo informado ese dia-turno
    const set = opSeen.get(k) ?? new Set<number>()
    set.add(r.operarios)
    opSeen.set(k, set)
  }
  const perfilHora = porHora.map((h, i) => ({
    hora: i,
    etiqueta: `${String(i).padStart(2, '0')}:00`,
    bultos: h.bultos,
    operariosProm: (() => {
      const vals = [...opSeen.values()].map((s) => Math.max(...s))
      return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 0
    })(),
  }))
  const horasConDatos = perfilHora.filter((p) => p.bultos > 0)
  const pico = horasConDatos.reduce((a, b) => (b.bultos > a.bultos ? b : a), horasConDatos[0] ?? { hora: 0, etiqueta: '-', bultos: 0, operariosProm: 0 })
  const valle = horasConDatos.reduce((a, b) => (b.bultos < a.bultos ? b : a), horasConDatos[0] ?? { hora: 0, etiqueta: '-', bultos: 0, operariosProm: 0 })

  // por turno
  const turnoAgg = new Map<string, { bultos: number; horas: number; opsDias: number; bultosExtras: number }>()
  for (const r of th) {
    let t = turnoAgg.get(r.turno)
    if (!t) { t = { bultos: 0, horas: 0, opsDias: 0, bultosExtras: 0 }; turnoAgg.set(r.turno, t) }
    t.bultos += r.bultos
  }
  const turnoHoras = new Map<string, Set<string>>()
  for (const r of ops) {
    let t = turnoHoras.get(r.turno)
    if (!t) { t = new Set(); turnoHoras.set(r.turno, t) }
    t.add(`${dia(r.fecha)}|${r.operario}`)
    t.add(`${dia(r.fecha)}|${r.operario}|h|${r.horasActivas}`)
  }
  for (const [turno, set] of turnoHoras) {
    const horas = [...set].filter((x) => x.includes('|h|')).reduce((a, x) => a + parseInt(x.split('|h|')[1], 10), 0)
    const opsDias = [...set].filter((x) => !x.includes('|h|')).length
    const t = turnoAgg.get(turno)
    if (t) { t.horas = horas; t.opsDias = opsDias }
  }
  for (const r of ops) {
    const t = turnoAgg.get(r.turno)
    if (t) t.bultosExtras += r.bultosExtras
  }
  const porTurno = [...turnoAgg.entries()].map(([turno, v]) => ({
    turno,
    nombre: turno === 'M' ? 'Mañana' : turno === 'T' ? 'Tarde' : turno === 'N' ? 'Noche' : turno,
    ...v,
    prodHora: v.horas ? +(v.bultos / v.horas).toFixed(1) : 0,
  })).sort((a, b) => b.bultos - a.bultos)

  // heatmap turno x hora
  const heat = ['M', 'T', 'N'].map((turno) => {
    const fila = Array.from({ length: 24 }, () => 0)
    for (const r of th) if (r.turno === turno) fila[r.hora] = Math.max(fila[r.hora], Math.round(r.bultos / Math.max(1, r.operarios)))
    return { turno, valores: fila }
  })

  // circuitos
  const ciAgg = new Map<string, number>()
  for (const r of ci) ciAgg.set(r.circuito, (ciAgg.get(r.circuito) ?? 0) + r.bultos)
  const circuitos = [...ciAgg.entries()].map(([circuito, bultos]) => ({ circuito, bultos })).sort((a, b) => b.bultos - a.bultos)

  // distribucion de jornadas 8h vs extras
  const distHoras = new Map<number, number>()
  for (const r of ops) distHoras.set(r.horasActivas, (distHoras.get(r.horasActivas) ?? 0) + 1)
  const distribucion = [...distHoras.entries()].sort((a, b) => a[0] - b[0]).map(([horas, opsDia]) => ({ horas, opsDia }))

  const opsExtras = ops.filter((r) => r.extras > 0)
  const extrasResumen = {
    opsDiasTotal: ops.length,
    opsDiasConExtras: opsExtras.length,
    pctOpsDiasConExtras: ops.length ? +((opsExtras.length / ops.length) * 100).toFixed(1) : 0,
    horasExtras: opsExtras.reduce((a, r) => a + r.extras, 0),
    bultosExtras: opsExtras.reduce((a, r) => a + r.bultosExtras, 0),
    bultosTotales: ops.reduce((a, r) => a + r.bultos, 0),
  }
  extrasResumen.pctBultosExtras = extrasResumen.bultosTotales ? +((extrasResumen.bultosExtras / extrasResumen.bultosTotales) * 100).toFixed(1) : 0

  // top operarios por productividad (minimo 80 horas)
  const opAgg = new Map<string, { nombre: string | null; bultos: number; horas: number; extras: number; dias: number; funcion: string }>()
  for (const r of ops) {
    let o = opAgg.get(r.operario)
    if (!o) { o = { nombre: r.nombre, bultos: 0, horas: 0, extras: 0, dias: 0, funcion: r.funcion }; opAgg.set(r.operario, o) }
    if (!o.nombre && r.nombre) o.nombre = r.nombre
    o.bultos += r.bultos
    o.horas += r.horasActivas
    o.extras += r.extras
    o.dias += 1
  }
  const operarios = [...opAgg.entries()]
    .map(([operario, o]) => ({ operario, nombre: o.nombre ?? operario, bultos: o.bultos, horas: o.horas, extras: o.extras, dias: o.dias, prodHora: o.horas ? +(o.bultos / o.horas).toFixed(1) : 0 }))
    .filter((o) => o.horas >= 80)
    .sort((a, b) => b.prodHora - a.prodHora)

  // serie diaria
  const serDia = new Map<string, { bultos: number; horas: number; ops: number }>()
  for (const r of ops) {
    const k = dia(r.fecha)
    let s = serDia.get(k)
    if (!s) { s = { bultos: 0, horas: 0, ops: 0 }; serDia.set(k, s) }
    s.bultos += r.bultos
    s.horas += r.horasActivas
    s.ops += 1
  }
  const serie = [...serDia.entries()].sort().map(([fecha, v]) => ({ fecha, ...v, prodHora: v.horas ? +(v.bultos / v.horas).toFixed(1) : 0 }))

  const bultosTot = ops.reduce((a, r) => a + r.bultos, 0)
  const horasTot = ops.reduce((a, r) => a + r.horasActivas, 0)

  return {
    perfilHora,
    pico: { ...pico },
    valle: { ...valle },
    porTurno,
    heat,
    circuitos: circuitos.slice(0, 17),
    distribucion,
    extrasResumen,
    operariosTop: operarios.slice(0, 15),
    operariosBottom: operarios.slice(-15).reverse(),
    operariosExtras: [...opAgg.entries()].map(([operario, o]) => ({ operario, nombre: o.nombre ?? operario, extras: o.extras, dias: o.dias })).filter((o) => o.extras > 0).sort((a, b) => b.extras - a.extras).slice(0, 15),
    serie,
    resumen: { bultos: bultosTot, horas: horasTot, prodHora: horasTot ? +(bultosTot / horasTot).toFixed(1) : 0, opsUnicos: opAgg.size },
  }
}

// ============ CAPACIDAD H61 (ritmo de preparacion: jornada vs extras) ============
// Regla: las primeras 8 horas con produccion de cada operario-dia cuentan como
// jornada base; el excedente de horas y sus bultos cuentan como horas extra.
function mediana(vals: number[]): number {
  if (!vals.length) return 0
  const s = [...vals].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export async function getCapacidad(f: Filtros) {
  const [ops, oh] = await Promise.all([
    db.h61OpDia.findMany({ where: { fecha: rango(f) }, orderBy: { fecha: 'asc' } }),
    db.h61OpHora.findMany({ where: { fecha: rango(f) } }),
  ])
  if (!ops.length) return { serie: [], porMes: [], porTurno: [], perfilHora: [], resumen: null, tieneOpHora: oh.length > 0 }

  // --- serie diaria ---
  const porDia = new Map<string, { bultos: number; bultosBase: number; bultosExtras: number; horas: number; horasExtras: number; ops: Set<string>; opsExtras: Set<string>; opDias: number }>()
  for (const r of ops) {
    const k = dia(r.fecha)
    let p = porDia.get(k)
    if (!p) { p = { bultos: 0, bultosBase: 0, bultosExtras: 0, horas: 0, horasExtras: 0, ops: new Set(), opsExtras: new Set(), opDias: 0 }; porDia.set(k, p) }
    p.bultos += r.bultos
    p.bultosBase += r.bultosBase
    p.bultosExtras += r.bultosExtras
    p.horas += r.horasActivas
    p.horasExtras += r.extras
    p.ops.add(r.operario)
    if (r.extras > 0) p.opsExtras.add(r.operario)
    p.opDias += 1
  }

  const serie = [...porDia.entries()].sort().map(([fecha, p]) => ({
    fecha,
    bultos: p.bultos,
    bultosBase: p.bultosBase,
    bultosExtras: p.bultosExtras,
    pctExtras: p.bultos ? +((p.bultosExtras / p.bultos) * 100).toFixed(1) : 0,
    horas: p.horas,
    horasExtras: p.horasExtras,
    ritmo: p.horas ? +(p.bultos / p.horas).toFixed(1) : null,
    ops: p.ops.size,
    opsExtras: p.opsExtras.size,
    opDias: p.opDias,
  }))

  // --- agregados por mes ---
  const mesAgg = new Map<string, { bultos: number; bultosBase: number; bultosExtras: number; horas: number; horasExtras: number; opDias: number; ops: Set<string>; opsExtras: Set<string>; ritmos: number[]; dias: number }>()
  for (const s of serie) {
    const k = s.fecha.slice(0, 7)
    let m = mesAgg.get(k)
    if (!m) { m = { bultos: 0, bultosBase: 0, bultosExtras: 0, horas: 0, horasExtras: 0, opDias: 0, ops: new Set(), opsExtras: new Set(), ritmos: [], dias: 0 }; mesAgg.set(k, m) }
    m.dias += 1
    m.bultos += s.bultos
    m.bultosBase += s.bultosBase
    m.bultosExtras += s.bultosExtras
    m.horas += s.horas
    m.horasExtras += s.horasExtras
    m.opDias += s.opDias
    m.ritmos.push(s.ritmo ?? 0)
  }
  // personas distintas por mes (necesita operarios por dia)
  const opsPorDia = new Map<string, { ops: Set<string>; opsExtras: Set<string> }>()
  for (const r of ops) {
    const k = dia(r.fecha)
    let p = opsPorDia.get(k)
    if (!p) { p = { ops: new Set(), opsExtras: new Set() }; opsPorDia.set(k, p) }
    p.ops.add(r.operario)
    if (r.extras > 0) p.opsExtras.add(r.operario)
  }
  for (const s of serie) {
    const m = mesAgg.get(s.fecha.slice(0, 7))
    const p = opsPorDia.get(s.fecha)
    if (!m || !p) continue
    for (const op of p.ops) m.ops.add(op)
    for (const op of p.opsExtras) m.opsExtras.add(op)
  }
  const porMes = [...mesAgg.entries()].sort().map(([mes, m]) => ({
    mes,
    dias: m.dias,
    actividades: m.opDias,
    personas: m.ops.size,
    personasExtras: m.opsExtras.size,
    bultos: m.bultos,
    bultosBase: m.bultosBase,
    bultosExtras: m.bultosExtras,
    pctExtras: m.bultos ? +((m.bultosExtras / m.bultos) * 100).toFixed(1) : 0,
    horas: m.horas,
    horasExtras: m.horasExtras,
    ritmoProm: m.horas ? +(m.bultos / m.horas).toFixed(1) : null,
    ritmoMediana: m.ritmos.length ? +mediana(m.ritmos).toFixed(1) : null,
  }))

  // --- perfil por hora: colaboradores en jornada vs extras (promedio por dia) ---
  type HoraAgg = { fechas: Set<string>; jornada: Map<string, Set<string>>; extras: Map<string, Set<string>>; bultos: Map<string, number> }
  const horasAgg: HoraAgg[] = Array.from({ length: 24 }, () => ({ fechas: new Set<string>(), jornada: new Map(), extras: new Map(), bultos: new Map() }))
  for (const r of oh) {
    const h = horasAgg[r.hora]
    if (!h) continue
    const k = dia(r.fecha)
    h.fechas.add(k)
    const destino = r.esExtra ? h.extras : h.jornada
    let set = destino.get(k)
    if (!set) { set = new Set(); destino.set(k, set) }
    set.add(r.operario)
    h.bultos.set(k, (h.bultos.get(k) ?? 0) + r.bultos)
  }
  const perfilHora = horasAgg.map((h, hora) => {
    const n = h.fechas.size
    const sumaJornada = [...h.jornada.values()].reduce((a, s) => a + s.size, 0)
    const sumaExtras = [...h.extras.values()].reduce((a, s) => a + s.size, 0)
    const sumaBultos = [...h.bultos.values()].reduce((a, b) => a + b, 0)
    return {
      hora,
      etiqueta: `${String(hora).padStart(2, '0')}:00`,
      opsJornada: n ? +(sumaJornada / n).toFixed(1) : 0,
      opsExtras: n ? +(sumaExtras / n).toFixed(1) : 0,
      bultosProm: n ? Math.round(sumaBultos / n) : 0,
    }
  })

  // --- resumen por turno (ventanas: TM 6-14, TT 14-22, TN 23-06) ---
  const turnoAgg = new Map<string, { bultos: number; bultosBase: number; bultosExtras: number; horas: number; horasExtras: number; opDias: number; ops: Set<string>; opsExtras: Set<string> }>()
  for (const r of ops) {
    let t = turnoAgg.get(r.turno)
    if (!t) { t = { bultos: 0, bultosBase: 0, bultosExtras: 0, horas: 0, horasExtras: 0, opDias: 0, ops: new Set(), opsExtras: new Set() }; turnoAgg.set(r.turno, t) }
    t.bultos += r.bultos
    t.bultosBase += r.bultosBase
    t.bultosExtras += r.bultosExtras
    t.horas += r.horasActivas
    t.horasExtras += r.extras
    t.opDias += 1
    t.ops.add(r.operario)
    if (r.extras > 0) t.opsExtras.add(r.operario)
  }
  const NOMBRE_TURNO: Record<string, string> = { M: 'TM (6 a 14)', T: 'TT (14 a 22)', N: 'TN (23 a 06)' }
  const porTurno = [...turnoAgg.entries()].sort().map(([turno, t]) => ({
    turno,
    nombre: NOMBRE_TURNO[turno] ?? turno,
    opDias: t.opDias,
    personas: t.ops.size,
    personasExtras: t.opsExtras.size,
    bultos: t.bultos,
    bultosBase: t.bultosBase,
    bultosExtras: t.bultosExtras,
    pctExtras: t.bultos ? +((t.bultosExtras / t.bultos) * 100).toFixed(1) : 0,
    horasExtras: t.horasExtras,
    ritmoProm: t.horas ? +(t.bultos / t.horas).toFixed(1) : null,
  }))

  // --- resumen del periodo filtrado ---
  const bultos = serie.reduce((a, s) => a + s.bultos, 0)
  const bultosBase = serie.reduce((a, s) => a + s.bultosBase, 0)
  const bultosExtras = serie.reduce((a, s) => a + s.bultosExtras, 0)
  const horas = serie.reduce((a, s) => a + s.horas, 0)
  const horasExtras = serie.reduce((a, s) => a + s.horasExtras, 0)
  const personas = new Set<string>()
  const personasExtras = new Set<string>()
  for (const p of opsPorDia.values()) {
    for (const op of p.ops) personas.add(op)
    for (const op of p.opsExtras) personasExtras.add(op)
  }
  const resumen = {
    dias: serie.length,
    actividades: serie.reduce((a, s) => a + s.opDias, 0),
    personas: personas.size,
    personasExtras: personasExtras.size,
    bultos,
    bultosBase,
    bultosExtras,
    pctExtras: bultos ? +((bultosExtras / bultos) * 100).toFixed(1) : 0,
    horas,
    horasExtras,
    ritmoProm: horas ? +(bultos / horas).toFixed(1) : null,
    ritmoMediana: +mediana(serie.map((s) => s.ritmo ?? 0)).toFixed(1),
  }

  return { serie, porMes, porTurno, perfilHora, resumen, tieneOpHora: oh.length > 0 }
}

// ============ TIEMPOS MUERTOS ============
export async function getTM(f: Filtros & { incluirBajas?: boolean }) {
  const where: Record<string, unknown> = { fecha: rango(f) }
  if (!f.incluirBajas) where.OR = [{ estado: null }, { estado: { not: 'B' } }]
  if (f.turno) where.turno = f.turno

  const rows = await db.tiempoMuerto.findMany({ where })

  const totalMin = rows.reduce((a, r) => a + r.minutosEf, 0)
  const cats = new Map<string, { minutos: number; registros: number }>()
  for (const r of rows) {
    let c = cats.get(r.categoria)
    if (!c) { c = { minutos: 0, registros: 0 }; cats.set(r.categoria, c) }
    c.minutos += r.minutosEf
    c.registros += 1
  }
  const porCategoria = [...cats.entries()].map(([categoria, v]) => ({ categoria, ...v, pct: totalMin ? +((v.minutos / totalMin) * 100).toFixed(1) : 0 })).sort((a, b) => b.minutos - a.minutos)

  // nave x pasillo (ESPERA UBICACION)
  const naves = new Map<string, { minutos: number; registros: number; pasillos: Map<string, { minutos: number; registros: number }> }>()
  for (const r of rows) {
    if (r.categoria !== 'ESPERA UBICACION' || !r.nave) continue
    let n = naves.get(r.nave)
    if (!n) { n = { minutos: 0, registros: 0, pasillos: new Map() }; naves.set(r.nave, n) }
    n.minutos += r.minutosEf
    n.registros += 1
    const pk = r.pasillo ?? '?'
    let p = n.pasillos.get(pk)
    if (!p) { p = { minutos: 0, registros: 0 }; n.pasillos.set(pk, p) }
    p.minutos += r.minutosEf
    p.registros += 1
  }
  const porNave = [...naves.entries()].map(([nave, v]) => ({
    nave,
    minutos: v.minutos,
    registros: v.registros,
    pasillos: [...v.pasillos.entries()].map(([pasillo, p]) => ({ pasillo, ...p })).sort((a, b) => b.minutos - a.minutos),
  })).sort((a, b) => b.minutos - a.minutos)

  // por turno y por dia
  const turnosMap = new Map<string, number>()
  const diasMap = new Map<string, number>()
  const horasMap = new Map<number, number>()
  const detalles = new Map<string, { minutos: number; registros: number }>()
  for (const r of rows) {
    turnosMap.set(r.turno, (turnosMap.get(r.turno) ?? 0) + r.minutosEf)
    const k = dia(r.fecha)
    diasMap.set(k, (diasMap.get(k) ?? 0) + r.minutosEf)
    if (r.horaDesde != null) horasMap.set(Math.floor(r.horaDesde / 60), (horasMap.get(Math.floor(r.horaDesde / 60)) ?? 0) + r.minutosEf)
    const dk = r.detalle ?? '(sin dato)'
    let d = detalles.get(dk)
    if (!d) { d = { minutos: 0, registros: 0 }; detalles.set(dk, d) }
    d.minutos += r.minutosEf
    d.registros += 1
  }
  const NOM_TURNO: Record<string, string> = { TM: 'Mañana', TT: 'Tarde', TN: 'Noche' }
  const porTurno = [...turnosMap.entries()].map(([t, minutos]) => ({ turno: t, nombre: NOM_TURNO[t] ?? t, minutos })).sort((a, b) => b.minutos - a.minutos)
  const porDia = [...diasMap.entries()].sort().map(([fecha, minutos]) => ({ fecha, minutos }))
  const porHora = Array.from({ length: 24 }, (_, h) => ({ hora: h, etiqueta: `${String(h).padStart(2, '0')}:00`, minutos: horasMap.get(h) ?? 0 }))
  const topDetalles = [...detalles.entries()].map(([detalle, v]) => ({ detalle, ...v })).sort((a, b) => b.minutos - a.minutos).slice(0, 25)

  // cruces codigo x categoria
  const codCat = new Map<string, { code: number | null; categoria: string; minutos: number; registros: number }>()
  for (const r of rows) {
    const k = `${r.motivoCode ?? '-'}|${r.categoria}`
    let c = codCat.get(k)
    if (!c) { c = { code: r.motivoCode, categoria: r.categoria, minutos: 0, registros: 0 }; codCat.set(k, c) }
    c.minutos += r.minutosEf
    c.registros += 1
  }
  const codigoCategoria = [...codCat.values()].sort((a, b) => b.minutos - a.minutos).slice(0, 20)

  return {
    totalMin,
    totalHoras: +(totalMin / 60).toFixed(1),
    registros: rows.length,
    porCategoria,
    porNave,
    porTurno,
    porDia,
    porHora,
    topDetalles,
    codigoCategoria,
    navesResumen: {
      minutos: porNave.reduce((a, n) => a + n.minutos, 0),
      naves: porNave.length,
      pasillos: porNave.reduce((a, n) => a + n.pasillos.length, 0),
    },
  }
}

// ============ PICKING ============
export async function getPicking(f: Filtros) {
  const where = { fecha: rango(f) }
  const [count, ops] = await Promise.all([
    db.pickingEvento.count({ where }),
    db.pickingEvento.findMany({ where, orderBy: [{ fecha: 'asc' }, { operario: 'asc' }, { horaMin: 'asc' }], select: { fecha: true, operario: true, horaMin: true, bultos: true, soporte: true, circuito: true } }),
  ])

  if (!count) {
    return { registros: 0, vacio: true as const }
  }

  // gaps entre eventos consecutivos por operario y dia
  const buckets = [
    { label: '0-1 min', min: 0, max: 1 },
    { label: '1-2 min', min: 1, max: 2 },
    { label: '2-5 min', min: 2, max: 5 },
    { label: '5-10 min', min: 5, max: 10 },
    { label: '10-20 min', min: 10, max: 20 },
    { label: '20-60 min', min: 20, max: 60 },
    { label: '> 60 min', min: 60, max: Infinity },
  ]
  const gapCounts = new Array(buckets.length).fill(0)
  const soporteGapCounts = new Array(buckets.length).fill(0)
  let gapSum = 0, gapN = 0, soporteGapSum = 0, soporteGapN = 0, cambiosSoporte = 0
  const opAgg = new Map<string, { nombre: string; eventos: number; gapSum: number; gapN: number; cambioSop: number; bultos: number }>()
  const serDia = new Map<string, { eventos: number; gapMin: number }>()

  let prev: { operario: string; key: string; horaMin: number; soporte: string | null } | null = null
  for (const r of ops) {
    const opKey = r.operario
    let o = opAgg.get(opKey)
    if (!o) { o = { nombre: opKey, eventos: 0, gapSum: 0, gapN: 0, cambioSop: 0, bultos: 0 }; opAgg.set(opKey, o) }
    o.eventos += 1
    o.bultos += r.bultos ?? 0
    const k = r.fecha.toISOString().slice(0, 10)
    let s = serDia.get(k)
    if (!s) { s = { eventos: 0, gapMin: 0 }; serDia.set(k, s) }
    s.eventos += 1

    if (prev && prev.operario === opKey && prev.key === k && r.horaMin != null && prev.horaMin != null) {
      const gap = Math.max(0, r.horaMin - prev.horaMin)
      if (gap > 720) {
        // salto de jornada (>12 h): no es tiempo muerto, se ignora para las metricas
        prev = { operario: opKey, key: k, horaMin: r.horaMin ?? -1, soporte: r.soporte }
        continue
      }
      const bi = buckets.findIndex((b) => gap >= b.min && gap < b.max)
      if (bi >= 0) gapCounts[bi]++
      gapSum += gap; gapN++
      s.gapMin += gap
      o.gapSum += gap; o.gapN++
      const cambioSop = prev.soporte != null && r.soporte != null && prev.soporte !== r.soporte
      if (cambioSop) {
        cambiosSoporte++
        if (bi >= 0) soporteGapCounts[bi]++
        soporteGapSum += gap; soporteGapN++
        o.cambioSop++
      }
    }
    prev = { operario: opKey, key: k, horaMin: r.horaMin ?? -1, soporte: r.soporte }
  }

  const serie = [...serDia.entries()].sort().map(([fecha, v]) => ({ fecha, eventos: v.eventos, gapPromedio: v.eventos > 1 ? +(v.gapMin / (v.eventos - 1)).toFixed(2) : null }))

  return {
    registros: count,
    vacio: false as const,
    operarios: opAgg.size,
    gapPromedio: gapN ? +(gapSum / gapN).toFixed(2) : null,
    gapMedianaEst: gapN ? +(gapSum / gapN).toFixed(2) : null,
    cambiosSoporte,
    gapPromedioCambioSoporte: soporteGapN ? +(soporteGapSum / soporteGapN).toFixed(2) : null,
    distribucionGaps: buckets.map((b, i) => ({ bucket: b.label, cantidad: gapCounts[i] })),
    distribucionGapsSoporte: buckets.map((b, i) => ({ bucket: b.label, cantidad: soporteGapCounts[i] })),
    operariosTop: [...opAgg.values()].filter((o) => o.gapN > 30).map((o) => ({ operario: o.nombre, eventos: o.eventos, bultos: o.bultos, gapPromedio: +(o.gapSum / o.gapN).toFixed(2), cambiosSoporte: o.cambioSop })).sort((a, b) => b.eventos - a.eventos).slice(0, 15),
    serie,
  }
}

// ============ PRODUCTIVIDAD POR CIRCUITO/SECTOR (Tiempos E-8 / Productividad X Circuito) ============
const r1 = (x: number) => Math.round(x * 10) / 10
const r2 = (x: number) => Math.round(x * 100) / 100

export async function getProdCirc(f: Filtros) {
  const where = { fecha: rango(f) }
  const [tot, sectores, filas, ops] = await Promise.all([
    db.prodCircuito.aggregate({
      where,
      _count: true,
      _min: { fecha: true },
      _max: { fecha: true },
      _sum: { soportes: true, lineas: true, bultos: true, tiempoTotal: true, tiempoMuerto: true, tiempoNeto: true, tiempoSuperNeto: true },
    }),
    db.prodCircuito.groupBy({
      by: ['sector'],
      where,
      _sum: { soportes: true, bultos: true, tiempoTotal: true, tiempoMuerto: true, tiempoSuperNeto: true },
    }),
    db.prodCircuito.findMany({ where, select: { fecha: true, bultos: true, tiempoTotal: true, tiempoMuerto: true, tiempoSuperNeto: true } }),
    db.prodCircuito.groupBy({
      by: ['operario', 'nombre'],
      where,
      _sum: { bultos: true, soportes: true, tiempoTotal: true, tiempoMuerto: true, tiempoSuperNeto: true },
    }),
  ])

  if (!tot._count) return { registros: 0, vacio: true as const }

  const s = tot._sum
  const kpis = {
    registros: tot._count,
    soportes: Math.round(s.soportes ?? 0),
    lineas: Math.round(s.lineas ?? 0),
    bultos: Math.round(s.bultos ?? 0),
    horasTotal: r1(s.tiempoTotal ?? 0),
    horasMuerto: r1(s.tiempoMuerto ?? 0),
    horasNeto: r1(s.tiempoNeto ?? 0),
    pctMuerto: s.tiempoTotal ? r1(((s.tiempoMuerto ?? 0) / s.tiempoTotal) * 100) : null,
    prodTotal: s.tiempoTotal ? r2((s.bultos ?? 0) / s.tiempoTotal) : null,
    prodNeto: s.tiempoNeto ? r2((s.bultos ?? 0) / s.tiempoNeto) : null,
    prodSuperNeto: s.tiempoSuperNeto ? r2((s.bultos ?? 0) / s.tiempoSuperNeto) : null,
  }

  const porSector = sectores
    .map((x) => ({
      sector: x.sector || '(sin sector)',
      soportes: Math.round(x._sum.soportes ?? 0),
      bultos: Math.round(x._sum.bultos ?? 0),
      pctMuerto: x._sum.tiempoTotal ? r1(((x._sum.tiempoMuerto ?? 0) / x._sum.tiempoTotal) * 100) : null,
      prodSuperNeto: x._sum.tiempoSuperNeto && x._sum.tiempoSuperNeto > 0 ? r2((x._sum.bultos ?? 0) / x._sum.tiempoSuperNeto) : null,
    }))
    .sort((a, b) => b.bultos - a.bultos)

  // serie mensual
  const porMesMap = new Map<string, { bultos: number; tiempoTotal: number; tiempoMuerto: number; tiempoSuperNeto: number }>()
  for (const r of filas) {
    const k = dia(r.fecha).slice(0, 7)
    let m = porMesMap.get(k)
    if (!m) { m = { bultos: 0, tiempoTotal: 0, tiempoMuerto: 0, tiempoSuperNeto: 0 }; porMesMap.set(k, m) }
    m.bultos += r.bultos ?? 0
    m.tiempoTotal += r.tiempoTotal ?? 0
    m.tiempoMuerto += r.tiempoMuerto ?? 0
    m.tiempoSuperNeto += r.tiempoSuperNeto ?? 0
  }
  const porMes = [...porMesMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, m]) => ({
    mes,
    bultos: Math.round(m.bultos),
    pctMuerto: m.tiempoTotal ? r1((m.tiempoMuerto / m.tiempoTotal) * 100) : null,
    prodSuperNeto: m.tiempoSuperNeto > 0 ? r2(m.bultos / m.tiempoSuperNeto) : null,
  }))

  const operariosTop = ops
    .map((x) => ({
      operario: x.operario,
      nombre: x.nombre || x.operario,
      bultos: Math.round(x._sum.bultos ?? 0),
      soportes: Math.round(x._sum.soportes ?? 0),
      horasTotal: r1(x._sum.tiempoTotal ?? 0),
      pctMuerto: x._sum.tiempoTotal ? r1(((x._sum.tiempoMuerto ?? 0) / x._sum.tiempoTotal) * 100) : null,
      prodSuperNeto: x._sum.tiempoSuperNeto && x._sum.tiempoSuperNeto > 0 ? r2((x._sum.bultos ?? 0) / x._sum.tiempoSuperNeto) : null,
    }))
    .sort((a, b) => b.bultos - a.bultos)
    .slice(0, 15)

  return {
    registros: tot._count,
    vacio: false as const,
    desde: tot._min.fecha ? dia(tot._min.fecha) : undefined,
    hasta: tot._max.fecha ? dia(tot._max.fecha) : undefined,
    kpis,
    porSector,
    porMes,
    operariosTop,
  }
}

// ============ STATUS ============
export async function getStatus() {
  const [ola, h61, tm, pk, pc, batches] = await Promise.all([
    db.olaDia.aggregate({ _count: true, _min: { fecha: true }, _max: { fecha: true } }),
    db.h61OpDia.aggregate({ _count: true, _min: { fecha: true }, _max: { fecha: true } }),
    db.tiempoMuerto.aggregate({ _count: true, _min: { fecha: true }, _max: { fecha: true } }),
    db.pickingEvento.aggregate({ _count: true, _min: { fecha: true }, _max: { fecha: true } }),
    db.prodCircuito.aggregate({ _count: true, _min: { fecha: true }, _max: { fecha: true } }),
    db.uploadBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
  ])
  return {
    ola: { registros: ola._count, desde: ola._min.fecha, hasta: ola._max.fecha },
    h61: { registros: h61._count, desde: h61._min.fecha, hasta: h61._max.fecha },
    tm: { registros: tm._count, desde: tm._min.fecha, hasta: tm._max.fecha },
    picking: { registros: pk._count, desde: pk._min.fecha, hasta: pk._max.fecha },
    prodcirc: { registros: pc._count, desde: pc._min.fecha, hasta: pc._max.fecha },
    batches: batches.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() })),
  }
}
