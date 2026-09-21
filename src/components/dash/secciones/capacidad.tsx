'use client'

// Sección CAPACIDAD H61 del resumen: ritmo de preparación por día (sábados
// aparte, feriados y comparativa que incluye los sábados), influencia de las
// horas extras, ritmo por turno en extras y productividad promedio por hora
// sin extras vs con extras.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Gauge, Hourglass, Layers, Users, Flame } from 'lucide-react'
import { Kpi, SinDatos } from '../kpi'
import { fetchDatos, n, n1, pct, fechaCorta, COLORES } from '@/lib/client'
import { ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { TituloSeccion, VERDE, NARANJA } from './comun'

interface FilaMes { mes: string; dias: number; diasFeriado: number; personas: number; bultos: number; bultosBase: number; bultosExtras: number; bultosFeriado: number; pctExtrasTotal: number; horas: number; horasExtras: number; ritmoProm: number | null; ritmoMediana: number | null }

interface CapacidadData {
  porMes: FilaMes[]
  porTurno: { turno: string; nombre: string; opDias: number; personas: number; personasExtras: number; bultos: number; bultosBase: number; bultosExtras: number; pctExtras: number; horasExtras: number; ritmoProm: number | null }[]
  perfilHora: { hora: number; etiqueta: string; opsJornada: number; opsExtras: number; bultosProm: number; bultosJornadaProm?: number; bultosExtrasProm?: number; ritmoJornada?: number | null; ritmoExtras?: number | null }[]
  feriados: { fecha: string; nombre: string; tipo: string; personas: number; opDias: number; bultos: number; horas: number; ritmo: number | null }[]
  resumen: { dias: number; personas: number; personasExtras: number; bultos: number; bultosBase: number; bultosExtras: number; pctExtras: number; horas: number; horasExtras: number; ritmoProm: number | null; ritmoMediana: number | null; diasFeriado: number; bultosFeriado: number; horasFeriado: number; personasFeriado: number; pctExtrasTotal: number } | null
  comparativa: { normal: { dias: number; bultosPorDia: number; personasPorDia: number; horasPorDia: number; ritmo: number | null }; feriado: { dias: number; bultosPorJornada: number; personasPorJornada: number; horasPorJornada: number; ritmo: number | null }; deltas: { bultosPct: number | null; personasPct: number | null; horasPct: number | null; ritmoPct: number | null } } | null
  porDiaSemana: { dow: number; dia: string; dias: number; bultosProm: number; personasProm: number; horasProm: number; ritmo: number | null; ritmoMediana: number | null; pctExtras: number }[]
  sabados: { fecha: string; bultos: number; bultosNormales: number; personas: number; personasExtras: number; horas: number; ritmo: number | null; pctExtras: number; dotacionAcotada: boolean }[]
  sabadosResumen: { total: number; personasMediana: number; acotadas: number; personasAcotadasProm: number | null; personasRestoProm: number | null; ritmo: number | null } | null
  tieneOpHora: boolean
}

const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const etiquetaMes = (ym: string) => `${MESES_ABR[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`

export function CapacidadResumen() {
  const { data, isLoading } = useQuery({ queryKey: ['capacidad'], queryFn: () => fetchDatos<CapacidadData>('capacidad') })

  const perfil = useMemo(() => (data?.perfilHora ?? []).filter((p) => p.opsJornada > 0 || p.opsExtras > 0), [data])
  const diasSemana = useMemo(() => (data?.porDiaSemana ?? []), [data])

  // comparativa de tres grupos: día normal (lun-vie), sábado y feriado
  const comp3 = useMemo(() => {
    if (!data) return null
    const sab = data.sabados ?? []
    const sabTotBul = sab.reduce((a, s) => a + s.bultosNormales, 0)
    const sabTotHoras = sab.reduce((a, s) => a + s.horas, 0)
    const sabTotPers = sab.reduce((a, s) => a + s.personas, 0)
    const sabados = {
      dias: sab.length,
      bultosPorJornada: sab.length ? Math.round(sabTotBul / sab.length) : null,
      personasPorJornada: sab.length ? +(sabTotPers / sab.length).toFixed(1) : null,
      horasPorJornada: sab.length ? Math.round(sabTotHoras / sab.length) : null,
      ritmo: sabTotHoras ? +(sabTotBul / sabTotHoras).toFixed(1) : null,
    }
    const delta = (fer: number | null, nor: number | null) => (fer != null && nor != null && nor > 0 ? +(((fer - nor) / nor) * 100).toFixed(1) : null)
    const nor = data.comparativa?.normal ?? null
    const fer = data.comparativa?.feriado ?? null
    return {
      normal: nor,
      sabados,
      feriado: fer,
      deltas: {
        sab: {
          bultosPct: delta(sabados.bultosPorJornada, nor?.bultosPorDia ?? null),
          personasPct: delta(sabados.personasPorJornada, nor?.personasPorDia ?? null),
          ritmoPct: delta(sabados.ritmo, nor?.ritmo ?? null),
        },
        fer: data.comparativa?.deltas ?? null,
      },
    }
  }, [data])

  if (isLoading) return <div className="grid gap-3 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
  if (!data || !data.resumen || data.resumen.bultos + data.resumen.bultosFeriado === 0) return <SinDatos mensaje="Cargá el archivo H61 para ver el ritmo y la capacidad de preparación." />

  const resumen = data.resumen
  const porTurnoExtras = data.porTurno.map((t) => ({
    ...t,
    ritmoExtras: t.horasExtras ? +(t.bultosExtras / t.horasExtras).toFixed(1) : null,
    ritmoBase: t.horas - t.horasExtras > 0 ? +(t.bultosBase / (t.horas - t.horasExtras)).toFixed(1) : null,
  }))

  return (
    <div className="space-y-4">
      <TituloSeccion icono={Gauge} id="sec-capacidad" titulo="Capacidad H61: ritmo de preparación" descripcion="Ritmo por día, sábados analizados aparte, feriados y comparativa (incluye sábados), influencia de las horas extras y ritmo por turno en extras." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Ritmo de preparación" valor={resumen.ritmoProm} formato="decimal" unidad="bultos/h" icono={Gauge} tono="exito" detalle={`Mediana de días: ${n1(resumen.ritmoMediana)} bultos/h`} />
        <Kpi titulo="Bultos en horas extra" valor={resumen.pctExtrasTotal} formato="porcentaje" icono={Hourglass} tono="alerta" detalle={`${n(resumen.bultosExtras)} bultos en extras + ${n(resumen.bultosFeriado)} en feriados`} />
        <Kpi titulo="Personas involucradas" valor={resumen.personas} unidad="operarios" icono={Users} detalle={`${resumen.personasExtras} hicieron extras · ${resumen.dias} días`} />
        <Kpi titulo="Bultos preparados" valor={resumen.bultos + resumen.bultosFeriado} unidad="bultos" icono={Layers} detalle={`${n(resumen.horas)} h normales + ${n(resumen.horasExtras)} h extras + ${n(resumen.horasFeriado)} h feriado`} />
      </div>

      {/* Influencia de las horas extras */}
      <div className="bg-white rounded-xl border p-4">
        <p className="text-sm font-semibold mb-1">Influencia de las horas extras en la preparación</p>
        <p className="text-xs text-muted-foreground mb-2">Bultos dentro de la jornada del turno (verde), en horas extra (ámbar) y en feriados (rojo). La línea marca el % de la preparación que dependió de extras (feriados incluidos).</p>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data.porMes.map((m) => ({ ...m, etiqueta: etiquetaMes(m.mes) }))} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="b" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip formatter={(v: number, name: string) => (name.includes('%') ? [pct(v), name] : [n(v), name])} />
            <Legend />
            <Bar yAxisId="b" dataKey="bultosBase" name="Sin extras" stackId="a" fill={COLORES[0]} />
            <Bar yAxisId="b" dataKey="bultosExtras" name="En horas extra" stackId="a" fill={COLORES[1]} />
            <Bar yAxisId="b" dataKey="bultosFeriado" name="En feriados" stackId="a" fill={COLORES[2]} radius={[3, 3, 0, 0]} />
            <Line yAxisId="p" dataKey="pctExtrasTotal" name="% en extras" stroke={COLORES[3]} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 mt-3">
          {porTurnoExtras.map((t) => (
            <div key={t.turno} className="rounded-lg border p-3">
              <p className="text-xs font-semibold">{t.nombre}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Ritmo base: <b className="text-foreground">{n1(t.ritmoBase)}</b> bultos/h</p>
              <p className="text-[11px] text-muted-foreground">Ritmo en extras: <b className="text-foreground">{t.ritmoExtras != null ? n1(t.ritmoExtras) : '—'}</b> bultos/h · {pct(t.pctExtras)} de sus bultos son extras ({n(t.bultosExtras)} en {n(t.horasExtras)} h)</p>
            </div>
          ))}
        </div>
      </div>

      {/* Productividad por hora sin extras vs con extras */}
      {data.tieneOpHora && (
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm font-semibold mb-1 flex items-center gap-1.5"><Flame className="h-4 w-4 text-amber-600" /> Productividad promedio por hora: sin extras vs con extras</p>
          <p className="text-xs text-muted-foreground mb-2">Bultos por hora-hombre en cada hora del día, separando las horas trabajadas dentro de la jornada (verde) de las horas extra (ámbar). Los feriados no influyen.</p>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={perfil} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="etiqueta" tick={{ fontSize: 9 }} interval={1} />
              <YAxis yAxisId="r" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="o" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(v: number, name: string) => (name.startsWith('Productividad') ? [n1(v) + ' bultos/h', name] : [n1(v), name])}
                labelFormatter={(l) => `Hora ${l}`}
              />
              <Legend />
              <Bar yAxisId="o" dataKey="opsJornada" name="Personas en jornada" fill={VERDE} fillOpacity={0.15} />
              <Bar yAxisId="o" dataKey="opsExtras" name="Personas en extras" fill={NARANJA} fillOpacity={0.25} radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" dataKey="ritmoJornada" name="Productividad sin extras" stroke={COLORES[0]} strokeWidth={2.5} dot={false} connectNulls />
              <Line yAxisId="r" dataKey="ritmoExtras" name="Productividad con extras" stroke={COLORES[1]} strokeWidth={2.5} strokeDasharray="6 3" dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Ritmo por día: lunes a domingo con sábados marcados */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm font-semibold mb-1">Ritmo de preparación por día</p>
          <p className="text-xs text-muted-foreground mb-2">Bultos promedio y ritmo (bultos/hora-hombre) de cada día de la semana, excluyendo jornadas feriadas. Los sábados se analizan aparte abajo.</p>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={diasSemana} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="b" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="b" dataKey="bultosProm" name="Bultos promedio" fill={COLORES[0]} radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" dataKey="ritmo" name="Ritmo (bultos/h)" stroke={COLORES[3]} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Día</TableHead>
                <TableHead className="text-right">Días</TableHead>
                <TableHead className="text-right">Bultos prom.</TableHead>
                <TableHead className="text-right">Personas</TableHead>
                <TableHead className="text-right">Ritmo</TableHead>
                <TableHead className="text-right">% extras</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diasSemana.map((d) => (
                <TableRow key={d.dow} className={d.dow === 6 ? 'bg-sky-50/60' : undefined}>
                  <TableCell className="font-medium">{d.dia}{d.dow === 6 && <Badge variant="outline" className="ml-2 border-sky-200 bg-sky-50 text-sky-700">aparte</Badge>}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.dias}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(d.bultosProm)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n1(d.personasProm)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{n1(d.ritmo)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(d.pctExtras)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Comparativa: día normal vs sábado vs feriado */}
        {comp3 && (
          <div className="bg-white rounded-xl border p-4 space-y-3">
            <p className="text-sm font-semibold">Comparativa: día normal vs sábado vs feriado</p>
            <p className="text-xs text-muted-foreground">Promedio por jornada de cada tipo: bultos preparados, personas y ritmo. Incluye los sábados como grupo propio.</p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead />
                    <TableHead className="text-right">Días</TableHead>
                    <TableHead className="text-right">Bultos/jornada</TableHead>
                    <TableHead className="text-right">Personas</TableHead>
                    <TableHead className="text-right">Horas</TableHead>
                    <TableHead className="text-right">Ritmo (bultos/h)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium text-emerald-700">Día normal (lun-vie)</TableCell>
                    <TableCell className="text-right tabular-nums">{comp3.normal?.dias ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{comp3.normal ? n(comp3.normal.bultosPorDia) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{comp3.normal ? n1(comp3.normal.personasPorDia) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{comp3.normal ? n(comp3.normal.horasPorDia) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{n1(comp3.normal?.ritmo ?? null)}</TableCell>
                  </TableRow>
                  <TableRow className="bg-sky-50/50">
                    <TableCell className="font-medium text-sky-700">Sábado</TableCell>
                    <TableCell className="text-right tabular-nums">{comp3.sabados.dias}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(comp3.sabados.bultosPorJornada ?? 0)}{comp3.deltas.sab.bultosPct != null && <Badge variant="outline" className="ml-1 text-[10px]">{comp3.deltas.sab.bultosPct >= 0 ? '+' : ''}{n1(comp3.deltas.sab.bultosPct)}%</Badge>}</TableCell>
                    <TableCell className="text-right tabular-nums">{n1(comp3.sabados.personasPorJornada ?? 0)}{comp3.deltas.sab.personasPct != null && <Badge variant="outline" className="ml-1 text-[10px]">{comp3.deltas.sab.personasPct >= 0 ? '+' : ''}{n1(comp3.deltas.sab.personasPct)}%</Badge>}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(comp3.sabados.horasPorJornada ?? 0)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{n1(comp3.sabados.ritmo)}{comp3.deltas.sab.ritmoPct != null && <Badge variant="outline" className="ml-1 text-[10px]">{comp3.deltas.sab.ritmoPct >= 0 ? '+' : ''}{n1(comp3.deltas.sab.ritmoPct)}%</Badge>}</TableCell>
                  </TableRow>
                  <TableRow className="bg-red-50/40">
                    <TableCell className="font-medium text-red-700">Feriado (todo es extra)</TableCell>
                    <TableCell className="text-right tabular-nums">{comp3.feriado?.dias ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{comp3.feriado ? n(comp3.feriado.bultosPorJornada) : '—'}{comp3.deltas.fer?.bultosPct != null && <Badge variant="outline" className="ml-1 text-[10px]">{comp3.deltas.fer.bultosPct >= 0 ? '+' : ''}{n1(comp3.deltas.fer.bultosPct)}%</Badge>}</TableCell>
                    <TableCell className="text-right tabular-nums">{comp3.feriado ? n1(comp3.feriado.personasPorJornada) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{comp3.feriado ? n(comp3.feriado.horasPorJornada) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{n1(comp3.feriado?.ritmo ?? null)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {data.sabadosResumen && data.sabadosResumen.total > 0 && (
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-xs font-semibold">Sábados analizados aparte: dotación y ritmo</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {data.sabadosResumen.total} sábados con actividad · mediana de dotación <b className="text-foreground">{n1(data.sabadosResumen.personasMediana)}</b> personas ·
                  ritmo <b className="text-foreground">{n1(data.sabadosResumen.ritmo)}</b> bultos/h.
                  {data.sabadosResumen.acotadas > 0 && (
                    <> <b>{data.sabadosResumen.acotadas}</b> sábados operan con dotación acotada (promedio {n1(data.sabadosResumen.personasAcotadasProm)} personas contra {n1(data.sabadosResumen.personasRestoProm)} del resto): esos días la operación la cubre personal del turno tarde en extras.</>
                  )}
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={data.sabados.map((s) => ({ ...s, etiqueta: fechaCorta(s.fecha) }))} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="etiqueta" tick={{ fontSize: 9 }} interval={0} angle={-35} textAnchor="end" height={44} />
                    <YAxis yAxisId="p" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="p" dataKey="personas" name="Dotación" radius={[3, 3, 0, 0]}>
                      {data.sabados.map((s) => <Cell key={s.fecha} fill={s.dotacionAcotada ? COLORES[2] : COLORES[0]} />)}
                    </Bar>
                    <Line yAxisId="r" dataKey="ritmo" name="Ritmo" stroke={COLORES[3]} strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Feriados */}
      {data.feriados.length > 0 && (
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm font-semibold mb-1">Feriados con actividad</p>
          <p className="text-xs text-muted-foreground mb-2">Todo lo producido en una jornada feriada cuenta como horas extra (incluye la noche del turno noche que antecede al feriado).</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feriado</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Personas</TableHead>
                <TableHead className="text-right">Bultos</TableHead>
                <TableHead className="text-right">Horas</TableHead>
                <TableHead className="text-right">Ritmo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.feriados.map((f) => (
                <TableRow key={f.fecha}>
                  <TableCell className="font-medium">{f.nombre}</TableCell>
                  <TableCell>{fechaCorta(f.fecha)}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.personas}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(f.bultos)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n1(f.horas)} h</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{n1(f.ritmo)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
