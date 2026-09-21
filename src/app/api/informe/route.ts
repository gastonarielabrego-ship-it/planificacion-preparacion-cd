import { NextResponse } from 'next/server'
import { LOGO_BASE64 } from '@/lib/logo'
import { getOla, getCapacidad, getH61, getMaquinistas, getTM, getPicking, getPlanificador } from '@/lib/agg'

export const runtime = 'nodejs'
export const maxDuration = 300

// Informe en POWER POINT (.pptx) con logo y colores institucionales Grupo Gestión
const VERDE = '7CB93E'
const VERDE_OSC = '5C9429'
const NARANJA = 'F08A00'
const GRIS = '58595B'
const GRIS_CLARO = 'F2F2F2'
const VERDE_BG = 'EAF4DC'
const ROJO = 'DC2626'
const BORDE = 'D9D9D9'

const nf = (v: number | null | undefined, dec = 0) =>
  v == null ? '—' : v.toLocaleString('es-AR', { maximumFractionDigits: dec, minimumFractionDigits: 0 })

const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const etiquetaMes = (ym: string) => `${MESES_ABR[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`

function medianaDe(vals: number[]): number {
  if (!vals.length) return 0
  const s = [...vals].sort((a, b) => a - b)
  const mi = Math.floor(s.length / 2)
  return s.length % 2 ? s[mi] : (s[mi - 1] + s[mi]) / 2
}

// correlación de Pearson (igual que en la pestaña Resumen)
function pearson(a: number[], b: number[]): number | null {
  const n0 = a.length
  if (n0 < 3) return null
  const ma = a.reduce((x, y) => x + y, 0) / n0
  const mb = b.reduce((x, y) => x + y, 0) / n0
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n0; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2 }
  if (!da || !db) return null
  return num / Math.sqrt(da * db)
}

type Celda = { text: string; options?: Record<string, unknown> }
type Fila = Celda[]

function celda(text: string | number, opts: Record<string, unknown> = {}): Celda {
  return { text: typeof text === 'number' ? nf(text) : text, options: opts }
}

function filaHeader(cols: (string | number)[]): Fila {
  return cols.map((c) => celda(c, { bold: true, color: 'FFFFFF', fill: { color: VERDE }, fontSize: 10, align: 'center' }))
}

function filaDatos(vals: (string | number)[], zebra: boolean, extra: Record<string, unknown> = {}): Fila {
  return vals.map((v, i) => celda(v, { fontSize: 10, align: i === 0 ? 'left' : 'right', color: GRIS, fill: zebra ? { color: GRIS_CLARO } : undefined, ...extra }))
}

function tituloSlide(slide: PptxGenJS.Slide, num: string, titulo: string, subtitulo: string) {
  slide.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: VERDE } })
  slide.addText([
    { text: `${num} · `, options: { color: VERDE_OSC, bold: true } },
    { text: titulo, options: { color: GRIS, bold: true } },
  ], { x: 0.45, y: 0.22, w: 10.5, h: 0.45, fontSize: 20, fontFace: 'Calibri' })
  slide.addText(subtitulo, { x: 0.47, y: 0.66, w: 12.4, h: 0.32, fontSize: 11, color: '7F7F7F', italic: true })
  // logo chico arriba a la derecha
  slide.addImage({ data: `image/png;base64,${LOGO_BASE64}`, x: 11.75, y: 0.18, w: 1.35, h: 0.51 })
}

function kpiCard(slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number, valor: string, label: string, detalle: string, color: string) {
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.06, fill: { color: 'FFFFFF' }, line: { color: BORDE, width: 1 } })
  slide.addText(valor, { x, y: y + 0.08, w, h: h * 0.42, fontSize: 21, bold: true, color, align: 'center', valign: 'middle' })
  slide.addText(label, { x: x + 0.08, y: y + h * 0.48, w: w - 0.16, h: h * 0.26, fontSize: 10.5, bold: true, color: GRIS, align: 'center' })
  slide.addText(detalle, { x: x + 0.08, y: y + h * 0.72, w: w - 0.16, h: h * 0.26, fontSize: 8.5, color: '8A8A8A', align: 'center' })
}

function notaPie(slide: PptxGenJS.Slide, texto: string, y = 7.05) {
  slide.addText(texto, { x: 0.45, y, w: 12.4, h: 0.3, fontSize: 9, color: '8A8A8A', italic: true })
}

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

    const fechaHoy = new Date().toISOString().slice(0, 10)
    const { default: PptxGenJS } = await import('pptxgenjs')
    const pptx = new PptxGenJS()
    pptx.defineLayout({ name: 'GG16x9', width: 13.33, height: 7.5 })
    pptx.layout = 'GG16x9'
    pptx.author = 'Grupo Gestión'
    pptx.company = 'Grupo Gestión'
    pptx.title = 'Informe de Planificación — Preparación CD'

    const logoFull = { data: `image/png;base64,${LOGO_BASE64}`, x: 0.55, y: 0.62, w: 3.0, h: 1.14 }

    // ============ S1 · PORTADA ============
    {
      const s = pptx.addSlide()
      s.background = { color: 'FFFFFF' }
      s.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.28, fill: { color: VERDE } })
      s.addShape('rect', { x: 0, y: 7.28, w: 13.33, h: 0.22, fill: { color: VERDE } })
      s.addShape('rect', { x: 0, y: 0.28, w: 0.22, h: 7.0, fill: { color: NARANJA } })
      s.addImage(logoFull)
      s.addText('Informe de Planificación', { x: 0.55, y: 2.6, w: 12.2, h: 0.95, fontSize: 44, bold: true, color: GRIS })
      s.addText('Preparación del Centro de Distribución', { x: 0.55, y: 3.55, w: 12.2, h: 0.6, fontSize: 24, color: VERDE_OSC, bold: true })
      const periodo = cap.serie.length ? ` · Período H61: ${cap.serie[0].fecha.slice(0, 10)} a ${cap.serie[cap.serie.length - 1].fecha.slice(0, 10)}` : ''
      s.addText(`Grupo Gestión · generado el ${fechaHoy}${periodo}`, { x: 0.55, y: 4.5, w: 12.2, h: 0.4, fontSize: 14, color: '7F7F7F' })
      s.addText('Ola · Capacidad H61 · Productividad · Maquinistas · Tiempos muertos · E-8 · Modelo de planificación', { x: 0.55, y: 6.55, w: 12.2, h: 0.4, fontSize: 11, color: '9A9A9A' })
    }

    // ============ S2 · RESUMEN EJECUTIVO ============
    {
      const s = pptx.addSlide()
      tituloSlide(s, '1', 'Resumen ejecutivo', 'Los números clave del período para decidir la planificación de la ola')
      const diasConOla = ola.serie.filter((x) => x.ola > 0)
      const olaProm = diasConOla.length ? diasConOla.reduce((a, x) => a + x.ola, 0) / diasConOla.length : null
      const h61Horas = h61.resumen?.horas ?? 0
      const esperaCat = tm.porCategoria.find((c) => c.categoria === 'ESPERA PICKING')
      const e8Prom = picking.grano === 'resumen' ? picking.muertoBloques.promedio : picking.gapPromedio
      const e8Med = picking.grano === 'resumen' ? picking.muertoBloques.mediana : picking.gapMediana
      const kpis: [string, string, string, string][] = [
        [olaProm != null ? nf(olaProm) : '—', 'Ola diaria promedio', `${diasConOla.length} días con ola`, VERDE_OSC],
        [cap.resumen ? nf(cap.resumen.bultos + cap.resumen.bultosFeriado) : '—', 'Bultos preparados (H61 + feriados)', cap.resumen ? `+${nf(cap.resumen.bultosExtras)} en extras` : '', VERDE_OSC],
        [cap.resumen?.ritmoProm != null ? nf(cap.resumen.ritmoProm, 1) : '—', 'Ritmo de preparación (bultos/h)', cap.resumen?.ritmoMediana != null ? `mediana ${nf(cap.resumen.ritmoMediana, 1)}` : '', VERDE_OSC],
        [cap.resumen ? `${nf(cap.resumen.pctExtras, 1)}%` : '—', 'Bultos en horas extra', cap.resumen ? `${nf(cap.resumen.bultosExtras)} bultos en extras` : '', NARANJA],
        [tm.registros ? nf(tm.totalMin / 60) : '—', 'Tiempo muerto informado (h)', h61Horas ? `${nf((tm.totalMin / 60 / h61Horas) * 100, 1)}% de las horas H61` : `${nf(tm.registros)} eventos`, GRIS],
        [esperaCat ? nf(esperaCat.minutos / 60) : '—', 'Espera de piking (h)', esperaCat ? `motivo n° 1: ${nf(esperaCat.pct, 1)}% del muerto` : '', ROJO],
        [maq.vacio ? 'sin datos' : nf(maq.personasPromDia, 1), 'Personas/día (maquinistas)', maq.vacio ? '' : `${nf(maq.tareas.personasPromApros, 1)} apros · ${nf(maq.tareas.personasPromHom, 1)} homog.`, VERDE_OSC],
        [picking.vacio ? 'sin datos' : `${nf(e8Prom, 1)} / ${nf(e8Med, 1)} min`, 'E-8 muerto entre piking (prom/med)', picking.vacio ? '' : `${nf(picking.tiempos.pctMuerto, 1)}% de la jornada`, NARANJA],
      ]
      kpis.forEach((k, i) => {
        const col = i % 4, row = Math.floor(i / 4)
        kpiCard(s, 0.45 + col * 3.18, 1.25 + row * 2.15, 2.98, 1.9, k[0], k[1], k[2], k[3])
      })
      notaPie(s, 'Detalle por sección en las láminas siguientes: Ola, Capacidad, Productividad, Maquinistas, Tiempos muertos, E-8 y Modelo de planificación.')
    }

    // ============ S3 · OLA ============
    {
      const s = pptx.addSlide()
      tituloSlide(s, '2', 'Ola — ¿cuánto hay que preparar por día?', 'Promedio y mediana por mes y por día de la semana. Sábados y domingos no cae ola.')
      // tabla por mes (izquierda)
      const porMes = new Map<string, { vals: number[]; pend: number; dias: number }>()
      for (const x of ola.serie) {
        const k = x.fecha.slice(0, 7)
        const m = porMes.get(k) ?? { vals: [], pend: 0, dias: 0 }
        if (x.ola > 0) { m.vals.push(x.ola); m.dias++ }
        m.pend += x.pendiente
        porMes.set(k, m)
      }
      const filasMes: Fila[] = [filaHeader(['Mes', 'Prom. ola/día', 'Mediana', 'Días c/ ola'])]
      let i = 0
      for (const [k, m] of [...porMes.entries()].sort()) {
        const prom = m.dias ? Math.round(m.vals.reduce((a, b) => a + b, 0) / m.dias) : null
        filasMes.push(filaDatos([etiquetaMes(k), prom != null ? prom : '—', m.dias ? Math.round(medianaDe(m.vals)) : '—', m.dias], i % 2 === 1))
        i++
      }
      s.addTable(filasMes, { x: 0.45, y: 1.55, w: 6.1, colW: [1.8, 1.6, 1.4, 1.3], border: { type: 'solid', pt: 0.5, color: BORDE }, rowH: 0.34, valign: 'middle', margin: 0.04 })
      // tabla por día (derecha)
      const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
      const filasDia: Fila[] = [filaHeader(['Día', 'Ola prom.', 'Ola mediana', 'Pend. prom.'])]
      DIAS.forEach((d, di) => {
        const filas = ola.serie.filter((x) => x.diaSemana === d)
        const conOla = filas.filter((x) => x.ola > 0)
        if (!filas.length) return
        const conPend = filas.filter((x) => x.pendiente > 0)
        filasDia.push(filaDatos([d, conOla.length ? Math.round(conOla.reduce((a, x) => a + x.ola, 0) / conOla.length) : '—', conOla.length ? Math.round(medianaDe(conOla.map((x) => x.ola))) : '—', conPend.length ? Math.round(conPend.reduce((a, x) => a + x.pendiente, 0) / conPend.length) : '—'], di % 2 === 1))
      })
      s.addTable(filasDia, { x: 6.85, y: 1.55, w: 6.0, colW: [1.5, 1.5, 1.5, 1.5], border: { type: 'solid', pt: 0.5, color: BORDE }, rowH: 0.34, valign: 'middle', margin: 0.04 })
      notaPie(s, 'La mediana muestra el día típico sin distorsión de picos; la diferencia entre promedio y mediana indica qué tan variable es cada día.', 6.3)
    }

    // ============ S4 · CAPACIDAD H61 ============
    {
      const s = pptx.addSlide()
      tituloSlide(s, '3', 'Capacidad H61 — ritmo de preparación', 'Ritmo = bultos por hora-hombre. Sábados y feriados medidos aparte.')
      const filas: Fila[] = [filaHeader(['Día', 'Días', 'Bultos prom.', 'Personas prom.', 'Ritmo', 'Ritmo mediana', '% extras'])]
      cap.porDiaSemana.forEach((d, i) => filas.push(filaDatos([d.dia, d.dias, nf(d.bultosProm), nf(d.personasProm, 1), nf(d.ritmo, 1), nf(d.ritmoMediana, 1), `${nf(d.pctExtras, 1)}%`], i % 2 === 1)))
      s.addTable(filas, { x: 0.45, y: 1.5, w: 7.4, colW: [1.3, 0.7, 1.4, 1.4, 0.9, 1.3, 1.0], border: { type: 'solid', pt: 0.5, color: BORDE }, rowH: 0.36, valign: 'middle', margin: 0.04 })
      // cajas sábados / feriados
      s.addShape('roundRect', { x: 8.15, y: 1.5, w: 4.7, h: 1.7, rectRadius: 0.06, fill: { color: VERDE_BG }, line: { color: VERDE, width: 1 } })
      s.addText([
        { text: 'Sábados', options: { bold: true, fontSize: 13, color: VERDE_OSC, breakLine: true } },
        { text: cap.sabadosResumen ? `${cap.sabadosResumen.total} días con actividad · ritmo ${nf(cap.sabadosResumen.ritmo, 1)} bult/h · dotación mediana ${nf(cap.sabadosResumen.personasMediana, 0)} personas (${cap.sabadosResumen.acotadas} con dotación acotada)` : 'sin datos', options: { fontSize: 10.5, color: GRIS } },
      ], { x: 8.35, y: 1.6, w: 4.35, h: 1.5, valign: 'middle' })
      s.addShape('roundRect', { x: 8.15, y: 3.4, w: 4.7, h: 1.7, rectRadius: 0.06, fill: { color: 'FFF3E2' }, line: { color: NARANJA, width: 1 } })
      const totFeriados = cap.feriados.reduce((a, f) => a + f.bultos, 0)
      s.addText([
        { text: 'Feriados', options: { bold: true, fontSize: 13, color: 'B86A00', breakLine: true } },
        { text: cap.feriados.length ? `${cap.feriados.length} feriados medidos · ${nf(totFeriados)} bultos · ritmo ${nf(cap.feriados.length ? totFeriados / Math.max(1, cap.feriados.reduce((a, f) => a + f.horas, 0)) : 0, 1)} bult/h (todo cuenta como extra)` : 'sin feriados en el período', options: { fontSize: 10.5, color: GRIS } },
      ], { x: 8.35, y: 3.5, w: 4.35, h: 1.5, valign: 'middle' })
      // turnos
      const filasT: Fila[] = [filaHeader(['Turno', 'Personas', 'Bultos sin extras', 'Bultos en extras', '% extras', 'Ritmo jornada', 'Ritmo extras'])]
      cap.porTurno.forEach((t, i) => filasT.push(filaDatos([t.nombre, nf(t.personas), nf(t.bultosBase), nf(t.bultosExtras), `${nf(t.pctExtras, 1)}%`, nf(t.ritmoProm, 1), t.horasExtras ? nf(t.bultosExtras / t.horasExtras, 1) : '—'], i % 2 === 1)))
      s.addTable(filasT, { x: 0.45, y: 5.45, w: 12.4, colW: [1.6, 1.4, 2.1, 2.1, 1.2, 2.0, 2.0], border: { type: 'solid', pt: 0.5, color: BORDE }, rowH: 0.34, valign: 'middle', margin: 0.04 })
      notaPie(s, 'El ritmo en extras muestra el rendimiento de las horas extra: compararlo con el ritmo de jornada indica si conviene sostener la preparación con extras o redistribuir.', 7.12)
    }

    // ============ S5 · PRODUCTIVIDAD H61 ============
    {
      const s = pptx.addSlide()
      tituloSlide(s, '4', 'Productividad H61 — perfil del día, picos y valles', 'Bultos promedio por hora del día (todas las semanas del período).')
      const perfil = cap.perfilHora.filter((p) => p.bultosProm > 0)
      s.addChart(pptx.ChartType.bar, [{ name: 'Bultos promedio por hora', labels: perfil.map((p) => p.etiqueta.slice(0, 2)), values: perfil.map((p) => Math.round(p.bultosProm)) }], {
        x: 0.45, y: 1.5, w: 7.5, h: 5.2, barDir: 'col', chartColors: [VERDE], showLegend: false,
        catAxisTitle: 'Hora', valAxisTitle: 'Bultos/h', showCatAxisTitle: true, showValAxisTitle: true,
        catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, dataLabelFontSize: 8, catAxisTitleFontSize: 10, valAxisTitleFontSize: 10,
      })
      const activas = [...perfil].sort((a, b) => b.bultosProm - a.bultosProm)
      const picos = activas.slice(0, 3)
      const valles = [...activas].reverse().slice(0, 3)
      const lisPicos: PptxGenJS.TextProps[] = picos.map((p) => ({ text: `${p.etiqueta} — ${nf(p.bultosProm)} bultos/h`, options: { bullet: { characterCode: '25AA' }, color: VERDE_OSC, fontSize: 12, breakLine: true } }))
      const lisValles: PptxGenJS.TextProps[] = valles.map((p) => ({ text: `${p.etiqueta} — ${nf(p.bultosProm)} bultos/h`, options: { bullet: { characterCode: '25AA' }, color: NARANJA, fontSize: 12, breakLine: true } }))
      s.addText('Horas pico (mayor producción)', { x: 8.25, y: 1.55, w: 4.6, h: 0.35, fontSize: 13, bold: true, color: GRIS })
      s.addText(lisPicos, { x: 8.3, y: 1.95, w: 4.5, h: 1.2 })
      s.addText('Horas valle (menor producción)', { x: 8.25, y: 3.3, w: 4.6, h: 0.35, fontSize: 13, bold: true, color: GRIS })
      s.addText(lisValles, { x: 8.3, y: 3.7, w: 4.5, h: 1.2 })
      s.addText('Producción e intensidad por turno', { x: 8.25, y: 5.05, w: 4.6, h: 0.35, fontSize: 13, bold: true, color: GRIS })
      const filasT: Fila[] = [filaHeader(['Turno', 'Bultos/h'])]
      h61.porTurno.forEach((t, i) => filasT.push(filaDatos([t.nombre, nf(t.prodHora, 1)], i % 2 === 1)))
      s.addTable(filasT, { x: 8.25, y: 5.45, w: 4.6, colW: [2.6, 2.0], border: { type: 'solid', pt: 0.5, color: BORDE }, rowH: 0.32, valign: 'middle', margin: 0.04 })
      notaPie(s, 'Los picos definen la dotación mínima por franja; los valles son la ventana para reasignar personas a apros, reabastecimiento o capacitación.')
    }

    // ============ S6 · MAQUINISTAS ============
    if (!maq.vacio) {
      const s = pptx.addSlide()
      tituloSlide(s, '5', 'Maquinistas (clarkistas) — personas, tareas y horarios', 'Quién mueve la mercadería: actividades, turnos y movimientos por hora.')
      const filasA: Fila[] = [filaHeader(['Actividad', 'Personas/día', 'Operarios', 'Movimientos'])]
      maq.porActividad.slice(0, 8).forEach((a, i) => filasA.push(filaDatos([a.actividad, nf(a.personasPromDia, 1), a.operarios, nf(a.movimientos)], i % 2 === 1)))
      s.addTable(filasA, { x: 0.45, y: 1.5, w: 5.9, colW: [2.4, 1.3, 1.0, 1.2], border: { type: 'solid', pt: 0.5, color: BORDE }, rowH: 0.33, valign: 'middle', margin: 0.04 })
      const NOM: Record<string, string> = { M: 'TM (6 a 14)', T: 'TT (14 a 22)', N: 'TN (23 a 06)', '?': 'Sin turno' }
      const filasT: Fila[] = [filaHeader(['Turno', 'Personas/día', 'Apros', 'Homog.'])]
      maq.porTurno.forEach((t, i) => filasT.push(filaDatos([NOM[t.turno] ?? t.turno, nf(t.personasPromDia, 1), nf(t.personasPromApros, 1), nf(t.personasPromHom, 1)], i % 2 === 1)))
      s.addTable(filasT, { x: 0.45, y: 4.75, w: 5.9, colW: [1.9, 1.4, 1.3, 1.3], border: { type: 'solid', pt: 0.5, color: BORDE }, rowH: 0.33, valign: 'middle', margin: 0.04 })
      const horasConMov = maq.porHora.filter((p) => p.total > 0)
      s.addChart(pptx.ChartType.bar, [{ name: 'Movimientos promedio por día', labels: horasConMov.map((p) => p.etiqueta.slice(0, 2)), values: horasConMov.map((p) => Math.round(p.total)) }], {
        x: 6.65, y: 1.5, w: 6.2, h: 3.4, barDir: 'col', chartColors: [VERDE], showLegend: false,
        catAxisTitle: 'Hora', valAxisTitle: 'Movimientos', showCatAxisTitle: true, showValAxisTitle: true, catAxisLabelFontSize: 8, valAxisLabelFontSize: 9,
      })
      // cruce con espera de piking
      const esperaHora = tm.porHoraEsperaPiking.map((h) => h.minutos)
      const movHora = maq.porHora.map((p) => p.total)
      const r = pearson(movHora, esperaHora)
      const union = maq.porHora.map((p, idx) => ({ etiqueta: p.etiqueta, mov: p.total, esp: tm.porHoraEsperaPiking[idx]?.minutos ?? 0 })).filter((x) => x.mov > 0 || x.esp > 0)
      const topMov = [...union].sort((a, b) => b.mov - a.mov).slice(0, 3)
      const topEsp = [...union].sort((a, b) => b.esp - a.esp).slice(0, 3)
      const coinciden = topMov.filter((m) => topEsp.some((e) => e.etiqueta === m.etiqueta)).length
      s.addShape('roundRect', { x: 6.65, y: 5.15, w: 6.2, h: 1.75, rectRadius: 0.06, fill: { color: VERDE_BG }, line: { color: VERDE, width: 1 } })
      s.addText([
        { text: 'Cruce con la espera de piking', options: { bold: true, fontSize: 12, color: VERDE_OSC, breakLine: true } },
        { text: `Correlación movimientos ↔ espera: ${r != null ? nf(r, 2) : '—'}. Horas de mayor movimiento: ${topMov.map((m) => m.etiqueta.slice(0, 2)).join(', ')}. Horas de mayor espera: ${topEsp.map((m) => m.etiqueta.slice(0, 2)).join(', ')}. Coinciden ${coinciden} de 3: la dotación de apros de esas franjas es la palanca directa para reducir la espera de piking.`, options: { fontSize: 10.5, color: GRIS } },
      ], { x: 6.85, y: 5.25, w: 5.85, h: 1.55, valign: 'middle' })
      notaPie(s, 'Los movimientos por hora alimentan directamente el análisis de la espera de piking: alinear la dotación de clarks con las franjas de mayor demanda de apros.', 7.12)
    }

    // ============ S7 · TIEMPOS MUERTOS ============
    {
      const s = pptx.addSlide()
      tituloSlide(s, '6', 'Tiempos muertos — dónde y cuándo se pierde el tiempo', 'Categorías unificadas: la espera de piking incluye lo cargado como espera de ubicación y apro (son lo mismo).')
      const esperaCat = tm.porCategoria.find((c) => c.categoria === 'ESPERA PICKING')
      s.addText([
        { text: `${nf(tm.totalMin / 60)} h`, options: { fontSize: 26, bold: true, color: GRIS, breakLine: true } },
        { text: 'tiempo muerto total informado', options: { fontSize: 10, color: '8A8A8A' } },
      ], { x: 0.45, y: 1.5, w: 2.6, h: 1.2, align: 'center', valign: 'middle', fill: { color: GRIS_CLARO }, line: { color: BORDE, width: 1 } })
      const filas: Fila[] = [filaHeader(['Categoría', 'Horas', '% del total', '% acum.'])]
      let acum = 0
      tm.porCategoria.slice(0, 8).forEach((c, i) => {
        acum += c.pct
        filas.push(filaDatos([c.categoria, nf(c.minutos / 60, 1), `${nf(c.pct, 1)}%`, `${nf(acum, 1)}%`], i % 2 === 1))
      })
      s.addTable(filas, { x: 3.25, y: 1.5, w: 5.6, colW: [2.6, 1.0, 1.0, 1.0], border: { type: 'solid', pt: 0.5, color: BORDE }, rowH: 0.34, valign: 'middle', margin: 0.04 })
      s.addChart(pptx.ChartType.line, [{ name: 'Espera de piking por hora (min)', labels: tm.porHoraEsperaPiking.map((h) => h.hora), values: tm.porHoraEsperaPiking.map((h) => Math.round(h.minutos)) }], {
        x: 0.45, y: 4.0, w: 8.4, h: 2.85, chartColors: [ROJO], showLegend: false, lineSize: 2.5, lineSmooth: true,
        catAxisTitle: 'Hora del día', valAxisTitle: 'Minutos', showCatAxisTitle: true, showValAxisTitle: true, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9,
      })
      const topNaves = tm.porNave.slice(0, 5)
      const filasN: Fila[] = [filaHeader(['Nave', 'Horas espera', 'Pasillos con más espera'])]
      topNaves.forEach((nv, i) => filasN.push(filaDatos([nv.nave, nf(nv.minutos / 60, 1), nv.pasillos.slice(0, 3).map((p) => `${p.pasillo} (${Math.round(p.minutos)}′)`).join(', ')], i % 2 === 1, { fontSize: 9, align: 'left' })))
      s.addTable(filasN, { x: 9.15, y: 1.5, w: 3.7, colW: [0.9, 1.0, 1.8], border: { type: 'solid', pt: 0.5, color: BORDE }, rowH: 0.4, valign: 'middle', margin: 0.04 })
      s.addText(esperaCat ? [
        { text: 'Espera de piking', options: { bold: true, fontSize: 12, color: ROJO, breakLine: true } },
        { text: `${nf(esperaCat.minutos / 60)} h — ${nf(esperaCat.pct, 1)}% del tiempo muerto (motivo n° 1)`, options: { fontSize: 10, color: GRIS } },
      ] : [{ text: 'Sin datos de espera de piking', options: { fontSize: 10, color: GRIS } }], { x: 9.15, y: 4.4, w: 3.7, h: 1.2, fill: { color: 'FDECEC' }, line: { color: ROJO, width: 1 }, valign: 'middle', margin: 4 })
      notaPie(s, 'La espera de piking por hora es el insumo para repartir la dotación de apros: concentrar clarks en las franjas rojas del gráfico reduce el tiempo perdido.')
    }

    // ============ S8 · E-8 ============
    if (!picking.vacio && picking.registros > 0) {
      const s = pptx.addSlide()
      tituloSlide(s, '7', 'E-8 — tiempo muerto entre piking', `Grano ${picking.grano === 'resumen' ? 'resumen por colaborador' : 'log evento a evento'} · ${picking.desde} a ${picking.hasta} · ${nf(picking.operarios)} colaboradores`)
      const promE = picking.grano === 'resumen' ? picking.muertoBloques.promedio : picking.gapPromedio
      const medE = picking.grano === 'resumen' ? picking.muertoBloques.mediana : picking.gapMediana
      kpiCard(s, 0.45, 1.5, 3.0, 1.9, `${nf(promE, 1)} min`, 'Promedio por bloque', picking.grano === 'resumen' ? 'colaborador × día × turno' : 'entre eventos consecutivos', NARANJA)
      kpiCard(s, 3.65, 1.5, 3.0, 1.9, `${nf(medE, 1)} min`, 'Mediana', 'el caso típico, sin extremos', NARANJA)
      kpiCard(s, 6.85, 1.5, 3.0, 1.9, `${nf(picking.tiempos.pctMuerto, 1)}%`, 'de la jornada', `${nf(picking.tiempos.horasMuerto)} h muertas de ${nf(picking.tiempos.horasTotal)} h`, ROJO)
      kpiCard(s, 10.05, 1.5, 2.85, 1.9, nf(picking.bultos), 'Bultos del período', picking.productividad.neta ? `neta ${nf(picking.productividad.neta, 1)} · superNeta ${nf(picking.productividad.superNeta, 1)} bult/h` : '', VERDE_OSC)
      if (picking.muertoPorTurno.length) {
        const filasT: Fila[] = [filaHeader(['Turno', 'Minutos muertos', 'Promedio/bloque'])]
        picking.muertoPorTurno.forEach((t, i) => filasT.push(filaDatos([t.nombre, nf(t.minutosMuerto), nf(t.promedio, 1)], i % 2 === 1)))
        s.addTable(filasT, { x: 0.45, y: 3.85, w: 6.1, colW: [2.3, 2.0, 1.8], border: { type: 'solid', pt: 0.5, color: BORDE }, rowH: 0.36, valign: 'middle', margin: 0.04 })
      }
      if (picking.muertoPorSector.length) {
        const filasS: Fila[] = [filaHeader(['Sector (nave)', 'Muerto', '% de su jornada'])]
        picking.muertoPorSector.slice(0, 6).forEach((x, i) => filasS.push(filaDatos([x.sector, nf(x.minutosMuerto), x.pctJornada ? `${nf(x.pctJornada, 1)}%` : '—'], i % 2 === 1)))
        s.addTable(filasS, { x: 6.85, y: 3.85, w: 6.05, colW: [2.5, 1.7, 1.85], border: { type: 'solid', pt: 0.5, color: BORDE }, rowH: 0.36, valign: 'middle', margin: 0.04 })
      }
      notaPie(s, 'Este es el tiempo que la persona pasa sin preparar: reducirlo es la vía directa para aumentar la productividad sin sumar dotación.', 7.12)
    }

    // ============ S9 · MODELO DE PLANIFICACIÓN ============
    {
      const s = pptx.addSlide()
      tituloSlide(s, '8', 'Modelo de planificación — planificar con una meta de productividad', 'El modelo no mantiene la productividad actual: la usa como punto de partida y exige una mejora.')
      s.addShape('roundRect', { x: 0.45, y: 1.45, w: 12.4, h: 1.35, rectRadius: 0.06, fill: { color: VERDE_BG }, line: { color: VERDE, width: 1 } })
      const ritmoBase = plan.h61.ritmoBase
      const metaPct = 10
      const ritmoMeta = ritmoBase != null ? ritmoBase * (1 + metaPct / 100) : null
      const techo = plan.picking?.prodNeta ?? null
      s.addText([
        { text: `Partiendo del ritmo medido ${nf(ritmoBase, 1)} bultos/h, con una meta de mejora de +${metaPct}% se planifica con ${nf(ritmoMeta, 1)} bultos/h`, options: { fontSize: 13, bold: true, color: VERDE_OSC, breakLine: true } },
        { text: `personas = demanda ÷ (ritmo meta × horas útiles por persona). Horas útiles = jornada 8 h × ${(100 - 10)}% de cobertura. Techo operativo E-8 (neta): ${techo != null ? `${nf(techo, 1)} bult/h` : 'sin datos'}.`, options: { fontSize: 11, color: GRIS } },
      ], { x: 0.7, y: 1.55, w: 11.9, h: 1.15, valign: 'middle' })
      const factor = 0.9 * 8
      const filas: Fila[] = [filaHeader(['Día', 'Demanda prom.', `Personas con ritmo actual (${nf(ritmoBase, 1)})`, `Personas con la meta (+${metaPct}%)`, 'Ahorro'])]
      let totHoy = 0, totMeta = 0
      plan.porDiaSemana.forEach((d, i) => {
        const hoy = ritmoBase != null && ritmoBase > 0 ? Math.ceil(d.totalProm / (ritmoBase * factor)) : 0
        const conMeta = ritmoMeta != null ? Math.ceil(d.totalProm / (ritmoMeta * factor)) : 0
        totHoy += hoy; totMeta += conMeta
        filas.push(filaDatos([d.dia, nf(d.totalProm), hoy, conMeta, hoy - conMeta > 0 ? `−${hoy - conMeta}` : '—'], i % 2 === 1))
      })
      filas.push(filaDatos(['Semana', '', totHoy, totMeta, `−${totHoy - totMeta}`], false, { bold: true, fill: { color: VERDE_BG }, color: VERDE_OSC }))
      s.addTable(filas, { x: 0.45, y: 3.05, w: 12.4, colW: [1.3, 2.4, 3.3, 3.3, 2.1], border: { type: 'solid', pt: 0.5, color: BORDE }, rowH: 0.36, valign: 'middle', margin: 0.04 })
      s.addChart(pptx.ChartType.bar, [
        { name: 'Personas con ritmo actual', labels: plan.porDiaSemana.map((d) => d.dia.slice(0, 3)), values: plan.porDiaSemana.map((d) => (ritmoBase != null && ritmoBase > 0 ? Math.ceil(d.totalProm / (ritmoBase * factor)) : 0)) },
        { name: `Personas con la meta (+${metaPct}%)`, labels: plan.porDiaSemana.map((d) => d.dia.slice(0, 3)), values: plan.porDiaSemana.map((d) => (ritmoMeta != null ? Math.ceil(d.totalProm / (ritmoMeta * factor)) : 0)) },
      ], {
        x: 0.45, y: 5.15, w: 12.4, h: 1.85, barDir: 'col', chartColors: [GRIS, VERDE], showLegend: true, legendPos: 't', legendFontSize: 10,
        catAxisLabelFontSize: 10, valAxisLabelFontSize: 9, barGapWidthPct: 60,
      })
      notaPie(s, 'El ahorro de personas-turno es el resultado de la mejora de productividad: permite cubrir más demanda, reducir horas extra o liberar horas de preparación.', 7.12)
    }

    // ============ S10 · DIAGNÓSTICO — FOCOS DE MEJORA ============
    {
      const s = pptx.addSlide()
      tituloSlide(s, '9', 'Diagnóstico — hallazgos y focos de mejora', 'Qué dicen los datos del período y dónde conviene atacar primero.')
      const esperaCat = tm.porCategoria.find((c) => c.categoria === 'ESPERA PICKING')
      const esperaH = esperaCat ? esperaCat.minutos / 60 : 0
      const topHoras = [...tm.porHoraEsperaPiking].sort((a, b) => b.minutos - a.minutos).slice(0, 3)
      const topNaves = tm.porNave.slice(0, 2)
      const muertosSector = picking.vacio ? [] : picking.muertoPorSector ?? []
      const xd = muertosSector.find((x) => x.sector.toUpperCase().includes('XD'))
      const tnR = cap.porTurno.find((t) => t.turno === 'N')?.ritmoProm ?? null
      const ttR = cap.porTurno.find((t) => t.turno === 'T')?.ritmoProm ?? null
      const sab = cap.sabadosResumen
      const extrasPct = cap.resumen?.pctExtras ?? null
      const extrasH = cap.resumen?.horasExtras ?? 0
      const hallazgos: [string, string, string][] = []
      hallazgos.push([
        '1 · Espera de piking: motivo n° 1 de tiempo muerto',
        `${nf(esperaH)} h (${esperaCat ? nf(esperaCat.pct, 1) : '—'}% del muerto)`,
        'Es el foco con mayor retorno: se recupera con reabastecimiento preventivo y apros en las horas valle',
      ])
      if (topHoras.length) {
        hallazgos.push([
          '2 · La espera se concentra en horas concretas',
          topHoras.map((h) => `${h.etiqueta} (${nf(h.minutos / 60, 1)} h)`).join(' · '),
          'Hay ventanas específicas para atacar: reforzar reposición justo antes de esos picos',
        ])
      }
      if (topNaves.length) {
        hallazgos.push([
          '3 · Naves con más espera de piking',
          topNaves.map((nv) => `Nave ${nv.nave} (${nf(nv.minutos / 60, 1)} h)`).join(' · '),
          'Revisar lotización y ubicaciones de alta rotación en esas naves',
        ])
      }
      if (xd && xd.pctJornada != null) {
        hallazgos.push([
          '4 · Circuito XD anómalo (E-8)',
          `${nf(xd.pctJornada, 1)}% de su jornada es tiempo muerto`,
          '2 de cada 3 horas no producen: auditar medición, asignación y mix del circuito',
        ])
      }
      if (sab) {
        hallazgos.push([
          '5 · Sábados con extras estructurales',
          `${nf(sab.acotadas)} de ${nf(sab.total)} sábados con dotación acotada · ritmo ${nf(sab.ritmo, 1)} bult/h`,
          'Política: cerrar sábados y abrir solo cada 15 días cuando hay que cumplir la pendiente',
        ])
      }
      if (tnR != null && ttR != null) {
        hallazgos.push([
          '6 · Turno noche con ritmo más bajo',
          `TN ${nf(tnR, 1)} vs TT ${nf(ttR, 1)} bult/h (brecha ${nf(((ttR - tnR) / ttR) * 100, 1)}%)`,
          'Prearmado nocturno, sincronizar apros y capacitación específica del turno',
        ])
      }
      if (extrasPct != null) {
        hallazgos.push([
          '7 · Horas extra: caras y sostenidas',
          `${nf(extrasPct, 1)}% de los bultos se prepara en extra · ${nf(extrasH)} h extra del período`,
          'La meta de productividad (+10%) permite absorber esa demanda dentro de la jornada',
        ])
      }
      const filasDiag: Fila[] = [filaHeader(['Hallazgo', 'Dato', 'Implicancia'])]
      hallazgos.forEach((hh, i) => filasDiag.push(filaDatos(hh, i % 2 === 1)))
      s.addTable(filasDiag, { x: 0.45, y: 1.4, w: 12.4, colW: [3.9, 3.4, 5.1], border: { type: 'solid', pt: 0.5, color: BORDE }, rowH: 0.62, valign: 'middle', margin: 0.05, fontSize: 10 })
      notaPie(s, 'Fuente: H61, Tiempos muertos, E-8, Maquinistas y Ola del período. Los focos están ordenados por impacto sobre la productividad y el costo operativo.', 7.15)
    }

    // ============ S11 · PLAN DE ACCIÓN ============
    {
      const s = pptx.addSlide()
      tituloSlide(s, '10', 'Plan de acción — medidas concretas', 'Cada acción con su métrica objetivo, impacto estimado y plazo.')
      const esperaCat = tm.porCategoria.find((c) => c.categoria === 'ESPERA PICKING')
      const esperaH = esperaCat ? esperaCat.minutos / 60 : 0
      const muertosSector = picking.vacio ? [] : picking.muertoPorSector ?? []
      const xd = muertosSector.find((x) => x.sector.toUpperCase().includes('XD'))
      const extrasH = cap.resumen?.horasExtras ?? 0
      const acciones: [string, string, string, string][] = [
        [
          'A1 · Reabastecimiento preventivo en las horas de mayor espera de piking (reposición adelantada según el mapa de calor horario)',
          `Espera de piking −50% (≈ −${nf(esperaH / 2)} h del período)`,
          '≈ 6 personas-turno recuperadas por mes para preparar',
          '30 días',
        ],
        [
          'A2 · Mover apros de maquinistas a las franjas valle detectadas en el cruce movimientos × espera (ya medido en el Resumen)',
          'Movimientos de apro en horas pico de espera +30%',
          'Menos pasillos bloqueados: menos espera de piking',
          '15 días',
        ],
        [
          'A3 · Auditar el circuito XD: medición, asignación de personas y mix (hoy la mayor parte de su jornada es tiempo muerto)',
          xd ? `XD: tiempo muerto de ${nf(xd.pctJornada, 1)}% a menos de 25%` : 'XD: tiempo muerto < 25%',
          xd ? `≈ ${nf((xd.minutosTotal / 60) * 0.4, 1)} h productivas recuperadas` : 'Horas productivas recuperadas',
          '15 días',
        ],
        [
          'A4 · Política de sábados: cerrados por defecto, abrir solo cada 15 días cuando la pendiente acumulada lo exige (Planificación Diaria)',
          'Bultos en extras de sábado → 0 salvo sábados autorizados',
          `Reduce las ${nf(extrasH)} h extra del período`,
          'Inmediato',
        ],
        [
          'A5 · Plan de ritmo para el TN: prearmado nocturno, apros sincronizados y capacitación (hoy es el turno más lento)',
          'TN: cerrar la brecha con el TT (objetivo +10% de ritmo)',
          'Menos dotación nocturna para la misma demanda',
          '60 días',
        ],
        [
          'A6 · Planificar la ola día por día con la meta de productividad (+5/+10/+15/+20%) en la pestaña Planificación Diaria, verificando el tope de 90 máquinas (100 de tope)',
          'Personas-turno −10% para la misma ola',
          'La misma dotación cubre más demanda sin abrir sábados',
          'Continuo',
        ],
      ]
      const filasAcc: Fila[] = [filaHeader(['Acción', 'Métrica objetivo', 'Impacto estimado', 'Plazo'])]
      acciones.forEach((a, i) => filasAcc.push(filaDatos(a, i % 2 === 1)))
      s.addTable(filasAcc, { x: 0.45, y: 1.4, w: 12.4, colW: [5.4, 3.1, 2.5, 1.4], border: { type: 'solid', pt: 0.5, color: BORDE }, rowH: 0.78, valign: 'middle', margin: 0.05, fontSize: 10 })
      notaPie(s, 'Seguimiento sugerido: revisar semanalmente la espera de piking y el ritmo por turno en el Resumen; la Planificación Diaria se actualiza con cada carga de datos.', 7.15)
    }

    // devolver el archivo
    const buf = (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="Informe_Preparacion_CD_${fechaHoy}.pptx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('informe pptx error', e)
    return NextResponse.json({
      error: e instanceof Error ? e.message : 'error generando informe',
      stack: e instanceof Error ? e.stack?.split('\n').slice(0, 8).join(' | ') : String(e),
    }, { status: 500 })
  }
}
