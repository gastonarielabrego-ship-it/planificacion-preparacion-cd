'use client'

// Pestaña "Capacidad H61": ritmo de preparación mensual (promedio y mediana),
// días / actividades / personas, y separación de bultos preparados sin horas
// extra (primeras 8 h de cada operario) versus preparados en horas extra.

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Gauge, Hourglass, Layers, Users, CalendarOff } from 'lucide-react'
import { Kpi, SinDatos } from './kpi'
import { fetchDatos, n, n1, pct, fechaCorta, COLORES } from '@/lib/client'
import { ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'

interface FilaMes {
  mes: string
  dias: number
  diasFeriado: number
  actividades: number
  personas: number
  personasExtras: number
  bultos: number
  bultosBase: number
  bultosExtras: number
  bultosFeriado: number
  pctExtras: number
  pctExtrasTotal: number
  horas: number
  horasExtras: number
  ritmoProm: number | null
  ritmoMediana: number | null
}
interface CapacidadData {
  serie: { fecha: string; bultos: number; bultosNormales: number; bultosBase: number; bultosExtras: number; bultosFeriado: number; pctExtras: number; ritmo: number | null; ops: number; opsExtras: number; opDias: number; esFeriado: boolean; feriado: string | null; feriadoManana: string | null }[]
  porMes: FilaMes[]
  porTurno: { turno: string; nombre: string; opDias: number; personas: number; personasExtras: number; bultos: number; bultosBase: number; bultosExtras: number; pctExtras: number; horasExtras: number; ritmoProm: number | null }[]
  perfilHora: { hora: number; etiqueta: string; opsJornada: number; opsExtras: number; bultosProm: number }[]
  feriados: { fecha: string; nombre: string; tipo: string; personas: number; opDias: number; bultos: number; horas: number; ritmo: number | null }[]
  resumen: {
    dias: number
    actividades: number
    personas: number
    personasExtras: number
    bultos: number
    bultosBase: number
    bultosExtras: number
    pctExtras: number
    horas: number
    horasExtras: number
    ritmoProm: number | null
    ritmoMediana: number | null
    diasFeriado: number
    bultosFeriado: number
    horasFeriado: number
    personasFeriado: number
    pctExtrasTotal: number
  } | null
  tieneOpHora: boolean
  comparativa: {
    normal: { dias: number; bultosPorDia: number; personasPorDia: number; horasPorDia: number; ritmo: number | null }
    feriado: { dias: number; bultosPorJornada: number; personasPorJornada: number; horasPorJornada: number; ritmo: number | null }
    deltas: { bultosPct: number | null; personasPct: number | null; horasPct: number | null; ritmoPct: number | null }
    perfilHora: { hora: number; etiqueta: string; bultosNormal: number; personasNormal: number; ritmoNormal: number | null; bultosFeriado: number; personasFeriado: number; ritmoFeriado: number | null }[]
    diasNormalesPerfil: number
    diasFeriadoPerfil: number
  } | null
  porDiaSemana: { dow: number; dia: string; dias: number; bultosProm: number; personasProm: number; horasProm: number; ritmo: number | null; ritmoMediana: number | null; pctExtras: number }[]
  sabados: { fecha: string; bultos: number; bultosNormales: number; personas: number; personasExtras: number; opDias: number; horas: number; ritmo: number | null; pctExtras: number; bultosFeriado: number; feriadoManana: string | null; esFeriado: boolean; dotacionAcotada: boolean }[]
  sabadosResumen: { total: number; personasMediana: number; acotadas: number; personasAcotadasProm: number | null; personasRestoProm: number | null; ritmo: number | null } | null
  porActividad: { actividad: string; bultos: number; dias: number; bultosPorDia: number; opDias: number; horas: number; ritmo: number | null; pct: number }[]
  tieneActividad: boolean
}

// Caja de comparación: valor de un día normal contra el de una jornada feriada
function CajaComparativa({ titulo, normal, feriado, delta, unidad, decimales }: {
  titulo: string
  normal: number | null
  feriado: number | null
  delta: number | null
  unidad?: string
  decimales?: boolean
}) {
  const fmtV = (v: number | null) => (decimales ? n1(v) : n(v))
  return (
    <div className="rounded-lg border p-3 space-y-2">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <div className="flex items-end gap-3">
        <div>
          <p className="text-[11px] font-medium text-emerald-700">Día normal</p>
          <p className="text-xl font-bold tabular-nums">{fmtV(normal)}<span className="text-xs font-normal text-muted-foreground"> {unidad}</span></p>
        </div>
        <div className="border-l pl-3">
          <p className="text-[11px] font-medium text-red-700">Feriado</p>
          <p className="text-xl font-bold tabular-nums text-red-700">{fmtV(feriado)}<span className="text-xs font-normal text-muted-foreground"> {unidad}</span></p>
        </div>
      </div>
      {delta !== null && (
        <Badge variant="outline" className={delta >= 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}>
          {delta >= 0 ? '+' : ''}{n1(delta)}% vs día normal
        </Badge>
      )}
    </div>
  )
}

const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const etiquetaMes = (ym: string) => `${MESES_ABR[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`

// Etiqueta legible del código de actividad: 2 -> "Actividad 2", JAULA -> "Jaula"
const etiquetaActividad = (a: string) => {
  if (/^\d+$/.test(a)) return `Actividad ${a}`
  return a.charAt(0) + a.slice(1).toLowerCase()
}

export function CapacidadTab() {
  const { data, isLoading } = useQuery({ queryKey: ['capacidad'], queryFn: () => fetchDatos<CapacidadData>('capacidad') })
  const meses = useMemo(() => (data?.porMes ?? []).map((m) => m.mes), [data])
  const [mes, setMes] = useState('todos')

  const resumen = data?.resumen ?? null
  const filas = useMemo(() => (mes === 'todos' ? data?.porMes ?? [] : (data?.porMes ?? []).filter((m) => m.mes === mes)), [data, mes])
  const feriadosConActividad = useMemo(() => (mes === 'todos' ? data?.feriados ?? [] : (data?.feriados ?? []).filter((f) => f.fecha.startsWith(mes))), [data, mes])
  const comp = data?.comparativa ?? null
  const perfilComp = useMemo(() => (comp?.perfilHora ?? []).filter((p) => p.bultosNormal > 0 || p.bultosFeriado > 0 || p.personasNormal > 0 || p.personasFeriado > 0), [comp])
  const diasSemana = useMemo(() => (data?.porDiaSemana ?? []).filter((d) => d.dow >= 1 && d.dow <= 5), [data])
  const sab = data?.sabados ?? []
  const sabResumen = data?.sabadosResumen ?? null

  // Perfil por hora: promedio de colaboradores por hora (jornada vs extras) + bultos promedio
  const perfil = useMemo(() => (data?.perfilHora ?? []).filter((p) => p.opsJornada > 0 || p.opsExtras > 0), [data])

  if (isLoading) return <div className="grid gap-4"><Skeleton className="h-24" /><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
  if (!data || !resumen || resumen.bultos + resumen.bultosFeriado === 0) return <SinDatos mensaje="Cargá el archivo H61 para ver el ritmo y la capacidad de preparación." />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <Select value={mes} onValueChange={setMes}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Elegí un mes" /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="todos">Todo el período</SelectItem>
            {[...meses].reverse().map((m) => <SelectItem key={m} value={m}>{etiquetaMes(m)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* KPIs principales */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          titulo="Bultos sin horas extra"
          valor={resumen.bultosBase}
          unidad="bultos"
          icono={Layers}
          tono="exito"
          detalle={`${pct(resumen.bultos ? 100 - resumen.pctExtras : null)} de la preparación total · dentro de la jornada del turno`}
        />
        <Kpi
          titulo="Bultos en horas extra"
          valor={resumen.bultosExtras}
          unidad="bultos"
          icono={Hourglass}
          tono="alerta"
          detalle={`${pct(resumen.pctExtrasTotal)} del total incluyendo feriados · ${n(resumen.horasExtras)} h extra + ${n(resumen.horasFeriado)} h de feriados`}
        />
        <Kpi
          titulo="Ritmo de preparación"
          valor={resumen.ritmoProm}
          formato="decimal"
          unidad="bultos/h"
          icono={Gauge}
          detalle={`Mediana de días: ${n1(resumen.ritmoMediana)} bultos/h`}
        />
        <Kpi
          titulo="Personas involucradas"
          valor={resumen.personas}
          unidad="operarios"
          icono={Users}
          detalle={`${n(resumen.actividades)} operario-días en ${resumen.dias} días · ${resumen.personasExtras} con extras`}
        />
      </div>

      <Alert>
        <Hourglass className="h-4 w-4" />
        <AlertTitle>¿Cómo se separa jornada y horas extra?</AlertTitle>
        <AlertDescription>
          <p>
            Cada turno tiene su <b>ventana de jornada base</b>: <b>TM de 6 a 14</b>, <b>TT de 14 a 22</b> y <b>TN de 23 a 6</b> (7 h).
            Las horas trabajadas fuera de esa ventana cuentan como <b>extras</b>: el TM puede extenderse hasta las 18, el TT puede
            empezar sus extras a las 10 o pasar de las 22, y el TN desde las 18 o hasta las 10. La jornada del turno noche
            (las 23 del día + las 00 a 6 siguientes) se agrupa como un único día. El ritmo se mide en <b>bultos por hora-hombre</b>.
          </p>
          <p className="mt-2">
            Los <b>feriados nacionales</b> (calendario de Argentina) se miden aparte: todo lo producido en una
            jornada feriada cuenta como <b>horas extra</b> y <b>no influye</b> en los promedios, medianas ni perfiles
            de la medición normal. En el <b>turno noche</b> la jornada que antecede al feriado es la feriada:
            los bultos de la noche del día previo (23 a 6) se computan como feriado junto con los diurnos del día
            feriado; la noche del propio feriado (hacia el día siguiente) es jornada normal.
          </p>
        </AlertDescription>
      </Alert>

      {/* Comparativa mensual: base vs extras vs feriados */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Preparación por mes: sin extras vs horas extra vs feriados</CardTitle>
          <CardDescription>
            Bultos apilados: dentro de la jornada del turno (verde), en horas extra (ámbar) y en feriados (rojo, todo cuenta como extra). La línea marca el porcentaje de la preparación que dependió de extras, feriados incluidos. Los promedios y medianas de ritmo usan solo los días no feriados, y los bultos de feriado se asignan al mes del feriado (noche TN previa incluida)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={filas.map((m) => ({ ...m, etiqueta: etiquetaMes(m.mes) }))} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis yAxisId="b" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v: number, name: string) => (name.includes('%') ? [pct(v), name] : [n(v), name])} />
              <Legend />
              <Bar yAxisId="b" dataKey="bultosBase" name="Sin extras (jornada del turno)" stackId="a" fill={COLORES[0]} radius={[0, 0, 0, 0]} />
              <Bar yAxisId="b" dataKey="bultosExtras" name="En horas extra" stackId="a" fill={COLORES[1]} radius={[0, 0, 0, 0]} />
              <Bar yAxisId="b" dataKey="bultosFeriado" name="En feriados (todo es extra)" stackId="a" fill={COLORES[2]} radius={[3, 3, 0, 0]} />
              <Line yAxisId="p" dataKey="pctExtrasTotal" name="% en extras (incl. feriados)" stroke={COLORES[3]} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Ritmo de preparación por día: lunes a viernes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ritmo de preparación por día: lunes a viernes</CardTitle>
          <CardDescription>
            Medición normal de cada día de la semana (excluye jornadas feriadas y noches TN previas). Las barras marcan los bultos promedio de un día típico y la línea el ritmo (bultos por hora-hombre); la mediana refleja el día típico sin distorsión de picos. Los sábados se analizan aparte en la tarjeta siguiente
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={diasSemana} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="b" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="b" dataKey="bultosProm" name="Bultos promedio del día" fill={COLORES[0]} radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" dataKey="ritmo" name="Ritmo (bultos/h)" stroke={COLORES[3]} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Día</TableHead>
                <TableHead className="text-right">Días</TableHead>
                <TableHead className="text-right">Bultos prom.</TableHead>
                <TableHead className="text-right">Personas prom.</TableHead>
                <TableHead className="text-right">Horas-hombre</TableHead>
                <TableHead className="text-right">Ritmo (bultos/h)</TableHead>
                <TableHead className="text-right">Mediana días</TableHead>
                <TableHead className="text-right">% extras</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data.porDiaSemana ?? []).map((d) => (
                <TableRow key={d.dow} className={d.dow === 6 ? 'bg-sky-50/60' : undefined}>
                  <TableCell className="font-medium">
                    {d.dia}
                    {d.dow === 6 && <Badge variant="outline" className="ml-2 border-sky-200 bg-sky-50 text-sky-700">análisis aparte</Badge>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{d.dias}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(d.bultosProm)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n1(d.personasProm)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(d.horasProm)} h</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{n1(d.ritmo)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n1(d.ritmoMediana)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(d.pctExtras)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Sábados: dotación y ritmo */}
      {sab.length > 0 && sabResumen && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Sábados: dotación y ritmo</CardTitle>
              {sabResumen.acotadas > 0 && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">dotación acotada cada 15 días (cubren extras TT)</Badge>}
            </div>
            <CardDescription>
              {`${sabResumen.total} sábados con actividad · mediana de dotación ${n1(sabResumen.personasMediana)} personas · ritmo ${n1(sabResumen.ritmo)} bultos/h`}
              {sabResumen.acotadas > 0 && ` · ${sabResumen.acotadas} sábados operan con dotación acotada (promedio ${n1(sabResumen.personasAcotadasProm)} personas contra ${n1(sabResumen.personasRestoProm)} del resto): esos días la operación la cubre personal que viene del turno tarde como extras`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={sab.map((s) => ({ ...s, etiqueta: fechaCorta(s.fecha) }))} margin={{ left: 4, right: 8, top: 12, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 9 }} interval={0} angle={-35} textAnchor="end" height={54} />
                <YAxis yAxisId="p" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="p" dataKey="personas" name="Dotación (personas)" radius={[3, 3, 0, 0]}>
                  {sab.map((s) => <Cell key={s.fecha} fill={s.dotacionAcotada ? COLORES[2] : COLORES[0]} />)}
                </Bar>
                <Line yAxisId="r" dataKey="ritmo" name="Ritmo (bultos/h)" stroke={COLORES[3]} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
            <ScrollArea className="h-[300px] rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Sábado</TableHead>
                    <TableHead className="text-right">Dotación</TableHead>
                    <TableHead className="text-right">c/ extras</TableHead>
                    <TableHead className="text-right">Bultos</TableHead>
                    <TableHead className="text-right">% extras</TableHead>
                    <TableHead className="text-right">Ritmo (bultos/h)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sab.map((s) => (
                    <TableRow key={s.fecha} className={s.dotacionAcotada ? 'bg-red-50/60' : undefined}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {fechaCorta(s.fecha)}
                        {s.dotacionAcotada && <Badge className="ml-1 bg-red-100 text-red-800 hover:bg-red-100">dotación acotada</Badge>}
                        {s.esFeriado && <Badge className="ml-1 bg-red-100 text-red-800 hover:bg-red-100" title={s.feriadoManana ?? undefined}>feriado</Badge>}
                        {!s.esFeriado && s.bultosFeriado > 0 && <Badge variant="outline" className="ml-1 border-red-200 bg-red-50 text-red-700" title={`Noche TN que antecede a ${s.feriadoManana ?? 'feriado'}`}>noche TN</Badge>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{s.personas}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.personasExtras || '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(s.bultosNormales)}{s.bultosFeriado > 0 ? ` + ${n(s.bultosFeriado)} fer.` : ''}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(s.pctExtras)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{n1(s.ritmo)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Bultos por actividad (2 · 4 · jaula) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Bultos por actividad (2 · 4 · jaula)</CardTitle>
          <CardDescription>Desagregado de la preparación según la columna ACTIVIDAD del archivo H61. El ritmo usa horas-hombre aproximadas por actividad (un operario puede alternar actividades dentro del mismo día)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data.tieneActividad ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              El desagregado por actividad todavía no está disponible: volvé a cargar el archivo H61 (doble clic en CARGAR_ARCHIVOS.bat) para que el sistema procese la columna ACTIVIDAD.
            </p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={120 + 36 * data.porActividad.length}>
                <BarChart layout="vertical" data={data.porActividad.map((a) => ({ ...a, nombre: etiquetaActividad(a.actividad) }))} margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <YAxis type="category" dataKey="nombre" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="bultos" name="Bultos" fill={COLORES[0]} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Actividad</TableHead>
                    <TableHead className="text-right">Bultos</TableHead>
                    <TableHead className="text-right">% del total</TableHead>
                    <TableHead className="text-right">Bultos por día</TableHead>
                    <TableHead className="text-right">Op-días</TableHead>
                    <TableHead className="text-right">Horas-hombre</TableHead>
                    <TableHead className="text-right">Ritmo (bultos/h)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.porActividad.map((a) => (
                    <TableRow key={a.actividad}>
                      <TableCell className="font-medium">{etiquetaActividad(a.actividad)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(a.bultos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(a.pct)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(a.bultosPorDia)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(a.opDias)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(a.horas)} h</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{n1(a.ritmo)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {/* Producción en feriados: se mide aparte */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2"><CalendarOff className="h-4 w-4 text-red-600" /> Producción en feriados (medición aparte)</CardTitle>
            <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">todo feriado = horas extra</Badge>
          </div>
          <CardDescription>
            Feriados nacionales de Argentina detectados automáticamente. Cada feriado reúne su jornada completa:
            la noche del turno noche previo (23 a 6) más los diurnos del día feriado. Su producción cuenta como
            horas extra y no influye en los promedios, medianas ni perfiles de la medición normal
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border bg-red-50/40 p-3">
              <p className="text-xs text-muted-foreground">Bultos en feriados</p>
              <p className="text-xl font-bold text-red-700 tabular-nums">{n(resumen.bultosFeriado)}</p>
              <p className="text-xs text-muted-foreground">{pct(resumen.bultos + resumen.bultosFeriado ? (resumen.bultosFeriado / (resumen.bultos + resumen.bultosFeriado)) * 100 : 0)} de la producción total</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Feriados con actividad</p>
              <p className="text-xl font-bold tabular-nums">{resumen.diasFeriado}</p>
              <p className="text-xs text-muted-foreground">{n(resumen.horasFeriado)} horas-hombre trabajadas</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Personas que trabajaron</p>
              <p className="text-xl font-bold tabular-nums">{resumen.personasFeriado}</p>
              <p className="text-xs text-muted-foreground">operarios distintos</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Ritmo en feriados</p>
              <p className="text-xl font-bold tabular-nums">{n1(resumen.horasFeriado ? resumen.bultosFeriado / resumen.horasFeriado : null)}</p>
              <p className="text-xs text-muted-foreground">bultos por hora-hombre</p>
            </div>
          </div>
          {feriadosConActividad.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Feriado</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Personas</TableHead>
                  <TableHead className="text-right">Op-días</TableHead>
                  <TableHead className="text-right">Bultos</TableHead>
                  <TableHead className="text-right">Horas</TableHead>
                  <TableHead className="text-right">Ritmo (bultos/h)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feriadosConActividad.map((f) => (
                  <TableRow key={f.fecha} className="bg-red-50/40">
                    <TableCell className="font-medium">{f.nombre}</TableCell>
                    <TableCell className="tabular-nums">{fechaCorta(f.fecha)}</TableCell>
                    <TableCell><Badge variant="secondary" className="capitalize">{f.tipo}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{f.personas}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(f.opDias)}</TableCell>
                    <TableCell className="text-right tabular-nums text-red-700">{n(f.bultos)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(f.horas)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{n1(f.ritmo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {feriadosConActividad.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">Sin producción en feriados en el período mostrado.</p>
          )}
        </CardContent>
      </Card>

      {/* Feriado vs día normal: comparativa de producción */}
      {comp && comp.normal.dias > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2"><CalendarOff className="h-4 w-4 text-red-600" /> Feriado vs día normal: ¿cómo se compara la producción?</CardTitle>
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">mediciones separadas</Badge>
            </div>
            <CardDescription>
              La jornada feriada completa (noche TN previa + diurnos del feriado) contra el día normal promedio.
              {comp.feriado.dias > 0 ? (
                <> Un feriado típico produce <b>{n(comp.feriado.bultosPorJornada)}</b> bultos con <b>{n1(comp.feriado.personasPorJornada)}</b> personas y un ritmo de <b>{n1(comp.feriado.ritmo)}</b> bultos/h, frente a <b>{n(comp.normal.bultosPorDia)}</b> bultos, <b>{n1(comp.normal.personasPorDia)}</b> personas y <b>{n1(comp.normal.ritmo)}</b> bultos/h de un día normal</>
              ) : (
                <> Aún no hay producción en feriados en el período analizado</>
              )}
              {mes !== 'todos' && '. Las cajas y el perfil horario usan todo el período; los rankings respetan el filtro de mes'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <CajaComparativa titulo="Bultos por jornada" normal={comp.normal.bultosPorDia} feriado={comp.feriado.bultosPorJornada} delta={comp.deltas.bultosPct} />
              <CajaComparativa titulo="Personas por jornada" normal={comp.normal.personasPorDia} feriado={comp.feriado.personasPorJornada} delta={comp.deltas.personasPct} decimales />
              <CajaComparativa titulo="Horas-hombre por jornada" normal={comp.normal.horasPorDia} feriado={comp.feriado.horasPorJornada} delta={comp.deltas.horasPct} unidad="h" />
              <CajaComparativa titulo="Ritmo (bultos por hora-hombre)" normal={comp.normal.ritmo} feriado={comp.feriado.ritmo} delta={comp.deltas.ritmoPct} decimales />
            </div>

            {/* Productividad por hora: normal vs feriado */}
            <div>
              <p className="text-sm font-medium mb-1">Productividad de cada hora — días normales vs feriados</p>
              <p className="text-xs text-muted-foreground mb-2">Bultos promedio de cada hora (barras, promediando {comp.diasNormalesPerfil} días normales{comp.diasFeriadoPerfil > 0 ? ` contra ${comp.diasFeriadoPerfil} jornadas feriadas` : ''}) y ritmo de esa hora (bultos por persona activa, línea).</p>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={perfilComp} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} interval={1} />
                  <YAxis yAxisId="b" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="b" dataKey="bultosNormal" name="Bultos/hora — día normal" fill={COLORES[0]} radius={[2, 2, 0, 0]} />
                  {comp.diasFeriadoPerfil > 0 && <Bar yAxisId="b" dataKey="bultosFeriado" name="Bultos/hora — feriado" fill={COLORES[2]} radius={[2, 2, 0, 0]} />}
                  <Line yAxisId="r" dataKey="ritmoNormal" name="Ritmo por hora — normal" stroke={COLORES[3]} strokeWidth={2} dot={false} />
                  {comp.diasFeriadoPerfil > 0 && <Line yAxisId="r" dataKey="ritmoFeriado" name="Ritmo por hora — feriado" stroke={COLORES[2]} strokeWidth={2} strokeDasharray="4 3" dot={false} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preparación por turno */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Preparación por turno</CardTitle>
          <CardDescription>Jornada base de cada turno (TM 6-14 · TT 14-22 · TN 23-06) y qué parte de su preparación dependió de extras. Las jornadas feriadas (días feriados y las noches TN que los anteceden) se miden aparte y no entran en esta tabla</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Turno</TableHead>
                <TableHead className="text-right">Op-días</TableHead>
                <TableHead className="text-right">Personas</TableHead>
                <TableHead className="text-right">c/ extras</TableHead>
                <TableHead className="text-right">Bultos sin extras</TableHead>
                <TableHead className="text-right">Bultos en extras</TableHead>
                <TableHead className="text-right">% extras</TableHead>
                <TableHead className="text-right">Horas extra</TableHead>
                <TableHead className="text-right">Ritmo (bultos/h)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data.porTurno ?? []).map((t) => (
                <TableRow key={t.turno}>
                  <TableCell className="font-medium">{t.nombre}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(t.opDias)}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.personas}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.personasExtras || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(t.bultosBase)}</TableCell>
                  <TableCell className="text-right tabular-nums text-amber-700">{t.bultosExtras ? n(t.bultosExtras) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{pct(t.pctExtras)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(t.horasExtras)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{n1(t.ritmoProm)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Colaboradores por hora: jornada vs extras */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">¿Cuántos colaboradores preparan en cada hora? — jornada vs extras</CardTitle>
          <CardDescription>
            Promedio de personas con producción en cada hora del día: en verde las que están dentro de sus primeras 8 h, en ámbar las que están en horas extra. La línea marca los bultos promedio de esa hora. No incluye las jornadas feriadas (días feriados ni las noches TN previas a cada feriado)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!data.tieneOpHora ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Este gráfico necesita el detalle operario × hora. Volvé a cargar el archivo H61 para habilitarlo.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={perfil} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} interval={1} />
                <YAxis yAxisId="ops" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="bultos" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="ops" dataKey="opsJornada" name="Personas en jornada (turno base)" stackId="ops" fill={COLORES[0]} radius={[0, 0, 0, 0]} />
                <Bar yAxisId="ops" dataKey="opsExtras" name="Personas en horas extra" stackId="ops" fill={COLORES[1]} radius={[3, 3, 0, 0]} />
                <Line yAxisId="bultos" dataKey="bultosProm" name="Bultos promedio por hora" stroke={COLORES[3]} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Tabla mensual */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalle mensual {mes !== 'todos' && `— ${etiquetaMes(mes)}`}</CardTitle>
          <CardDescription>Ritmo = bultos por hora-hombre (solo días no feriados). Promedio ponderado del mes y mediana de los días. La producción de feriados se lista aparte</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[420px] rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Días</TableHead>
                  <TableHead className="text-right">Feriados</TableHead>
                  <TableHead className="text-right">Actividades (op-días)</TableHead>
                  <TableHead className="text-right">Personas</TableHead>
                  <TableHead className="text-right">Bultos sin extras</TableHead>
                  <TableHead className="text-right">Bultos en extras</TableHead>
                  <TableHead className="text-right">Bultos feriado</TableHead>
                  <TableHead className="text-right">% extras</TableHead>
                  <TableHead className="text-right">Horas extra</TableHead>
                  <TableHead className="text-right">Ritmo prom.</TableHead>
                  <TableHead className="text-right">Mediana días</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((m) => (
                  <TableRow key={m.mes}>
                    <TableCell className="font-medium">{etiquetaMes(m.mes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.dias}</TableCell>
                    <TableCell className="text-right tabular-nums text-red-700">{m.diasFeriado || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(m.actividades)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.personas}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(m.bultosBase)}</TableCell>
                    <TableCell className="text-right tabular-nums text-amber-700">{n(m.bultosExtras)}</TableCell>
                    <TableCell className="text-right tabular-nums text-red-700">{m.bultosFeriado ? n(m.bultosFeriado) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{pct(m.pctExtrasTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(m.horasExtras)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{n1(m.ritmoProm)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n1(m.ritmoMediana)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Detalle diario del mes elegido */}
      {mes !== 'todos' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Días de {etiquetaMes(mes)}</CardTitle>
            <CardDescription>Ritmo diario de preparación y cuánta gente trabajó con extras cada día. Los feriados (rojo) van todo a horas extra y no entran en la medición normal; la noche TN que antecede a un feriado se marca con “noche TN”</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[360px] rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Bultos</TableHead>
                    <TableHead className="text-right">Sin extras</TableHead>
                    <TableHead className="text-right">En extras</TableHead>
                    <TableHead className="text-right">En feriado</TableHead>
                    <TableHead className="text-right">% extras</TableHead>
                    <TableHead className="text-right">Personas</TableHead>
                    <TableHead className="text-right">c/ extras</TableHead>
                    <TableHead className="text-right">Ritmo (bultos/h)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.serie.filter((s) => s.fecha.startsWith(mes)).map((s) => (
                    <TableRow key={s.fecha} className={s.esFeriado || s.bultosFeriado > 0 ? 'bg-red-50/60' : s.opsExtras > 0 ? 'bg-amber-50/50' : undefined}>
                      <TableCell className="font-medium">
                        {fechaCorta(s.fecha)}{' '}
                        {s.esFeriado && <Badge className="ml-1 bg-red-100 text-red-800 hover:bg-red-100" title={s.feriado ?? undefined}>feriado</Badge>}
                        {!s.esFeriado && s.bultosFeriado > 0 && (
                          <Badge variant="outline" className="ml-1 border-red-200 bg-red-50 text-red-700" title={`Noche TN que antecede a ${s.feriadoManana ?? 'feriado'}: todo cuenta como extra`}>
                            noche TN
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{n(s.bultos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.bultosBase ? n(s.bultosBase) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums text-amber-700">{s.bultosExtras ? n(s.bultosExtras) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums text-red-700">{s.bultosFeriado ? n(s.bultosFeriado) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.bultosNormales > 0 ? pct(s.pctExtras) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.ops}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.opsExtras || '—'}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{n1(s.ritmo)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
