'use client'

import { useQuery } from '@tanstack/react-query'
import { Factory, Timer, Boxes, Gauge, Users, Layers } from 'lucide-react'
import { Kpi, SinDatos } from './kpi'
import { fetchDatos, n, n1, COLORES } from '@/lib/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart, Line, Legend, Cell } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface ProdCircData {
  registros: number
  vacio?: boolean
  desde?: string
  hasta?: string
  meses?: number
  fuentes?: { filename: string | null; rows: number; fecha: string }[]
  kpis?: {
    registros: number
    soportes: number
    lineas: number
    bultos: number
    horasTotal: number
    horasMuerto: number
    horasNeto: number
    pctMuerto: number | null
    prodTotal: number | null
    prodNeto: number | null
    prodSuperNeto: number | null
  }
  porSector?: { sector: string; soportes: number; bultos: number; pctMuerto: number | null; prodSuperNeto: number | null }[]
  porMes?: { mes: string; bultos: number; pctMuerto: number | null; prodSuperNeto: number | null }[]
  operariosTop?: { operario: string; nombre: string; bultos: number; soportes: number; horasTotal: number; pctMuerto: number | null; prodSuperNeto: number | null }[]
}

export function ProdCircTab() {
  const { data, isLoading } = useQuery({ queryKey: ['prodcirc'], queryFn: () => fetchDatos<ProdCircData>('prodcirc') })

  if (isLoading) return <Skeleton className="h-72" />
  if (!data || data.vacio || !data.kpis) {
    return (
      <div className="space-y-4">
        <Alert>
          <Factory className="h-4 w-4" />
          <AlertTitle>Módulo listo — esperando los archivos de productividad por circuito</AlertTitle>
          <AlertDescription className="leading-relaxed">
            Acá se cargan los reportes <b>“Productividad X Circuito”</b> y <b>“Tiempos E-8”</b> (julio, agosto, septiembre):
            tiempos total / muerto / neto / super neto y producción por colaborador, sector, día y turno.
            Reconocidos automáticamente por el script Python (nombres que incluyan “Tiempos”, “Circuito”, “Productividad” o “E8”).
          </AlertDescription>
        </Alert>
        <SinDatos mensaje="No hay datos de productividad por circuito cargados todavía." />
      </div>
    )
  }

  const k = data.kpis
  const meses = (data.porMes ?? []).map((m) => ({ ...m, etiqueta: m.mes.slice(5) === '' ? m.mes : m.mes.replace('-', '/') }))
  const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const etiquetaPeriodo = (() => {
    if (!data.desde || !data.hasta) return null
    const f = (iso: string) => { const [y, m] = iso.slice(0, 10).split('-'); return `${MESES_CORTOS[parseInt(m, 10) - 1]} ${y.slice(2)}` }
    return `${f(data.desde)} → ${f(data.hasta)}`
  })()

  return (
    <div className="space-y-4">
      <Alert>
        <Factory className="h-4 w-4" />
        <AlertTitle className="text-sm">Fuente del análisis: reporte <b>Tiempos E-8</b> (Productividad X Circuito)</AlertTitle>
        <AlertDescription className="leading-relaxed text-xs">
          Este módulo se calcula <b>solo</b> con los archivos “Tiempos E-8” / “Productividad X Circuito” cargados en Carga de Datos —
          no mezcla datos de H61, Ola ni Tiempos Muertos. Los reportes E-8 se generan por mes (julio, agosto, septiembre…),
          por lo que el tablero toma únicamente los meses incluidos en esos archivos:
          {' '}<b>{data.meses ?? (data.porMes ?? []).length} {data.meses === 1 ? 'mes' : 'meses'} con datos</b>{etiquetaPeriodo ? ` (${etiquetaPeriodo})` : ''}.
          {(data.fuentes ?? []).length > 0 && (
            <>
              <br />
              Archivos tomados en cuenta: {(data.fuentes ?? []).map((fu) => `${fu.filename ?? '(sin nombre)'} (${n(fu.rows)} filas)`).join(' · ')}
            </>
          )}
        </AlertDescription>
      </Alert>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Bultos preparados" valor={k.bultos} icono={Boxes} detalle={`${n(k.registros)} registros ${data.desde ?? ''} → ${data.hasta ?? ''}`} />
        <Kpi titulo="% Tiempo muerto" valor={k.pctMuerto ?? 0} formato="decimal" unidad="%" icono={Timer} tono="alerta" detalle={`${n1(k.horasMuerto)} h muertas de ${n1(k.horasTotal)} h totales`} />
        <Kpi titulo="Prod. super neta" valor={k.prodSuperNeto ?? 0} formato="decimal" unidad="bult/h" icono={Gauge} detalle="Bultos por hora super neta (sin muertos ni auxiliares)" />
        <Kpi titulo="Prod. neta vs total" valor={k.prodNeto ?? 0} formato="decimal" unidad="bult/h" icono={Gauge} tono="atencion" detalle={`Prod. total (con muertos): ${n1(k.prodTotal ?? 0)} bult/h`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Soportes" valor={k.soportes} icono={Layers} />
        <Kpi titulo="Líneas" valor={k.lineas} icono={Factory} />
        <Kpi titulo="Horas netas" valor={k.horasNeto} formato="decimal" unidad="h" icono={Timer} />
        <Kpi titulo="Colaboradores" valor={(data.operariosTop ?? []).length} icono={Users} detalle="Top por bultos en el período" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">% Tiempo muerto por sector</CardTitle>
            <CardDescription>Horas muertas sobre horas totales, por circuito/sector</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.porSector ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="sector" fontSize={12} />
                <YAxis fontSize={12} unit="%" />
                <Tooltip formatter={(v: number) => `${v}%`} />
                <Bar dataKey="pctMuerto" name="% tiempo muerto" radius={[4, 4, 0, 0]}>
                  {(data.porSector ?? []).map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bultos y % muerto por mes</CardTitle>
            <CardDescription>Volumen preparado y peso del tiempo muerto</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={meses}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="etiqueta" fontSize={12} />
                <YAxis yAxisId="b" fontSize={12} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <YAxis yAxisId="p" orientation="right" fontSize={12} unit="%" />
                <Tooltip />
                <Legend />
                <Bar yAxisId="b" dataKey="bultos" name="Bultos" fill="#059669" radius={[4, 4, 0, 0]} />
                <Line yAxisId="p" dataKey="pctMuerto" name="% muerto" stroke="#dc2626" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top colaboradores por bultos</CardTitle>
          <CardDescription>Producción y % de tiempo muerto individual en el período</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Colaborador</TableHead>
                <TableHead className="text-right">Bultos</TableHead>
                <TableHead className="text-right">Soportes</TableHead>
                <TableHead className="text-right">Horas</TableHead>
                <TableHead className="text-right">% Muerto</TableHead>
                <TableHead className="text-right">Prod. super neta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data.operariosTop ?? []).map((o) => (
                <TableRow key={o.operario}>
                  <TableCell>
                    <div className="font-medium">{o.nombre}</div>
                    <div className="text-xs text-muted-foreground">{o.operario}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{n(o.bultos)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(o.soportes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n1(o.horasTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums">{o.pctMuerto != null ? `${n1(o.pctMuerto)}%` : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{o.prodSuperNeto != null ? n1(o.prodSuperNeto) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
