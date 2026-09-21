'use client'

// Sección OLA del resumen: cómo se comporta lo que hay que preparar por día —
// por día de semana y por mes, con promedio y mediana.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Waves, ClipboardList, TrendingUp, Equal, CalendarOff } from 'lucide-react'
import { Kpi, SinDatos } from '../kpi'
import { fetchDatos, n, n1, fechaCorta, COLORES } from '@/lib/client'
import { ComposedChart, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { TituloSeccion, mediana } from './comun'

interface DiaOla { fecha: string; diaSemana: string; esFinde: boolean; semana: string; ola: number; pendiente: number; total: number }

const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const ORDEN_DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const etiquetaMes = (ym: string) => `${MESES_ABR[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`

export function OlaResumen() {
  const { data, isLoading } = useQuery({ queryKey: ['ola'], queryFn: () => fetchDatos<{ serie: DiaOla[] }>('ola') })
  const serie = useMemo(() => data?.serie ?? [], [data])

  const porMes = useMemo(() => {
    const m = new Map<string, { olaVals: number[]; ola: number; pend: number }>()
    for (const s of serie) {
      const k = s.fecha.slice(0, 7)
      let p = m.get(k)
      if (!p) { p = { olaVals: [], ola: 0, pend: 0 }; m.set(k, p) }
      p.ola += s.ola; p.pend += s.pendiente
      if (s.ola > 0) p.olaVals.push(s.ola)
    }
    return [...m.entries()].sort().map(([mes, v]) => ({
      etiqueta: etiquetaMes(mes),
      ola: v.ola,
      pendiente: v.pend,
      prom: v.olaVals.length ? v.ola / v.olaVals.length : 0,
      med: v.olaVals.length ? mediana(v.olaVals) : 0,
    }))
  }, [serie])

  const porDiaSem = useMemo(() => {
    const ag = new Map<string, { ola: number; conOla: number; pend: number; conPend: number }>()
    for (const s of serie) {
      let a = ag.get(s.diaSemana)
      if (!a) { a = { ola: 0, conOla: 0, pend: 0, conPend: 0 }; ag.set(s.diaSemana, a) }
      if (s.ola > 0) { a.ola += s.ola; a.conOla += 1 }
      if (s.pendiente > 0) { a.pend += s.pendiente; a.conPend += 1 }
    }
    return ORDEN_DIAS.map((nombre) => {
      const a = ag.get(nombre)
      return { dia: nombre.slice(0, 3), OlaProm: a && a.conOla ? a.ola / a.conOla : 0, PendProm: a && a.conPend ? a.pend / a.conPend : 0 }
    })
  }, [serie])

  if (isLoading) return <div className="grid gap-3 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
  if (!data || serie.length === 0) return <SinDatos mensaje="Cargá el archivo de Ola y Pendiente para ver la demanda a preparar por día." />

  const conOla = serie.filter((s) => s.ola > 0)
  const conPend = serie.filter((s) => s.pendiente > 0)
  const promOla = conOla.length ? conOla.reduce((a, s) => a + s.ola, 0) / conOla.length : null
  const medOla = conOla.length ? mediana(conOla.map((s) => s.ola)) : null
  const promPend = conPend.length ? conPend.reduce((a, s) => a + s.pendiente, 0) / conPend.length : null
  const medPend = conPend.length ? mediana(conPend.map((s) => s.pendiente)) : null
  const conDatos = serie.filter((s) => s.total > 0)
  const promTot = conDatos.length ? conDatos.reduce((a, s) => a + s.total, 0) / conDatos.length : null
  const maxDia = conOla.reduce<DiaOla | null>((a, s) => (s.ola > (a?.ola ?? -1) ? s : a), null)

  return (
    <div className="space-y-4">
      <TituloSeccion icono={Waves} id="sec-ola" titulo="Ola y pendiente: qué hay que preparar por día" descripcion="Comportamiento por día de semana y por mes, con promedio y mediana — el macro de la demanda diaria del área de preparación." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Ola promedio" valor={promOla == null ? null : Math.round(promOla)} unidad="bultos/día" icono={TrendingUp} tono="exito" detalle={`Mediana: ${n(medOla)} bultos · ${conOla.length} días con ola`} />
        <Kpi titulo="Ola mediana (día típico)" valor={medOla == null ? null : Math.round(medOla)} unidad="bultos/día" icono={Equal} detalle="La mitad de los días cae por debajo" />
        <Kpi titulo="Pendiente promedio" valor={promPend == null ? null : Math.round(promPend)} unidad="bultos/día" icono={ClipboardList} tono="atencion" detalle={`Mediana: ${n(medPend)} bultos · ${conPend.length} días`} />
        <Kpi titulo="Demanda total promedio" valor={promTot == null ? null : Math.round(promTot)} unidad="bultos/día" icono={Waves} detalle={`${serie.length} días · máx ${n(maxDia?.ola)} el ${fechaCorta(maxDia?.fecha ?? null)}`} />
      </div>

      <Alert>
        <CalendarOff className="h-4 w-4" />
        <AlertTitle>La ola no cae sábados y domingos</AlertTitle>
        <AlertDescription>
          De lunes a viernes llega la <b>ola</b> (bultos a preparar del día) y además se procesa <b>pendiente</b> acumulado.
          Sábados y domingos solo se trabaja con pendientes: el promedio y la mediana de la ola se calculan sobre los días con ola.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm font-semibold mb-1">Demanda por mes</p>
          <p className="text-xs text-muted-foreground mb-2">Ola (verde) + pendiente (ámbar) apiladas: el volumen total que entra cada mes. Línea: promedio de ola por día con ola.</p>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={porMes} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => n(v)} />
              <Legend />
              <Bar dataKey="ola" name="Ola" stackId="a" fill={COLORES[0]} />
              <Bar dataKey="pendiente" name="Pendiente" stackId="a" fill={COLORES[1]} radius={[3, 3, 0, 0]} />
              <ReferenceLine y={porMes.reduce((a, m) => a + m.prom, 0) / Math.max(1, porMes.length)} stroke={COLORES[3]} strokeDasharray="6 3" label={{ value: 'Prom. mensual', position: 'insideTopRight', fontSize: 10, fill: COLORES[3] }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm font-semibold mb-1">Comportamiento por día de la semana</p>
          <p className="text-xs text-muted-foreground mb-2">Promedio de bultos por día de la semana. Sábado y domingo sin ola: solo pendientes.</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={porDiaSem} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => n(v)} />
              <Legend />
              <Bar dataKey="OlaProm" name="Ola promedio" fill={COLORES[0]} radius={[3, 3, 0, 0]} />
              <Bar dataKey="PendProm" name="Pendiente promedio" fill={COLORES[1]} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl border">
        <div className="px-4 pt-4 pb-2">
          <p className="text-sm font-semibold">Detalle mensual: promedio y mediana</p>
          <p className="text-xs text-muted-foreground">Promedio y mediana calculados sobre los días con ola de cada mes — el día típico de cada mes</p>
        </div>
        <ScrollArea className="h-[260px]">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Mes</TableHead>
                <TableHead className="text-right">Ola</TableHead>
                <TableHead className="text-right">Pendiente</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Prom. ola/día</TableHead>
                <TableHead className="text-right">Mediana ola/día</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...porMes].reverse().map((m) => (
                <TableRow key={m.etiqueta}>
                  <TableCell className="font-medium">{m.etiqueta}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(m.ola)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.pendiente > 0 ? n(m.pendiente) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(m.ola + m.pendiente)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{m.prom ? n(m.prom) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{m.med ? n(m.med) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
      <p className="text-[11px] text-muted-foreground">Los bultos que se preparan cada día salen de esta demanda: la sección de Planificación usa estos promedios y medianas para estimar la dotación.</p>
    </div>
  )
}
