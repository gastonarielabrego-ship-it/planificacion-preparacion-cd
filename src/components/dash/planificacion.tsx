'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarX2, Hourglass, Percent, Target } from 'lucide-react'
import { Kpi, SinDatos } from './kpi'
import { fetchDatos, n, n1, pct, fechaCorta, COLORES } from '@/lib/client'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface SerieDia {
  fecha: string
  ola: number | null
  pendiente: number | null
  demanda: number | null
  preparado: number | null
  ops: number | null
  opsExtras: number | null
  horas: number | null
  horasExtras: number | null
  prodHora: number | null
  bultosBase: number | null
  bultosExtras: number | null
  faltanteSinExtras: number | null
}
interface PlanData {
  serie: SerieDia[]
  meses: { mes: string; ola: number; demanda: number; preparado: number; dias: number; diasExtras: number; horasExtras: number; faltante: number }[]
  resumen: { dias: number; diasConExtras: number; pctDiasConExtras: number; faltantePromedioSinExtras: number; faltanteTotalSinExtras: number; horasExtrasTotales: number; bultosExtrasTotales: number; prodHoraMedia: number | null }
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const nombreMes = (ym: string) => `${MESES[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`

export function PlanificacionTab() {
  const { data, isLoading } = useQuery({ queryKey: ['planificacion'], queryFn: () => fetchDatos<PlanData>('planificacion') })
  const meses = useMemo(() => (data?.meses ?? []).filter((m) => m.demanda > 0 || m.preparado > 0), [data])
  const [mes, setMes] = useState<string>('todos')

  const serie = useMemo(() => {
    const s = data?.serie ?? []
    if (mes === 'todos') return s.filter((x) => x.demanda != null || x.preparado != null)
    return s.filter((x) => x.fecha.startsWith(mes))
  }, [data, mes])

  const r = useMemo(() => {
    const dias = serie.length
    const conExtras = serie.filter((s) => (s.opsExtras ?? 0) > 0)
    const vals = serie.filter((s) => s.prodHora != null && (s.preparado ?? 0) > 0)
    const totB = vals.reduce((a, s) => a + (s.preparado ?? 0), 0)
    const totH = vals.reduce((a, s) => a + (s.horas ?? 0), 0)
    return {
      dias,
      diasConExtras: conExtras.length,
      pctDiasConExtras: dias ? +((conExtras.length / dias) * 100).toFixed(1) : 0,
      faltantePromedioSinExtras: conExtras.length ? Math.round(conExtras.reduce((a, s) => a + (s.faltanteSinExtras ?? 0), 0) / conExtras.length) : 0,
      faltanteTotalSinExtras: conExtras.reduce((a, s) => a + (s.faltanteSinExtras ?? 0), 0),
      horasExtrasTotales: serie.reduce((a, s) => a + (s.horasExtras ?? 0), 0),
      bultosExtrasTotales: serie.reduce((a, s) => a + (s.bultosExtras ?? 0), 0),
      prodHoraMedia: totH ? +(totB / totH).toFixed(1) : null,
    }
  }, [serie])

  const chartData = serie.map((s) => ({
    fecha: fechaCorta(s.fecha),
    Demanda: s.demanda ?? 0,
    Preparado: s.preparado ?? 0,
    Ola: s.ola ?? 0,
    Faltante: s.faltanteSinExtras ?? 0,
  }))

  if (isLoading) return <div className="grid gap-4"><Skeleton className="h-24" /><Skeleton className="h-72" /></div>
  if (!data || data.serie.length === 0) return <SinDatos mensaje="Cargá los archivos de Ola y Pendiente y del H61 para planificar." />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <Select value={mes} onValueChange={setMes}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Elegí un mes" /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="todos">Todo el período</SelectItem>
            {[...meses].reverse().map((m) => <SelectItem key={m.mes} value={m.mes}>{nombreMes(m.mes)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Días que dependen de extras" valor={r.pctDiasConExtras} formato="porcentaje" icono={Percent} detalle={`${r.diasConExtras} de ${r.dias} días con operarios en horas extra`} tono="atencion" />
        <Kpi titulo="Horas extra del período" valor={r.horasExtrasTotales} unidad="h" icono={Hourglass} detalle={`${n(r.bultosExtrasTotales)} bultos preparados en extras`} />
        <Kpi titulo="Bultos no preparables sin extras" valor={r.faltanteTotalSinExtras} unidad="bultos" icono={CalendarX2} detalle={`Promedio en días con extras: ${n(r.faltantePromedioSinExtras)}`} tono="alerta" />
        <Kpi titulo="Productividad media" valor={r.prodHoraMedia} formato="decimal" unidad="bultos/h" icono={Target} tono="exito" />
      </div>

      <Alert>
        <Hourglass className="h-4 w-4" />
        <AlertTitle>¿Cómo funcionan las extras y qué pasa si se suprimen?</AlertTitle>
        <AlertDescription className="text-sm leading-relaxed">
          Cada operario-día se clasifica por sus horas con producción informadas en el H61: hasta 8 h = jornada base;
          por encima de 8 h se computan <b>horas extra</b> (típicamente jornadas de 12 h = 4 h extra).
          El <b>faltante sin extras</b> de cada día estima cuántos bultos de la demanda no podrían prepararse si se eliminan las extras,
          manteniendo la productividad por hora: eso quedará como <b>pendiente</b> para el día siguiente o exigirá más dotación base.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Demanda vs preparación diaria</CardTitle>
          <CardDescription>Bultos por día: demanda (ola + pendiente) contra producción preparada y faltante estimado sin extras</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="fecha" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => n(v)} />
              <Legend />
              <Bar dataKey="Demanda" fill={COLORES[3]} radius={[3, 3, 0, 0]} />
              <Bar dataKey="Preparado" fill={COLORES[0]} radius={[3, 3, 0, 0]} />
              <Line dataKey="Faltante" stroke={COLORES[2]} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalle diario {mes !== 'todos' && `— ${nombreMes(mes)}`}</CardTitle>
          <CardDescription>Planificación por día: demanda, dotación, extras y capacidad base</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[420px] rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Ola</TableHead>
                  <TableHead className="text-right">Pendiente</TableHead>
                  <TableHead className="text-right">Demanda</TableHead>
                  <TableHead className="text-right">Preparado</TableHead>
                  <TableHead className="text-right">Dotación</TableHead>
                  <TableHead className="text-right">Ops. c/ extras</TableHead>
                  <TableHead className="text-right">Horas extra</TableHead>
                  <TableHead className="text-right">Bultos/h</TableHead>
                  <TableHead className="text-right">Faltante s/ extras</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {serie.map((s) => (
                  <TableRow key={s.fecha} className={(s.opsExtras ?? 0) > 0 ? 'bg-amber-50/50' : undefined}>
                    <TableCell className="font-medium">{fechaCorta(s.fecha)}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.ola == null ? '—' : n(s.ola)}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.pendiente == null ? '—' : n(s.pendiente)}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.demanda == null ? '—' : n(s.demanda)}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.preparado == null ? '—' : n(s.preparado)}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.ops ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{(s.opsExtras ?? 0) > 0 ? <span className="font-semibold text-amber-700">{s.opsExtras}</span> : '0'}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.horasExtras ? n(s.horasExtras) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.prodHora ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.faltanteSinExtras ? <span className="text-red-600 font-semibold">{n(s.faltanteSinExtras)}</span> : '0'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Resumen por mes</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-72 rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Días</TableHead>
                  <TableHead className="text-right">Días c/ extras</TableHead>
                  <TableHead className="text-right">Demanda</TableHead>
                  <TableHead className="text-right">Preparado</TableHead>
                  <TableHead className="text-right">Horas extra</TableHead>
                  <TableHead className="text-right">Faltante s/ extras</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meses.map((m) => (
                  <TableRow key={m.mes}>
                    <TableCell className="font-medium">{nombreMes(m.mes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.dias}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.diasExtras}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(m.demanda)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(m.preparado)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(m.horasExtras)}</TableCell>
                    <TableCell className="text-right tabular-nums text-red-600">{n(m.faltante)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
