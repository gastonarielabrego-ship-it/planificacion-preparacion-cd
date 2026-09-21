'use client'

// Secciones "Tiempos muertos" (versión resumen: pareto de categorías unificadas,
// espera de piking por nave, por turno y por hora — SIN evolución diaria, sin
// motivos crudos y sin cruce de código por sistema) y "E-8" (tiempo muerto entre
// piking: promedio, mediana, horario, calor día×turno, % de la jornada y naves).

import { TriangleAlert, Timer, Warehouse, Boxes, CalendarClock } from 'lucide-react'
import { Kpi, SinDatos } from '../kpi'
import { n, n1, pct, horasHMin, COLORES, GG_VERDE, GG_NARANJA, GG_GRIS } from '@/lib/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, ComposedChart, Line, AreaChart, Area } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'

export interface TMData {
  totalMin: number
  totalHoras: number
  registros: number
  porCategoria: { categoria: string; minutos: number; registros: number; pct: number }[]
  porNave: { nave: string; minutos: number; registros: number; pasillos: { pasillo: string; minutos: number; registros: number }[] }[]
  porTurno: { turno: string; nombre: string; minutos: number }[]
  porHora: { hora: number; etiqueta: string; minutos: number }[]
  porHoraEsperaPiking: { hora: number; etiqueta: string; minutos: number }[]
  navesResumen: { minutos: number; naves: number; pasillos: number }
}

export function SeccionTiemposMuertos({ data, horasH61 }: { data: TMData; horasH61: number }) {
  if (!data.registros) return <SinDatos mensaje="Cargá el archivo de tiempos muertos para ver esta sección." />
  const espera = data.porCategoria.find((c) => c.categoria === 'ESPERA PICKING')
  const pareto = (() => {
    // % acumulado con reduce (sin mutar variables externas)
    const acumulados: number[] = []
    data.porCategoria.reduce((acc, c) => {
      const total = acc + c.pct
      acumulados.push(total)
      return total
    }, 0)
    return data.porCategoria.map((c, i) => ({ ...c, horas: +(c.minutos / 60).toFixed(1), acumulado: +acumulados[i].toFixed(1) }))
  })()

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Tiempo muerto total" valor={data.totalHoras} unidad="h" icono={TriangleAlert} tono="alerta" detalle={`${n(data.registros)} eventos informados`} />
        <Kpi titulo="% sobre horas de preparación" valor={horasH61 ? (data.totalMin / 60 / horasH61) * 100 : null} formato="porcentaje" icono={Timer} detalle="Horas muertas contra horas-hombre H61 del período" />
        <Kpi titulo="Espera de piking" valor={espera ? horasHMin(espera.minutos) : '—'} formato="texto" icono={Warehouse} tono="atencion" detalle={`${pct(espera?.pct)} del tiempo muerto · motivo n° 1 del pareto`} />
        <Kpi titulo="Naves con espera de piking" valor={data.navesResumen.naves} icono={Boxes} detalle={`${data.navesResumen.pasillos} pasillos con ubicación puntual`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Pareto de categorias */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pareto de motivos agrupados</CardTitle>
            <CardDescription>Horas acumuladas por categoría. &quot;Espera de piking&quot; incluye lo que antes se cargaba como espera de ubicación y apro (son lo mismo)</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={pareto} margin={{ left: 4, right: 8, top: 12, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="categoria" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" height={70} interval={0} />
                <YAxis yAxisId="h" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v: number, name: string) => (name === '% acumulado' ? [pct(v), name] : [`${n1(v)} h`, name])} />
                <Bar yAxisId="h" dataKey="horas" name="Horas" radius={[3, 3, 0, 0]}>
                  {pareto.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                </Bar>
                <Line yAxisId="p" dataKey="acumulado" name="% acumulado" stroke={GG_GRIS} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Espera de piking por nave */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Espera de piking por nave</CardTitle>
            <CardDescription>Dónde se concentra la espera (con ubicación puntual): top naves y pasillos</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px] rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Nave</TableHead>
                    <TableHead className="text-right">Minutos</TableHead>
                    <TableHead className="text-right">Eventos</TableHead>
                    <TableHead>Pasillos con más espera</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.porNave.slice(0, 12).map((nv) => (
                    <TableRow key={nv.nave}>
                      <TableCell className="font-medium">{nv.nave}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(nv.minutos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(nv.registros)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {nv.pasillos.slice(0, 4).map((p) => (
                            <Badge key={p.pasillo} variant="secondary" className="text-[10px]">{p.pasillo}: {n(p.minutos)}′</Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Por turno */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tiempo muerto por turno</CardTitle>
            <CardDescription>Horas muertas de cada turno</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.porTurno} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="nombre" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 60)}h`} />
                <Tooltip formatter={(v: number) => horasHMin(v)} />
                <Bar dataKey="minutos" name="Minutos muertos" radius={[3, 3, 0, 0]}>
                  {data.porTurno.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Por hora del dia: SOLO espera de piking */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Espera de piking por hora del día</CardTitle>
            <CardDescription>Cuándo se concentra la espera de piking a lo largo del día (cruce con movimientos de clark en la sección Maquinistas)</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={data.porHoraEsperaPiking} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradEspera" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#dc2626" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#dc2626" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} interval={2} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 60)}h`} />
                <Tooltip formatter={(v: number) => horasHMin(v)} />
                <Area dataKey="minutos" name="Espera de piking" stroke="#dc2626" strokeWidth={2} fill="url(#gradEspera)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ==================== E-8: TIEMPO MUERTO ENTRE PICKING ====================

export interface PickingData {
  registros: number
  vacio: boolean
  grano: 'resumen' | 'detalle'
  desde: string
  hasta: string
  bultos: number
  operarios: number
  gapPromedio: number | null
  gapMediana: number | null
  muertoBloques: { promedio: number | null; mediana: number | null; distribucion: { bucket: string; cantidad: number }[]; conMuerto: boolean }
  muertoPorSector: { sector: string; minutosMuerto: number; minutosTotal: number; pctJornada: number | null; bloques: number }[]
  muertoPorTurno: { turno: string; nombre: string; minutosMuerto: number; bloques: number; promedio: number | null }[]
  muertoHeat: { dias: string[]; turnos: { turno: string; nombre: string; valores: (number | null)[] }[] } | null
  tiempos: { horasTotal: number; horasMuerto: number; pctMuerto: number | null }
  productividad: { total: number | null; neta: number | null; superNeta: number | null }
}

export function SeccionE8({ data }: { data: PickingData }) {
  if (data.vacio || !data.registros) return null
  const esResumen = data.grano === 'resumen'

  const prom = esResumen ? data.muertoBloques.promedio : data.gapPromedio
  const med = esResumen ? data.muertoBloques.mediana : data.gapMediana
  const heatMax = Math.max(1, ...(data.muertoHeat?.turnos.flatMap((t) => t.valores.filter((v): v is number => v != null)) ?? [1]))

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Tiempo muerto entre pickings — promedio" valor={prom == null ? '—' : n1(prom)} formato="texto" unidad={prom != null ? 'min' : undefined} icono={Timer} tono="atencion" detalle={esResumen ? 'Por bloque colaborador×día×turno' : 'Gap entre eventos consecutivos'} />
        <Kpi titulo="Mediana" valor={med == null ? '—' : n1(med)} formato="texto" unidad={med != null ? 'min' : undefined} icono={CalendarClock} detalle="El caso típico, sin distorsión de extremos" />
        <Kpi titulo="% de la jornada" valor={data.tiempos.pctMuerto} formato="porcentaje" icono={TriangleAlert} detalle={`${n(data.tiempos.horasMuerto)} h muertas de ${n(data.tiempos.horasTotal)} h informadas`} />
        <Kpi titulo="Bultos y productividad" valor={data.bultos} unidad="bultos" icono={Boxes} detalle={data.productividad.neta ? `Productividad neta: ${n1(data.productividad.neta)} bultos/h` : undefined} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">E-8 — Tiempo muerto entre piking ({esResumen ? 'bloques por colaborador' : 'log evento a evento'})</CardTitle>
          <CardDescription>
            Período {data.desde} → {data.hasta} · {n(data.registros)} registros · {data.operarios} colaboradores.
            {esResumen ? ' El E-8 informa tiempos por colaborador: el muerto por bloque muestra cuánto tiempo de la jornada no se está preparando.' : ' Los gaps se calculan entre eventos consecutivos de picking.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mapa de calor dia x turno */}
          {data.muertoHeat && (
            <div>
              <p className="text-sm font-medium mb-2">¿En qué horario se concentra? — mapa de calor día de la semana × turno (minutos muertos promedio)</p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="border p-2 text-left bg-muted/40">Turno</th>
                      {data.muertoHeat.dias.map((d) => <th key={d} className="border p-2 bg-muted/40">{d}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.muertoHeat.turnos.map((t) => (
                      <tr key={t.turno}>
                        <td className="border p-2 font-medium">{t.nombre}</td>
                        {t.valores.map((v, i) => {
                          const inten = v != null ? v / heatMax : 0
                          return (
                            <td key={i} className="border p-2 text-center tabular-nums" style={{ backgroundColor: v != null ? `rgba(240, 138, 0, ${0.12 + 0.75 * inten})` : undefined, color: inten > 0.55 ? '#fff' : undefined }}>
                              {v != null ? n1(v) : '—'}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Por turno (horario particular) */}
            {data.muertoPorTurno.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">Tiempo muerto por turno</p>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data.muertoPorTurno} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="nombre" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 60)}h`} />
                    <Tooltip formatter={(v: number) => horasHMin(v)} />
                    <Bar dataKey="minutosMuerto" name="Minutos muertos" fill={GG_NARANJA} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Por nave (sector) */}
            {data.muertoPorSector.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">¿Se identifica en alguna nave? — muerto por sector</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sector</TableHead>
                      <TableHead className="text-right">Muerto</TableHead>
                      <TableHead className="text-right">% de su jornada</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.muertoPorSector.slice(0, 6).map((s) => (
                      <TableRow key={s.sector}>
                        <TableCell className="font-medium">{s.sector}</TableCell>
                        <TableCell className="text-right tabular-nums">{n(s.minutosMuerto)}′</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-red-700">{pct(s.pctJornada)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
