'use client'

// Pestaña "Capacidad H61": ritmo de preparación mensual (promedio y mediana),
// días / actividades / personas, y separación de bultos preparados sin horas
// extra (primeras 8 h de cada operario) versus preparados en horas extra.

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Gauge, Hourglass, Layers, Users } from 'lucide-react'
import { Kpi, SinDatos } from './kpi'
import { fetchDatos, n, n1, pct, fechaCorta, COLORES } from '@/lib/client'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface FilaMes {
  mes: string
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
}
interface CapacidadData {
  serie: { fecha: string; bultos: number; bultosBase: number; bultosExtras: number; pctExtras: number; ritmo: number | null; ops: number; opsExtras: number; opDias: number }[]
  porMes: FilaMes[]
  perfilHora: { hora: number; etiqueta: string; opsJornada: number; opsExtras: number; bultosProm: number }[]
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
  } | null
  tieneOpHora: boolean
}

const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const etiquetaMes = (ym: string) => `${MESES_ABR[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`

export function CapacidadTab() {
  const { data, isLoading } = useQuery({ queryKey: ['capacidad'], queryFn: () => fetchDatos<CapacidadData>('capacidad') })
  const meses = useMemo(() => (data?.porMes ?? []).map((m) => m.mes), [data])
  const [mes, setMes] = useState('todos')

  const resumen = data?.resumen ?? null
  const filas = useMemo(() => (mes === 'todos' ? data?.porMes ?? [] : (data?.porMes ?? []).filter((m) => m.mes === mes)), [data, mes])

  // Perfil por hora: promedio de colaboradores por hora (jornada vs extras) + bultos promedio
  const perfil = useMemo(() => (data?.perfilHora ?? []).filter((p) => p.opsJornada > 0 || p.opsExtras > 0), [data])

  if (isLoading) return <div className="grid gap-4"><Skeleton className="h-24" /><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
  if (!data || !resumen || resumen.bultos === 0) return <SinDatos mensaje="Cargá el archivo H61 para ver el ritmo y la capacidad de preparación." />

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
          detalle={`${pct(resumen.bultos ? 100 - resumen.pctExtras : null)} de la preparación total · primeras 8 h de cada operario`}
        />
        <Kpi
          titulo="Bultos en horas extra"
          valor={resumen.bultosExtras}
          unidad="bultos"
          icono={Hourglass}
          tono="alerta"
          detalle={`${pct(resumen.pctExtras)} de la preparación total · ${n(resumen.horasExtras)} h extra`}
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
            Cada operario-día se ordena por sus horas con producción: las <b>primeras 8 horas</b> cuentan como <b>jornada base</b>
            {' '}y sus bultos son <b>preparación sin extras</b>. Las horas que exceden las 8 (típicamente jornadas de 12 h = 4 h extra)
            y sus bultos cuentan como <b>preparación en horas extra</b>. En el turno noche las horas cruzan la medianoche: se ordenan
            desde la tarde hasta la madrugada siguiente. El ritmo se mide en <b>bultos por hora-hombre</b>.
          </p>
        </AlertDescription>
      </Alert>

      {/* Comparativa mensual: base vs extras */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Preparación por mes: sin extras vs horas extra</CardTitle>
          <CardDescription>
            Bultos apilados según si se prepararon dentro de la jornada de 8 h (verde) o en horas extra (ámbar). La línea marca el porcentaje de la preparación que dependió de extras
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
              <Bar yAxisId="b" dataKey="bultosBase" name="Sin extras (jornada 8 h)" stackId="a" fill={COLORES[0]} radius={[0, 0, 0, 0]} />
              <Bar yAxisId="b" dataKey="bultosExtras" name="En horas extra" stackId="a" fill={COLORES[1]} radius={[3, 3, 0, 0]} />
              <Line yAxisId="p" dataKey="pctExtras" name="% en extras" stroke={COLORES[2]} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Colaboradores por hora: jornada vs extras */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">¿Cuántos colaboradores preparan en cada hora? — jornada vs extras</CardTitle>
          <CardDescription>
            Promedio de personas con producción en cada hora del día: en verde las que están dentro de sus primeras 8 h, en ámbar las que están en horas extra. La línea marca los bultos promedio de esa hora
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
                <Bar yAxisId="ops" dataKey="opsJornada" name="Personas en jornada (primeras 8 h)" stackId="ops" fill={COLORES[0]} radius={[0, 0, 0, 0]} />
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
          <CardDescription>Ritmo = bultos por hora-hombre. Promedio ponderado del mes y mediana de los días</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[420px] rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Días</TableHead>
                  <TableHead className="text-right">Actividades (op-días)</TableHead>
                  <TableHead className="text-right">Personas</TableHead>
                  <TableHead className="text-right">Bultos sin extras</TableHead>
                  <TableHead className="text-right">Bultos en extras</TableHead>
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
                    <TableCell className="text-right tabular-nums">{n(m.actividades)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.personas}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(m.bultosBase)}</TableCell>
                    <TableCell className="text-right tabular-nums text-amber-700">{n(m.bultosExtras)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{pct(m.pctExtras)}</TableCell>
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
            <CardDescription>Ritmo diario de preparación y cuánta gente trabajó con extras cada día</CardDescription>
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
                    <TableHead className="text-right">% extras</TableHead>
                    <TableHead className="text-right">Personas</TableHead>
                    <TableHead className="text-right">c/ extras</TableHead>
                    <TableHead className="text-right">Ritmo (bultos/h)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.serie.filter((s) => s.fecha.startsWith(mes)).map((s) => (
                    <TableRow key={s.fecha} className={s.opsExtras > 0 ? 'bg-amber-50/50' : undefined}>
                      <TableCell className="font-medium">{fechaCorta(s.fecha)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(s.bultos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(s.bultosBase)}</TableCell>
                      <TableCell className="text-right tabular-nums text-amber-700">{s.bultosExtras ? n(s.bultosExtras) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(s.pctExtras)}</TableCell>
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
