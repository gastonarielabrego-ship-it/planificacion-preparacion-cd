import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { LOGO_BASE64 } from '@/lib/logo'
import { getOla, getCapacidad, getH61, getMaquinistas, getTM, getPicking, getPlanificador } from '@/lib/agg'

export const runtime = 'nodejs'
export const maxDuration = 300

// Colores institucionales Grupo Gestion
const VERDE = 'FF7CB93E'
const VERDE_OSCURO = 'FF5C9429'
const GRIS = 'FF58595B'
const GRIS_CLARO = 'FFF2F2F2'

function estilarHeader(ws: ExcelJS.Worksheet, fila: number, cols: number) {
  const row = ws.getRow(fila)
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
  row.alignment = { vertical: 'middle', wrapText: true }
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c)
    cell.border = { bottom: { style: 'thin', color: { argb: VERDE_OSCURO } } }
  }
  row.height = 22
}

function tituloHoja(ws: ExcelJS.Worksheet, titulo: string, subtitulo: string, totalCols: number) {
  ws.mergeCells(1, 1, 1, totalCols)
  const t = ws.getCell(1, 1)
  t.value = titulo
  t.font = { bold: true, size: 14, color: { argb: GRIS } }
  ws.mergeCells(2, 1, 2, totalCols)
  const s = ws.getCell(2, 1)
  s.value = subtitulo
  s.font = { size: 9, italic: true, color: { argb: GRIS } }
  ws.getRow(1).height = 22
}

const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const etiquetaMes = (ym: string) => `${MESES_ABR[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`
const f = (v: number | null | undefined, dec = 0) => (v == null ? '' : +(v).toFixed(dec))

export async function GET() {
  try {
    const [ola, cap, h61, maq, tm, picking, plan] = await Promise.all([
      getOla({}),
      getCapacidad({}),
      getH61({}),
      getMaquinistas({}),
      getTM({}),
      getPicking({}),
      getPlanificador(),
    ])

    const wb = new ExcelJS.Workbook()
    wb.creator = 'Grupo Gestión — Preparación CD'
    wb.created = new Date()

    const fechaHoy = new Date().toISOString().slice(0, 10)

    // ============ HOJA INFORME (portada con logo + KPIs) ============
    const port = wb.addWorksheet('Informe', { views: [{ showGridLines: false }] })
    port.columns = [{ width: 42 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 20 }]

    const logo = wb.addImage({ base64: LOGO_BASE64, extension: 'png' })
    port.addImage(logo, { tl: { col: 0.2, row: 0.2 }, ext: { width: 190, height: 72 } })

    port.mergeCells('A1:E1')
    const t1 = port.getCell('A1')
    t1.value = 'Informe de Planificación — Preparación CD'
    t1.font = { bold: true, size: 16, color: { argb: GRIS } }
    t1.alignment = { vertical: 'middle', horizontal: 'right' }
    port.getRow(1).height = 40

    port.mergeCells('A2:E2')
    const t2 = port.getCell('A2')
    t2.value = `Grupo Gestión · generado el ${fechaHoy}${cap.resumen && cap.serie.length ? ` · período H61: ${cap.serie[0].fecha.slice(0, 10)} a ${cap.serie[cap.serie.length - 1].fecha.slice(0, 10)}` : ''}`
    t2.font = { size: 10, color: { argb: GRIS } }
    t2.alignment = { horizontal: 'right' }

    let r = 4
    port.getCell(r, 1).value = 'Resumen ejecutivo'
    port.getCell(r, 1).font = { bold: true, size: 12, color: { argb: VERDE_OSCURO } }
    r++
    const diasConOla = ola.serie.filter((s) => s.ola > 0)
    const kpis: [string, string][] = [
      ['Ola diaria promedio (días con ola)', diasConOla.length ? `${Math.round(diasConOla.reduce((a, s) => a + s.ola, 0) / diasConOla.length).toLocaleString('es-AR')} bultos/día` : '—'],
      ['Bultos preparados H61', cap.resumen ? `${(cap.resumen.bultos + cap.resumen.bultosFeriado).toLocaleString('es-AR')}` : '—'],
      ['Ritmo de preparación', cap.resumen ? `${cap.resumen.ritmoProm ?? '—'} bultos/h (mediana ${cap.resumen.ritmoMediana})` : '—'],
      ['Bultos en horas extra', cap.resumen ? `${cap.resumen.bultosExtras.toLocaleString('es-AR')} (${cap.resumen.pctExtras}%) + feriados ${cap.resumen.bultosFeriado.toLocaleString('es-AR')}` : '—'],
      ['Personas involucradas (H61)', cap.resumen ? `${cap.resumen.personas} operarios · ${cap.resumen.personasExtras} con extras` : '—'],
      ['Tiempo muerto informado', `${(tm.totalMin / 60).toLocaleString('es-AR', { maximumFractionDigits: 0 })} h (${tm.registros} eventos)`],
      ['Motivo n° 1 de tiempo muerto', tm.porCategoria[0] ? `${tm.porCategoria[0].categoria}: ${(tm.porCategoria[0].minutos / 60).toLocaleString('es-AR', { maximumFractionDigits: 0 })} h (${tm.porCategoria[0].pct}%)` : '—'],
      ['Maquinistas', maq.vacio ? 'sin datos' : `${maq.personasPromDia ?? '—'} personas/día · ${maq.tareas.personasPromApros ?? '—'} hacen apros · ${maq.tareas.personasPromHom ?? '—'} homogéneos`],
      ['E-8 tiempo muerto entre pickings', picking.vacio ? 'sin datos' : picking.grano === 'resumen' ? `prom ${picking.muertoBloques.promedio ?? '—'} min · mediana ${picking.muertoBloques.mediana ?? '—'} min por bloque` : `prom ${picking.gapPromedio ?? '—'} min · mediana ${picking.gapMediana ?? '—'} min entre eventos`],
    ]
    for (const [k, v] of kpis) {
      port.getCell(r, 1).value = k
      port.getCell(r, 1).font = { bold: true, size: 10 }
      port.mergeCells(r, 2, r, 5)
      port.getCell(r, 2).value = v
      port.getCell(r, 2).font = { size: 10 }
      if (r % 2 === 0) for (let c = 1; c <= 5; c++) port.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_CLARO } }
      r++
    }
    r++
    port.getCell(r, 1).value = 'Detalle por sección en las hojas: Ola, Capacidad H61, Productividad H61, Maquinistas, Tiempos muertos, E-8 y Modelo.'
    port.getCell(r, 1).font = { italic: true, size: 9, color: { argb: GRIS } }

    // ============ OLA ============
    const wsOla = wb.addWorksheet('Ola')
    wsOla.columns = [{ width: 12 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }]
    tituloHoja(wsOla, 'Ola — promedio y mediana por mes y por día de la semana', 'Demanda de bultos a preparar (ola + pendiente). Sábados y domingos no cae ola.', 6)
    wsOla.getCell(4, 1).value = 'Por mes (promedio y mediana sobre días con ola)'
    wsOla.getCell(4, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
    const cabeOla = ['Mes', 'Días c/ ola', 'Ola total', 'Pendiente', 'Prom. ola/día', 'Mediana ola/día']
    cabeOla.forEach((h, i) => (wsOla.getCell(5, i + 1).value = h))
    estilarHeader(wsOla, 5, 6)
    const porMesOla = new Map<string, { vals: number[]; ola: number; pend: number; n: number }>()
    for (const s of ola.serie) {
      const k = s.fecha.slice(0, 7)
      const m = porMesOla.get(k) ?? { vals: [], ola: 0, pend: 0, n: 0 }
      if (s.ola > 0) { m.vals.push(s.ola); m.ola += s.ola; m.n++ }
      m.pend += s.pendiente
      porMesOla.set(k, m)
    }
    const medianaDe = (vals: number[]): number => {
      if (!vals.length) return 0
      const s = [...vals].sort((a, b) => a - b)
      const mi = Math.floor(s.length / 2)
      return s.length % 2 ? s[mi] : (s[mi - 1] + s[mi]) / 2
    }
    let rr = 6
    for (const [k, m] of [...porMesOla.entries()].sort()) {
      wsOla.getRow(rr).values = [etiquetaMes(k), m.n, m.ola, m.pend, m.n ? Math.round(m.ola / m.n) : '', m.n ? Math.round(medianaDe(m.vals)) : '']
      rr++
    }
    rr += 2
    wsOla.getCell(rr, 1).value = 'Por día de la semana'
    wsOla.getCell(rr, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
    rr++
    const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
    const cab2 = ['Día', 'Días c/ ola', 'Ola prom.', 'Ola mediana', 'Pend. prom.', 'Total prom.']
    cab2.forEach((h, i) => (wsOla.getCell(rr, i + 1).value = h))
    estilarHeader(wsOla, rr, 6)
    rr++
    for (const d of DIAS) {
      const filas = ola.serie.filter((s) => s.diaSemana === d)
      const conOla = filas.filter((s) => s.ola > 0)
      if (!filas.length) continue
      const conPend = filas.filter((s) => s.pendiente > 0)
      wsOla.getRow(rr).values = [d, conOla.length, conOla.reduce((a, s) => a + s.ola, 0) / Math.max(1, conOla.length), medianaDe(conOla.map((s) => s.ola)), conPend.reduce((a, s) => a + s.pendiente, 0) / Math.max(1, conPend.length), filas.reduce((a, s) => a + s.total, 0) / Math.max(1, filas.length)]
      rr++
    }

    // ============ CAPACIDAD H61 ============
    const wsCap = wb.addWorksheet('Capacidad H61')
    wsCap.columns = [{ width: 16 }, { width: 10 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 16 }]
    tituloHoja(wsCap, 'Capacidad H61 — ritmo de preparación', 'Ritmo = bultos por hora-hombre. Los feriados se miden aparte (todo cuenta como extra).', 9)
    const cabCap = ['Día semana', 'Días', 'Bultos prom.', 'Personas prom.', 'Horas-hombre', 'Ritmo', 'Mediana días', '% extras', '']
    cabCap.forEach((h, i) => (wsCap.getCell(4, i + 1).value = h))
    estilarHeader(wsCap, 4, 9)
    let rc = 5
    for (const d of cap.porDiaSemana) {
      wsCap.getRow(rc).values = [d.dia, d.dias, d.bultosProm, d.personasProm, d.horasProm, f(d.ritmo, 1), f(d.ritmoMediana, 1), d.pctExtras / 100]
      wsCap.getCell(rc, 8).numFmt = '0.0%'
      rc++
    }
    rc += 1
    wsCap.getCell(rc, 1).value = 'Sábados'
    wsCap.getCell(rc, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
    rc++
    if (cap.sabadosResumen) {
      wsCap.getRow(rc).values = ['Sábados con actividad', 'Dotación mediana', 'Con dotación acotada', 'Ritmo sábados']
      estilarHeader(wsCap, rc, 9)
      rc++
      wsCap.getRow(rc).values = [cap.sabadosResumen.total, cap.sabadosResumen.personasMediana, cap.sabadosResumen.acotadas, f(cap.sabadosResumen.ritmo, 1)]
      rc++
    }
    rc += 1
    wsCap.getCell(rc, 1).value = 'Por turno (jornada y extras)'
    wsCap.getCell(rc, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
    rc++
    const cabT = ['Turno', 'Op-días', 'Personas', 'Bultos sin extras', 'Bultos en extras', '% extras', 'Horas extra', 'Ritmo jornada', 'Ritmo extras']
    cabT.forEach((h, i) => (wsCap.getCell(rc, i + 1).value = h))
    estilarHeader(wsCap, rc, 9)
    rc++
    for (const t of cap.porTurno) {
      wsCap.getRow(rc).values = [t.nombre, t.opDias, t.personas, t.bultosBase, t.bultosExtras, t.pctExtras / 100, t.horasExtras, f(t.ritmoProm, 1), t.horasExtras ? +(t.bultosExtras / t.horasExtras).toFixed(1) : '']
      wsCap.getCell(rc, 6).numFmt = '0.0%'
      rc++
    }
    rc += 1
    wsCap.getCell(rc, 1).value = 'Feriados'
    wsCap.getCell(rc, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
    rc++
    const cabF = ['Feriado', 'Fecha', 'Personas', 'Bultos', 'Horas', 'Ritmo']
    cabF.forEach((h, i) => (wsCap.getCell(rc, i + 1).value = h))
    estilarHeader(wsCap, rc, 9)
    rc++
    for (const fe of cap.feriados) {
      wsCap.getRow(rc).values = [fe.nombre, fe.fecha.slice(0, 10), fe.personas, fe.bultos, fe.horas, f(fe.ritmo, 1)]
      rc++
    }

    // ============ PRODUCTIVIDAD H61 ============
    const wsP = wb.addWorksheet('Productividad H61')
    wsP.columns = [{ width: 16 }, { width: 16 }, { width: 16 }, { width: 20 }]
    tituloHoja(wsP, 'Productividad H61 — producción por turno y perfil del día', 'Picos y valles del perfil horario promedio y producción e intensidad por turno.', 4)
    wsP.getCell(4, 1).value = 'Producción por turno'
    wsP.getCell(4, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
    const cabP = ['Turno', 'Bultos', 'Horas-hombre', 'Intensidad (bultos/h)']
    cabP.forEach((h, i) => (wsP.getCell(5, i + 1).value = h))
    estilarHeader(wsP, 5, 4)
    let rp = 6
    for (const t of h61.porTurno) {
      wsP.getRow(rp).values = [t.nombre, t.bultos, t.horas, f(t.prodHora, 1)]
      rp++
    }
    rp += 1
    wsP.getCell(rp, 1).value = 'Perfil horario (bultos promedio por hora)'
    wsP.getCell(rp, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
    rp++
    wsP.getCell(rp, 1).value = 'Hora'
    wsP.getCell(rp, 2).value = 'Bultos prom.'
    estilarHeader(wsP, rp, 4)
    rp++
    for (const p of cap.perfilHora) {
      if (p.bultosProm <= 0) continue
      wsP.getRow(rp).values = [p.etiqueta, p.bultosProm]
      rp++
    }

    // ============ MAQUINISTAS ============
    const wsM = wb.addWorksheet('Maquinistas')
    wsM.columns = [{ width: 18 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }]
    tituloHoja(wsM, 'Maquinistas (clarkistas) — personas, tareas y horarios', 'Personas por actividad y tarea (apros/homogéneos), distribución por turno y movimientos.', 5)
    if (maq.vacio) {
      wsM.getCell(4, 1).value = 'Sin datos cargados'
    } else {
      wsM.getCell(4, 1).value = 'Personas por actividad'
      wsM.getCell(4, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
      const cabM = ['Actividad', 'Personas prom./día', 'Operarios', 'Movimientos', 'Bultos']
      cabM.forEach((h, i) => (wsM.getCell(5, i + 1).value = h))
      estilarHeader(wsM, 5, 5)
      let rm = 6
      for (const a of maq.porActividad) {
        wsM.getRow(rm).values = [a.actividad, f(a.personasPromDia, 1), a.operarios, a.movimientos, a.bultos]
        rm++
      }
      rm += 1
      wsM.getCell(rm, 1).value = 'Personas por tarea y actividad'
      wsM.getCell(rm, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
      rm++
      const cabT2 = ['Tarea', 'Actividad', 'Personas prom./día', 'Operarios', 'Movimientos']
      cabT2.forEach((h, i) => (wsM.getCell(rm, i + 1).value = h))
      estilarHeader(wsM, rm, 5)
      rm++
      for (const a of maq.tareas.porActividad) {
        wsM.getRow(rm).values = [a.tarea, a.actividad, f(a.personasPromDia, 1), a.operarios, a.movimientos]
        rm++
      }
      rm += 1
      wsM.getCell(rm, 1).value = 'Distribución por turno'
      wsM.getCell(rm, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
      rm++
      const cabD = ['Turno', 'Personas prom./día', 'c/ apros', 'c/ homogéneos', 'Movimientos']
      cabD.forEach((h, i) => (wsM.getCell(rm, i + 1).value = h))
      estilarHeader(wsM, rm, 5)
      rm++
      const NOM: Record<string, string> = { M: 'TM (6 a 14)', T: 'TT (14 a 22)', N: 'TN (23 a 06)', '?': 'Sin turno' }
      for (const t of maq.porTurno) {
        wsM.getRow(rm).values = [NOM[t.turno] ?? t.turno, f(t.personasPromDia, 1), f(t.personasPromApros, 1), f(t.personasPromHom, 1), t.movimientos]
        rm++
      }
      rm += 1
      wsM.getCell(rm, 1).value = 'Movimientos por horario (promedio por día)'
      wsM.getCell(rm, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
      rm++
      const cabH = ['Hora', 'Total', 'TM', 'TT', 'TN']
      cabH.forEach((h, i) => (wsM.getCell(rm, i + 1).value = h))
      estilarHeader(wsM, rm, 5)
      rm++
      for (const p of maq.porHora) {
        if (p.total <= 0) continue
        wsM.getRow(rm).values = [p.etiqueta, f(p.total, 1), f(p.M, 1), f(p.T, 1), f(p.N, 1)]
        rm++
      }
      rm += 1
      wsM.getCell(rm, 1).value = 'Movimientos por mes por persona (top 100 por apros)'
      wsM.getCell(rm, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
      rm++
      const cabP2 = ['Mes', 'Persona', 'Apros', 'Homogéneos', 'Total mov.']
      cabP2.forEach((h, i) => (wsM.getCell(rm, i + 1).value = h))
      estilarHeader(wsM, rm, 5)
      rm++
      for (const m of maq.movPorPersonaMes.slice(0, 100)) {
        wsM.getRow(rm).values = [etiquetaMes(m.mes), m.nombre, m.apros, m.homogeneos, m.total]
        rm++
      }
      rm += 1
      wsM.getCell(rm, 1).value = 'Mapa de calor de apros: movimientos por mes × actividad'
      wsM.getCell(rm, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
      rm++
      const cabC = ['Mes', ...maq.calorApros.actividades]
      cabC.forEach((h, i) => (wsM.getCell(rm, i + 1).value = h))
      estilarHeader(wsM, rm, cabC.length)
      rm++
      for (const mes of maq.calorApros.meses) {
        const fila: (string | number)[] = [etiquetaMes(mes)]
        for (const act of maq.calorApros.actividades) {
          const c = maq.calorApros.celdas.find((x) => x.mes === mes && x.actividad === act)
          fila.push(c ? c.mov : '')
        }
        wsM.getRow(rm).values = fila
        rm++
      }
    }

    // ============ TIEMPOS MUERTOS ============
    const wsT = wb.addWorksheet('Tiempos muertos')
    wsT.columns = [{ width: 24 }, { width: 14 }, { width: 12 }, { width: 30 }]
    tituloHoja(wsT, 'Tiempos muertos — pareto y espera de piking', 'Categorías unificadas: espera de piking incluye lo cargado como espera de ubicación y apro.', 4)
    const cabTM = ['Categoría', 'Minutos', 'Horas', '% del total']
    cabTM.forEach((h, i) => (wsT.getCell(4, i + 1).value = h))
    estilarHeader(wsT, 4, 4)
    let rt = 5
    for (const c of tm.porCategoria) {
      wsT.getRow(rt).values = [c.categoria, c.minutos, +(c.minutos / 60).toFixed(1), c.pct / 100]
      wsT.getCell(rt, 4).numFmt = '0.0%'
      rt++
    }
    rt += 1
    wsT.getCell(rt, 1).value = 'Espera de piking por nave'
    wsT.getCell(rt, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
    rt++
    const cabN = ['Nave', 'Minutos', 'Eventos', 'Pasillos con más espera']
    cabN.forEach((h, i) => (wsT.getCell(rt, i + 1).value = h))
    estilarHeader(wsT, rt, 4)
    rt++
    for (const nv of tm.porNave.slice(0, 15)) {
      wsT.getRow(rt).values = [nv.nave, nv.minutos, nv.registros, nv.pasillos.slice(0, 4).map((p) => `${p.pasillo} (${Math.round(p.minutos)}′)`).join(', ')]
      rt++
    }
    rt += 1
    wsT.getCell(rt, 1).value = 'Por turno'
    wsT.getCell(rt, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
    rt++
    for (const t of tm.porTurno) {
      wsT.getRow(rt).values = [t.nombre, t.minutos]
      rt++
    }
    rt += 1
    wsT.getCell(rt, 1).value = 'Por hora del día'
    wsT.getCell(rt, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
    rt++
    const cabH2 = ['Hora', 'Total min', 'Espera piking min', '']
    cabH2.forEach((h, i) => (wsT.getCell(rt, i + 1).value = h))
    estilarHeader(wsT, rt, 4)
    rt++
    for (let h = 0; h < 24; h++) {
      const tot = tm.porHora[h]?.minutos ?? 0
      const esp = tm.porHoraEsperaPiking[h]?.minutos ?? 0
      if (tot <= 0 && esp <= 0) continue
      wsT.getRow(rt).values = [tm.porHora[h].etiqueta, tot, esp]
      rt++
    }

    // ============ E-8 ============
    if (!picking.vacio && picking.registros > 0) {
      const wsE = wb.addWorksheet('E-8')
      wsE.columns = [{ width: 24 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }]
      tituloHoja(wsE, 'E-8 — tiempo muerto entre piking', `Grano ${picking.grano === 'resumen' ? 'resumen por colaborador' : 'log evento a evento'}.`, 7)
      let re = 4
      wsE.getCell(re, 1).value = 'Promedio (min)'
      wsE.getCell(re, 2).value = 'Mediana (min)'
      wsE.getCell(re, 3).value = '% de la jornada'
      wsE.getCell(re, 4).value = 'Bultos'
      estilarHeader(wsE, re, 4)
      re++
      const promE = picking.grano === 'resumen' ? picking.muertoBloques.promedio : picking.gapPromedio
      const medE = picking.grano === 'resumen' ? picking.muertoBloques.mediana : picking.gapMediana
      wsE.getRow(re).values = [f(promE, 1), f(medE, 1), picking.tiempos.pctMuerto ? picking.tiempos.pctMuerto / 100 : '', picking.bultos]
      wsE.getCell(re, 3).numFmt = '0.0%'
      re += 2
      if (picking.muertoPorTurno.length) {
        wsE.getCell(re, 1).value = 'Por turno'
        wsE.getCell(re, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
        re++
        wsE.getRow(re).values = ['Turno', 'Minutos muertos', 'Promedio/bloque']
        estilarHeader(wsE, re, 3)
        re++
        for (const t of picking.muertoPorTurno) {
          wsE.getRow(re).values = [t.nombre, t.minutosMuerto, f(t.promedio, 1)]
          re++
        }
        re += 1
      }
      if (picking.muertoPorSector.length) {
        wsE.getCell(re, 1).value = 'Por nave (sector)'
        wsE.getCell(re, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
        re++
        wsE.getRow(re).values = ['Sector', 'Minutos muertos', '% de su jornada']
        estilarHeader(wsE, re, 3)
        re++
        for (const s of picking.muertoPorSector) {
          wsE.getRow(re).values = [s.sector, s.minutosMuerto, s.pctJornada ? s.pctJornada / 100 : '']
          wsE.getCell(re, 3).numFmt = '0.0%'
          re++
        }
      }
    }

    // ============ MODELO ============
    const wsPl = wb.addWorksheet('Modelo')
    wsPl.columns = [{ width: 14 }, { width: 18 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 16 }]
    tituloHoja(wsPl, 'Modelo de planificación — demanda y ritmos medidos', 'personas = demanda ÷ (ritmo × horas por persona) ÷ (1 − cobertura)', 6)
    wsPl.getCell(4, 1).value = 'Demanda por día de la semana'
    wsPl.getCell(4, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
    const cabPl = ['Día', 'Ola prom.', 'Ola mediana', 'Pend. prom.', 'Total prom.', 'Total mediana']
    cabPl.forEach((h, i) => (wsPl.getCell(5, i + 1).value = h))
    estilarHeader(wsPl, 5, 6)
    let rpl = 6
    for (const d of plan.porDiaSemana) {
      wsPl.getRow(rpl).values = [d.dia, d.olaProm, d.olaMediana ?? '', d.pendProm, d.totalProm, d.totalMediana ?? '']
      rpl++
    }
    rpl += 1
    wsPl.getCell(rpl, 1).value = 'Ritmos medidos (bultos por hora-hombre)'
    wsPl.getCell(rpl, 1).font = { bold: true, size: 11, color: { argb: VERDE_OSCURO } }
    rpl++
    wsPl.getRow(rpl).values = ['Ritmo global', 'Ritmo base', 'Ritmo extras', 'Prod. total E-8', 'Prod. neta E-8', '% extras']
    estilarHeader(wsPl, rpl, 6)
    rpl++
    wsPl.getRow(rpl).values = [f(plan.h61.ritmoGlobal, 1), f(plan.h61.ritmoBase, 1), f(plan.h61.ritmoExtras, 1), f(plan.picking?.prodTotal ?? null, 1), f(plan.picking?.prodNeta ?? null, 1), plan.h61.pctExtras / 100]
    wsPl.getCell(rpl, 6).numFmt = '0.0%'

    // devolver el archivo
    const buffer = await wb.xlsx.writeBuffer()
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Informe_Preparacion_CD_${fechaHoy}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('informe error', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error generando informe' }, { status: 500 })
  }
}
