'use client'

// Pestaña "Ola": analisis exclusivo de la ola recibida y los pendientes.
// Regla de negocio: sabados y domingos NO cae ola — esos dias solo se trabaja
// con los pendientes. El promedio y la mediana de la ola se calculan sobre los
// dias con ola (lunes a viernes tipicamente).

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Waves, ClipboardList, TrendingUp, Equal, CalendarOff } from 'lucide-react'
import { Kpi, SinDatos } from './kpi'
import { fetchDatos, n, fechaCorta, COLORES } from '@/lib/client'
import { ComposedChart, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface DiaOla {
  fecha: string
  diaSemana: string
  esFinde: boolean
  semana: string // lunes de la semana ISO
  ola: number
  pendiente: number
  total: number
}
interface OlaData {
  serie: DiaOla[]
}

type Granularidad = 'mensual' | 'semanal' | 'diario'

const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const ORDEN_DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

const etiquetaMes = (ym: string) => `${MESES_ABR[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`

function mediana(vals: number[]): number {
  if (!vals.length) return 0
  const s = [...vals].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

interface FilaPeriodo {
  clave: string
  etiqueta: string
  orden: string
  dias: number
  diasConOla: number
  ola: number
  pendiente: number
  total: number
  olaVals: number[]
  esFinde?: boolean
  diaSemana?: string
}

export function OlaTab() {
  const { data, isLoading } = useQuery({ queryKey: ['ola'], queryFn: () => fetchDatos<OlaData>('ola') })
  const serieAll = useMemo(() => data?.serie ?? [], [data])

  const mesesDisp = useMemo(() => [...new Set(serieAll.map((s) => s.fecha.slice(0, 7)))].sort(), [serieAll])
  const [gran, setGran] = useState<Granularidad>('mensual')
  const [mes, setMes] = useState('todos')

  const cambiarGran = (v: string) => {
    const g = v as Granularidad
    setGran(g)
    // En vista diaria un mes completo es legible; "todo el periodo" no.
    if (g === 'diario' && mes === 'todos' && mesesDisp.length) setMes(mesesDisp[mesesDisp.length - 1])
  }

  const serieF = useMemo(() => (mes === 'todos' ? serieAll : serieAll.filter((s) => s.fecha.startsWith(mes))), [serieAll, mes])

  // ---- KPIs del periodo filtrado ----
  const k = useMemo(() => {
    const conOla = serieF.filter((s) => s.ola > 0)
    const totalOla = serieF.reduce((a, s) => a + s.ola, 0)
    const totalPend = serieF.reduce((a, s) => a + s.pendiente, 0)
    const maxDia = conOla.reduce<DiaOla | null>((a, s) => (s.ola > (a?.ola ?? -1) ? s : a), null)
    return {
      totalOla,
      totalPend,
      total: totalOla + totalPend,
      dias: serieF.length,
      diasConOla: conOla.length,
      diasSinOla: serieF.length - conOla.length,
      promOla: conOla.length ? totalOla / conOla.length : null,
      medOla: conOla.length ? mediana(conOla.map((s) => s.ola)) : null,
      maxDia,
    }
  }, [serieF])

  // ---- Agregacion por periodo (mes / semana / dia) ----
  const porPeriodo = useMemo<FilaPeriodo[]>(() => {
    if (gran === 'diario') {
      return serieF.map((s) => ({
        clave: s.fecha,
        etiqueta: `${fechaCorta(s.fecha)} · ${s.diaSemana.slice(0, 3)}`,
        orden: s.fecha,
        dias: 1,
        diasConOla: s.ola > 0 ? 1 : 0,
        ola: s.ola,
        pendiente: s.pendiente,
        total: s.total,
        olaVals: s.ola > 0 ? [s.ola] : [],
        esFinde: s.esFinde,
        diaSemana: s.diaSemana,
      }))
    }
    const map = new Map<string, FilaPeriodo>()
    for (const s of serieF) {
      const clave = gran === 'mensual' ? s.fecha.slice(0, 7) : s.semana
      let p = map.get(clave)
      if (!p) {
        p = {
          clave,
          etiqueta: gran === 'mensual' ? etiquetaMes(clave) : `Sem. ${fechaCorta(clave)}`,
          orden: clave,
          dias: 0,
          diasConOla: 0,
          ola: 0,
          pendiente: 0,
          total: 0,
          olaVals: [],
        }
        map.set(clave, p)
      }
      p.dias += 1
      if (s.ola > 0) { p.diasConOla += 1; p.olaVals.push(s.ola) }
      p.ola += s.ola
      p.pendiente += s.pendiente
      p.total += s.total
    }
    return [...map.values()].sort((a, b) => a.orden.localeCompare(b.orden))
  }, [gran, serieF])

  // ---- Comportamiento por dia de la semana ----
  const porDiaSem = useMemo(() => {
    const ag = new Map<string, { ola: number; conOla: number; pend: number; conPend: number; dias: number }>()
    for (const s of serieF) {
      let a = ag.get(s.diaSemana)
      if (!a) { a = { ola: 0, conOla: 0, pend: 0, conPend: 0, dias: 0 }; ag.set(s.diaSemana, a) }
      a.dias += 1
      if (s.ola > 0) { a.ola += s.ola; a.conOla += 1 }
      if (s.pendiente > 0) { a.pend += s.pendiente; a.conPend += 1 }
    }
    return ORDEN_DIAS.map((nombre) => {
      const a = ag.get(nombre)
      return {
        dia: nombre.slice(0, 3),
        diaCompleto: nombre,
        OlaProm: a && a.conOla ? a.ola / a.conOla : 0,
        PendProm: a && a.conPend ? a.pend / a.conPend : 0,
        dias: a?.dias ?? 0,
        conOla: a?.conOla ?? 0,
      }
    })
  }, [serieF])

  if (isLoading) return <div className="grid gap-4"><Skeleton className="h-24" /><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
  if (!data || serieAll.length === 0) return <SinDatos mensaje="Cargá el archivo de Ola y Pendiente para ver el análisis de la ola." />

  const hayProm = k.promOla != null && k.promOla > 0
  const esDiarioTodo = gran === 'diario' && mes === 'todos'

  return (
    <div className="space-y-4">
      {/* Filtros: granularidad + mes */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <ToggleGroup type="single" value={gran} onValueChange={(v) => v && cambiarGran(v)} variant="outline">
          <ToggleGroupItem value="mensual" className="px-4">Mensual</ToggleGroupItem>
          <ToggleGroupItem value="semanal" className="px-4">Semanal</ToggleGroupItem>
          <ToggleGroupItem value="diario" className="px-4">Diario</ToggleGroupItem>
        </ToggleGroup>
        <Select value={mes} onValueChange={setMes}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Elegí un mes" /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="todos">Todo el período</SelectItem>
            {[...mesesDisp].reverse().map((m) => <SelectItem key={m} value={m}>{etiquetaMes(m)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* KPIs principales */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          titulo="Ola recibida (total)"
          valor={k.totalOla}
          unidad="bultos"
          icono={Waves}
          tono="exito"
          detalle={`${k.diasConOla} días con ola de ${k.dias} días${k.maxDia ? ` · máx ${n(k.maxDia.ola)} el ${fechaCorta(k.maxDia.fecha)}` : ''}`}
        />
        <Kpi
          titulo="Pendientes trabajados"
          valor={k.totalPend}
          unidad="bultos"
          icono={ClipboardList}
          tono="atencion"
          detalle="Sáb y dom no cae ola: esos días solo se trabaja con pendientes"
        />
        <Kpi
          titulo="Promedio de la ola"
          valor={k.promOla == null ? null : Math.round(k.promOla)}
          unidad="bultos/día"
          icono={TrendingUp}
          detalle={`Sobre los ${k.diasConOla} días con ola (sin contar finde)`}
        />
        <Kpi
          titulo="Mediana de la ola"
          valor={k.medOla == null ? null : Math.round(k.medOla)}
          unidad="bultos/día"
          icono={Equal}
          detalle="El día típico: la mitad de los días cae por debajo"
        />
      </div>

      <Alert>
        <CalendarOff className="h-4 w-4" />
        <AlertTitle>La ola no cae sábados y domingos</AlertTitle>
        <AlertDescription>
          <p>
            De lunes a viernes llega la <b>ola</b> (bultos a preparar del día) y además se procesa <b>pendiente</b> acumulado.
            Los <b>sábados</b> no cae ola — se trabaja únicamente con los pendientes — y los <b>domingos</b> generalmente no hay actividad.
            Por eso el promedio y la mediana de la ola se calculan solo sobre los días con ola.
          </p>
        </AlertDescription>
      </Alert>

      {/* Grafico principal segun granularidad */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {gran === 'mensual' ? 'Ola por mes' : gran === 'semanal' ? 'Ola por semana' : 'Ola por día'}
            <span className="text-muted-foreground font-normal"> — {mes === 'todos' ? 'todo el período' : etiquetaMes(mes)}</span>
          </CardTitle>
          <CardDescription>
            {gran === 'diario'
              ? 'Bultos de cada día: ola (verde) y pendiente (ámbar). Las líneas marcan el promedio y la mediana de la ola del período filtrado'
              : 'Bultos apilados: ola (verde) + pendiente (ámbar) = demanda total del período'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {esDiarioTodo && (
            <p className="text-xs text-muted-foreground mb-2">Estás viendo todos los días del período. Elegí un mes arriba para leer mejor el detalle diario.</p>
          )}
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={porPeriodo} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} interval={gran === 'diario' ? 2 : 'preserveStartEnd'} angle={gran === 'semanal' ? -45 : 0} textAnchor={gran === 'semanal' ? 'end' : 'middle'} height={gran === 'semanal' ? 60 : 30} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => n(v)} labelFormatter={(l) => String(l)} />
              <Legend />
              <Bar dataKey="ola" name="Ola" stackId="a" fill={COLORES[0]} radius={[0, 0, 0, 0]} />
              <Bar dataKey="pendiente" name="Pendiente" stackId="a" fill={COLORES[1]} radius={[3, 3, 0, 0]} />
              {gran === 'diario' && hayProm && (
                <ReferenceLine y={k.promOla} stroke={COLORES[2]} strokeDasharray="6 3" label={{ value: `Prom. ${n(k.promOla)}`, position: 'insideTopRight', fontSize: 10, fill: COLORES[2] }} />
              )}
              {gran === 'diario' && k.medOla != null && k.medOla > 0 && (
                <ReferenceLine y={k.medOla} stroke={COLORES[4]} strokeDasharray="6 3" label={{ value: `Mediana ${n(k.medOla)}`, position: 'insideTopLeft', fontSize: 10, fill: COLORES[4] }} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Comportamiento por dia de la semana */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">¿Cómo se comporta la ola por día de la semana?</CardTitle>
          <CardDescription>
            Promedio de bultos por día de la semana en el período filtrado. Se ve claramente que sábado y domingo no reciben ola: ahí solo se procesa pendiente
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={porDiaSem} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip
                formatter={(v: number) => n(v)}
                labelFormatter={(l, payload) => {
                  const p = payload?.[0]?.payload as { diaCompleto?: string; dias?: number; conOla?: number } | undefined
                  return p?.diaCompleto ? `${p.diaCompleto} (${p.conOla} días con ola de ${p.dias})` : String(l)
                }}
              />
              <Legend />
              <Bar dataKey="OlaProm" name="Ola promedio (días con ola)" fill={COLORES[0]} radius={[3, 3, 0, 0]} />
              <Bar dataKey="PendProm" name="Pendiente promedio (días c/ pendiente)" fill={COLORES[1]} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Tabla de detalle segun granularidad */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Detalle {gran === 'mensual' ? 'mensual' : gran === 'semanal' ? 'semanal' : 'diario'}
            {mes !== 'todos' && ` — ${etiquetaMes(mes)}`}
          </CardTitle>
          <CardDescription>Promedio y mediana calculados sobre los días con ola de cada período</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[420px] rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>{gran === 'diario' ? 'Fecha' : gran === 'semanal' ? 'Semana' : 'Mes'}</TableHead>
                  <TableHead className="text-right">Días</TableHead>
                  <TableHead className="text-right">Días c/ ola</TableHead>
                  <TableHead className="text-right">Ola</TableHead>
                  <TableHead className="text-right">Pendiente</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Prom. ola</TableHead>
                  <TableHead className="text-right">Mediana ola</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porPeriodo.map((p) => (
                  <TableRow key={p.clave} className={p.esFinde ? 'bg-amber-50/50' : undefined}>
                    <TableCell className="font-medium whitespace-nowrap">{p.etiqueta}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.dias}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.diasConOla}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.ola > 0 ? n(p.ola) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.pendiente > 0 ? n(p.pendiente) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(p.total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.diasConOla ? n(p.ola / p.diasConOla) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.diasConOla ? n(mediana(p.olaVals)) : '—'}</TableCell>
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
