'use client'

import { useQuery } from '@tanstack/react-query'
import { Clock3, Boxes, User, Route, MapPin, Users, Gauge, Timer, Award, ArrowRightLeft, UploadCloud } from 'lucide-react'
import { Kpi, SinDatos } from './kpi'
import { fetchDatos, n, n1, fechaCorta, COLORES } from '@/lib/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, ComposedChart, Line, Legend } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface PickingData {
  registros: number
  vacio?: boolean
  grano?: 'resumen' | 'detalle'
  desde?: string
  hasta?: string
  meses?: number
  fuentes?: { filename: string | null; rows: number; fecha: string }[]
  umbralMuertoMin?: number
  conUbicacion?: boolean
  bultos?: number
  operarios?: number
  gapPromedio?: number | null
  gapMediana?: number | null
  distribucionGaps?: { bucket: string; cantidad: number }[]
  cambiosUbicacion?: number
  trasladoPromedio?: number | null
  trasladoMediana?: number | null
  distribucionTraslados?: { bucket: string; cantidad: number }[]
  muertoBloques?: { promedio: number | null; mediana: number | null; distribucion: { bucket: string; cantidad: number }[]; conMuerto: boolean }
  tiempos?: { horasTotal: number; horasMuerto: number; horasNeto: number; horasTraslados: number; horasSuperNeto: number; pctMuerto: number | null }
  productividad?: { total: number | null; neta: number | null; superNeta: number | null }
  topColaborador?: { operario: string; nombre: string; bultos: number; prodSuperNeta: number | null } | null
  operariosTop?: { operario: string; nombre: string; dias: number; eventos: number; bultos: number; horasTotal: number; pctMuerto: number | null; prodTotal: number | null; prodNeta: number | null; prodSuperNeta: number | null; ubicUnicas: number; traslados: number }[]
  porZona?: { zona: string; bultos: number; eventos: number; operarios: number; dias: number }[]
  porActividad?: { actividad: string; bultos: number; eventos: number; operarios: number; personasPromedioDia: number | null }[]
  recorridosTop?: { fecha: string; operario: string; nombre: string | null; ubicaciones: number; zonas: number; eventos: number; bultos: number; spanMin: number; muertoMin: number; trasladosMin: number }[]
  paresZona?: { desde: string; hasta: string; trasladoPromedio: number; cantidad: number }[]
  serie?: { fecha: string; eventos: number; bultos: number; gapPromedio: number | null }[]
}

export function PickingTab() {
  const { data, isLoading } = useQuery({ queryKey: ['picking'], queryFn: () => fetchDatos<PickingData>('picking') })

  if (isLoading) return <Skeleton className="h-72" />
  if (!data || data.vacio) {
    return (
      <div className="space-y-4">
        <Alert>
          <UploadCloud className="h-4 w-4" />
          <AlertTitle>Módulo Picking (E-8) — esperando datos</AlertTitle>
          <AlertDescription className="leading-relaxed">
            Este módulo toma el <b>reporte E-8</b> en sus dos formatos: el <b>log evento a evento</b> (produccion picking…,
            con hora y ubicación) o el <b>resumen por colaborador</b> ("Tiempos E-8" / Productividad X Circuito, ene→ago 2026).
            Calcula: <b>tiempo muerto promedio y mediana</b>, bultos por zona/circuito, personas asignadas a cada actividad,
            <b> recorridos y traslados</b> (solo con el log detalle), top colaborador y <b>productividad neta y super neta</b>.
            <br />
            Se reconoce automáticamente por el nombre ("picking", "piking", "pickeo", "E-8", "productividad…circuito"). Podés
            subirlo acá (por partes, sin límite) o con el script <code className="rounded bg-muted px-1">subir_archivo.py</code>.
          </AlertDescription>
        </Alert>
        <SinDatos mensaje="No hay eventos de picking cargados todavía." />
      </div>
    )
  }

  const t = data.tiempos
  const p = data.productividad
  const umbral = data.umbralMuertoMin ?? 2
  const resumen = data.grano === 'resumen'
  const totalGaps = (resumen ? data.muertoBloques?.distribucion : data.distribucionGaps)?.reduce((a, b) => a + b.cantidad, 0) || 1
  const totalTraslados = (data.distribucionTraslados ?? []).reduce((a, b) => a + b.cantidad, 0) || 1

  return (
    <div className="space-y-4">
      <Alert>
        <Boxes className="h-4 w-4" />
        <AlertTitle className="text-sm">Fuente del análisis: reporte E-8 {resumen ? '(resumen por colaborador — "Tiempos E-8")' : '(log de picking evento a evento)'}</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          Período con datos: <b>{data.desde ? `${fechaCorta(data.desde)} → ${fechaCorta(data.hasta)}` : '—'}</b>
          {data.meses != null && <> · <b>{data.meses}</b> {data.meses === 1 ? 'mes' : 'meses'}</>}
          {(data.fuentes ?? []).length > 0 && (
            <> · Archivos tomados en cuenta: {(data.fuentes ?? []).map((f) => f.filename || '(sin nombre)').join(', ')}</>
          )}
          {resumen && (
            <> · Cada fila del reporte (colaborador × día × turno × circuito) se toma como un <b>bloque</b> con sus horas informadas.</>
          )}
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo={resumen ? 'Bloques colaborador-día' : 'Eventos de picking'} valor={data.registros} icono={Boxes} detalle={data.desde ? `${fechaCorta(data.desde)} → ${fechaCorta(data.hasta)}` : undefined} />
        <Kpi titulo="Operarios" valor={data.operarios ?? 0} icono={User} />
        <Kpi titulo="Bultos levantados" valor={data.bultos ?? 0} icono={Boxes} />
        {resumen ? (
          <Kpi titulo="Tiempo muerto por bloque" valor={data.muertoBloques?.promedio ?? 0} formato="decimal" unidad="min" icono={Clock3} tono="atencion" detalle={`Mediana: ${n1(data.muertoBloques?.mediana)} min por bloque (colaborador-turno-circuito)`} />
        ) : (
          <Kpi titulo="Gap promedio entre pickings" valor={data.gapPromedio ?? 0} formato="decimal" unidad="min" icono={Clock3} tono="atencion" detalle={`Mediana: ${n1(data.gapMediana)} min — umbral muerto > ${umbral} min`} />
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Prod. neta" valor={p?.neta ?? 0} formato="decimal" unidad="bult/h" icono={Gauge} detalle={`Total (con muertos): ${n1(p?.total ?? 0)} bult/h`} />
        <Kpi titulo="Prod. super neta" valor={p?.superNeta ?? 0} formato="decimal" unidad="bult/h" icono={Gauge} tono="exito" detalle={`Sin muertos (${n1(t?.horasMuerto)} h) ni traslados (${n1(t?.horasTraslados)} h)`} />
        <Kpi titulo="% Tiempo muerto" valor={t?.pctMuerto ?? 0} formato="decimal" unidad="%" icono={Timer} tono="alerta" detalle={`${n1(t?.horasMuerto)} h de ${n1(t?.horasTotal)} h de jornada`} />
        <Kpi
          titulo="Top colaborador"
          valor={data.topColaborador ? data.topColaborador.nombre : '—'}
          formato="texto"
          icono={Award}
          tono="exito"
          detalle={data.topColaborador ? `${n(data.topColaborador.bultos)} bultos · prod. super neta ${n1(data.topColaborador.prodSuperNeta)} bult/h` : undefined}
        />
      </div>

      <Alert>
        <Gauge className="h-4 w-4" />
        <AlertTitle className="text-sm">Cómo se calcula la productividad</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          {resumen ? (
            <>
              Los tiempos salen de las columnas del reporte: <b>Tiempo total</b>, <b>Tiempo muerto</b>, <b>Tiempo neto</b> y
              <b> Tiempo super neto</b> (informados por bloque). Prod. neta y super neta = bultos ÷ cada tiempo.
              ⚠︎ Grano resumen: sin hora ni ubicación evento a evento — gaps entre pickings, traslados y recorridos
              requieren el log detallado (produccion picking…).
            </>
          ) : (
            <>
              <b>Tiempo total</b> = jornada observada (primer → último evento del día). <b>Tiempo muerto</b> = suma de gaps mayores a {umbral} min.
              <b> Tiempo neto</b> = total − muertos. <b>Tiempo super neto</b> = tiempo de operación WMS (columna MINUTOS) acotado al neto;
              sin MINUTOS, super neto = neto. <b>Traslados</b> = neto − super neto. Prod. neta y super neta = bultos ÷ cada tiempo.
              {!data.conUbicacion && ' ⚠︎ El archivo no trae ubicación (ZONSTS/ALLSTS/NIVSTS): traslados y recorridos quedan sin efecto.'}
            </>
          )}
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{resumen ? 'Distribución del tiempo muerto por bloque' : 'Distribución de tiempos muertos entre pickings'}</CardTitle>
            <CardDescription>{resumen ? 'Bloques (colaborador × día × turno × circuito) según minutos muertos informados' : 'Porcentaje de gaps en cada rango de minutos'}</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={(resumen ? (data.muertoBloques?.distribucion ?? []) : (data.distribucionGaps ?? [])).map((d) => ({ ...d, p: +((d.cantidad / totalGaps) * 100).toFixed(1) }))} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} unit="%" />
                <Tooltip formatter={(v: number) => [`${n1(v)}%`, 'Proporción']} />
                <Bar dataKey="p" radius={[3, 3, 0, 0]}>
                  {(resumen ? data.muertoBloques?.distribucion ?? [] : data.distribucionGaps ?? []).map((_, i) => <Cell key={i} fill={i >= 4 ? '#dc2626' : i >= 2 ? '#d97706' : '#059669'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{resumen ? 'Bultos levantados por circuito (Sector)' : 'Bultos levantados por zona (naves)'}</CardTitle>
            <CardDescription>{resumen ? 'ACT2 / ACT4 / JAULA / XD según la columna Sector del reporte' : 'Volumen, eventos y personas por zona del depósito'}</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.porZona ?? []} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="zona" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v: number) => [n(v), 'Bultos']} />
                <Bar dataKey="bultos" name="Bultos" radius={[3, 3, 0, 0]}>
                  {(data.porZona ?? []).map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {resumen ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Análisis de detalle no disponible en este grano</CardTitle>
              <CardDescription>El resumen por colaborador no trae hora ni ubicación evento a evento</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground py-2 leading-relaxed">
                Los <b>gaps entre pickings</b>, los <b>traslados entre ubicaciones</b> y los <b>recorridos más largos</b> se calculan
                con el log detallado del E-8 (archivo tipo “produccion picking…” con CODUTI/FECHA/HORA/ZONSTS/ALLSTS).
                Cuando lo cargues reemplaza este grano y activa esas secciones automáticamente.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Traslados entre ubicaciones</CardTitle>
              <CardDescription>Gap al cambiar de ubicación ({n(data.cambiosUbicacion ?? 0)} cambios detectados)</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={(data.distribucionTraslados ?? []).map((d) => ({ ...d, p: +((d.cantidad / totalTraslados) * 100).toFixed(1) }))} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip formatter={(v: number) => [`${n1(v)}%`, 'Proporción']} />
                  <Bar dataKey="p" radius={[3, 3, 0, 0]}>
                    {(data.distribucionTraslados ?? []).map((_, i) => <Cell key={i} fill={i >= 4 ? '#dc2626' : i >= 2 ? '#d97706' : '#0d9488'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="text-xs text-muted-foreground mt-2">
                Promedio {n1(data.trasladoPromedio)} min · mediana {n1(data.trasladoMediana)} min por cambio de ubicación
                {(data.paresZona ?? []).length > 0 && ' — ver pares de zonas más lentos abajo'}
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{resumen ? 'Bloques y bultos por día' : 'Eventos por día'}</CardTitle>
            <CardDescription>{resumen ? 'Volumen diario de bloques y bultos del resumen E-8' : 'Volumen de levantes y gap promedio del día'}</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={(data.serie ?? []).map((s) => ({ ...s, f: s.fecha.slice(5) }))} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="f" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis yAxisId="e" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <YAxis yAxisId="g" orientation="right" tick={{ fontSize: 10 }} unit=" min" />
                <Tooltip formatter={(v: number) => n(v)} />
                <Legend />
                <Bar yAxisId="e" dataKey="eventos" name={resumen ? 'Bloques' : 'Eventos'} fill={COLORES[0]} radius={[3, 3, 0, 0]} />
                {!resumen && <Line yAxisId="g" dataKey="gapPromedio" name="Gap prom. (min)" stroke="#dc2626" strokeWidth={2} dot={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Award className="h-4 w-4" /> Ranking de colaboradores</CardTitle>
          <CardDescription>Producción, % de tiempo muerto y productividad neta / super neta en el período</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead className="text-right">Días</TableHead>
                  <TableHead className="text-right">Bultos</TableHead>
                  <TableHead className="text-right">Horas</TableHead>
                  <TableHead className="text-right">% Muerto</TableHead>
                  <TableHead className="text-right">Prod. neta</TableHead>
                  <TableHead className="text-right">Prod. super neta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data.operariosTop ?? []).map((o) => (
                  <TableRow key={o.operario}>
                    <TableCell>
                      <div className="font-medium leading-tight">{o.nombre}</div>
                      <div className="text-xs text-muted-foreground">{o.operario}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{n(o.dias)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(o.bultos)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n1(o.horasTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.pctMuerto != null ? `${n1(o.pctMuerto)}%` : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.prodNeta != null ? n1(o.prodNeta) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.prodSuperNeta != null ? n1(o.prodSuperNeta) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Personas asignadas por actividad</CardTitle>
            <CardDescription>{resumen ? 'Según la columna Tipo del reporte (Soporte / Notas): colaboradores distintos y promedio de personas por día' : 'Colaboradores distintos y promedio de personas por día en cada actividad (CODACT)'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Actividad</TableHead>
                    <TableHead className="text-right">Personas</TableHead>
                    <TableHead className="text-right">Prom. por día</TableHead>
                    <TableHead className="text-right">Eventos</TableHead>
                    <TableHead className="text-right">Bultos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.porActividad ?? []).slice(0, 15).map((a) => (
                    <TableRow key={a.actividad}>
                      <TableCell className="font-medium">{a.actividad}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(a.operarios)}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.personasPromedioDia != null ? n1(a.personasPromedioDia) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(a.eventos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(a.bultos)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><ArrowRightLeft className="h-4 w-4" /> Traslados más lentos entre zonas</CardTitle>
            <CardDescription>Pares zona → zona con mayor tiempo promedio de traslado (mín. 5 casos){resumen && ' — requiere el log detallado'}</CardDescription>
          </CardHeader>
          <CardContent>
            {(data.paresZona ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Sin pares de zonas suficientes (¿falta columna de zona?).</p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Desde → Hasta</TableHead>
                      <TableHead className="text-right">Traslado prom. (min)</TableHead>
                      <TableHead className="text-right">Casos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data.paresZona ?? []).map((pz) => (
                      <TableRow key={`${pz.desde}-${pz.hasta}`}>
                        <TableCell className="font-medium">{pz.desde} → {pz.hasta}</TableCell>
                        <TableCell className="text-right tabular-nums">{n1(pz.trasladoPromedio)}</TableCell>
                        <TableCell className="text-right tabular-nums">{n(pz.cantidad)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Route className="h-4 w-4" /> Recorridos más largos</CardTitle>
          <CardDescription>Días con más ubicaciones distintas visitadas por un colaborador{resumen && ' — requiere el log detallado (con hora y ubicación)'}</CardDescription>
        </CardHeader>
        <CardContent>
          {(data.recorridosTop ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Sin recorridos calculables (¿falta columna de ubicación?).</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead className="text-right">Ubicaciones</TableHead>
                    <TableHead className="text-right">Zonas</TableHead>
                    <TableHead className="text-right">Eventos</TableHead>
                    <TableHead className="text-right">Bultos</TableHead>
                    <TableHead className="text-right">Duración</TableHead>
                    <TableHead className="text-right">Muertos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.recorridosTop ?? []).map((r, i) => (
                    <TableRow key={`${r.fecha}-${r.operario}`}>
                      <TableCell className="tabular-nums">{fechaCorta(r.fecha)}</TableCell>
                      <TableCell>
                        <div className="font-medium leading-tight">{r.nombre ?? r.operario}</div>
                        <div className="text-xs text-muted-foreground">{r.operario}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{n(r.ubicaciones)} <MapPin className="inline h-3 w-3 text-muted-foreground" /></TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.zonas)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.eventos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.bultos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n1(r.spanMin / 60)} h</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.muertoMin)} min</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
