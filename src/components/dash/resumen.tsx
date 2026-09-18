'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Boxes, Clock, Gauge, TriangleAlert, Users, UploadCloud, ArrowRight } from 'lucide-react'
import { Kpi, SinDatos } from './kpi'
import { fetchDatos, n, n1, pct, horasHMin, fechaCorta, COLORES } from '@/lib/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface ResumenData {
  datasets: {
    ola: { registros: number; desde: string | null; hasta: string | null; olaMedia: number; totalMedia: number }
    h61: { registros: number; desde: string | null; hasta: string | null; bultos: number; horas: number; productividad: number; operarios: number; extrasHoras: number; bultosExtras: number; pctBultosExtras: number }
    tm: { registros: number; desde: string | null; hasta: string | null; minutos: number; horas: number; pctSobreHorasH61: number }
    picking: { registros: number; desde: string | null; hasta: string | null }
  }
  topCategoriasTM: { categoria: string; minutos: number; registros: number }[]
  batches: { id: string; tipo: string; filename: string | null; rows: number; createdAt: string }[]
}

export function ResumenTab({ onIrACarga }: { onIrACarga: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['resumen'], queryFn: () => fetchDatos<ResumenData>('resumen') })

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
    )
  }
  if (error) return <SinDatos mensaje={`Error cargando resumen: ${(error as Error).message}`} />
  if (!data) return <SinDatos />

  const { ola, h61, tm, picking } = data.datasets
  const vacio = h61.registros === 0 && ola.registros === 0 && tm.registros === 0

  const focos: string[] = []
  if (data.topCategoriasTM[0]) focos.push(`El mayor tiempo muerto es “${data.topCategoriasTM[0].categoria}” con ${horasHMin(data.topCategoriasTM[0].minutos)} acumulados (${data.topCategoriasTM[0].registros} eventos).`)
  if (h61.pctBultosExtras > 0) focos.push(`El ${pct(h61.pctBultosExtras)} de los bultos (${n(h61.bultosExtras)}) se prepara en horas extra: ${n(h61.extrasHoras)} horas extra informadas.`)
  if (h61.productividad) focos.push(`Productividad global de preparación: ${n1(h61.productividad)} bultos por hora-hombre (promedio sobre ${n(h61.horas)} horas).`)
  if (tm.horas && h61.horas) focos.push(`Los tiempos muertos informados equivalen a ${n(tm.horas)} horas-hombre (${pct(tm.pctSobreHorasH61)} de las horas de preparación).`)

  return (
    <div className="space-y-4">
      {vacio ? (
        <SinDatos mensaje="Aún no hay datos. Empezá cargando los archivos Excel." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi titulo="Bultos preparados (H61)" valor={h61.bultos} icono={Boxes} detalle={`Período ${fechaCorta(h61.desde)} → ${fechaCorta(h61.hasta)}`} />
            <Kpi titulo="Productividad media" valor={h61.productividad} formato="decimal" unidad="bultos/h" icono={Gauge} detalle={`${n(h61.horas)} horas-hombre · ${n(h61.operarios)} operarios`} tono="exito" />
            <Kpi titulo="Horas extra" valor={h61.extrasHoras} unidad="h" icono={Clock} detalle={`${pct(h61.pctBultosExtras)} de la producción se hace en extras`} tono="atencion" />
            <Kpi titulo="Tiempo muerto informado" valor={tm.horas} unidad="h" icono={TriangleAlert} detalle={`${n(tm.registros)} eventos · ${pct(tm.pctSobreHorasH61)} de horas de prep.`} tono="alerta" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi titulo="Ola diaria promedio" valor={ola.olaMedia} unidad="bultos" icono={Boxes} detalle={`Demanda total prom. ${n(ola.totalMedia)} con pendiente`} />
            <Kpi titulo="Días con demanda cargada" valor={ola.registros} icono={UploadCloud} detalle={ola.registros ? `${fechaCorta(ola.desde)} → ${fechaCorta(ola.hasta)}` : 'Sin carga'} />
            <Kpi titulo="Operarios distintos" valor={h61.operarios} icono={Users} detalle="En el período del H61" />
            <Kpi titulo="Eventos de picking" valor={picking.registros} icono={Boxes} detalle={picking.registros ? `${fechaCorta(picking.desde)} → ${fechaCorta(picking.hasta)}` : 'Archivo grande pendiente de carga'} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Focos de mejora detectados</CardTitle>
                <CardDescription>Generados automáticamente a partir de los datos cargados</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {focos.map((f, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-md border bg-muted/30 p-3">
                    <ArrowRight className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
                    <p className="text-sm leading-relaxed">{f}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Tiempos muertos por categoría</CardTitle>
                <CardDescription>Horas acumuladas por grupo normalizado de motivo</CardDescription>
              </CardHeader>
              <CardContent>
                {data.topCategoriasTM.length === 0 ? (
                  <SinDatos mensaje="Cargá el archivo de tiempos muertos para ver este gráfico." />
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={data.topCategoriasTM.map((c) => ({ ...c, horas: +(c.minutos / 60).toFixed(1) }))} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="categoria" width={130} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => [`${n1(v)} h`, 'Horas']} />
                      <Bar dataKey="horas" radius={[0, 4, 4, 0]}>
                        {data.topCategoriasTM.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {data.batches.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Últimas cargas</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {data.batches.map((b) => (
                    <div key={b.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                      <span className="font-medium uppercase text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">{b.tipo}</span>
                      <span className="flex-1 truncate text-muted-foreground">{b.filename ?? b.id}</span>
                      <span className="tabular-nums">{n(b.rows)} filas</span>
                      <span className="text-xs text-muted-foreground hidden sm:inline">{new Date(b.createdAt).toLocaleString('es-AR')}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
      {!vacio && data.batches.length === 0 && (
        <p className="text-xs text-muted-foreground">¿Primera vez? Cargá tus archivos desde la pestaña Carga de Datos.</p>
      )}
      {vacio && (
        <button onClick={onIrACarga} className="text-sm text-emerald-700 underline">Ir a Carga de Datos</button>
      )}
    </div>
  )
}
