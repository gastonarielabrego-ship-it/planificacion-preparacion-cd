'use client'

// Sección "Maquinistas (clarkistas)" del Resumen: personas por actividad,
// personas por tarea y actividad (apros vs homogéneos), distribución por turno,
// mapa de calor de apros por actividad, mapa de calor día × hora de movimientos,
// movimientos por horario y el CRUCE con los tiempos muertos:
// ¿los movimientos de apros coinciden con la espera de piking?

import { useMemo } from 'react'
import { Forklift, Users, Layers, Clock, GitCompareArrows } from 'lucide-react'
import { Kpi, SinDatos } from '../kpi'
import { n, n1, COLORES, GG_VERDE, GG_NARANJA, GG_GRIS } from '@/lib/client'
import { ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const etiquetaMes = (ym: string) => `${MESES_ABR[parseInt(ym.slice(5, 7), 10) - 1] ?? ym.slice(5, 7)} ${ym.slice(2, 4)}`

export interface MaqData {
  registros: number
  vacio: boolean
  desde: string
  hasta: string
  meses: number
  operarios: number
  dias: number
  personasPromDia: number | null
  movimientos: number
  bultos: number
  horasHombre: number
  navesActivas: number
  navesPorOperarioDia: number | null
  porActividad: { actividad: string; codigo: string; operarios: number; personasPromDia: number | null; dias: number; movimientos: number; bultos: number; horas: number }[]
  porHora: { hora: number; etiqueta: string; total: number; M: number; T: number; N: number }[]
  porHoraApros: { hora: number; etiqueta: string; total: number }[]
  horaPico: { hora: number; movimientos: number; promDia: number } | null
  tieneHorario: boolean
  porTurno: { turno: string; personasPromDia: number | null; operarios: number; movimientos: number; bultos: number; porActividad: { actividad: string; personasProm: number | null; operarios: number }[]; personasPromApros: number | null; personasPromHom: number | null; porTareaActividad: { tarea: string; actividad: string; codigo: string; personasPromDia: number | null; operarios: number; movimientos: number }[] }[]
  porMesActividad: { mes: string; actividad: string; personasProm: number }[]
  calorHora: { dias: string[]; horas: { hora: number; etiqueta: string; valores: (number | null)[] }[] }
  calorApros: { meses: string[]; actividades: string[]; celdas: { mes: string; actividad: string; mov: number; personas: number }[] }
  tareas: {
    movApros: number
    movHom: number
    conDatos: boolean
    operariosApros: number
    operariosHom: number
    personasPromApros: number | null
    personasPromHom: number | null
    porActividad: { tarea: string; actividad: string; codigo: string; personasPromDia: number | null; operarios: number; dias: number; movimientos: number }[]
  }
}

const TURNO_NOMBRE: Record<string, string> = { M: 'TM (6 a 14)', T: 'TT (14 a 22)', N: 'TN (23 a 06)', '?': 'Sin turno' }

// correlación de Pearson entre movimientos por hora y minutos de espera de piking
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

export function SeccionMaquinistas({ data, esperaPikingPorHora }: { data: MaqData; esperaPikingPorHora: { hora: number; etiqueta: string; minutos: number }[] }) {
  // datos de apoyo tolerantes a ausencia (el modulo maq puede venir vacio)
  const porHora = data.porHora ?? []
  // foco apros: movimientos de los clarks que hacen apros por hora (el espera de
  // piking se resuelve con aprontamiento, no con movimientos de homogeneos)
  const porHoraApros = data.porHoraApros ?? porHora.map((p) => ({ hora: p.hora, etiqueta: p.etiqueta, total: 0 }))
  const celdasCalor = data.calorApros?.celdas ?? []
  const movPorHora = porHoraApros.map((p) => p.total)

  // ---- cruce movimientos de apros por hora vs espera de piking por hora ----
  const cruce = useMemo(() => {
    const espera = esperaPikingPorHora.map((h) => h.minutos)
    const hayEspera = espera.some((m) => m > 0)
    const hayMov = movPorHora.some((m) => m > 0)
    if (!hayEspera || !hayMov) return null
    const r = pearson(movPorHora, espera)
    const union = porHoraApros.map((p, i) => ({
      etiqueta: p.etiqueta,
      movimientos: p.total,
      esperaMin: esperaPikingPorHora[i]?.minutos ?? 0,
    })).filter((x) => x.movimientos > 0 || x.esperaMin > 0)
    const topMov = [...union].sort((a, b) => b.movimientos - a.movimientos).slice(0, 4)
    const topEspera = [...union].sort((a, b) => b.esperaMin - a.esperaMin).slice(0, 4)
    const coinciden = topMov.filter((m) => topEspera.some((e) => e.etiqueta === m.etiqueta)).length
    return { r, union, topMov, topEspera, coinciden }
  }, [porHoraApros, esperaPikingPorHora, movPorHora])

  const calorMax = Math.max(1, ...celdasCalor.map((c) => c.mov))
  const calorMap = new Map(celdasCalor.map((c) => [`${c.mes}|${c.actividad}`, c]))

  // mapa de calor día × hora de los movimientos de clarks: filas de horas con algún dato
  const filasCalorHora = (data.calorHora?.horas ?? []).filter((f) => f.valores.some((v) => v != null))
  const calorHoraMax = Math.max(1, ...filasCalorHora.flatMap((f) => f.valores.filter((v): v is number => v != null)))

  if (data.vacio) return <SinDatos mensaje="Cargá el archivo H61 de maquinistas (clarkistas) para ver esta sección." />

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Personas promedio por día" valor={data.personasPromDia} formato="decimal" unidad="clarkistas" icono={Users} detalle={`${data.operarios} operarios distintos en ${data.dias} días`} />
        <Kpi titulo="Movimientos por día" valor={data.dias ? data.movimientos / data.dias : null} unidad="mov/día" icono={Forklift} detalle={`${n(data.movimientos)} movimientos informados`} />
        <Kpi titulo="Personas que hacen apros" valor={data.tareas.personasPromApros} formato="decimal" icono={Layers} tono="exito" detalle={`${data.tareas.operariosApros} operarios · ${n(data.tareas.movApros)} movimientos de apros`} />
        <Kpi titulo="Personas que hacen homogéneos" valor={data.tareas.personasPromHom} formato="decimal" icono={Layers} tono="atencion" detalle={`${data.tareas.operariosHom} operarios · ${n(data.tareas.movHom)} movimientos`} />
      </div>

      {/* Personas por actividad */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Personas por actividad</CardTitle>
          <CardDescription>Cuántas personas trabajan cada día en cada actividad y cuántos movimientos realizan</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.porActividad} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="actividad" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="p" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="m" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="p" dataKey="personasPromDia" name="Personas prom./día" fill={GG_VERDE} radius={[3, 3, 0, 0]} />
              <Bar yAxisId="m" dataKey="movimientos" name="Movimientos totales" fill={GG_GRIS} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Actividad</TableHead>
                <TableHead className="text-right">Personas prom./día</TableHead>
                <TableHead className="text-right">Operarios distintos</TableHead>
                <TableHead className="text-right">Movimientos</TableHead>
                <TableHead className="text-right">Bultos</TableHead>
                <TableHead className="text-right">Horas-hombre</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.porActividad.map((a) => (
                <TableRow key={a.codigo}>
                  <TableCell className="font-medium">{a.actividad}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{n1(a.personasPromDia)}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.operarios}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(a.movimientos)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(a.bultos)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(a.horas)} h</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Personas por tarea y actividad */}
      {data.tareas.conDatos && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Personas por tarea y actividad (apros vs homogéneos)</CardTitle>
            <CardDescription>
              Las tareas no equivalen a la actividad: actividad 2 y 4 hacen ambas tareas. Apros promedio {n1(data.tareas.personasPromApros)} personas/día y homogéneos {n1(data.tareas.personasPromHom)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarea</TableHead>
                  <TableHead>Actividad</TableHead>
                  <TableHead className="text-right">Personas prom./día</TableHead>
                  <TableHead className="text-right">Operarios distintos</TableHead>
                  <TableHead className="text-right">Movimientos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.tareas.porActividad.map((t, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Badge variant="outline" className={t.tarea === 'apros' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}>{t.tarea}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{t.actividad}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{n1(t.personasPromDia)}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.operarios}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(t.movimientos)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Distribución por turno */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Distribución por turno</CardTitle>
          <CardDescription>Personas promedio por turno, separando apros y homogéneos, y en qué actividad están</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Turno</TableHead>
                <TableHead className="text-right">Personas prom./día</TableHead>
                <TableHead className="text-right">c/ apros</TableHead>
                <TableHead className="text-right">c/ homogéneos</TableHead>
                <TableHead className="text-right">Movimientos</TableHead>
                <TableHead>Por actividad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.porTurno.map((t) => (
                <TableRow key={t.turno}>
                  <TableCell className="font-medium">{TURNO_NOMBRE[t.turno] ?? t.turno}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{n1(t.personasPromDia)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-700">{n1(t.personasPromApros)}</TableCell>
                  <TableCell className="text-right tabular-nums text-amber-700">{n1(t.personasPromHom)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(t.movimientos)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {t.porActividad.map((a) => (
                        <Badge key={a.actividad} variant="secondary" className="text-[10px]">{a.actividad}: {n1(a.personasProm)}</Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Movimientos por horario */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Movimientos por horario</CardTitle>
          <CardDescription>Movimientos de clark promedio por hora del día (barras apiladas por turno). La hora pico es {data.horaPico ? `${data.horaPico.hora}h con ${n1(data.horaPico.promDia)} mov/día` : '—'}</CardDescription>
        </CardHeader>
        <CardContent>
          {!data.tieneHorario ? (
            <p className="text-sm text-muted-foreground py-8 text-center">El archivo cargado no tiene el detalle horario (HORA_00 a HORA_23). Volvé a cargar el archivo de maquinistas.</p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={data.porHora} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} interval={1} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => n1(v)} />
                <Legend />
                <Bar dataKey="M" name="TM" stackId="h" fill={GG_VERDE} />
                <Bar dataKey="T" name="TT" stackId="h" fill={GG_NARANJA} />
                <Bar dataKey="N" name="TN" stackId="h" fill="#7c3aed" radius={[3, 3, 0, 0]} />
                <Line dataKey="total" name="Total mov/día" stroke={GG_GRIS} strokeWidth={2} dot={false} />
                {data.horaPico && <ReferenceLine x={`${String(data.horaPico.hora).padStart(2, '0')}h`} stroke="#dc2626" strokeDasharray="4 3" label={{ value: 'pico', fontSize: 10, fill: '#dc2626', position: 'insideTopLeft' }} />}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Mapa de calor día x hora de los movimientos de clarks */}
      {filasCalorHora.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Mapa de calor día de la semana × hora — movimientos de clarks</CardTitle>
            <CardDescription>Cada celda muestra los movimientos promedio de clarkistas en ese día y esa hora (más oscuro = más movimiento)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto max-h-[520px]">
              <table className="border-collapse text-[10px]">
                <thead>
                  <tr>
                    <th className="border p-1.5 text-left bg-muted/40 sticky top-0 bg-background">Hora</th>
                    {data.calorHora?.dias.map((d) => <th key={d} className="border p-1.5 bg-muted/40 sticky top-0">{d}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filasCalorHora.map((f) => (
                    <tr key={f.hora}>
                      <td className="border p-1.5 font-medium whitespace-nowrap">{f.etiqueta}</td>
                      {f.valores.map((v, i) => {
                        const inten = v != null ? v / calorHoraMax : 0
                        return (
                          <td key={i} className="border p-1.5 text-center tabular-nums" style={{ backgroundColor: v != null ? `rgba(124, 185, 62, ${0.12 + 0.78 * inten})` : undefined, color: inten > 0.55 ? '#fff' : undefined }}>
                            {v != null ? n1(v) : '—'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* CRUCE con tiempos muertos */}
      {cruce && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><GitCompareArrows className="h-4 w-4" /> Cruce con tiempos muertos: ¿los movimientos de apros coinciden con la espera de piking?</CardTitle>
            <CardDescription>
              Movimientos de los clarks que hacen apros por hora contra horas de espera de piking informadas por hora. Correlación de {n1((cruce.r ?? 0) * 100)}% — {cruce.coinciden} de las 4 horas con más movimientos de apros también están entre las 4 de más espera
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={cruce.union} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} interval={1} />
                <YAxis yAxisId="mov" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="esp" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 60)}h`} />
                <Tooltip formatter={(v: number, name: string) => (name === 'Espera de piking' ? [`${n1(v / 60)} h`, name] : [n1(v), name])} />
                <Legend />
                <Bar yAxisId="mov" dataKey="movimientos" name="Movimientos de clark (apros)" fill={GG_VERDE} radius={[2, 2, 0, 0]} />
                <Line yAxisId="esp" dataKey="esperaMin" name="Espera de piking" stroke="#dc2626" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium mb-1">Horas con más movimientos de apros</p>
                <p className="text-sm text-muted-foreground">{cruce.topMov.map((h) => `${h.etiqueta} (${n1(h.movimientos)})`).join(' · ')}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium mb-1">Horas con más espera de piking</p>
                <p className="text-sm text-muted-foreground">{cruce.topEspera.map((h) => `${h.etiqueta} (${n1(h.esperaMin / 60)} h)`).join(' · ')}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <Clock className="inline h-3 w-3 mr-1" />
              {cruce.r != null && Math.abs(cruce.r) >= 0.5
                ? `Correlación ${cruce.r > 0 ? 'positiva' : 'inversa'} fuerte (${n1(cruce.r)}): ${cruce.r > 0 ? 'las horas de mayor movimiento de apros son también las de mayor espera de piking — la dotación de apros no alcanza en esos horarios' : 'los movimientos no explican la espera — revisar otras causas (oleadas, asignación de ubicaciones)'}.`
                : `Correlación débil (${n1(cruce.r ?? 0)}): la espera de piking no sigue al movimiento de apros por hora — conviene revisar cuándo se genera la espera (olas) en el detalle.`}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Mapa de calor de apros por actividad */}
      {data.tareas.conDatos && data.calorApros.celdas.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Mapa de calor: movimientos de apros por mes y actividad</CardTitle>
            <CardDescription>Cada celda muestra los movimientos de apros del mes en cada actividad (más oscuro = más movimientos) y las personas que los hicieron</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="border p-2 text-left bg-muted/40">Actividad</th>
                    {data.calorApros.meses.map((m) => <th key={m} className="border p-2 bg-muted/40 whitespace-nowrap">{etiquetaMes(m)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.calorApros.actividades.map((act) => (
                    <tr key={act}>
                      <td className="border p-2 font-medium">{act}</td>
                      {data.calorApros.meses.map((m) => {
                        const c = calorMap.get(`${m}|${act}`)
                        const inten = c ? c.mov / calorMax : 0
                        return (
                          <td key={m} className="border p-2 text-center tabular-nums" style={{ backgroundColor: c ? `rgba(124, 185, 62, ${0.15 + 0.75 * inten})` : undefined, color: inten > 0.55 ? '#fff' : undefined }}>
                            {c ? <>{n(c.mov)}<br /><span className="text-[10px] opacity-80">{n1(c.personas)} pers.</span></> : '—'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  )
}
