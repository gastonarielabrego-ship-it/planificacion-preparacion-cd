'use client'

import { useQuery } from '@tanstack/react-query'
import { Clock3, Boxes, RefreshCcw, User } from 'lucide-react'
import { Kpi, SinDatos } from './kpi'
import { fetchDatos, n, n1, COLORES } from '@/lib/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface PickingData {
  registros: number
  vacio?: boolean
  operarios?: number
  gapPromedio?: number | null
  cambiosSoporte?: number
  gapPromedioCambioSoporte?: number | null
  distribucionGaps?: { bucket: string; cantidad: number }[]
  distribucionGapsSoporte?: { bucket: string; cantidad: number }[]
  operariosTop?: { operario: string; eventos: number; bultos: number; gapPromedio: number; cambiosSoporte: number }[]
  serie?: { fecha: string; eventos: number; gapPromedio: number | null }[]
}

export function PickingTab() {
  const { data, isLoading } = useQuery({ queryKey: ['picking'], queryFn: () => fetchDatos<PickingData>('picking') })

  if (isLoading) return <Skeleton className="h-72" />
  if (!data || data.vacio) {
    return (
      <div className="space-y-4">
        <Alert>
          <Clock3 className="h-4 w-4" />
          <AlertTitle>Módulo listo — esperando el archivo de producción por picking</AlertTitle>
          <AlertDescription className="leading-relaxed">
            Este módulo estimará el <b>tiempo muerto entre pickings</b> y el <b>tiempo entre soportes</b> cuando cargues el archivo grande
            (excede el límite del chat). Usá el script <code className="rounded bg-muted px-1">subir_archivo.py</code> incluido en el repositorio
            (ver pestaña Carga de Datos): leés el archivo con Python y el script lo envía por lotes a esta app, aunque pese cientos de MB.
          </AlertDescription>
        </Alert>
        <SinDatos mensaje="No hay eventos de picking cargados todavía." />
      </div>
    )
  }

  const totalGaps = (data.distribucionGaps ?? []).reduce((a, b) => a + b.cantidad, 0) || 1

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Eventos de picking" valor={data.registros} icono={Boxes} />
        <Kpi titulo="Operarios" valor={data.operarios ?? 0} icono={User} />
        <Kpi titulo="Gap promedio entre pickings" valor={data.gapPromedio ?? 0} formato="decimal" unidad="min" icono={Clock3} tono="atencion" detalle="Tiempo entre eventos consecutivos del mismo operario" />
        <Kpi titulo="Gap promedio al cambiar soporte" valor={data.gapPromedioCambioSoporte ?? 0} formato="decimal" unidad="min" icono={RefreshCcw} tono="alerta" detalle={`${n(data.cambiosSoporte ?? 0)} cambios de soporte detectados`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Distribución de tiempos muertos entre pickings</CardTitle>
            <CardDescription>Porcentaje de gaps en cada rango de minutos</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={(data.distribucionGaps ?? []).map((d) => ({ ...d, p: +((d.cantidad / totalGaps) * 100).toFixed(1) }))} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} unit="%" />
                <Tooltip formatter={(v: number) => [`${n1(v)}%`, 'Proporción']} />
                <Bar dataKey="p" radius={[3, 3, 0, 0]}>
                  {(data.distribucionGaps ?? []).map((_, i) => <Cell key={i} fill={i >= 4 ? '#dc2626' : i >= 2 ? '#d97706' : '#059669'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tiempos al cambiar de soporte</CardTitle>
            <CardDescription>Gap cuando el evento implica pasar a un soporte distinto (traslado/reposicionamiento)</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={(data.distribucionGapsSoporte ?? []).map((d, i) => ({ ...d, p: +((d.cantidad / (data.cambiosSoporte || 1)) * 100).toFixed(1) }))} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} unit="%" />
                <Tooltip formatter={(v: number) => [`${n1(v)}%`, 'Proporción']} />
                <Bar dataKey="p" radius={[3, 3, 0, 0]}>
                  {(data.distribucionGapsSoporte ?? []).map((_, i) => <Cell key={i} fill={i >= 4 ? '#dc2626' : i >= 2 ? '#d97706' : '#059669'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Operarios con más eventos</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operario</TableHead>
                <TableHead className="text-right">Eventos</TableHead>
                <TableHead className="text-right">Bultos</TableHead>
                <TableHead className="text-right">Gap prom. (min)</TableHead>
                <TableHead className="text-right">Cambios de soporte</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data.operariosTop ?? []).map((o) => (
                <TableRow key={o.operario}>
                  <TableCell className="font-medium">{o.operario}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(o.eventos)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(o.bultos)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n1(o.gapPromedio)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(o.cambiosSoporte)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Eventos por día y gap promedio</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={(data.serie ?? []).map((s) => ({ ...s, f: s.fecha.slice(5) }))} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="f" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => [n(v), 'Eventos']} />
              <Bar dataKey="eventos" fill={COLORES[0]} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
