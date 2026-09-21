'use client'

// Secciones "Tiempos muertos" (versión resumen: pareto de categorías unificadas,
// espera de piking por nave y por turno — SIN evolución diaria, sin motivos
// crudos, sin cruce de código por sistema y SIN gráfico por hora) y "E-8"
// (tiempo muerto entre piking: promedio, mediana, calor día×turno, calor día×hora,
// % de la jornada y naves). Todos los valores se muestran en HORAS.

import { TriangleAlert, Timer, Warehouse, Boxes, CalendarClock } from 'lucide-react'
import { Kpi, SinDatos } from '../kpi'
import { n, n1, pct, COLORES, GG_NARANJA, GG_GRIS } from '@/lib/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, ComposedChart, Line } from 'recharts'
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
  const porTurnoHoras = data.porTurno.map((t) => ({ ...t, horas: +(t.minutos / 60).toFixed(1) }))

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Tiempo muerto total" valor={data.totalHoras} unidad="h" icono={TriangleAlert} tono="alerta" detalle={`${n(data.registros)} eventos informados`} />
        <Kpi titulo="% sobre horas de preparación" valor={horasH61 ? (data.totalMin / 60 / horasH61) * 100 : null} formato="porcentaje" icono={Timer} detalle="Horas muertas contra horas-hombre H61 del período" />
        <Kpi titulo="Espera de piking" valor={espera ? +(espera.minutos / 60).toFixed(1) : null} unidad={espera ? 'h' : undefined} formato="texto" icono={Warehouse} tono="atencion" detalle={`${pct(espera?.pct)} del tiempo muerto · motivo n° 1 del pareto`} />
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
                    <TableHead className="text-right">Horas</TableHead>
                    <TableHead className="text-right">Eventos</TableHead>
                    <TableHead>Pasillos con más espera</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.porNave.slice(0, 12).map((nv) => (
                    <TableRow key={nv.nave}>
                      <TableCell className="font-medium">{nv.nave}</TableCell>
                      <TableCell className="text-right tabular-nums">{n1(nv.minutos / 60)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(nv.registros)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {nv.pasillos.slice(0, 4).map((p) => (
                            <Badge key={p.pasillo} variant="secondary" className="text-[10px]">{p.pasillo}: {n1(p.minutos / 60)} h</Badge>
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
              <BarChart data={porTurnoHoras} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="nombre" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}h`} />
                <Tooltip formatter={(v: number) => `${n1(v)} h`} />
                <Bar dataKey="horas" name="Horas muertas" radius={[3, 3, 0, 0]}>
                  {porTurnoHoras.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                </Bar>
              </BarChart>
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

export function SeccionE8({ data, porHoraMuertos }: { data: PickingData; porHoraMuertos?: TMData['porHora'] }) {
  if (data.vacio || !data.registros) return null
  const esResumen = data.grano === 'resumen'

  const prom = esResumen ? data.muertoBloques.promedio : data.gapPromedio
  const med = esResumen ? data.muertoBloques.mediana : data.gapMediana
  const heatMax = Math.max(1, ...(data.muertoHeat?.turnos.flatMap((t) => t.valores.filter((v): v is number => v != null)) ?? [1]))
  // mapa de calor SOLO por hora del día: horas muertas del período en cada hora
  // (fuente: tiempos muertos informados con hora, módulo TM)
  const calorHoraValores = (porHoraMuertos ?? []).map((p) => +(p.minutos / 60).toFixed(1))
  const calorHoraMax = Math.max(1, ...calorHoraValores)
  const muertoTurnoHoras = data.muertoPorTurno.map((t) => ({ ...t, horas: +(t.minutosMuerto / 60).toFixed(1) }))

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Tiempo muerto entre pickings — promedio" valor={prom == null ? '—' : n1(prom / 60)} formato="texto" unidad={prom != null ? 'h' : undefined} icono={Timer} tono="atencion" detalle={esResumen ? 'Por bloque colaborador×día×turno' : 'Gap entre eventos consecutivos'} />
        <Kpi titulo="Mediana" valor={med == null ? '—' : n1(med / 60)} formato="texto" unidad={med != null ? 'h' : undefined} icono={CalendarClock} detalle="El caso típico, sin distorsión de extremos" />
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
              <p className="text-sm font-medium mb-2">¿En qué horario se concentra? — mapa de calor día de la semana × turno (horas muertas promedio por bloque)</p>
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
                              {v != null ? `${n1(v / 60)} h` : '—'}
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

          {/* Mapa de calor SOLO por hora del día */}
          {calorHoraValores.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Mapa de calor por hora del día (horas muertas del período)</p>
              <p className="text-xs text-muted-foreground mb-2">Cada celda suma las horas muertas informadas en esa hora a lo largo del período — más oscuro = más tiempo perdido</p>
              <div className="overflow-x-auto">
                <table className="border-collapse text-[10px]">
                  <thead>
                    <tr>
                      {(porHoraMuertos ?? []).map((p) => <th key={p.hora} className="border p-1 bg-muted/40 font-medium whitespace-nowrap">{String(p.hora).padStart(2, '0')}h</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {calorHoraValores.map((v, i) => {
                        const inten = v / calorHoraMax
                        return (
                          <td key={i} className="border p-1 text-center tabular-nums min-w-[44px]" style={{ backgroundColor: v > 0 ? `rgba(240, 138, 0, ${0.1 + 0.8 * inten})` : undefined, color: inten > 0.55 ? '#fff' : undefined }}>
                            {v > 0 ? n1(v) : '—'}
                          </td>
                        )
                      })}
                    </tr>
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
                  <BarChart data={muertoTurnoHoras} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="nombre" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}h`} />
                    <Tooltip formatter={(v: number) => `${n1(v)} h`} />
                    <Bar dataKey="horas" name="Horas muertas" fill={GG_NARANJA} radius={[3, 3, 0, 0]} />
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
                      <TableHead className="text-right">Muerto (h)</TableHead>
                      <TableHead className="text-right">% de su jornada</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.muertoPorSector.slice(0, 6).map((s) => (
                      <TableRow key={s.sector}>
                        <TableCell className="font-medium">{s.sector}</TableCell>
                        <TableCell className="text-right tabular-nums">{n1(s.minutosMuerto / 60)}</TableCell>
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
