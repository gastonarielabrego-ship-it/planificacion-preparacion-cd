'use client'

// Sección TIEMPO MUERTO del resumen. De los tiempos muertos se conserva todo
// menos la evolución diaria, los motivos crudos y el cruce de código por sistema
// (eliminados a pedido). Se agrega el tiempo muerto del E-8 (grano resumen):
// promedio y mediana por bloque, cuánto representa en la jornada, si concentra
// en algún circuito (naves) y mapa de calor por día de la semana y turno.

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, MapPin, Timer, Warehouse, CalendarDays, Clock3 } from 'lucide-react'
import { Kpi, SinDatos } from '../kpi'
import { fetchDatos, n, n1, pct, horasHMin, COLORES } from '@/lib/client'
import { etiquetaCategoria } from '@/lib/normaliza'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, ComposedChart, Line, Legend } from 'recharts'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown } from 'lucide-react'
import { TituloSeccion, MapaCalor } from './comun'

interface TMData {
  totalMin: number
  totalHoras: number
  registros: number
  porCategoria: { categoria: string; minutos: number; registros: number; pct: number }[]
  porNave: { nave: string; minutos: number; registros: number; pasillos: { pasillo: string; minutos: number; registros: number }[] }[]
  porTurno: { turno: string; nombre: string; minutos: number }[]
  porHora: { hora: number; etiqueta: string; minutos: number }[]
  navesResumen: { minutos: number; naves: number; pasillos: number }
}

interface PickData {
  registros: number
  vacio?: boolean
  grano: 'resumen' | 'detalle'
  bultos: number
  umbralMuertoMin?: number
  muertoBloques?: { promedio: number | null; mediana: number | null; distribucion: { bucket: string; cantidad: number }[]; conMuerto: boolean }
  muertoPorSector?: { sector: string; minutosMuerto: number; minutosTotal: number; pctJornada: number | null; bloques: number }[]
  muertoPorTurno?: { turno: string; nombre: string; minutosMuerto: number; bloques: number; promedio: number | null }[]
  muertoHeat?: { dias: string[]; turnos: { turno: string; nombre: string; valores: (number | null)[] }[] } | null
  tiempos?: { horasTotal: number; horasMuerto: number; horasNeto: number; horasSuperNeto: number; pctMuerto: number | null }
}

export function TiempoMuertoSeccion() {
  const { data: tm, isLoading } = useQuery({ queryKey: ['tm', 'resumen'], queryFn: () => fetchDatos<TMData>('tm') })
  const { data: pk } = useQuery({ queryKey: ['picking', 'resumen'], queryFn: () => fetchDatos<PickData>('picking') })

  if (isLoading) return <div className="grid gap-3 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
  if (!tm || tm.registros === 0) return <SinDatos mensaje="Cargá el archivo 'tiempos muertos' para ver el análisis." />

  const pareto = tm.porCategoria.map((c, i) => {
    const acum = tm.porCategoria.slice(0, i + 1).reduce((a, x) => a + x.minutos, 0)
    return { ...c, etiqueta: etiquetaCategoria(c.categoria), horas: +(c.minutos / 60).toFixed(1), acumPct: +((acum / tm.totalMin) * 100).toFixed(1) }
  })

  const bloques = pk?.muertoBloques
  const hayE8 = pk && !pk.vacio && bloques?.conMuerto
  const maxHoraTM = Math.max(1, ...tm.porHora.map((h) => h.minutos))
  const horaMasMuerta = [...tm.porHora].sort((a, b) => b.minutos - a.minutos)[0]

  return (
    <div className="space-y-4">
      <TituloSeccion icono={Timer} id="sec-tm" titulo="Tiempos muertos: dónde se pierde el tiempo de preparación" descripcion="Pareto de motivos (Espera de ubicación, espera de piking y Apro unificadas en Espera de piking), distribución por turno y hora, naves afectadas — y el tiempo muerto que mide el E-8 por bloque de trabajo." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Tiempo muerto total" valor={tm.totalHoras} unidad="h" formato="decimal" icono={Timer} detalle={`${n(tm.registros)} eventos informados`} tono="alerta" />
        <Kpi titulo="Motivo n° 1" valor={pareto[0] ? pareto[0].etiqueta : '—'} formato="texto" icono={AlertTriangle} detalle={`${horasHMin(pareto[0]?.minutos ?? 0)} · ${pct(pareto[0]?.pct ?? 0)} del total`} tono="atencion" />
        <Kpi titulo="Promedio por evento" valor={tm.registros ? tm.totalMin / tm.registros : 0} formato="decimal" unidad="min" icono={Clock3} detalle={`Hora más crítica: ${horaMasMuerta.minutos > 0 ? horaMasMuerta.etiqueta : '—'}`} />
        <Kpi titulo="Espera de piking con ubicación" valor={tm.navesResumen.minutos / 60} unidad="h" icono={MapPin} detalle={`${tm.navesResumen.naves} naves y ${tm.navesResumen.pasillos} pasillos afectados`} tono="alerta" />
      </div>

      {/* Tiempo muerto según el E-8 */}
      {hayE8 && pk && (
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold flex items-center gap-1.5"><Clock3 className="h-4 w-4 text-amber-600" /> Tiempo muerto según el E-8 (por bloque de trabajo)</p>
            <p className="text-xs text-muted-foreground">Cada bloque es un colaborador-día-turno-circuito. El muerto es el tiempo informado sin producción; la productividad neta del E-8 corrige este tiempo.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi titulo="Muerto promedio por bloque" valor={bloques.promedio ?? 0} formato="decimal" unidad="min" icono={Timer} tono="atencion" />
            <Kpi titulo="Muerto mediano por bloque" valor={bloques.mediana ?? 0} formato="decimal" unidad="min" icono={Timer} detalle="La mitad de los bloques cae por debajo" />
            <Kpi titulo="Peso en la jornada" valor={pk.tiempos?.pctMuerto ?? 0} formato="porcentaje" icono={CalendarDays} tono="alerta" detalle={`${n1(pk.tiempos?.horasMuerto ?? 0)} h muertas de ${n1(pk.tiempos?.horasTotal ?? 0)} h trabajadas`} />
            <Kpi titulo="Circuito más afectado" valor={pk.muertoPorSector?.[0]?.sector ?? '—'} formato="texto" icono={Warehouse} detalle={pk.muertoPorSector?.[0] ? `${pct(pk.muertoPorSector[0].pctJornada ?? 0)} de su jornada es muerta` : null} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="text-xs font-semibold mb-1">Distribución del muerto por bloque</p>
              <p className="text-[11px] text-muted-foreground mb-2">Cuántos bloques caen en cada rango de tiempo muerto.</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={bloques.distribucion} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => [n(v), 'Bloques']} />
                  <Bar dataKey="cantidad" radius={[3, 3, 0, 0]}>
                    {bloques.distribucion.map((_, i) => <Cell key={i} fill={i >= 4 ? '#dc2626' : i >= 2 ? '#d97706' : '#059669'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-xs font-semibold mb-1">Muerto por circuito (naves del E-8)</p>
              <p className="text-[11px] text-muted-foreground mb-2">Horas muertas y peso sobre la jornada de cada circuito.</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Circuito</TableHead>
                    <TableHead className="text-right">Bloques</TableHead>
                    <TableHead className="text-right">Horas muertas</TableHead>
                    <TableHead className="text-right">% jornada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(pk.muertoPorSector ?? []).map((s) => (
                    <TableRow key={s.sector}>
                      <TableCell className="font-medium">{s.sector}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(s.bloques)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n1(s.minutosMuerto / 60)} h</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{pct(s.pctJornada ?? 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          {pk.muertoHeat && (
            <div>
              <p className="text-xs font-semibold mb-1">Mapa de calor del tiempo muerto (E-8): día de la semana × turno</p>
              <p className="text-[11px] text-muted-foreground mb-2">Minutos muertos promedio por bloque en cada combinación.</p>
              <MapaCalor
                filas={pk.muertoHeat.turnos.map((t) => ({ clave: t.turno, etiqueta: t.nombre }))}
                columnas={pk.muertoHeat.dias.map((d) => ({ clave: d, etiqueta: d }))}
                valor={(fila, col) => {
                  const t = pk.muertoHeat!.turnos.find((x) => x.turno === fila)
                  const i = pk.muertoHeat!.dias.indexOf(col)
                  return t && i >= 0 ? (t.valores[i] ?? 0) : 0
                }}
                formato={(v) => n1(v)}
                tituloCelda={(fila, col, v) => `${fila} · ${col}: ${v != null ? `${n1(v)} min muertos promedio por bloque` : 'sin datos'}`}
              />
            </div>
          )}
        </div>
      )}

      {/* Pareto de motivos */}
      <div className="bg-white rounded-xl border p-4">
        <p className="text-sm font-semibold mb-1">Pareto de motivos agrupados</p>
        <p className="text-xs text-muted-foreground mb-2">Motivos normalizados desde el texto libre. “Espera de ubicación”, “espera de piking” y “apro” se unifican en <b>Espera de piking</b>. Línea = % acumulado.</p>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={pareto} margin={{ left: 4, right: 8, top: 8, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="etiqueta" angle={-30} textAnchor="end" height={70} interval={0} tick={{ fontSize: 10 }} />
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
      </div>

      {/* Por turno y por hora */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm font-semibold mb-1">Tiempo muerto por turno</p>
          <p className="text-xs text-muted-foreground mb-2">Horas muertas informadas en cada turno.</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={tm.porTurno} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="nombre" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`${n1(v)} h`, 'Muerto']} />
              <Bar dataKey="minutos" name="Horas muertas" radius={[3, 3, 0, 0]}>
                {tm.porTurno.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm font-semibold mb-1">Tiempo muerto por hora del día</p>
          <p className="text-xs text-muted-foreground mb-2">En qué horario se concentra el muerto (la hora más crítica se destaca).</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={tm.porHora} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="etiqueta" tick={{ fontSize: 9 }} interval={2} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`${n(v)} min`, 'Muerto']} />
              <Bar dataKey="minutos" radius={[3, 3, 0, 0]}>
                {tm.porHora.map((h) => <Cell key={h.hora} fill={h.minutos === maxHoraTM ? '#dc2626' : '#d97706'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Espera de piking por nave y pasillo */}
      <div className="bg-white rounded-xl border p-4">
        <p className="text-sm font-semibold mb-1">Espera de piking por nave y pasillo</p>
        <p className="text-xs text-muted-foreground mb-2">Eventos con ubicación puntual en el texto (ej: “ESPERA E-11-124” → nave E, pasillo 11, posición 124). Expandí cada nave para ver sus pasillos. Incluye las esperas históricas categorizadas como “espera de ubicación” o “apro”.</p>
        {tm.porNave.length === 0 ? (
          <p className="text-sm text-muted-foreground">No se detectaron ubicaciones en las observaciones.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {tm.porNave.map((nv) => (
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
                            <TableCell>{p.pasillo}</TableCell>
                            <TableCell className="text-right tabular-nums">{n1(p.minutos / 60)}</TableCell>
                            <TableCell className="text-right tabular-nums">{n(p.registros)}</TableCell>
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
      </div>
    </div>
  )
}
