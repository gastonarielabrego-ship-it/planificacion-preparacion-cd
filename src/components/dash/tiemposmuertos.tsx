'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, MapPin, Timer, ToggleLeft } from 'lucide-react'
import { Kpi, SinDatos } from './kpi'
import { fetchDatos, n, n1, pct, fechaCorta, horasHMin, COLORES } from '@/lib/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, ComposedChart, Line, Legend } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown } from 'lucide-react'

interface TMData {
  totalMin: number
  totalHoras: number
  registros: number
  porCategoria: { categoria: string; minutos: number; registros: number; pct: number }[]
  porNave: { nave: string; minutos: number; registros: number; pasillos: { pasillo: string; minutos: number; registros: number }[] }[]
  porTurno: { turno: string; nombre: string; minutos: number }[]
  porDia: { fecha: string; minutos: number }[]
  porHora: { hora: number; etiqueta: string; minutos: number }[]
  topDetalles: { detalle: string; minutos: number; registros: number }[]
  codigoCategoria: { code: number | null; categoria: string; minutos: number; registros: number }[]
  navesResumen: { minutos: number; naves: number; pasillos: number }
}

export function TiemposMuertosTab() {
  const [incluirBajas, setIncluirBajas] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['tm', incluirBajas],
    queryFn: () => fetchDatos<TMData>('tm', { incluirBajas }),
  })

  if (isLoading) return <div className="grid gap-4"><Skeleton className="h-24" /><Skeleton className="h-72" /></div>
  if (!data || data.registros === 0) return <SinDatos mensaje="Cargá el archivo 'tiempos muertos' para ver el análisis." />

  // pareto con acumulado
  const pareto = data.porCategoria.map((c, i) => {
    const acum = data.porCategoria.slice(0, i + 1).reduce((a, x) => a + x.minutos, 0)
    return { ...c, horas: +(c.minutos / 60).toFixed(1), acumPct: +((acum / data.totalMin) * 100).toFixed(1) }
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 justify-end">
        <Switch id="bajas" checked={incluirBajas} onCheckedChange={setIncluirBajas} />
        <Label htmlFor="bajas" className="text-sm flex items-center gap-1.5"><ToggleLeft className="h-4 w-4" /> Incluir registros de baja (ESTADO B = errores de carga)</Label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Tiempo muerto total" valor={data.totalHoras} unidad="h" formato="decimal" icono={Timer} detalle={`${n(data.registros)} eventos informados`} tono="alerta" />
        <Kpi titulo="Motivo n° 1" valor={data.porCategoria[0]?.categoria ?? '—'} formato="texto" icono={AlertTriangle} detalle={`${horasHMin(data.porCategoria[0]?.minutos ?? 0)} · ${pct(data.porCategoria[0]?.pct ?? 0)} del total`} tono="atencion" />
        <Kpi titulo="Esperas por ubicación" valor={data.navesResumen.minutos / 60} unidad="h" icono={MapPin} detalle={`${data.navesResumen.naves} naves y ${data.navesResumen.pasillos} pasillos afectados`} tono="alerta" />
        <Kpi titulo="Promedio por evento" valor={data.registros ? data.totalMin / data.registros : 0} formato="decimal" unidad="min" icono={Timer} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pareto de motivos agrupados</CardTitle>
          <CardDescription>Los motivos se normalizan desde el texto libre (mayúsculas, tildes y errores de tipeo corregidos). Línea = % acumulado.</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={pareto} margin={{ left: 4, right: 8, top: 8, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="categoria" angle={-30} textAnchor="end" height={70} interval={0} tick={{ fontSize: 10 }} />
              <YAxis yAxisId="h" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
              <Tooltip formatter={(v: number, k: string) => (k === 'horas' ? [`${n1(v)} h`, 'Horas'] : k === 'acumPct' ? [`${n1(v)}%`, 'Acumulado'] : [n(v), 'Eventos'])} />
              <Legend />
              <Bar yAxisId="h" dataKey="horas" name="Horas" radius={[3, 3, 0, 0]}>
                {pareto.map((_, i) => <Cell key={i} fill={i === 0 ? '#dc2626' : COLORES[i % COLORES.length]} />)}
              </Bar>
              <Line yAxisId="p" dataKey="acumPct" name="Acumulado %" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Esperas por nave y pasillo</CardTitle>
          <CardDescription>Eventos con ubicación en el texto (ej: “ESPERA E-11-124” → nave E, pasillo 11, posición 124). Expandí cada nave para ver sus pasillos.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.porNave.length === 0 ? (
            <p className="text-sm text-muted-foreground">No se detectaron ubicaciones en las observaciones.</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {data.porNave.map((nv) => (
                <Collapsible key={nv.nave} className="rounded-md border">
                  <CollapsibleTrigger className="group flex w-full items-center justify-between px-3 py-2.5 hover:bg-muted/40">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-800">{nv.nave}</span>
                      <div className="text-left">
                        <p className="text-sm font-semibold">Nave {nv.nave}</p>
                        <p className="text-xs text-muted-foreground">{n1(nv.minutos / 60)} h · {n(nv.registros)} eventos</p>
                      </div>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ScrollArea className="max-h-60 px-3 pb-3">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="h-8">Pasillo</TableHead>
                            <TableHead className="h-8 text-right">Horas</TableHead>
                            <TableHead className="h-8 text-right">Eventos</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {nv.pasillos.map((p) => (
                            <TableRow key={p.pasillo}>
                              <TableCell className="py-1.5">Pasillo {p.pasillo}</TableCell>
                              <TableCell className="py-1.5 text-right tabular-nums">{n1(p.minutos / 60)}</TableCell>
                              <TableCell className="py-1.5 text-right tabular-nums">{n(p.registros)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tiempo muerto por turno</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.porTurno.map((t) => ({ ...t, horas: +(t.minutos / 60).toFixed(1) }))} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="nombre" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => [`${n1(v)} h`, 'Horas']} />
                <Bar dataKey="horas" radius={[3, 3, 0, 0]}>
                  {data.porTurno.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tiempo muerto por hora del día</CardTitle>
            <CardDescription>Según hora de inicio informada del evento</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.porHora} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 9 }} interval={1} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v: number) => [n(v), 'Minutos']} />
                <Bar dataKey="minutos" fill={COLORES[1]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Evolución diaria</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.porDia.map((d) => ({ ...d, horas: +(d.minutos / 60).toFixed(1), f: fechaCorta(d.fecha) }))} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="f" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`${n1(v)} h`, 'Horas']} />
              <Bar dataKey="horas" fill={COLORES[0]} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Motivos crudos más frecuentes</CardTitle>
            <CardDescription>Texto original normalizado (para auditar la agrupación automática)</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-80 rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Motivo (texto)</TableHead>
                    <TableHead className="text-right">Horas</TableHead>
                    <TableHead className="text-right">Eventos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topDetalles.map((d) => (
                    <TableRow key={d.detalle}>
                      <TableCell className="py-1.5">{d.detalle}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">{n1(d.minutos / 60)}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">{n(d.registros)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cruce código de sistema × categoría</CardTitle>
            <CardDescription>Los códigos del WMS agrupan motivos distintos; el texto permite separarlos mejor</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-80 rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Categoría detectada</TableHead>
                    <TableHead className="text-right">Horas</TableHead>
                    <TableHead className="text-right">Eventos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.codigoCategoria.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell className="py-1.5 font-medium">{c.code ?? '—'}</TableCell>
                      <TableCell className="py-1.5">{c.categoria}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">{n1(c.minutos / 60)}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">{n(c.registros)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
