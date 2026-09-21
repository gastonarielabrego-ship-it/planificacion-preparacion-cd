'use client'

// Sección MAQUINISTAS del resumen: personas por actividad, personas por tarea y
// actividad, distribución por turno, detalle de movimientos por mes por persona
// (foco apros), mapa de calor de los apros por actividad, cruce con los tiempos
// muertos (¿los movimientos coinciden con la espera de piking?) y movimientos por horario.

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Forklift, Users, ArrowRightLeft, Layers3, CalendarClock, Timer, Activity } from 'lucide-react'
import { Kpi, SinDatos } from '../kpi'
import { fetchDatos, n, n1, COLORES } from '@/lib/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ComposedChart, Line, Area } from 'recharts'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TituloSeccion, MapaCalor, mediana } from './comun'

interface FilaAct { actividad: string; codigo: string; operarios: number; personasPromDia: number | null; dias: number; movimientos: number; bultos: number; horas: number }
interface MaqData {
  registros: number
  vacio?: boolean
  desde?: string
  hasta?: string
  meses?: number
  operarios?: number
  dias?: number
  personasPromDia?: number | null
  movimientos?: number
  bultos?: number
  horasHombre?: number
  porActividad?: FilaAct[]
  porTurno?: {
    turno: string
    personasPromDia: number | null
    operarios: number
    movimientos: number
    bultos: number
    porActividad: { actividad: string; personasProm: number | null; operarios: number }[]
    personasPromApros?: number | null
    personasPromHom?: number | null
    porTareaActividad?: { tarea: string; actividad: string; codigo: string; personasPromDia: number | null; operarios: number; movimientos: number }[]
  }[]
  porHora?: { hora: number; etiqueta: string; total: number; M: number; T: number; N: number }[]
  horaPico?: { hora: number; movimientos: number; promDia: number } | null
  tieneHorario?: boolean
  movPorPersonaMes?: { operario: string; nombre: string; mes: string; apros: number; homogeneos: number; total: number; bultos: number }[]
  calorApros?: { meses: string[]; actividades: string[]; celdas: { mes: string; actividad: string; mov: number; personas: number }[] }
  tareas?: {
    conDatos: boolean
    movApros: number
    movHom: number
    operariosApros: number
    operariosHom: number
    personasPromApros: number | null
    personasPromHom: number | null
    porActividad: { tarea: string; actividad: string; codigo: string; personasPromDia: number | null; operarios: number; dias: number; movimientos: number }[]
  }
}
interface TMData {
  registros: number
  porHoraEsperaPiking?: { hora: number; etiqueta: string; minutos: number }[]
}

const TURNO_LABEL: Record<string, string> = { M: 'Mañana (6-14)', T: 'Tarde (14-22)', N: 'Noche (23-6)', '?': 'Sin turno' }
const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const etiquetaMes = (ym: string) => `${MESES_ABR[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(2, 4)}`
const TURNO_COLOR: Record<string, string> = { M: '#059669', T: '#d97706', N: '#7c3aed' }

export function MaquinistasSeccion() {
  const { data, isLoading } = useQuery({ queryKey: ['maq'], queryFn: () => fetchDatos<MaqData>('maq') })
  const { data: tmData } = useQuery({ queryKey: ['tm', 'cruce'], queryFn: () => fetchDatos<TMData>('tm') })
  const [mesSel, setMesSel] = useState<string>('todos')

  const mesesDisp = useMemo(() => [...new Set((data?.movPorPersonaMes ?? []).map((p) => p.mes))].sort(), [data])

  const detallePersona = useMemo(() => {
    const base = data?.movPorPersonaMes ?? []
    const filtrado = mesSel === 'todos' ? base : base.filter((p) => p.mes === mesSel)
    // una fila por persona: suma de los meses visibles, con el detalle por mes dentro
    const porOp = new Map<string, { operario: string; nombre: string; apros: number; homogeneos: number; total: number; bultos: number; meses: number; detalle: { mes: string; apros: number; total: number }[] }>()
    for (const p of filtrado) {
      let f = porOp.get(p.operario)
      if (!f) { f = { operario: p.operario, nombre: p.nombre, apros: 0, homogeneos: 0, total: 0, bultos: 0, meses: 0, detalle: [] }; porOp.set(p.operario, f) }
      f.apros += p.apros
      f.homogeneos += p.homogeneos
      f.total += p.total
      f.bultos += p.bultos
      f.meses += 1
      f.detalle.push({ mes: p.mes, apros: p.apros, total: p.total })
    }
    return [...porOp.values()].sort((a, b) => b.apros - a.apros || b.total - a.total)
  }, [data, mesSel])

  // cruce por hora: movimientos de clark (promedio por día) vs minutos de espera de piking
  const cruce = useMemo(() => {
    if (!data?.porHora || !tmData?.porHoraEsperaPiking) return null
    const esp = new Map(tmData.porHoraEsperaPiking.map((e) => [e.hora, e.minutos]))
    const filas = data.porHora.map((p) => ({
      etiqueta: p.etiqueta,
      movimientos: p.total,
      esperaMin: Math.round((esp.get(p.hora) ?? 0) / 60),
    }))
    const horasActivas = filas.filter((f) => f.movimientos > 0)
    if (!horasActivas.length) return null
    const promMov = horasActivas.reduce((a, f) => a + f.movimientos, 0) / horasActivas.length
    const promEsp = filas.reduce((a, f) => a + f.esperaMin, 0) / Math.max(1, filas.filter((f) => f.esperaMin > 0).length)
    // correlación simple sobre las horas con datos en ambas series
    const pares = filas.filter((f) => f.movimientos > 0 && f.esperaMin > 0)
    let corr: number | null = null
    if (pares.length >= 3) {
      const mx = pares.reduce((a, p) => a + p.movimientos, 0) / pares.length
      const my = pares.reduce((a, p) => a + p.esperaMin, 0) / pares.length
      const num = pares.reduce((a, p) => a + (p.movimientos - mx) * (p.esperaMin - my), 0)
      const dx = Math.sqrt(pares.reduce((a, p) => a + (p.movimientos - mx) ** 2, 0))
      const dy = Math.sqrt(pares.reduce((a, p) => a + (p.esperaMin - my) ** 2, 0))
      corr = dx > 0 && dy > 0 ? +(num / (dx * dy)).toFixed(2) : null
    }
    const topMov = [...filas].sort((a, b) => b.movimientos - a.movimientos).slice(0, 3)
    const topEsp = [...filas].sort((a, b) => b.esperaMin - a.esperaMin).slice(0, 3)
    return { filas, promMov, promEsp, corr, topMov, topEsp, hayEspera: tmData.porHoraEsperaPiking.some((e) => e.minutos > 0) }
  }, [data, tmData])

  if (isLoading) return <div className="grid gap-3 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
  if (!data || data.vacio) return <SinDatos mensaje="Cargá el archivo 'h61 maquinista.xlsx' (H61 de clarkistas) para ver las personas por actividad y turno." />

  const acts = data.porActividad ?? []
  const turnos = data.porTurno ?? []
  const tareas = data.tareas
  const calor = data.calorApros
  const maxApros = Math.max(1, ...(calor?.celdas ?? []).map((c) => c.mov))

  return (
    <div className="space-y-4">
      <TituloSeccion icono={Forklift} id="sec-maq" titulo="Maquinistas (H61 de clarkistas): personas por actividad y turno" descripcion="Cuántas personas hacen cada actividad y cada tarea (apros / homogéneos), cómo se distribuyen por turno, dónde se concentran los movimientos de aprontamiento y cómo coinciden con las esperas de piking." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Personas por día" valor={data.personasPromDia ?? 0} formato="decimal" unidad="pers/día" icono={Users} detalle={`${data.operarios} operarios · ${data.dias} días`} />
        <Kpi titulo="Movimientos de clark" valor={data.movimientos} unidad="mov." icono={ArrowRightLeft} detalle={`${data.horaPico ? `hora pico ${String(data.horaPico.hora).padStart(2, '0')}h` : 'sin perfil horario'}`} />
        {tareas?.conDatos && (
          <Kpi titulo="Personas haciendo apros" valor={tareas.personasPromApros ?? 0} formato="decimal" unidad="pers/día" icono={Layers3} tono="exito" detalle={`${tareas.operariosApros} operarios · ${n(tareas.movApros)} movimientos de aprontamiento`} />
        )}
        {tareas?.conDatos && (
          <Kpi titulo="Personas en homogéneos" valor={tareas.personasPromHom ?? 0} formato="decimal" unidad="pers/día" icono={Layers3} tono="atencion" detalle={`${tareas.operariosHom} operarios · ${n(tareas.movHom)} movimientos de homogeneización`} />
        )}
      </div>

      {/* Personas por actividad + tarea por actividad */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm font-semibold mb-1">Personas por actividad</p>
          <p className="text-xs text-muted-foreground mb-2">Promedio de personas por día asignadas a cada actividad y movimientos que realizan.</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={acts} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="actividad" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="p" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="m" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="p" dataKey="personasPromDia" name="Personas/día" fill="#76B41E" radius={[3, 3, 0, 0]} />
              <Bar yAxisId="m" dataKey="movimientos" name="Movimientos" fill="#E09020" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm font-semibold mb-1">Personas por tarea y actividad (apros / homogéneos)</p>
          <p className="text-xs text-muted-foreground mb-2">En cada actividad, cuántas personas por día hacen aprontamiento y cuántas homogeneización.</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarea</TableHead>
                <TableHead>Actividad</TableHead>
                <TableHead className="text-right">Pers/día</TableHead>
                <TableHead className="text-right">Operarios</TableHead>
                <TableHead className="text-right">Movimientos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(tareas?.porActividad ?? []).map((t, i) => (
                <TableRow key={`${t.tarea}-${t.actividad}`}>
                  <TableCell>
                    <Badge variant="outline" className={t.tarea === 'apros' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}>
                      {t.tarea === 'apros' ? 'Apros' : 'Homogéneos'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{t.actividad}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{n1(t.personasPromDia)}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.operarios}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(t.movimientos)}</TableCell>
                </TableRow>
              ))}
              {!tareas?.conDatos && (
                <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">El archivo no trae las columnas de tareas (aprontamiento / homogeneización).</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Distribución por turno */}
      <div className="bg-white rounded-xl border p-4">
        <p className="text-sm font-semibold mb-1">Distribución por turno</p>
        <p className="text-xs text-muted-foreground mb-3">Personas por día de cada turno, con el desglose de cuántas hacen apros y cuántas homogéneos y en qué actividad están.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {turnos.map((t) => (
            <div key={t.turno} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold" style={{ color: TURNO_COLOR[t.turno] ?? undefined }}>{TURNO_LABEL[t.turno] ?? t.turno}</p>
                <span className="text-xs text-muted-foreground tabular-nums">{n1(t.personasPromDia)} pers/día</span>
              </div>
              {t.porTareaActividad && t.porTareaActividad.length > 0 ? (
                <div className="space-y-1.5">
                  {['apros', 'homogeneos'].map((tarea) => {
                    const filas = t.porTareaActividad!.filter((x) => x.tarea === tarea && (x.personasPromDia ?? 0) > 0)
                    if (!filas.length) return null
                    return (
                      <div key={tarea} className="text-[11px] leading-relaxed">
                        <Badge variant="outline" className={`mr-1 text-[10px] ${tarea === 'apros' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                          {tarea === 'apros' ? 'Apros' : 'Homog.'}
                        </Badge>
                        {filas.map((x) => <span key={x.actividad} className="mr-2 whitespace-nowrap"><b>{n1(x.personasPromDia)}</b> en {x.actividad}</span>)}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground space-y-0.5">
                  {t.porActividad.map((a) => <p key={a.actividad}><b className="text-foreground">{n1(a.personasProm)}</b> en {a.actividad}</p>)}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground border-t pt-1.5">{n(t.movimientos)} movimientos · {n(t.bultos)} bultos</p>
            </div>
          ))}
        </div>
      </div>

      {/* Movimientos por horario */}
      {data.tieneHorario && (
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm font-semibold mb-1 flex items-center gap-1.5"><CalendarClock className="h-4 w-4 text-emerald-700" /> Movimientos por horario</p>
          <p className="text-xs text-muted-foreground mb-2">Movimientos promedio de clark por hora del día, apilados por turno. La línea marca el total.</p>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data.porHora} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="etiqueta" tick={{ fontSize: 9 }} interval={1} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => n1(v)} labelFormatter={(l) => `Hora ${l}`} />
              <Legend />
              <Bar dataKey="M" name="Mañana" stackId="h" fill={TURNO_COLOR.M} />
              <Bar dataKey="T" name="Tarde" stackId="h" fill={TURNO_COLOR.T} />
              <Bar dataKey="N" name="Noche" stackId="h" fill={TURNO_COLOR.N} radius={[3, 3, 0, 0]} />
              <Line dataKey="total" name="Total mov/día" stroke="#54565A" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Cruce con tiempos muertos */}
      {cruce && cruce.hayEspera && (
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm font-semibold mb-1 flex items-center gap-1.5"><Activity className="h-4 w-4 text-emerald-700" /> Cruce con tiempos muertos: ¿los movimientos coinciden con la espera de piking?</p>
          <p className="text-xs text-muted-foreground mb-2">Movimientos de clark por hora del día (barras) contra minutos de <b>Espera de piking</b> informados en esa hora (área, horas-hombre). Si los picos coinciden, los clarks saturan justo cuando el picking queda esperando.</p>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={cruce.filas} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="etiqueta" tick={{ fontSize: 9 }} interval={1} />
              <YAxis yAxisId="m" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="e" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number, name: string) => (name === 'Espera de piking (h)' ? [`${n1(v)} h`, name] : [n1(v), name])} labelFormatter={(l) => `Hora ${l}`} />
              <Legend />
              <Bar yAxisId="m" dataKey="movimientos" name="Movimientos de clark/día" fill="#76B41E" fillOpacity={0.8} radius={[3, 3, 0, 0]} />
              <Area yAxisId="e" dataKey="esperaMin" name="Espera de piking (h)" stroke="#dc2626" fill="#dc2626" fillOpacity={0.15} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted-foreground mt-2">
            <b>Horas de mayor movimiento:</b> {cruce.topMov.map((f) => `${f.etiqueta} (${n1(f.movimientos)})`).join(' · ')} &nbsp;|&nbsp;
            <b> Horas de mayor espera de piking:</b> {cruce.topEsp.filter((f) => f.esperaMin > 0).map((f) => `${f.etiqueta} (${n1(f.esperaMin)} h)`).join(' · ') || '—'}
            {cruce.corr != null && <> &nbsp;|&nbsp; <b>Co-movimiento:</b> {cruce.corr >= 0.5 ? 'alto' : cruce.corr >= 0.2 ? 'moderado' : 'bajo'} (r = {n1(cruce.corr)})</>}
          </p>
        </div>
      )}

      {/* Mapa de calor de apros por actividad */}
      {calor && calor.celdas.length > 0 && (
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm font-semibold mb-1">Mapa de calor: movimientos de apros por actividad</p>
          <p className="text-xs text-muted-foreground mb-2">Movimientos de aprontamiento de cada mes según la actividad en que se hicieron (verde más intenso = más concentración de apros).</p>
          <MapaCalor
            filas={calor.meses.map((m) => ({ clave: m, etiqueta: etiquetaMes(m) }))}
            columnas={calor.actividades.map((a) => ({ clave: a, etiqueta: a.replace('Actividad', 'Act.') }))}
            valor={(fila, col) => calor.celdas.find((c) => c.mes === fila && c.actividad === col)?.mov ?? 0}
            formato={(v) => n(v)}
            tituloCelda={(fila, col) => {
              const c = calor.celdas.find((x) => x.mes === fila && x.actividad === col)
              return c ? `${etiquetaMes(fila)} · ${col}: ${n(c.mov)} movimientos de apros (${c.personas} personas)` : ''
            }}
          />
        </div>
      )}

      {/* Detalle movimientos por mes por persona (foco apros) */}
      {detallePersona.length > 0 && (
        <div className="bg-white rounded-xl border">
          <div className="px-4 pt-4 pb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Detalle: movimientos por mes por persona (foco en apros)</p>
              <p className="text-xs text-muted-foreground">Personas ordenadas por movimientos de aprontamiento. {mesSel === 'todos' ? 'Vista acumulada de todos los meses' : `Mes ${etiquetaMes(mesSel)}`} · top {Math.min(detallePersona.length, 50)}.</p>
            </div>
            <Select value={mesSel} onValueChange={setMesSel}>
              <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los meses</SelectItem>
                {[...mesesDisp].reverse().map((m) => <SelectItem key={m} value={m}>{etiquetaMes(m)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <ScrollArea className="h-[420px]">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead>Persona</TableHead>
                  <TableHead className="text-right">Mov. apros</TableHead>
                  <TableHead className="text-right">Mov. homog.</TableHead>
                  <TableHead className="text-right">Total mov.</TableHead>
                  <TableHead className="text-right">% apros</TableHead>
                  {mesSel === 'todos' && <TableHead className="text-right">Meses</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {detallePersona.slice(0, 50).map((p) => (
                  <TableRow key={p.operario}>
                    <TableCell className="font-medium max-w-56 truncate" title={p.nombre}>{p.nombre}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-emerald-700">{n(p.apros)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.homogeneos > 0 ? n(p.homogeneos) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(p.total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.total ? n1((p.apros / p.total) * 100) : '—'}%</TableCell>
                    {mesSel === 'todos' && <TableCell className="text-right tabular-nums text-muted-foreground">{p.meses}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
