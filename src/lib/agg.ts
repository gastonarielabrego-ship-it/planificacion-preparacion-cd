// Agregaciones server-side para los modulos del dashboard.
// Los volumenes (H61 ~39k op-dias, TM ~12k, Ola ~1k, Picking <=1M) se procesan en memoria.
import { db } from '@/lib/db'
import { getFeriadosMap } from './feriados'
import { unificarCategoria } from './normaliza'

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
    pctBultosExtras: 0,
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
  const [ops, oh, th, act] = await Promise.all([
    db.h61OpDia.findMany({ where: { fecha: rango(f) }, orderBy: { fecha: 'asc' } }),
    db.h61OpHora.findMany({ where: { fecha: rango(f) } }),
    db.h61TurnoHora.findMany({ where: { fecha: rango(f) } }),
    db.h61Actividad.findMany({ where: { fecha: rango(f) } }),
  ])
  if (!ops.length) return { serie: [], porMes: [], porTurno: [], perfilHora: [], resumen: null, feriados: [], comparativa: null, porDiaSemana: [], sabados: [], sabadosResumen: null, porActividad: [], tieneActividad: act.length > 0, tieneOpHora: oh.length > 0 }

  // --- feriados argentinos (se sincronizan on-demand desde api.argentinadatos.com.ar) ---
  const anios = new Set<number>()
  for (const r of ops) {
    const y = r.fecha.getUTCFullYear()
    anios.add(y)
    // un TN de diciembre puede pertenecer al feriado del 1° de enero siguiente
    if (r.turno === 'N' && r.fecha.getUTCMonth() === 11) anios.add(y + 1)
  }
  const feriadosMap = await getFeriadosMap([...anios])

  // Regla de feriados: en una jornada feriada TODO el tiempo y sus bultos
  // cuentan como horas extra y se miden aparte (no influyen en promedios,
  // medianas, perfiles ni tabla por turno de la medición normal).
  // Turnos diurnos (M/T): la jornada es su propia fecha. Turno noche (N,
  // 23:00 -> 06:00): la jornada que ANTECEDE al feriado es la feriada, así que
  // el op-día N con fecha D es feriado si D+1 lo es (los bultos de la noche
  // previa al feriado quedan registrados con la fecha del día previo).
  const MS_DIA = 86_400_000
  const feriadoRefDe = (fecha: Date, turno: string): string | null => {
    const k = dia(turno === 'N' ? new Date(fecha.getTime() + MS_DIA) : fecha)
    return feriadosMap.has(k) ? k : null
  }

  // --- serie diaria (cada día separa la medición normal de la producción feriada) ---
  type DiaAgg = {
    bultos: number; bultosBase: number; bultosExtras: number; bultosFeriado: number
    horas: number; horasNormales: number; horasExtras: number; horasFeriado: number
    ops: Set<string>; opsNormales: Set<string>; opsExtras: Set<string>; opsFeriado: Set<string>
    opDias: number; opDiasNormales: number; opDiasFeriado: number
  }
  const porDia = new Map<string, DiaAgg>()
  for (const r of ops) {
    const k = dia(r.fecha)
    let p = porDia.get(k)
    if (!p) {
      p = { bultos: 0, bultosBase: 0, bultosExtras: 0, bultosFeriado: 0, horas: 0, horasNormales: 0, horasExtras: 0, horasFeriado: 0, ops: new Set(), opsNormales: new Set(), opsExtras: new Set(), opsFeriado: new Set(), opDias: 0, opDiasNormales: 0, opDiasFeriado: 0 }
      porDia.set(k, p)
    }
    p.bultos += r.bultos
    p.horas += r.horasActivas
    p.ops.add(r.operario)
    p.opDias += 1
    if (feriadoRefDe(r.fecha, r.turno)) {
      p.bultosFeriado += r.bultos
      p.horasFeriado += r.horasActivas
      p.opsFeriado.add(r.operario)
      p.opDiasFeriado += 1
    } else {
      p.bultosBase += r.bultosBase
      p.bultosExtras += r.bultosExtras
      p.horasNormales += r.horasActivas
      p.horasExtras += r.extras
      p.opsNormales.add(r.operario)
      if (r.extras > 0) p.opsExtras.add(r.operario)
      p.opDiasNormales += 1
    }
  }

  const serie = [...porDia.entries()].sort().map(([fecha, p]) => {
    const bultosNormales = p.bultos - p.bultosFeriado
    const manana = feriadosMap.get(dia(new Date(new Date(`${fecha}T00:00:00.000Z`).getTime() + MS_DIA)))?.nombre ?? null
    return {
      fecha,
      bultos: p.bultos,
      bultosNormales,
      bultosBase: p.bultosBase,
      bultosExtras: p.bultosExtras,
      bultosFeriado: p.bultosFeriado,
      pctExtras: bultosNormales ? +((p.bultosExtras / bultosNormales) * 100).toFixed(1) : 0,
      horas: p.horas,
      horasNormales: p.horasNormales,
      horasExtras: p.horasExtras,
      horasFeriado: p.horasFeriado,
      ritmo: p.horasNormales ? +(bultosNormales / p.horasNormales).toFixed(1) : null,
      ops: p.ops.size,
      opsExtras: p.opsExtras.size,
      opsFeriado: p.opsFeriado.size,
      opDias: p.opDias,
      opDiasNormales: p.opDiasNormales,
      opDiasFeriado: p.opDiasFeriado,
      esFeriado: feriadosMap.has(fecha),
      feriado: feriadosMap.get(fecha)?.nombre ?? null,
      feriadoManana: manana,
    }
  })

  // --- agregados por mes ---
  // Medición normal: por fecha del op-día. La producción feriada se acumula en
  // el MES DEL FERIADO al que pertenece (para el TN puede ser el mes siguiente:
  // la noche del 30/04 hacia el feriado del 01/05 cuenta como mayo).
  const mesAgg = new Map<string, { bultos: number; bultosBase: number; bultosExtras: number; horas: number; horasExtras: number; opDias: number; ops: Set<string>; opsExtras: Set<string>; ritmos: number[]; dias: number }>()
  for (const s of serie) {
    if (s.opDiasNormales === 0) continue
    const k = s.fecha.slice(0, 7)
    let m = mesAgg.get(k)
    if (!m) { m = { bultos: 0, bultosBase: 0, bultosExtras: 0, horas: 0, horasExtras: 0, opDias: 0, ops: new Set(), opsExtras: new Set(), ritmos: [], dias: 0 }; mesAgg.set(k, m) }
    m.dias += 1
    m.bultos += s.bultosNormales
    m.bultosBase += s.bultosBase
    m.bultosExtras += s.bultosExtras
    m.horas += s.horasNormales
    m.horasExtras += s.horasExtras
    m.opDias += s.opDiasNormales
    m.ritmos.push(s.ritmo ?? 0)
  }
  // producción feriada por mes del feriado (incluye la noche TN del día previo)
  const ferMes = new Map<string, { bultosFeriado: number; horasFeriado: number; refs: Set<string> }>()
  for (const r of ops) {
    const ref = feriadoRefDe(r.fecha, r.turno)
    if (!ref) continue
    const k = ref.slice(0, 7)
    let fm = ferMes.get(k)
    if (!fm) { fm = { bultosFeriado: 0, horasFeriado: 0, refs: new Set() }; ferMes.set(k, fm) }
    fm.bultosFeriado += r.bultos
    fm.horasFeriado += r.horasActivas
    fm.refs.add(ref)
  }
  // personas distintas por mes (necesita operarios por día, separando feriado)
  const opsPorDia = new Map<string, { opsNormales: Set<string>; opsExtras: Set<string>; opsFeriado: Set<string> }>()
  for (const r of ops) {
    const k = dia(r.fecha)
    let p = opsPorDia.get(k)
    if (!p) { p = { opsNormales: new Set(), opsExtras: new Set(), opsFeriado: new Set() }; opsPorDia.set(k, p) }
    if (feriadoRefDe(r.fecha, r.turno)) {
      p.opsFeriado.add(r.operario)
    } else {
      p.opsNormales.add(r.operario)
      if (r.extras > 0) p.opsExtras.add(r.operario)
    }
  }
  for (const s of serie) {
    if (s.opDiasNormales === 0) continue
    const m = mesAgg.get(s.fecha.slice(0, 7))
    const p = opsPorDia.get(s.fecha)
    if (!m || !p) continue
    for (const op of p.opsNormales) m.ops.add(op)
    for (const op of p.opsExtras) m.opsExtras.add(op)
  }
  const porMes = [...new Set([...mesAgg.keys(), ...ferMes.keys()])].sort().map((mes) => {
    const m = mesAgg.get(mes)
    const fm = ferMes.get(mes)
    const bultos = m?.bultos ?? 0
    const bultosExtras = m?.bultosExtras ?? 0
    const bultosFeriado = fm?.bultosFeriado ?? 0
    return {
      mes,
      dias: m?.dias ?? 0,
      diasFeriado: fm?.refs.size ?? 0,
      actividades: m?.opDias ?? 0,
      personas: m?.ops.size ?? 0,
      personasExtras: m?.opsExtras.size ?? 0,
      bultos,
      bultosBase: m?.bultosBase ?? 0,
      bultosExtras,
      bultosFeriado,
      pctExtras: bultos ? +((bultosExtras / bultos) * 100).toFixed(1) : 0,
      pctExtrasTotal: bultos + bultosFeriado ? +(((bultosExtras + bultosFeriado) / (bultos + bultosFeriado)) * 100).toFixed(1) : 0,
      horas: m?.horas ?? 0,
      horasExtras: m?.horasExtras ?? 0,
      horasFeriado: fm?.horasFeriado ?? 0,
      ritmoProm: m?.horas ? +(bultos / m.horas).toFixed(1) : null,
      ritmoMediana: m?.ritmos.length ? +mediana(m.ritmos).toFixed(1) : null,
    }
  })

  // --- perfil por hora: colaboradores en jornada vs extras (promedio por dia) ---
  // Los bultos de cada hora se separan por si la hora fue jornada o extra: así la
  // UI puede mostrar la productividad promedio por hora SIN extras y CON extras.
  type HoraAgg = { fechas: Set<string>; jornada: Map<string, Set<string>>; extras: Map<string, Set<string>>; bultos: Map<string, number>; bultosJornada: Map<string, number>; bultosExtras: Map<string, number> }
  const horasAgg: HoraAgg[] = Array.from({ length: 24 }, () => ({ fechas: new Set<string>(), jornada: new Map(), extras: new Map(), bultos: new Map(), bultosJornada: new Map(), bultosExtras: new Map() }))
  for (const r of oh) {
    const h = horasAgg[r.hora]
    if (!h) continue
    const k = dia(r.fecha)
    // op-día feriado (feriado propio o noche TN previa al feriado): medición aparte
    const ref = r.turno === 'N' ? dia(new Date(r.fecha.getTime() + MS_DIA)) : k
    if (feriadosMap.has(ref)) continue
    h.fechas.add(k)
    const destino = r.esExtra ? h.extras : h.jornada
    let set = destino.get(k)
    if (!set) { set = new Set(); destino.set(k, set) }
    set.add(r.operario)
    h.bultos.set(k, (h.bultos.get(k) ?? 0) + r.bultos)
    const bk = r.esExtra ? h.bultosExtras : h.bultosJornada
    bk.set(k, (bk.get(k) ?? 0) + r.bultos)
  }
  const sumaMapNum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)
  const perfilHora = horasAgg.map((h, hora) => {
    const n = h.fechas.size
    const sumaJornada = [...h.jornada.values()].reduce((a, s) => a + s.size, 0)
    const sumaExtras = [...h.extras.values()].reduce((a, s) => a + s.size, 0)
    const sumaBultos = sumaMapNum(h.bultos)
    const bJornada = sumaMapNum(h.bultosJornada)
    const bExtras = sumaMapNum(h.bultosExtras)
    return {
      hora,
      etiqueta: `${String(hora).padStart(2, '0')}:00`,
      opsJornada: n ? +(sumaJornada / n).toFixed(1) : 0,
      opsExtras: n ? +(sumaExtras / n).toFixed(1) : 0,
      bultosProm: n ? Math.round(sumaBultos / n) : 0,
      bultosJornadaProm: n ? Math.round(bJornada / n) : 0,
      bultosExtrasProm: n ? Math.round(bExtras / n) : 0,
      ritmoJornada: sumaJornada >= 0.1 ? +(bJornada / sumaJornada).toFixed(1) : null,
      ritmoExtras: sumaExtras >= 0.1 ? +(bExtras / sumaExtras).toFixed(1) : null,
    }
  })

  // --- resumen por turno (ventanas: TM 6-14, TT 14-22, TN 23-06) ---
  const turnoAgg = new Map<string, { bultos: number; bultosBase: number; bultosExtras: number; horas: number; horasExtras: number; opDias: number; ops: Set<string>; opsExtras: Set<string> }>()
  for (const r of ops) {
    if (feriadoRefDe(r.fecha, r.turno)) continue // jornadas feriadas se miden aparte
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

  // --- feriados con actividad (se informan aparte) ---
  // Cada feriado reúne su jornada completa: los diurnos del propio feriado más
  // la noche del turno noche que lo antecede (23:00 -> 06:00 del día previo).
  const ferAgg = new Map<string, { bultos: number; horas: number; ops: Set<string>; opDias: number }>()
  for (const r of ops) {
    const ref = feriadoRefDe(r.fecha, r.turno)
    if (!ref) continue
    let v = ferAgg.get(ref)
    if (!v) { v = { bultos: 0, horas: 0, ops: new Set(), opDias: 0 }; ferAgg.set(ref, v) }
    v.bultos += r.bultos
    v.horas += r.horasActivas
    v.ops.add(r.operario)
    v.opDias += 1
  }
  const feriadosDetalle = [...ferAgg.entries()].sort().map(([fecha, v]) => ({
    fecha,
    nombre: feriadosMap.get(fecha)?.nombre ?? 'Feriado',
    tipo: feriadosMap.get(fecha)?.tipo ?? 'inamovible',
    personas: v.ops.size,
    opDias: v.opDias,
    bultos: v.bultos,
    horas: v.horas,
    ritmo: v.horas ? +(v.bultos / v.horas).toFixed(1) : null,
  }))

  // --- comparativa feriado vs día normal ---
  // Promedios por jornada: medición normal (días no feriados) contra jornadas feriadas
  // completas (diurnos del feriado + noche TN previa, ya reunidas en feriadosDetalle).
  const diasNormalesComp = serie.filter((s) => s.opDiasNormales > 0)
  const bultosNormTot = diasNormalesComp.reduce((a, s) => a + s.bultosNormales, 0)
  const horasNormTot = diasNormalesComp.reduce((a, s) => a + s.horasNormales, 0)
  const personasNormDia = diasNormalesComp.reduce((a, s) => a + (opsPorDia.get(s.fecha)?.opsNormales.size ?? 0), 0)
  const promedio = (tot: number, dias: number) => (dias ? tot / dias : 0)
  const deltaPct = (fer: number, nor: number): number | null => (nor > 0 && feriadosDetalle.length ? +(((fer - nor) / nor) * 100).toFixed(1) : null)
  const bultosFerTot = feriadosDetalle.reduce((a, f) => a + f.bultos, 0)
  const horasFerTot = feriadosDetalle.reduce((a, f) => a + f.horas, 0)
  const personasFerDia = feriadosDetalle.reduce((a, f) => a + f.personas, 0)
  const ritmoNormalComp = horasNormTot ? bultosNormTot / horasNormTot : null
  const ritmoFerComp = horasFerTot ? bultosFerTot / horasFerTot : null

  // Perfil horario por tipo de día (H61TurnoHora está disponible aunque falte el
  // detalle operario×hora). Cada registro se clasifica por su propio turno con la
  // misma regla de feriados: M/T -> su fecha; N -> la fecha siguiente.
  // En días normales las horas 0-5 del TN ocurren el día calendario siguiente.
  type PerfTipo = { bultos: number; personas: number; fechas: Set<string> }
  const acumulador = (): PerfTipo[] => Array.from({ length: 24 }, () => ({ bultos: 0, personas: 0, fechas: new Set<string>() }))
  const perfNormal = acumulador()
  const perfFeriado = acumulador()
  const sumarPerfil = (p: PerfTipo[], hora: number, bultos: number, operarios: number, fechaClave: string) => {
    const slot = p[hora]
    if (!slot) return
    slot.bultos += bultos
    slot.personas += operarios
    slot.fechas.add(fechaClave)
  }
  for (const r of th) {
    const ref = feriadoRefDe(r.fecha, r.turno)
    if (ref) {
      // jornada feriada: la noche TN completa (23 + 0-5) y los diurnos pertenecen al feriado
      sumarPerfil(perfFeriado, r.hora, r.bultos, r.operarios, ref)
    } else if (r.turno === 'N' && r.hora <= 5) {
      // madrugada de un día normal: el TN la registró con la fecha de inicio del turno
      const base = new Date(r.fecha)
      base.setUTCDate(base.getUTCDate() + 1)
      sumarPerfil(perfNormal, r.hora, r.bultos, r.operarios, dia(base))
    } else {
      sumarPerfil(perfNormal, r.hora, r.bultos, r.operarios, dia(r.fecha))
    }
  }
  const fechasNormalPerfil = new Set(perfNormal.flatMap((p) => [...p.fechas]))
  const fechasFeriadoPerfil = new Set(perfFeriado.flatMap((p) => [...p.fechas]))
  const perfilComparativa = Array.from({ length: 24 }, (_, hora) => {
    const nN = fechasNormalPerfil.size
    const nF = fechasFeriadoPerfil.size
    const bN = promedio(perfNormal[hora].bultos, nN)
    const pN = promedio(perfNormal[hora].personas, nN)
    const bF = promedio(perfFeriado[hora].bultos, nF)
    const pF = promedio(perfFeriado[hora].personas, nF)
    return {
      hora,
      etiqueta: `${String(hora).padStart(2, '0')}:00`,
      bultosNormal: Math.round(bN),
      personasNormal: +pN.toFixed(1),
      ritmoNormal: pN >= 0.1 ? +(bN / pN).toFixed(1) : null,
      bultosFeriado: Math.round(bF),
      personasFeriado: +pF.toFixed(1),
      ritmoFeriado: pF >= 0.1 ? +(bF / pF).toFixed(1) : null,
    }
  })

  const comparativa = {
    normal: {
      dias: diasNormalesComp.length,
      bultosPorDia: Math.round(promedio(bultosNormTot, diasNormalesComp.length)),
      personasPorDia: +promedio(personasNormDia, diasNormalesComp.length).toFixed(1),
      horasPorDia: Math.round(promedio(horasNormTot, diasNormalesComp.length)),
      ritmo: ritmoNormalComp !== null ? +ritmoNormalComp.toFixed(1) : null,
    },
    feriado: {
      dias: feriadosDetalle.length,
      bultosPorJornada: Math.round(promedio(bultosFerTot, feriadosDetalle.length)),
      personasPorJornada: +promedio(personasFerDia, feriadosDetalle.length).toFixed(1),
      horasPorJornada: Math.round(promedio(horasFerTot, feriadosDetalle.length)),
      ritmo: ritmoFerComp !== null ? +ritmoFerComp.toFixed(1) : null,
    },
    deltas: {
      bultosPct: deltaPct(bultosFerTot / Math.max(1, feriadosDetalle.length), bultosNormTot / Math.max(1, diasNormalesComp.length)),
      personasPct: deltaPct(personasFerDia / Math.max(1, feriadosDetalle.length), personasNormDia / Math.max(1, diasNormalesComp.length)),
      horasPct: deltaPct(horasFerTot / Math.max(1, feriadosDetalle.length), horasNormTot / Math.max(1, diasNormalesComp.length)),
      ritmoPct: ritmoNormalComp && ritmoFerComp ? +(((ritmoFerComp - ritmoNormalComp) / ritmoNormalComp) * 100).toFixed(1) : null,
    },
    perfilHora: perfilComparativa,
    diasNormalesPerfil: fechasNormalPerfil.size,
    diasFeriadoPerfil: fechasFeriadoPerfil.size,
  }

  // --- ritmo por día de semana (medición normal: excluye jornadas feriadas) ---
  const DIAS_SEM_CAP = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
  const semAgg = new Map<number, { dias: number; bultos: number; horas: number; personas: number; ritmos: number[]; bultosExtras: number }>()
  for (const s of serie) {
    if (s.opDiasNormales === 0) continue
    const dow = new Date(s.fecha + 'T00:00:00.000Z').getUTCDay()
    let m = semAgg.get(dow)
    if (!m) { m = { dias: 0, bultos: 0, horas: 0, personas: 0, ritmos: [], bultosExtras: 0 }; semAgg.set(dow, m) }
    m.dias += 1
    m.bultos += s.bultosNormales
    m.bultosExtras += s.bultosExtras
    m.horas += s.horasNormales
    m.personas += opsPorDia.get(s.fecha)?.opsNormales.size ?? 0
    if (s.ritmo !== null) m.ritmos.push(s.ritmo)
  }
  const porDiaSemana = [1, 2, 3, 4, 5, 6, 0].filter((d) => semAgg.has(d)).map((dow) => {
    const m = semAgg.get(dow)!
    return {
      dow,
      dia: DIAS_SEM_CAP[dow],
      dias: m.dias,
      bultosProm: Math.round(m.bultos / m.dias),
      personasProm: +(m.personas / m.dias).toFixed(1),
      horasProm: Math.round(m.horas / m.dias),
      ritmo: m.horas ? +(m.bultos / m.horas).toFixed(1) : null,
      ritmoMediana: m.ritmos.length ? +mediana(m.ritmos).toFixed(1) : null,
      pctExtras: m.bultos ? +((m.bultosExtras / m.bultos) * 100).toFixed(1) : 0,
    }
  })

  // --- sábados: serie completa de la dotación de cada sábado ---
  // En los sábados de dotación acotada la operación la cubre personal que viene
  // del turno tarde (extras TT); se marcan por debajo del 65% de la mediana.
  const sabadosBase = serie
    .filter((s) => new Date(s.fecha + 'T00:00:00.000Z').getUTCDay() === 6 && s.opDiasNormales > 0)
    .map((s) => {
      const p = opsPorDia.get(s.fecha)
      return {
        fecha: s.fecha,
        bultos: s.bultos,
        bultosNormales: s.bultosNormales,
        personas: p?.opsNormales.size ?? 0,
        personasExtras: p?.opsExtras.size ?? 0,
        opDias: s.opDiasNormales,
        horas: s.horasNormales,
        ritmo: s.ritmo,
        pctExtras: s.pctExtras,
        bultosFeriado: s.bultosFeriado,
        feriadoManana: s.feriadoManana,
        esFeriado: s.esFeriado,
      }
    })
  const medianaPersSab = mediana(sabadosBase.map((s) => s.personas))
  const sabados = sabadosBase
    .map((s) => ({ ...s, dotacionAcotada: s.personas < medianaPersSab * 0.65 }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
  const sabAcotadas = sabados.filter((s) => s.dotacionAcotada)
  const sabadosResumen = {
    total: sabados.length,
    personasMediana: +medianaPersSab.toFixed(1),
    acotadas: sabAcotadas.length,
    personasAcotadasProm: sabAcotadas.length ? +(sabAcotadas.reduce((a, s) => a + s.personas, 0) / sabAcotadas.length).toFixed(1) : null,
    personasRestoProm: sabados.length - sabAcotadas.length ? +((sabados.filter((s) => !s.dotacionAcotada).reduce((a, s) => a + s.personas, 0)) / (sabados.length - sabAcotadas.length)).toFixed(1) : null,
    ritmo: sabadosBase.reduce((a, s) => a + s.horas, 0) ? +(sabadosBase.reduce((a, s) => a + s.bultosNormales, 0) / sabadosBase.reduce((a, s) => a + s.horas, 0)).toFixed(1) : null,
  }

  // --- bultos por actividad (columna ACTIVIDAD del archivo: 2, 3, 4, JAULA...) ---
  const actAgg = new Map<string, { bultos: number; dias: Set<string>; opDias: number; horas: number }>()
  for (const r of act) {
    const k = r.actividad || 'SIN DATO'
    let a = actAgg.get(k)
    if (!a) { a = { bultos: 0, dias: new Set(), opDias: 0, horas: 0 }; actAgg.set(k, a) }
    a.bultos += r.bultos
    a.dias.add(dia(r.fecha))
    a.opDias += r.operarios
    a.horas += r.horas
  }
  const bultosActTotal = [...actAgg.values()].reduce((a, v) => a + v.bultos, 0)
  const porActividad = [...actAgg.entries()].map(([actividad, a]) => ({
    actividad,
    bultos: a.bultos,
    dias: a.dias.size,
    bultosPorDia: Math.round(a.bultos / Math.max(1, a.dias.size)),
    opDias: a.opDias,
    horas: a.horas,
    ritmo: a.horas ? +(a.bultos / a.horas).toFixed(1) : null,
    pct: bultosActTotal ? +((a.bultos / bultosActTotal) * 100).toFixed(1) : 0,
  })).sort((a, b) => b.bultos - a.bultos)

  // --- resumen del periodo filtrado (medición normal = solo op-días no feriados) ---
  const normales = serie.filter((s) => s.opDiasNormales > 0)
  const bultos = normales.reduce((a, s) => a + s.bultosNormales, 0)
  const bultosBase = normales.reduce((a, s) => a + s.bultosBase, 0)
  const bultosExtras = normales.reduce((a, s) => a + s.bultosExtras, 0)
  const horas = normales.reduce((a, s) => a + s.horasNormales, 0)
  const horasExtras = normales.reduce((a, s) => a + s.horasExtras, 0)
  const bultosFeriado = [...ferAgg.values()].reduce((a, v) => a + v.bultos, 0)
  const horasFeriado = [...ferAgg.values()].reduce((a, v) => a + v.horas, 0)
  const personas = new Set<string>()
  const personasExtras = new Set<string>()
  const personasFeriado = new Set<string>()
  for (const p of opsPorDia.values()) {
    for (const op of p.opsNormales) personas.add(op)
    for (const op of p.opsExtras) personasExtras.add(op)
  }
  for (const v of ferAgg.values()) for (const op of v.ops) personasFeriado.add(op)
  const resumen = {
    dias: normales.length,
    actividades: normales.reduce((a, s) => a + s.opDiasNormales, 0),
    personas: personas.size,
    personasExtras: personasExtras.size,
    bultos,
    bultosBase,
    bultosExtras,
    pctExtras: bultos ? +((bultosExtras / bultos) * 100).toFixed(1) : 0,
    horas,
    horasExtras,
    ritmoProm: horas ? +(bultos / horas).toFixed(1) : null,
    ritmoMediana: +mediana(normales.map((s) => s.ritmo ?? 0)).toFixed(1),
    // feriados: medición aparte; sus bultos cuentan como extras en el total
    diasFeriado: ferAgg.size,
    bultosFeriado,
    horasFeriado,
    personasFeriado: personasFeriado.size,
    pctExtrasTotal: bultos + bultosFeriado ? +(((bultosExtras + bultosFeriado) / (bultos + bultosFeriado)) * 100).toFixed(1) : 0,
  }

  return { serie, porMes, porTurno, perfilHora, resumen, feriados: feriadosDetalle, comparativa, porDiaSemana, sabados, sabadosResumen, porActividad, tieneActividad: act.length > 0, tieneOpHora: oh.length > 0 }
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
    // unificarCategoria: "espera de ubicacion" y "apro" de cargas viejas pasan a
    // ESPERA PICKING (son lo mismo para el negocio)
    const c0 = unificarCategoria(r.categoria)
    let c = cats.get(c0)
    if (!c) { c = { minutos: 0, registros: 0 }; cats.set(c0, c) }
    c.minutos += r.minutosEf
    c.registros += 1
  }
  const porCategoria = [...cats.entries()].map(([categoria, v]) => ({ categoria, ...v, pct: totalMin ? +((v.minutos / totalMin) * 100).toFixed(1) : 0 })).sort((a, b) => b.minutos - a.minutos)

  // nave x pasillo (espera de piking CON ubicacion puntual; incluye cargas viejas
  // con categoria "ESPERA UBICACION" y "APRO" via unificarCategoria)
  const naves = new Map<string, { minutos: number; registros: number; pasillos: Map<string, { minutos: number; registros: number }> }>()
  for (const r of rows) {
    if (unificarCategoria(r.categoria) !== 'ESPERA PICKING' || !r.nave) continue
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
  // minutos de ESPERA DE PICKING por hora (cruce con movimientos de clark por horario)
  const horasEsperaMap = new Map<number, number>()
  // mapa de calor día de semana × hora: minutos muertos acumulados del período
  const calorHoraMap = new Map<string, number>()
  const detalles = new Map<string, { minutos: number; registros: number }>()
  for (const r of rows) {
    turnosMap.set(r.turno, (turnosMap.get(r.turno) ?? 0) + r.minutosEf)
    const k = dia(r.fecha)
    diasMap.set(k, (diasMap.get(k) ?? 0) + r.minutosEf)
    if (r.horaDesde != null) {
      const h = Math.floor(r.horaDesde / 60)
      horasMap.set(h, (horasMap.get(h) ?? 0) + r.minutosEf)
      calorHoraMap.set(`${r.fecha.getUTCDay()}|${h}`, (calorHoraMap.get(`${r.fecha.getUTCDay()}|${h}`) ?? 0) + r.minutosEf)
      if (unificarCategoria(r.categoria) === 'ESPERA PICKING') horasEsperaMap.set(h, (horasEsperaMap.get(h) ?? 0) + r.minutosEf)
    }
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
  const porHoraEsperaPiking = Array.from({ length: 24 }, (_, h) => ({ hora: h, etiqueta: `${String(h).padStart(2, '0')}:00`, minutos: horasEsperaMap.get(h) ?? 0 }))
  // mapa de calor día × hora (valores en HORAS: minutos acumulados / 60)
  const calorHora = {
    dias: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
    horas: Array.from({ length: 24 }, (_, h) => ({
      hora: h,
      etiqueta: `${String(h).padStart(2, '0')}h`,
      valores: [1, 2, 3, 4, 5, 6, 0].map((dw) => {
        const v = calorHoraMap.get(`${dw}|${h}`)
        return v ? +(v / 60).toFixed(1) : null
      }),
    })),
  }
  const topDetalles = [...detalles.entries()].map(([detalle, v]) => ({ detalle, ...v })).sort((a, b) => b.minutos - a.minutos).slice(0, 25)

  // cruces codigo x categoria
  const codCat = new Map<string, { code: number | null; categoria: string; minutos: number; registros: number }>()
  for (const r of rows) {
    const catUnif = unificarCategoria(r.categoria)
    const k = `${r.motivoCode ?? '-'}|${catUnif}`
    let c = codCat.get(k)
    if (!c) { c = { code: r.motivoCode, categoria: catUnif, minutos: 0, registros: 0 }; codCat.set(k, c) }
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
    porHoraEsperaPiking,
    calorHora,
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
// Metricas sobre eventos de picking (1 evento = levante en una ubicacion con hora).
// Modelo de tiempos por operario-dia (umbral muerto = 2 min, consistente con los rangos del grafico):
//   tiempo total   = primer -> ultimo evento del dia (jornada observada)
//   tiempo muerto  = suma de gaps > 2 min (inactividad evidente)
//   tiempo neto    = total - muerto
//   super neto     = tiempo de operacion WMS (suma de MINUTOS si viene en el archivo), acotado al neto;
//                    sin columna MINUTOS, super neto = neto
//   traslados      = neto - super neto (ciclo de movimiento entre ubicaciones)
const UMBRAL_MUERTO_PICKING = 2

export async function getPicking(f: Filtros) {
  const where = { fecha: rango(f) }
  const count = await db.pickingEvento.count({ where })
  if (!count) return { registros: 0, vacio: true as const }

  // Grupos (fecha, operario) con cantidad de eventos: sirve para armar tandas
  // de fechas con un presupuesto de filas y NO cargar la tabla completa
  // (cientos de miles de eventos de una sola vez desbordaban la memoria).
  const [grupos, fuentes] = await Promise.all([
    db.pickingEvento.groupBy({
      by: ['fecha', 'operario'],
      where,
      _count: { _all: true },
      orderBy: [{ fecha: 'asc' }, { operario: 'asc' }],
    }),
    // archivos fuente cargados (para aclarar de donde salen los datos)
    db.uploadBatch.findMany({ where: { tipo: 'picking' }, orderBy: { createdAt: 'desc' }, take: 6, select: { filename: true, rows: true, createdAt: true } }),
  ])

  const buckets = [
    { label: '0-1 min', min: 0, max: 1 },
    { label: '1-2 min', min: 1, max: 2 },
    { label: '2-5 min', min: 2, max: 5 },
    { label: '5-10 min', min: 5, max: 10 },
    { label: '10-20 min', min: 10, max: 20 },
    { label: '20-60 min', min: 20, max: 60 },
    { label: '> 60 min', min: 60, max: Infinity },
  ]

  // acumuladores globales
  const gaps: number[] = []
  const gapCounts = new Array(buckets.length).fill(0)
  const trasladoGaps: number[] = []
  const trasladoCounts = new Array(buckets.length).fill(0)
  let spanTotal = 0, muertoTotal = 0, minutosTotal = 0, cambiosUbic = 0, cambiosSoporte = 0
  const paresZona = new Map<string, { desde: string; hasta: string; suma: number; n: number }>()

  // grano resumen (E-8 "Colaborador"): tiempos informados por bloque
  let conHoraTotal = 0, sumTotalRes = 0, sumMuertoRes = 0, sumNetoRes = 0, sumSuperRes = 0
  const muertoBloquesArr: number[] = []
  // desglose del tiempo muerto informado: por sector (nave), por turno y calor dia x turno
  const muertoSector = new Map<string, { muerto: number; total: number; bloques: number }>()
  const muertoTurno = new Map<string, { muerto: number; bloques: number }>()
  const muertoHeatMap = new Map<string, { suma: number; n: number }>()

  const porOp = new Map<string, { nombre: string | null; eventos: number; bultos: number; span: number; muerto: number; minutos: number; dias: number; cambioUbic: number; ubicUnicas: Set<string>; totalRes: number; muertoRes: number; netoRes: number; superRes: number }>()
  const porZona = new Map<string, { bultos: number; eventos: number; ops: Set<string>; dias: Set<string> }>()
  const porAct = new Map<string, { bultos: number; eventos: number; ops: Set<string>; opsPorDia: Map<string, Set<string>> }>()
  const serDia = new Map<string, { eventos: number; bultos: number; gapMin: number; gapN: number }>()
  const recorridos: { fecha: string; operario: string; nombre: string | null; ubicaciones: number; zonas: number; eventos: number; bultos: number; spanMin: number; muertoMin: number; trasladosMin: number }[] = []

  type PickingRow = {
    fecha: Date; operario: string; nombre: string | null; horaMin: number | null
    bultos: number | null; soporte: string | null; circuito: string | null; actividad: string | null
    zona: string | null; ubicacion: string | null; nivel: string | null; minutos: number | null
    turno: string | null; soportes: number | null; lineas: number | null
    muertoMin: number | null; netoMin: number | null; superNetoMin: number | null
  }

  const ubicDe = (e: PickingRow): string | null =>
    [e.zona, e.ubicacion, e.nivel].filter(Boolean).join('-') || null

  // procesa el bloque contiguo de eventos de un operario en un dia (ordenado por hora)
  const procesarDia = (evs: PickingRow[]) => {
    if (!evs.length) return
    const fechaISO = dia(evs[0].fecha)
    const operario = evs[0].operario
    const nombre = evs.find((e) => e.nombre)?.nombre ?? null
    const bultosDia = evs.reduce((a, e) => a + (e.bultos ?? 0), 0)

    const conHora = evs.filter((e) => e.horaMin != null) as (PickingRow & { horaMin: number })[]
    const ubicSet = new Set<string>()
    const zonaSet = new Set<string>()
    for (const e of evs) {
      const ub = ubicDe(e)
      if (ub) ubicSet.add(ub)
      if (e.zona) zonaSet.add(e.zona)
    }

    let span = 0, muertoDia = 0, minutosDia = 0, cambioUbicDia = 0, diaGapSum = 0, diaGapN = 0
    let prev: { horaMin: number; ubic: string | null; zona: string | null; sop: string | null } | null = null
    conHoraTotal += conHora.length
    for (const e of conHora) {
      const ubic = ubicDe(e)
      minutosDia += e.minutos ?? 0
      if (prev) {
        const gap = Math.max(0, e.horaMin - prev.horaMin)
        if (gap <= 720) {
          // salto de jornada (>12 h) se ignora; el resto entra al analisis
          gaps.push(gap)
          diaGapSum += gap; diaGapN++
          const bi = buckets.findIndex((b) => gap >= b.min && gap < b.max)
          if (bi >= 0) gapCounts[bi]++
          if (gap > UMBRAL_MUERTO_PICKING) muertoDia += gap
          const cambioUb = prev.ubic != null && ubic != null && prev.ubic !== ubic
          if (cambioUb) {
            cambioUbicDia++
            trasladoGaps.push(gap)
            const ti = buckets.findIndex((b) => gap >= b.min && gap < b.max)
            if (ti >= 0) trasladoCounts[ti]++
            if (prev.zona && e.zona && prev.zona !== e.zona) {
              const pk = `${prev.zona}|${e.zona}`
              let p = paresZona.get(pk)
              if (!p) { p = { desde: prev.zona, hasta: e.zona, suma: 0, n: 0 }; paresZona.set(pk, p) }
              p.suma += gap; p.n++
            }
          }
          if (prev.sop != null && e.soporte != null && prev.sop !== e.soporte) cambiosSoporte++
        }
      }
      prev = { horaMin: e.horaMin, ubic, zona: e.zona ?? null, sop: e.soporte ?? null }
    }
    if (conHora.length >= 2) span = Math.max(0, conHora[conHora.length - 1].horaMin - conHora[0].horaMin)

    // operario
    let o = porOp.get(operario)
    if (!o) { o = { nombre, eventos: 0, bultos: 0, span: 0, muerto: 0, minutos: 0, dias: 0, cambioUbic: 0, ubicUnicas: new Set(), totalRes: 0, muertoRes: 0, netoRes: 0, superRes: 0 }; porOp.set(operario, o) }
    if (nombre && !o.nombre) o.nombre = nombre
    o.eventos += evs.length; o.bultos += bultosDia; o.span += span; o.muerto += muertoDia; o.minutos += minutosDia
    o.dias += 1; o.cambioUbic += cambioUbicDia
    for (const u of ubicSet) o.ubicUnicas.add(u)

    // grano resumen (E-8 Colaborador): acumular tiempos informados por bloque
    for (const e of evs) {
      o.totalRes += e.minutos ?? 0
      sumTotalRes += e.minutos ?? 0
      if (e.muertoMin != null) {
        o.muertoRes += e.muertoMin; sumMuertoRes += e.muertoMin; muertoBloquesArr.push(e.muertoMin)
        // desglose: sector/nave (Circuito del reporte), turno y dia de la semana
        const sec = (e.circuito || e.actividad || '(sin sector)').toUpperCase()
        let ms = muertoSector.get(sec)
        if (!ms) { ms = { muerto: 0, total: 0, bloques: 0 }; muertoSector.set(sec, ms) }
        ms.muerto += e.muertoMin
        ms.total += e.minutos ?? 0
        ms.bloques += 1
        const tn = e.turno || '?'
        let mt = muertoTurno.get(tn)
        if (!mt) { mt = { muerto: 0, bloques: 0 }; muertoTurno.set(tn, mt) }
        mt.muerto += e.muertoMin
        mt.bloques += 1
        const dw = new Date(fechaISO + 'T00:00:00.000Z').getUTCDay()
        const kh = `${dw}|${tn}`
        let mh = muertoHeatMap.get(kh)
        if (!mh) { mh = { suma: 0, n: 0 }; muertoHeatMap.set(kh, mh) }
        mh.suma += e.muertoMin
        mh.n += 1
      }
      if (e.netoMin != null) { o.netoRes += e.netoMin; sumNetoRes += e.netoMin }
      if (e.superNetoMin != null) { o.superRes += e.superNetoMin; sumSuperRes += e.superNetoMin }
    }

    // zonas (naves) y actividades
    for (const e of evs) {
      const zk = e.zona || '(sin zona)'
      let z = porZona.get(zk)
      if (!z) { z = { bultos: 0, eventos: 0, ops: new Set(), dias: new Set() }; porZona.set(zk, z) }
      z.bultos += e.bultos ?? 0; z.eventos += 1; z.ops.add(operario); z.dias.add(fechaISO)

      const ak = (e.actividad || e.circuito || '(sin actividad)').toUpperCase()
      let a = porAct.get(ak)
      if (!a) { a = { bultos: 0, eventos: 0, ops: new Set(), opsPorDia: new Map() }; porAct.set(ak, a) }
      a.bultos += e.bultos ?? 0; a.eventos += 1; a.ops.add(operario)
      let sd = a.opsPorDia.get(fechaISO)
      if (!sd) { sd = new Set(); a.opsPorDia.set(fechaISO, sd) }
      sd.add(operario)
    }

    let s = serDia.get(fechaISO)
    if (!s) { s = { eventos: 0, bultos: 0, gapMin: 0, gapN: 0 }; serDia.set(fechaISO, s) }
    s.eventos += evs.length; s.bultos += bultosDia; s.gapMin += diaGapSum; s.gapN += diaGapN

    // recorridos: solo tienen sentido con horas (grano detalle)
    if (conHora.length > 0) recorridos.push({
      fecha: fechaISO, operario, nombre,
      ubicaciones: ubicSet.size, zonas: zonaSet.size,
      eventos: evs.length, bultos: bultosDia,
      spanMin: span, muertoMin: muertoDia, trasladosMin: 0,
    })

    spanTotal += span; muertoTotal += muertoDia; minutosTotal += minutosDia
    cambiosUbic += cambioUbicDia
  }

  // Procesa los eventos por TANDAS DE FECHAS (presupuesto ~20k filas por query):
  // cada grupo (fecha, operario) queda completo dentro de su tanda porque las
  // fechas se empaquetan enteras — el análisis por operario-día no cambia.
  // Empaqueta fechas hasta llegar al presupuesto (o al menos 1 por tanda si una
  // fecha sola lo supera).
  const fechasOrdenadas = [...new Set(grupos.map((g) => g.fecha.getTime()))].sort((a, b) => a - b)
  const eventosPorFecha = new Map<number, number>()
  for (const g of grupos) eventosPorFecha.set(g.fecha.getTime(), (eventosPorFecha.get(g.fecha.getTime()) ?? 0) + g._count._all)

  const PRESUPUESTO_TANDA = 20000
  let bultosTotal = 0
  let primeraFecha: Date | null = null
  let ultimaFecha: Date | null = null

  const SELECT_PICKING = { fecha: true, operario: true, nombre: true, horaMin: true, bultos: true, soporte: true, circuito: true, actividad: true, zona: true, ubicacion: true, nivel: true, minutos: true, turno: true, soportes: true, lineas: true, muertoMin: true, netoMin: true, superNetoMin: true } as const

  for (let i = 0; i < fechasOrdenadas.length; ) {
    const tanda: number[] = []
    let presupuesto = 0
    while (i < fechasOrdenadas.length && (tanda.length === 0 || presupuesto < PRESUPUESTO_TANDA)) {
      const ft = fechasOrdenadas[i]
      tanda.push(ft)
      presupuesto += eventosPorFecha.get(ft) ?? 0
      i++
    }
    const rows = await db.pickingEvento.findMany({
      where: { ...where, fecha: { in: tanda.map((t) => new Date(t)) } },
      orderBy: [{ fecha: 'asc' }, { operario: 'asc' }, { horaMin: 'asc' }],
      select: SELECT_PICKING,
    })
    if (!rows.length) continue
    if (!primeraFecha) primeraFecha = rows[0].fecha
    ultimaFecha = rows[rows.length - 1].fecha

    // agrupar por (fecha, operario): rows viene ordenado, los grupos son contiguos
    let grupoKey = ''
    let grupo: PickingRow[] = []
    for (const r of rows) {
      const k = `${dia(r.fecha)}|${r.operario}`
      if (k !== grupoKey) {
        procesarDia(grupo)
        grupo = []
        grupoKey = k
      }
      grupo.push(r)
    }
    procesarDia(grupo)
    bultosTotal += rows.reduce((a, e) => a + (e.bultos ?? 0), 0)
  }

  const medianaDe = (arr: number[]): number | null => {
    if (!arr.length) return null
    const s = [...arr].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? +s[mid].toFixed(2) : +((s[mid - 1] + s[mid]) / 2).toFixed(2)
  }
  const horas = (min: number) => +(min / 60).toFixed(2)

  // ¿grano resumen? (filas del "Colaborador" del E-8: sin hora evento, con tiempos informados)
  const granoResumen = conHoraTotal === 0

  if (granoResumen) {
    // los "tiempos" salen de las columnas del reporte (horas informadas), no de gaps
    spanTotal = sumTotalRes // tiempo total = Σ Tiempo Total informado
    muertoTotal = sumMuertoRes
  }
  const netoTotal = granoResumen
    ? (sumNetoRes > 0 ? sumNetoRes : Math.max(0, spanTotal - muertoTotal))
    : Math.max(0, spanTotal - muertoTotal)
  // super neto: resumen = Tiempo Super Neto informado; detalle = MINUTOS WMS acotado al neto
  const superNetoTotal = granoResumen
    ? (sumSuperRes > 0 ? Math.min(sumSuperRes, netoTotal) : netoTotal)
    : (minutosTotal > 0 ? Math.min(minutosTotal, netoTotal) : netoTotal)
  const trasladosNetoTotal = netoTotal - superNetoTotal

  const opsRanking = [...porOp.entries()].map(([operario, o]) => {
    if (granoResumen) {
      const total = o.totalRes
      const neto = o.netoRes > 0 ? o.netoRes : Math.max(0, total - o.muertoRes)
      const superNeto = o.superRes > 0 ? Math.min(o.superRes, neto) : neto
      return {
        operario,
        nombre: o.nombre ?? operario,
        dias: o.dias,
        eventos: o.eventos,
        bultos: o.bultos,
        horasTotal: horas(total),
        pctMuerto: total ? r1((o.muertoRes / total) * 100) : null,
        prodTotal: total ? r2(o.bultos / (total / 60)) : null,
        prodNeta: neto ? r2(o.bultos / (neto / 60)) : null,
        prodSuperNeta: superNeto ? r2(o.bultos / (superNeto / 60)) : null,
        ubicUnicas: 0,
        traslados: 0,
      }
    }
    const neto = Math.max(0, o.span - o.muerto)
    const superNeto = o.minutos > 0 ? Math.min(o.minutos, neto) : neto
    return {
      operario,
      nombre: o.nombre ?? operario,
      dias: o.dias,
      eventos: o.eventos,
      bultos: o.bultos,
      horasTotal: horas(o.span),
      pctMuerto: o.span ? r1((o.muerto / o.span) * 100) : null,
      prodTotal: o.span ? r2(o.bultos / (o.span / 60)) : null,
      prodNeta: neto ? r2(o.bultos / (neto / 60)) : null,
      prodSuperNeta: superNeto ? r2(o.bultos / (superNeto / 60)) : null,
      ubicUnicas: o.ubicUnicas.size,
      traslados: o.cambioUbic,
    }
  })
  const topColaborador = [...opsRanking].sort((a, b) => b.bultos - a.bultos)[0] ?? null

  // distribucion del tiempo muerto por bloque (grano resumen)
  const bucketsBloque = [
    { label: '0-15 min', max: 15 },
    { label: '15-30 min', max: 30 },
    { label: '30-60 min', max: 60 },
    { label: '1-2 h', max: 120 },
    { label: '2-4 h', max: 240 },
    { label: '> 4 h', max: Infinity },
  ]
  const distBloque = bucketsBloque.map((b, i) => ({
    bucket: b.label,
    cantidad: muertoBloquesArr.filter((m) => m >= (i === 0 ? 0 : bucketsBloque[i - 1].max) && m < b.max).length,
  }))

  // una sola entrada por archivo (la subida incremental de picking crea el batch
  // principal + una fila de cierre con el mismo nombre): nos quedamos con la principal
  const fuentesPorNombre = new Map<string, (typeof fuentes)[number]>()
  for (const x of fuentes) {
    const k = x.filename ?? '(sin nombre)'
    const prev = fuentesPorNombre.get(k)
    if (!prev || x.createdAt < prev.createdAt) fuentesPorNombre.set(k, x)
  }

  // desglose del muerto (solo grano resumen con muerto informado)
  const NOM_TURNO_PK: Record<string, string> = { M: 'TM (6 a 14)', T: 'TT (14 a 22)', N: 'TN (23 a 06)', '?': 'Sin turno' }
  const conMuertoRes = granoResumen && sumMuertoRes > 0
  const muertoPorSector = conMuertoRes
    ? [...muertoSector.entries()].map(([sector, v]) => ({
        sector,
        minutosMuerto: Math.round(v.muerto),
        minutosTotal: Math.round(v.total),
        pctJornada: v.total ? r1((v.muerto / v.total) * 100) : null,
        bloques: v.bloques,
      })).sort((a, b) => b.minutosMuerto - a.minutosMuerto)
    : []
  const muertoPorTurno = conMuertoRes
    ? [...muertoTurno.entries()].map(([turno, v]) => ({
        turno,
        nombre: NOM_TURNO_PK[turno] ?? turno,
        minutosMuerto: Math.round(v.muerto),
        bloques: v.bloques,
        promedio: v.bloques ? r1(v.muerto / v.bloques) : null,
      })).sort((a, b) => b.minutosMuerto - a.minutosMuerto)
    : []
  const muertoHeat = conMuertoRes
    ? {
        dias: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
        turnos: ['M', 'T', 'N'].filter((t) => muertoTurno.has(t)).map((tn) => ({
          turno: tn,
          nombre: NOM_TURNO_PK[tn] ?? tn,
          valores: [1, 2, 3, 4, 5, 6, 0].map((dw) => {
            const v = muertoHeatMap.get(`${dw}|${tn}`)
            return v && v.n ? r1(v.suma / v.n) : null
          }),
        })),
      }
    : null

  return {
    registros: count,
    vacio: false as const,
    grano: granoResumen ? 'resumen' : 'detalle',
    desde: primeraFecha ? dia(primeraFecha) : undefined,
    hasta: ultimaFecha ? dia(ultimaFecha) : undefined,
    umbralMuertoMin: UMBRAL_MUERTO_PICKING,
    conUbicacion: cambiosUbic > 0,
    bultos: bultosTotal,
    operarios: porOp.size,
    gapPromedio: gaps.length ? +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(2) : null,
    gapMediana: medianaDe(gaps),
    distribucionGaps: buckets.map((b, i) => ({ bucket: b.label, cantidad: gapCounts[i] })),
    cambiosUbicacion: cambiosUbic,
    trasladoPromedio: trasladoGaps.length ? +(trasladoGaps.reduce((a, b) => a + b, 0) / trasladoGaps.length).toFixed(2) : null,
    trasladoMediana: medianaDe(trasladoGaps),
    distribucionTraslados: buckets.map((b, i) => ({ bucket: b.label, cantidad: trasladoCounts[i] })),
    cambiosSoporte,
    muertoBloques: {
      promedio: muertoBloquesArr.length ? +(sumMuertoRes / muertoBloquesArr.length).toFixed(1) : null,
      mediana: medianaDe(muertoBloquesArr),
      distribucion: distBloque,
      conMuerto: muertoBloquesArr.length > 0,
    },
    muertoPorSector,
    muertoPorTurno,
    muertoHeat,
    tiempos: {
      horasTotal: horas(spanTotal),
      horasMuerto: horas(muertoTotal),
      horasNeto: horas(netoTotal),
      horasTraslados: horas(trasladosNetoTotal),
      horasSuperNeto: horas(superNetoTotal),
      pctMuerto: spanTotal ? r1((muertoTotal / spanTotal) * 100) : null,
      conMinutos: minutosTotal > 0,
    },
    productividad: {
      total: spanTotal ? r2(bultosTotal / (spanTotal / 60)) : null,
      neta: netoTotal ? r2(bultosTotal / (netoTotal / 60)) : null,
      superNeta: superNetoTotal ? r2(bultosTotal / (superNetoTotal / 60)) : null,
    },
    topColaborador,
    operariosTop: [...opsRanking].sort((a, b) => b.bultos - a.bultos).slice(0, 15),
    porZona: [...porZona.entries()].map(([zona, z]) => ({ zona, bultos: z.bultos, eventos: z.eventos, operarios: z.ops.size, dias: z.dias.size })).sort((a, b) => b.bultos - a.bultos),
    porActividad: [...porAct.entries()].map(([actividad, a]) => {
      const personasDia = [...a.opsPorDia.values()].reduce((acc, s) => acc + s.size, 0)
      return { actividad, bultos: Math.round(a.bultos), eventos: a.eventos, operarios: a.ops.size, personasPromedioDia: a.opsPorDia.size ? +(personasDia / a.opsPorDia.size).toFixed(1) : null }
    }).sort((a, b) => b.bultos - a.bultos),
    recorridosTop: granoResumen ? [] : recorridos.filter((r) => r.eventos >= 3).sort((a, b) => b.ubicaciones - a.ubicaciones || b.spanMin - a.spanMin).slice(0, 12),
    paresZona: [...paresZona.values()].filter((p) => p.n >= 5).map((p) => ({ desde: p.desde, hasta: p.hasta, trasladoPromedio: +(p.suma / p.n).toFixed(2), cantidad: p.n })).sort((a, b) => b.trasladoPromedio - a.trasladoPromedio).slice(0, 10),
    serie: [...serDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, v]) => ({ fecha, eventos: v.eventos, bultos: v.bultos, gapPromedio: v.gapN ? +(v.gapMin / v.gapN).toFixed(2) : null })),
    meses: new Set([...serDia.keys()].map((k) => k.slice(0, 7))).size,
    fuentes: [...fuentesPorNombre.values()].map((x) => ({ filename: x.filename, rows: x.rows, fecha: x.createdAt.toISOString() })),
  }
}

// helpers de redondeo (compartidos por picking)
const r1 = (x: number) => Math.round(x * 10) / 10
const r2 = (x: number) => Math.round(x * 100) / 100

// ============ MAQUINISTAS (H61 clarkistas: personas por actividad y nave) ============
// Foco: cuantas personas realizan cada actividad y a que naves (CIRCUITO) estan asignadas.
export async function getMaquinistas(f: Filtros) {
  const r = rango(f)
  const [rows, act, nav, fuentes] = await Promise.all([
    db.maqOpNave.findMany({ where: { fecha: r }, orderBy: { fecha: 'asc' } }),
    db.maqAct.findMany({ where: { fecha: r }, orderBy: { fecha: 'asc' } }),
    db.maqNave.findMany({ where: { fecha: r }, orderBy: { fecha: 'asc' } }),
    db.uploadBatch.findMany({ where: { tipo: 'maq' }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ])
  const fuentesOut = fuentes.map((x) => ({ filename: x.filename, rows: x.rows, fecha: x.createdAt.toISOString() }))
  if (!rows.length) {
    return { vacio: true as const, registros: 0, meses: 0, fuentes: fuentesOut }
  }

  // etiquetas: el archivo usa XXX = varios circuitos; '?' = fila sin nave; actividades 2/3/4
  const etiquetaNave = (nv: string) => (nv === 'XXX' ? 'Varias (XXX)' : nv === '?' ? 'Sin nave' : nv)
  const etiquetaAct = (a: string) => ({ '2': 'Actividad 2', '3': 'Actividad 3', '4': 'Actividad 4' }[a] ?? a)

  const diasSet = new Set<string>()
  const opsDia = new Map<string, Set<string>>() // fecha -> operarios distintos del dia
  const opsAll = new Set<string>()
  let movimientos = 0
  let bultos = 0

  // acumulador por corte: personas distintas (total y por dia), movimientos y bultos
  type Agr = { ops: Set<string>; porDia: Map<string, Set<string>>; mov: number; bul: number }
  const nuevoAgr = (): Agr => ({ ops: new Set(), porDia: new Map(), mov: 0, bul: 0 })
  const agrDe = (m: Map<string, Agr>, key: string): Agr => {
    let a = m.get(key)
    if (!a) { a = nuevoAgr(); m.set(key, a) }
    return a
  }
  const push = (a: Agr, operario: string, fechaISO: string, total: number, bulRow: number) => {
    a.ops.add(operario)
    let s = a.porDia.get(fechaISO)
    if (!s) { s = new Set(); a.porDia.set(fechaISO, s) }
    s.add(operario)
    a.mov += total
    a.bul += bulRow
  }

  const porAct = new Map<string, Agr>()
  const porNave = new Map<string, Agr>()
  const matriz = new Map<string, Agr>() // actividad|nave
  const porTurno = new Map<string, Agr>()
  const turnoAct = new Map<string, Agr>() // turno|actividad

  // ---- TAREAS: APROS vs HOMOGENEOS ----
  // El archivo trae por fila los movimientos de aprontamiento (apros) y de
  // homogeneización (homogeneos). NO equivalen a la actividad (2 y 4 hacen
  // ambas tareas): hay que clasificar persona-día por suma de sus filas.
  let movApros = 0
  let movHom = 0
  // suma de movimientos por tarea para persona-día (fecha|operario) y persona-día-actividad
  const opDiaTarea = new Map<string, { ap: number; ho: number }>()
  const opDiaActTarea = new Map<string, { ap: number; ho: number }>()
  // mismo cruce dentro de cada TURNO (fecha|turno|operario y fecha|turno|operario|actividad)
  const opDiaTurnoTarea = new Map<string, { ap: number; ho: number }>()
  const opDiaTurnoActTarea = new Map<string, { ap: number; ho: number }>()

  // ---- MOVIMIENTOS POR HORARIO (HORA_00..23 del reporte) ----
  const horaTotal = new Array(24).fill(0)
  const horaTurno = new Map<string, number[]>()
  // mismo perfil pero SOLO de los movimientos de apros: el reporte trae apros por
  // fila (no por hora), se reparte cada HORA_h según la proporción apros/total de la fila
  const horaApros = new Array(24).fill(0)
  let tieneHorario = false

  // ---- MOVIMIENTOS POR PERSONA POR MES (foco apros) + CALOR DE APROS MES x ACTIVIDAD ----
  const movOpMes = new Map<string, { operario: string; nombre: string; mes: string; apros: number; homogeneos: number; total: number; bultos: number }>()
  const aprosMesAct = new Map<string, { mov: number; ops: Set<string> }>()

  for (const rw of rows) {
    const fISO = dia(rw.fecha)
    diasSet.add(fISO)
    opsAll.add(rw.operario)
    movimientos += rw.total
    bultos += rw.bultos
    movApros += (rw as { apros?: number }).apros ?? 0
    movHom += (rw as { homogeneos?: number }).homogeneos ?? 0
    let g = opsDia.get(fISO)
    if (!g) { g = new Set(); opsDia.set(fISO, g) }
    g.add(rw.operario)
    push(agrDe(porAct, rw.actividad), rw.operario, fISO, rw.total, rw.bultos)
    push(agrDe(porNave, rw.nave), rw.operario, fISO, rw.total, rw.bultos)
    push(agrDe(matriz, `${rw.actividad}|${rw.nave}`), rw.operario, fISO, rw.total, rw.bultos)
    push(agrDe(porTurno, rw.turno), rw.operario, fISO, rw.total, rw.bultos)
    push(agrDe(turnoAct, `${rw.turno}|${rw.actividad}`), rw.operario, fISO, rw.total, rw.bultos)

    const kd = `${fISO}|${rw.operario}`
    const dAcc = opDiaTarea.get(kd) ?? { ap: 0, ho: 0 }
    dAcc.ap += (rw as { apros?: number }).apros ?? 0
    dAcc.ho += (rw as { homogeneos?: number }).homogeneos ?? 0
    opDiaTarea.set(kd, dAcc)
    const ka2 = `${kd}|${rw.actividad}`
    const aAcc = opDiaActTarea.get(ka2) ?? { ap: 0, ho: 0 }
    aAcc.ap += (rw as { apros?: number }).apros ?? 0
    aAcc.ho += (rw as { homogeneos?: number }).homogeneos ?? 0
    opDiaActTarea.set(ka2, aAcc)

    // tareas dentro del turno
    const kt = `${kd}|${rw.turno}`
    const tAcc = opDiaTurnoTarea.get(kt) ?? { ap: 0, ho: 0 }
    tAcc.ap += (rw as { apros?: number }).apros ?? 0
    tAcc.ho += (rw as { homogeneos?: number }).homogeneos ?? 0
    opDiaTurnoTarea.set(kt, tAcc)
    const kta = `${kt}|${rw.actividad}`
    const taAcc = opDiaTurnoActTarea.get(kta) ?? { ap: 0, ho: 0 }
    taAcc.ap += (rw as { apros?: number }).apros ?? 0
    taAcc.ho += (rw as { homogeneos?: number }).homogeneos ?? 0
    opDiaTurnoActTarea.set(kta, taAcc)

    // perfil horario: movimientos por hora del día, global y por turno
    const rr = rw as unknown as Record<string, number | null>
    let ht = horaTurno.get(rw.turno)
    if (!ht) { ht = new Array(24).fill(0); horaTurno.set(rw.turno, ht) }
    const aprosRow0 = (rw as { apros?: number }).apros ?? 0
    const shareApros = rw.total > 0 ? aprosRow0 / rw.total : 0
    for (let h = 0; h < 24; h++) {
      const v = rr[`hora${String(h).padStart(2, '0')}`] ?? 0
      if (v > 0) {
        tieneHorario = true
        horaTotal[h] += v
        ht[h] += v
        if (shareApros > 0) horaApros[h] += v * shareApros
      }
    }

    // detalle por persona y mes (apros/homogéneos) y calor de apros por mes x actividad
    const aprosRow = (rw as { apros?: number }).apros ?? 0
    const homRow = (rw as { homogeneos?: number }).homogeneos ?? 0
    const mesISO = fISO.slice(0, 7)
    const kpm = `${rw.operario}|${mesISO}`
    let pm = movOpMes.get(kpm)
    if (!pm) { pm = { operario: rw.operario, nombre: rw.nombre ?? rw.operario, mes: mesISO, apros: 0, homogeneos: 0, total: 0, bultos: 0 }; movOpMes.set(kpm, pm) }
    pm.apros += aprosRow
    pm.homogeneos += homRow
    pm.total += rw.total
    pm.bultos += rw.bultos
    if (aprosRow > 0) {
      const kma = `${mesISO}|${rw.actividad}`
      let m = aprosMesAct.get(kma)
      if (!m) { m = { mov: 0, ops: new Set<string>() }; aprosMesAct.set(kma, m) }
      m.mov += aprosRow
      m.ops.add(rw.operario)
    }
  }

  // personas promedio por dia del corte = suma de personas de cada dia / dias con datos
  const personasProm = (a: Agr): number | null => {
    if (!a.porDia.size) return null
    let sum = 0
    for (const s of a.porDia.values()) sum += s.size
    return r1(sum / a.porDia.size)
  }

  // horas-hombre exactas por actividad y nave (horas unicas por operario-dia, de las pre-agregadas)
  const horasAct = new Map<string, number>()
  for (const a of act) horasAct.set(a.actividad, (horasAct.get(a.actividad) ?? 0) + a.horas)
  const horasNave = new Map<string, number>()
  for (const v of nav) horasNave.set(v.nave, (horasNave.get(v.nave) ?? 0) + v.horas)
  const horasHombre = [...horasAct.values()].reduce((acc, h) => acc + h, 0)

  // personas promedio por mes por actividad (de MaqAct) y por nave (de MaqNave, top 8)
  const acumularMes = (m: Map<string, { dias: number; ops: number }>, fecha: Date, clave: string, operarios: number) => {
    const k = `${dia(fecha).slice(0, 7)}|${clave}`
    const cur = m.get(k) ?? { dias: 0, ops: 0 }
    cur.dias += 1
    cur.ops += operarios
    m.set(k, cur)
  }
  const mesAct = new Map<string, { dias: number; ops: number }>()
  for (const a of act) acumularMes(mesAct, a.fecha, a.actividad, a.operarios)
  const porMesActividad = [...mesAct.entries()]
    .map(([k, v]) => {
      const [mes, clave] = k.split('|')
      return { mes, actividad: etiquetaAct(clave), personasProm: r1(v.ops / v.dias) }
    })
    .sort((a, b) => a.mes.localeCompare(b.mes) || a.actividad.localeCompare(b.actividad))

  const mesNav = new Map<string, { dias: number; ops: number }>()
  for (const v of nav) acumularMes(mesNav, v.fecha, v.nave, v.operarios)
  // top 8 naves por personas promedio global para no saturar el grafico
  const topNaves = [...porNave.entries()]
    .sort((a, b) => (personasProm(b[1]) ?? 0) - (personasProm(a[1]) ?? 0))
    .slice(0, 8)
    .map(([nv]) => nv)

  const personasPromDiaGlobal = (() => {
    let sum = 0
    for (const s of opsDia.values()) sum += s.size
    return diasSet.size ? r1(sum / diasSet.size) : null
  })()

  // turno: personas promedio y desglose por actividad dentro de cada turno
  const turnosOrden = ['M', 'T', 'N', '?'].filter((t) => porTurno.has(t))
  // personas por tarea dentro de cada turno (de los acumuladores fecha|turno|operario[|actividad])
  const opsTareaTurno = new Map<string, { ap: Map<string, Set<string>>; ho: Map<string, Set<string>> }>()
  for (const [k, acc] of opDiaTurnoTarea) {
    const partes = k.split('|') // fecha|operario|turno
    const fISO = partes[0]
    const op = partes[1]
    const turno = partes[2]
    let t = opsTareaTurno.get(turno)
    if (!t) { t = { ap: new Map(), ho: new Map() }; opsTareaTurno.set(turno, t) }
    if (acc.ap > 0) { let s = t.ap.get(fISO); if (!s) { s = new Set(); t.ap.set(fISO, s) } s.add(op) }
    if (acc.ho > 0) { let s = t.ho.get(fISO); if (!s) { s = new Set(); t.ho.set(fISO, s) } s.add(op) }
  }
  const promDe = (m: Map<string, Set<string>>): number | null => {
    if (!m.size) return null
    let sum = 0
    for (const s of m.values()) sum += s.size
    return r1(sum / m.size)
  }
  // tarea x actividad x turno: personas promedio por día haciendo ESA tarea en ESA actividad en ESE turno
  const tareaTurnoAcc = new Map<string, { porDia: Map<string, Set<string>>; mov: number; ops: Set<string> }>()
  for (const [k, acc] of opDiaTurnoActTarea) {
    const partes = k.split('|') // fecha|operario|turno|actividad
    const fISO = partes[0]
    const op = partes[1]
    const turno = partes[2]
    const actv = partes[3]
    for (const [tarea, mov] of [['apros', acc.ap], ['homogeneos', acc.ho]] as const) {
      if (mov <= 0) continue
      const kk = `${turno}|${tarea}|${actv}`
      let t = tareaTurnoAcc.get(kk)
      if (!t) { t = { porDia: new Map(), mov: 0, ops: new Set() }; tareaTurnoAcc.set(kk, t) }
      t.mov += mov
      t.ops.add(op)
      let s = t.porDia.get(fISO); if (!s) { s = new Set(); t.porDia.set(fISO, s) }
      s.add(op)
    }
  }
  const porTurnoOut = turnosOrden.map((turno) => {
    const t = porTurno.get(turno)!
    const acts = turnosOrden.length
      ? [...turnoAct.entries()]
          .filter(([k]) => k.startsWith(`${turno}|`))
          .map(([k, a]) => ({ actividad: etiquetaAct(k.split('|')[1]), personasProm: personasProm(a), operarios: a.ops.size }))
          .sort((a, b) => (b.personasProm ?? 0) - (a.personasProm ?? 0))
      : []
    const tt = opsTareaTurno.get(turno)
    const porTareaActividad = [...tareaTurnoAcc.entries()]
      .filter(([k]) => k.startsWith(`${turno}|`))
      .map(([k, a]) => {
        const [, tarea, actv] = k.split('|')
        return {
          tarea,
          actividad: etiquetaAct(actv),
          codigo: actv,
          personasPromDia: promDe(a.porDia),
          operarios: a.ops.size,
          movimientos: a.mov,
        }
      })
      .sort((a, b) => a.tarea.localeCompare(b.tarea) || (b.personasPromDia ?? 0) - (a.personasPromDia ?? 0))
    return {
      turno,
      personasPromDia: personasProm(t),
      operarios: t.ops.size,
      movimientos: t.mov,
      bultos: t.bul,
      porActividad: acts,
      personasPromApros: tt ? promDe(tt.ap) : null,
      personasPromHom: tt ? promDe(tt.ho) : null,
      porTareaActividad,
    }
  })

  // naves por operario por dia: indicador de dispersión (cuantas naves atiende cada persona)
  const navesPorOpDia = new Map<string, Map<string, Set<string>>>() // fecha -> operario -> naves
  for (const rw of rows) {
    const fISO = dia(rw.fecha)
    let porOp = navesPorOpDia.get(fISO)
    if (!porOp) { porOp = new Map(); navesPorOpDia.set(fISO, porOp) }
    let s = porOp.get(rw.operario)
    if (!s) { s = new Set(); porOp.set(rw.operario, s) }
    s.add(rw.nave)
  }
  let sumaNavesPorOp = 0
  let nOpsNaves = 0
  for (const porOp of navesPorOpDia.values()) {
    for (const s of porOp.values()) { sumaNavesPorOp += s.size; nOpsNaves++ }
  }

  // ---- clasificación persona-día por tarea (apros / homogéneos / ambas) ----
  const opsAprosDia = new Map<string, Set<string>>()
  const opsHomDia = new Map<string, Set<string>>()
  const opsAmbasDia = new Map<string, Set<string>>()
  const opsAprosAll = new Set<string>()
  const opsHomAll = new Set<string>()
  for (const [kd, acc] of opDiaTarea) {
    const [fISO, op] = kd.split('|')
    const haceApros = acc.ap > 0
    const haceHom = acc.ho > 0
    if (haceApros) {
      let s = opsAprosDia.get(fISO); if (!s) { s = new Set(); opsAprosDia.set(fISO, s) }
      s.add(op); opsAprosAll.add(op)
    }
    if (haceHom) {
      let s = opsHomDia.get(fISO); if (!s) { s = new Set(); opsHomDia.set(fISO, s) }
      s.add(op); opsHomAll.add(op)
    }
    if (haceApros && haceHom) {
      let s = opsAmbasDia.get(fISO); if (!s) { s = new Set(); opsAmbasDia.set(fISO, s) }
      s.add(op)
    }
  }
  const personasPromDeMapa = (m: Map<string, Set<string>>): number | null => {
    if (!m.size) return null
    let sum = 0
    for (const s of m.values()) sum += s.size
    return r1(sum / m.size) // promedio sobre los días en que la tarea se realizó
  }
  const porDiaTareas = [...diasSet].sort().map((fISO) => ({
    fecha: fISO,
    apros: opsAprosDia.get(fISO)?.size ?? 0,
    homogeneos: opsHomDia.get(fISO)?.size ?? 0,
    ambas: opsAmbasDia.get(fISO)?.size ?? 0,
  }))

  // tarea x actividad: personas promedio por día haciendo ESA tarea en ESA actividad
  const tareaActAcc = new Map<string, { porDia: Map<string, Set<string>>; mov: number; ops: Set<string> }>()
  for (const [k, acc] of opDiaActTarea) {
    const partes = k.split('|') // fecha|operario|actividad
    const fISO = partes[0]
    const op = partes[1]
    const act = partes[2]
    for (const [tarea, mov] of [['apros', acc.ap], ['homogeneos', acc.ho]] as const) {
      if (mov <= 0) continue
      const kk = `${tarea}|${act}`
      let t = tareaActAcc.get(kk)
      if (!t) { t = { porDia: new Map(), mov: 0, ops: new Set() }; tareaActAcc.set(kk, t) }
      t.mov += mov
      t.ops.add(op)
      let s = t.porDia.get(fISO); if (!s) { s = new Set(); t.porDia.set(fISO, s) }
      s.add(op)
    }
  }
  const porDiaProm = (t: { porDia: Map<string, Set<string>> }): number | null => {
    if (!t.porDia.size) return null
    let sum = 0
    for (const s of t.porDia.values()) sum += s.size
    return r1(sum / t.porDia.size)
  }
  const tareasPorActividad = [...tareaActAcc.entries()]
    .map(([k, t]) => {
      const [tarea, actividad] = k.split('|')
      return {
        tarea,
        actividad: etiquetaAct(actividad),
        codigo: actividad,
        personasPromDia: porDiaProm(t),
        operarios: t.ops.size,
        dias: t.porDia.size,
        movimientos: t.mov,
      }
    })
    .sort((a, b) => a.tarea.localeCompare(b.tarea) || (b.personasPromDia ?? 0) - (a.personasPromDia ?? 0))

  return {
    registros: rows.length,
    vacio: false as const,
    desde: dia(rows[0].fecha),
    hasta: dia(rows[rows.length - 1].fecha),
    meses: new Set([...diasSet].map((d) => d.slice(0, 7))).size,
    operarios: opsAll.size,
    dias: diasSet.size,
    personasPromDia: personasPromDiaGlobal,
    movimientos,
    bultos,
    horasHombre,
    navesActivas: porNave.size,
    navesPorOperarioDia: nOpsNaves ? r2(sumaNavesPorOp / nOpsNaves) : null,
    porActividad: [...porAct.entries()]
      .map(([actividad, a]) => ({
        actividad: etiquetaAct(actividad),
        codigo: actividad,
        operarios: a.ops.size,
        personasPromDia: personasProm(a),
        dias: a.porDia.size,
        movimientos: a.mov,
        bultos: a.bul,
        horas: horasAct.get(actividad) ?? 0,
      }))
      .sort((a, b) => (b.personasPromDia ?? 0) - (a.personasPromDia ?? 0)),
    porNave: [...porNave.entries()]
      .map(([nave, a]) => ({
        nave: etiquetaNave(nave),
        codigo: nave,
        operarios: a.ops.size,
        personasPromDia: personasProm(a),
        dias: a.porDia.size,
        movimientos: a.mov,
        bultos: a.bul,
        horas: horasNave.get(nave) ?? 0,
      }))
      .sort((a, b) => (b.personasPromDia ?? 0) - (a.personasPromDia ?? 0)),
    matriz: [...matriz.entries()]
      .map(([k, a]) => {
        const [actividad, nave] = k.split('|')
        return {
          actividad: etiquetaAct(actividad),
          nave: etiquetaNave(nave),
          personasPromDia: personasProm(a),
          operarios: a.ops.size,
          dias: a.porDia.size,
          movimientos: a.mov,
        }
      })
      .sort((a, b) => (b.personasPromDia ?? 0) - (a.personasPromDia ?? 0)),
    // perfil horario: movimientos promedio por hora del día (total + por turno pivoteado)
    porHora: Array.from({ length: 24 }, (_, h) => {
      const fila: { hora: number; etiqueta: string; total: number; M: number; T: number; N: number } = {
        hora: h,
        etiqueta: `${String(h).padStart(2, '0')}h`,
        total: r1(horaTotal[h] / diasSet.size),
        M: 0,
        T: 0,
        N: 0,
      }
      for (const [t, vec] of horaTurno) {
        if (t === 'M' || t === 'T' || t === 'N') fila[t] = r1(vec[h] / diasSet.size)
      }
      return fila
    }),
    // perfil horario SOLO de movimientos de apros (promedio por día, estimado por
    // la proporción apros/total de cada fila)
    porHoraApros: Array.from({ length: 24 }, (_, h) => ({
      hora: h,
      etiqueta: `${String(h).padStart(2, '0')}h`,
      total: r1(horaApros[h] / diasSet.size),
    })),
    horaPico: (() => {
      if (!tieneHorario) return null
      let best = 0
      for (let h = 1; h < 24; h++) if (horaTotal[h] > horaTotal[best]) best = h
      return { hora: best, movimientos: horaTotal[best], promDia: r1(horaTotal[best] / diasSet.size) }
    })(),
    tieneHorario,
    porTurno: porTurnoOut,
    porMesActividad,
    porMesNave: porMesNaveFiltrado(mesNav, topNaves),
    // detalle: movimientos por mes por persona (foco apros), top 300 por apros
    movPorPersonaMes: [...movOpMes.values()].sort((a, b) => b.apros - a.apros || b.total - a.total).slice(0, 300),
    // mapa de calor de apros: movimientos por mes x actividad + personas que los hicieron
    calorApros: (() => {
      const meses = [...new Set([...aprosMesAct.keys()].map((k) => k.split('|')[0]))].sort()
      const actTot = new Map<string, number>()
      for (const [k, v] of aprosMesAct) {
        const act = k.split('|')[1]
        actTot.set(act, (actTot.get(act) ?? 0) + v.mov)
      }
      const actividades = [...actTot.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => etiquetaAct(k))
      const celdas = [...aprosMesAct.entries()].map(([k, v]) => {
        const [mes, act] = k.split('|')
        return { mes, actividad: etiquetaAct(act), mov: v.mov, personas: v.ops.size }
      })
      return { meses, actividades, celdas }
    })(),
    tareas: {
      movApros,
      movHom,
      conDatos: movApros + movHom > 0,
      operariosApros: opsAprosAll.size,
      operariosHom: opsHomAll.size,
      personasPromApros: movApros > 0 ? personasPromDeMapa(opsAprosDia) : null,
      personasPromHom: movHom > 0 ? personasPromDeMapa(opsHomDia) : null,
      porDia: porDiaTareas,
      porActividad: tareasPorActividad,
    },
    fuentes: fuentesOut,
  }
}

// naves por mes limitadas al top (reusa el acumulado mesNav)
function porMesNaveFiltrado(mesNav: Map<string, { dias: number; ops: number }>, topNaves: string[]) {
  return [...mesNav.entries()]
    .filter(([k]) => topNaves.includes(k.split('|')[1]))
    .map(([k, v]) => {
      const [mes, nave] = k.split('|')
      return { mes, nave: nave === 'XXX' ? 'Varias (XXX)' : nave === '?' ? 'Sin nave' : nave, personasProm: r1(v.ops / v.dias) }
    })
    .sort((a, b) => a.mes.localeCompare(b.mes) || a.nave.localeCompare(b.nave))
}

// ============ PLANIFICADOR (estimacion de dotacion segun la demanda) ============
// Reune en un solo lugar todos los parametros de productividad medidos:
// demanda (ola + pendiente), ritmos H61 (global / por turno / base / extras) y
// productividades del E-8, mas el perfil horario promedio para planificar por hora.
export async function getPlanificador() {
  const [olaRows, ops, th, pickAgg, e8Rows, oh] = await Promise.all([
    db.olaDia.findMany({ orderBy: { fecha: 'asc' } }),
    db.h61OpDia.findMany({ orderBy: { fecha: 'asc' } }),
    db.h61TurnoHora.findMany(),
    db.pickingEvento.aggregate({ _sum: { bultos: true, minutos: true, muertoMin: true, netoMin: true, superNetoMin: true } }),
    // E-8 grano resumen por sector/circuito (ACT2, ACT4, JAULA, XD): ritmos por circuito
    db.pickingEvento.findMany({
      where: { minutos: { not: null } },
      select: { circuito: true, bultos: true, minutos: true, netoMin: true, muertoMin: true },
    }),
    // perfil de operarios por hora (para el ritmo real de cada hora)
    db.h61OpHora.findMany({ select: { fecha: true, hora: true, bultos: true, esExtra: true, operario: true } }),
  ])

  const med = (vals: number[]): number | null => {
    if (!vals.length) return null
    const s = [...vals].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? r1(s[m]) : r1((s[m - 1] + s[m]) / 2)
  }
  const prom = (vals: number[]): number | null => (vals.length ? r1(vals.reduce((a, b) => a + b, 0) / vals.length) : null)

  // --- demanda: ola y pendiente por dia ---
  const olaPorDia = new Map<string, { ola: number; pendiente: number }>()
  for (const o of olaRows) {
    const k = dia(o.fecha)
    const cur = olaPorDia.get(k) ?? { ola: 0, pendiente: 0 }
    cur.ola += o.ola ?? 0
    cur.pendiente += o.pendiente ?? 0
    olaPorDia.set(k, cur)
  }
  const diasConOla: number[] = []
  const diasConPend: number[] = []
  const diasTotales: number[] = []
  for (const v of olaPorDia.values()) {
    if (v.ola > 0) diasConOla.push(v.ola)
    if (v.pendiente > 0) diasConPend.push(v.pendiente)
    if (v.ola > 0 || v.pendiente > 0) diasTotales.push(v.ola + v.pendiente)
  }
  // promedio de demanda por dia de semana (lun-dom) para planificar cada dia
  const DIAS_SEM_PL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
  const semAgg = new Map<number, { ola: number[]; pend: number[]; tot: number[] }>()
  for (const [k, v] of olaPorDia) {
    if (v.ola <= 0 && v.pendiente <= 0) continue
    const dw = new Date(k + 'T00:00:00.000Z').getUTCDay()
    let s = semAgg.get(dw)
    if (!s) { s = { ola: [], pend: [], tot: [] }; semAgg.set(dw, s) }
    s.ola.push(v.ola)
    s.pend.push(v.pendiente)
    s.tot.push(v.ola + v.pendiente)
  }
  const porDiaSemana = [1, 2, 3, 4, 5, 6, 0].filter((d) => semAgg.has(d)).map((dw) => {
    const s = semAgg.get(dw)!
    return {
      dow: dw,
      dia: DIAS_SEM_PL[dw],
      olaProm: Math.round(prom(s.ola) ?? 0),
      olaMediana: med(s.ola),
      pendProm: Math.round(prom(s.pend) ?? 0),
      totalProm: Math.round(prom(s.tot) ?? 0),
      totalMediana: med(s.tot),
      dias: s.tot.length,
    }
  })

  // --- H61: ritmos globales y por turno ---
  let bultosTot = 0, horasTot = 0, extrasTot = 0, baseTot = 0, extrasBulTot = 0
  const diasH61 = new Set<string>()
  const turnoMap = new Map<string, { bultos: number; horas: number; extras: number; bultosBase: number; bultosExtras: number; dias: Map<string, Set<string>> }>()
  for (const r of ops) {
    const k = dia(r.fecha)
    diasH61.add(k)
    bultosTot += r.bultos
    horasTot += r.horasActivas
    extrasTot += r.extras
    baseTot += r.bultosBase
    extrasBulTot += r.bultosExtras
    let t = turnoMap.get(r.turno)
    if (!t) { t = { bultos: 0, horas: 0, extras: 0, bultosBase: 0, bultosExtras: 0, dias: new Map() }; turnoMap.set(r.turno, t) }
    t.bultos += r.bultos
    t.horas += r.horasActivas
    t.extras += r.extras
    t.bultosBase += r.bultosBase
    t.bultosExtras += r.bultosExtras
    let s = t.dias.get(k)
    if (!s) { s = new Set(); t.dias.set(k, s) }
    s.add(r.operario)
  }
  const NOMBRE_TURNO_PL: Record<string, string> = { M: 'TM (6 a 14)', T: 'TT (14 a 22)', N: 'TN (23 a 06)' }
  const porTurno = [...turnoMap.entries()].sort().map(([turno, t]) => {
    const dias = t.dias.size
    const personasPromDia = dias ? r1([...t.dias.values()].reduce((a, s) => a + s.size, 0) / dias) : null
    const horasBase = Math.max(0, t.horas - t.extras)
    return {
      turno,
      nombre: NOMBRE_TURNO_PL[turno] ?? turno,
      bultos: t.bultos,
      bultosBase: t.bultosBase,
      bultosExtras: t.bultosExtras,
      horas: t.horas,
      horasBase,
      horasExtras: t.extras,
      ritmo: t.horas ? r1(t.bultos / t.horas) : null,
      ritmoBase: horasBase ? r1(t.bultosBase / horasBase) : null,
      ritmoExtras: t.extras ? r1(t.bultosExtras / t.extras) : null,
      personasPromDia,
      pctExtras: t.bultos ? r1((t.bultosExtras / t.bultos) * 100) : 0,
      dias,
    }
  })

  // --- perfil horario promedio por dia (bultos de cada hora) ---
  const horaFechas = new Map<number, Map<string, number>>()
  for (const r of th) {
    let m = horaFechas.get(r.hora)
    if (!m) { m = new Map(); horaFechas.set(r.hora, m) }
    m.set(dia(r.fecha), (m.get(dia(r.fecha)) ?? 0) + r.bultos)
  }
  const nDiasPerfil = new Set(th.map((r) => dia(r.fecha))).size
  const perfilHora = Array.from({ length: 24 }, (_, hora) => {
    const m = horaFechas.get(hora)
    const suma = m ? [...m.values()].reduce((a, b) => a + b, 0) : 0
    return {
      hora,
      etiqueta: `${String(hora).padStart(2, '0')}:00`,
      bultosProm: nDiasPerfil ? Math.round(suma / nDiasPerfil) : 0,
    }
  })

  // --- PLANIFICACIÓN DIARIA: perfiles horarios por tipo de día (L-V, sábado, domingo) ---
  const tipoDeDow = (dw: number) => (dw === 0 ? 'dom' : dw === 6 ? 'sab' : 'lv') as 'lv' | 'sab' | 'dom'
  const perfAgg: Record<'lv' | 'sab' | 'dom', { bultos: number[]; dias: Set<string> }> = {
    lv: { bultos: new Array(24).fill(0), dias: new Set() },
    sab: { bultos: new Array(24).fill(0), dias: new Set() },
    dom: { bultos: new Array(24).fill(0), dias: new Set() },
  }
  for (const r of th) {
    const k = dia(r.fecha)
    const t = tipoDeDow(new Date(k + 'T00:00:00.000Z').getUTCDay())
    perfAgg[t].bultos[r.hora] += r.bultos
    perfAgg[t].dias.add(k)
  }
  const perfiles = {
    lv: perfAgg.lv.bultos.map((b) => (perfAgg.lv.dias.size ? Math.round(b / perfAgg.lv.dias.size) : 0)),
    sab: perfAgg.sab.bultos.map((b) => (perfAgg.sab.dias.size ? Math.round(b / perfAgg.sab.dias.size) : 0)),
    dom: perfAgg.dom.bultos.map((b) => (perfAgg.dom.dias.size ? Math.round(b / perfAgg.dom.dias.size) : 0)),
  }
  const diasPerfil = { lv: perfAgg.lv.dias.size, sab: perfAgg.sab.dias.size, dom: perfAgg.dom.dias.size }

  // ritmo real por hora (jornada, sin extras): bultos del día-hora ÷ operarios distintos del día-hora,
  // promediado por día (por eso se agrupa primero por fecha)
  const ohAgg = new Map<number, Map<string, { bultos: number; ops: Set<string> }>>()
  for (const r of oh) {
    if (r.esExtra) continue
    let m = ohAgg.get(r.hora)
    if (!m) { m = new Map(); ohAgg.set(r.hora, m) }
    const k = dia(r.fecha)
    let a = m.get(k)
    if (!a) { a = { bultos: 0, ops: new Set() }; m.set(k, a) }
    a.bultos += r.bultos
    a.ops.add(r.operario)
  }
  const ritmoHora = Array.from({ length: 24 }, (_, h) => {
    const m = ohAgg.get(h)
    if (!m || !m.size) return null
    const bultos = [...m.values()].reduce((a, x) => a + x.bultos, 0)
    const ops = [...m.values()].reduce((a, x) => a + x.ops.size, 0)
    return ops ? r1(bultos / ops) : null
  })

  // --- PLANIFICACIÓN DIARIA: ritmos por circuito del E-8 (grano resumen) ---
  const normSector = (s: string | null) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const circAgg = new Map<string, { bultos: number; min: number; neto: number; muerto: number }>()
  for (const r of e8Rows) {
    const k = normSector(r.circuito) || 'SINSECTOR'
    let c = circAgg.get(k)
    if (!c) { c = { bultos: 0, min: 0, neto: 0, muerto: 0 }; circAgg.set(k, c) }
    c.bultos += r.bultos ?? 0
    c.min += r.minutos ?? 0
    c.neto += r.netoMin ?? 0
    c.muerto += r.muertoMin ?? 0
  }
  const e8BultosTot = [...circAgg.values()].reduce((a, c) => a + c.bultos, 0)
  const e8HorasTot = [...circAgg.values()].reduce((a, c) => a + c.min, 0) / 60
  const ritmoE8 = e8HorasTot > 0 ? r2(e8BultosTot / e8HorasTot) : null
  const ritmoBaseH61 = horasTot - extrasTot > 0 ? r2(baseTot / (horasTot - extrasTot)) : null
  // calibración: los ritmos por circuito (E-8) se ajustan para que el promedio global de la
  // preparación coincida con el ritmo base medido por H61 (el "85" de referencia del usuario)
  const factorCal = ritmoE8 && ritmoBaseH61 ? r2(ritmoBaseH61 / ritmoE8) : 1
  const ETIQUETA_SECTOR: Record<string, string> = { ACT2: 'ACT. 2', ACT4: 'ACT. 4', JAULA: 'Jaula', XD: 'XD' }
  const circuitos = [...circAgg.entries()]
    .filter(([, c]) => c.bultos > 0 && e8BultosTot > 0 && c.bultos / e8BultosTot >= 0.005)
    .sort((a, b) => b[1].bultos - a[1].bultos)
    .map(([sector, c]) => ({
      sector,
      etiqueta: ETIQUETA_SECTOR[sector] ?? sector,
      bultos: Math.round(c.bultos),
      horas: r1(c.min / 60),
      ritmoTotal: c.min ? r2(c.bultos / (c.min / 60)) : null,
      ritmoNeto: c.neto ? r2(c.bultos / (c.neto / 60)) : null,
      pctMuerto: c.min ? r1(((c.muerto ?? 0) / c.min) * 100) : null,
      share: r1((c.bultos / e8BultosTot) * 100),
      ritmoCal: c.min && ritmoBaseH61 && ritmoE8 ? r2(c.bultos / (c.min / 60) * factorCal) : null,
    }))

  // --- productividades del E-8 (grano resumen: tiempos informados) ---
  const s = pickAgg._sum
  const picking = s.minutos && s.minutos > 0
    ? {
        grano: 'resumen' as const,
        bultos: s.bultos ?? 0,
        prodTotal: r2((s.bultos ?? 0) / (s.minutos / 60)),
        prodNeta: s.netoMin ? r2((s.bultos ?? 0) / (s.netoMin / 60)) : null,
        prodSuperNeta: s.superNetoMin ? r2((s.bultos ?? 0) / (Math.min(s.superNetoMin, s.netoMin ?? s.superNetoMin) / 60)) : null,
        pctMuerto: r1(((s.muertoMin ?? 0) / s.minutos) * 100),
      }
    : null

  return {
    ola: { prom: prom(diasConOla), mediana: med(diasConOla), dias: diasConOla.length },
    pendiente: { prom: prom(diasConPend), mediana: med(diasConPend), dias: diasConPend.length },
    demandaTotal: { prom: prom(diasTotales), mediana: med(diasTotales), dias: diasTotales.length },
    porDiaSemana,
    h61: {
      dias: diasH61.size,
      bultos: bultosTot,
      horas: horasTot,
      ritmoGlobal: horasTot ? r1(bultosTot / horasTot) : null,
      ritmoBase: horasTot - extrasTot > 0 ? r1(baseTot / (horasTot - extrasTot)) : null,
      ritmoExtras: extrasTot ? r1(extrasBulTot / extrasTot) : null,
      pctExtras: bultosTot ? r1((extrasBulTot / bultosTot) * 100) : 0,
      porTurno,
    },
    picking,
    perfilHora,
    planDiaria: {
      circuitos,
      calibracion: { ritmoH61: ritmoBaseH61, ritmoE8, factor: factorCal },
      perfiles,
      diasPerfil,
      ritmoHora,
    },
  }
}

// ============ STATUS ============
export async function getStatus() {
  const [ola, h61, tm, pk, mq, batches] = await Promise.all([
    db.olaDia.aggregate({ _count: true, _min: { fecha: true }, _max: { fecha: true } }),
    db.h61OpDia.aggregate({ _count: true, _min: { fecha: true }, _max: { fecha: true } }),
    db.tiempoMuerto.aggregate({ _count: true, _min: { fecha: true }, _max: { fecha: true } }),
    db.pickingEvento.aggregate({ _count: true, _min: { fecha: true }, _max: { fecha: true } }),
    db.maqOpNave.aggregate({ _count: true, _min: { fecha: true }, _max: { fecha: true } }),
    db.uploadBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
  ])
  return {
    ola: { registros: ola._count, desde: ola._min.fecha, hasta: ola._max.fecha },
    h61: { registros: h61._count, desde: h61._min.fecha, hasta: h61._max.fecha },
    tm: { registros: tm._count, desde: tm._min.fecha, hasta: tm._max.fecha },
    picking: { registros: pk._count, desde: pk._min.fecha, hasta: pk._max.fecha },
    maq: { registros: mq._count, desde: mq._min.fecha, hasta: mq._max.fecha },
    batches: batches.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() })),
  }
}
