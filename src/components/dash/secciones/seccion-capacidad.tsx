'use client'

// Sección "Capacidad H61" del Resumen: ritmo de preparación por día (lun-vie),
// sábados analizados aparte, feriados, comparativa que incluye los sábados,
// influencia de las horas extra en la preparación, ritmo por turno en extras y
// productividad promedio por hora sin extras vs con extras.

import { useMemo } from 'react'
import { Gauge, Hourglass, Layers, Users, CalendarOff, Sigma } from 'lucide-react'
import { Kpi, SinDatos } from '../kpi'
import { n, n1, pct, fechaCorta, COLORES, GG_VERDE, GG_NARANJA, GG_GRIS } from '@/lib/client'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'

const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const etiquetaMes = (ym: string) => `${MESES_ABR[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`

export interface SerieCapDia {
  fecha: string
  bultos: number
  bultosNormales: number
  bultosBase: number
  bultosExtras: number
  bultosFeriado: number
  pctExtras: number
  ritmo: number | null
  ops: number
  opsExtras: number
  opDias: number
  opDiasNormales: number
  horasNormales: number
  esFeriado: boolean
  feriado: string | null
}
export interface CapacidadData {
  serie: SerieCapDia[]
  porMes: { mes: string; dias: number; diasFeriado: number; actividades: number; personas: number; personasExtras: number; bultos: number; bultosBase: number; bultosExtras: number; bultosFeriado: number; pctExtras: number; pctExtrasTotal: number; horas: number; horasExtras: number; horasFeriado: number; ritmoProm: number | null; ritmoMediana: number | null }[]
  porTurno: { turno: string; nombre: string; opDias: number; personas: number; personasExtras: number; bultos: number; bultosBase: number; bultosExtras: number; pctExtras: number; horasExtras: number; ritmoProm: number | null }[]
  perfilHora: { hora: number; etiqueta: string; opsJornada: number; opsExtras: number; bultosProm: number; bultosJornadaProm: number; bultosExtrasProm: number; ritmoJornada: number | null; ritmoExtras: number | null }[]
  feriados: { fecha: string; nombre: string; tipo: string; personas: number; opDias: number; bultos: number; horas: number; ritmo: number | null }[]
  resumen: { dias: number; actividades: number; personas: number; personasExtras: number; bultos: number; bultosBase: number; bultosExtras: number; pctExtras: number; horas: number; horasExtras: number; ritmoProm: number | null; ritmoMediana: number | null; diasFeriado: number; bultosFeriado: number; horasFeriado: number; personasFeriado: number; pctExtrasTotal: number } | null
  porDiaSemana: { dow: number; dia: string; dias: number; bultosProm: number; personasProm: number; horasProm: number; ritmo: number | null; ritmoMediana: number | null; pctExtras: number }[]
  sabados: { fecha: string; bultos: number; bultosNormales: number; personas: number; personasExtras: number; opDias: number; horas: number; ritmo: number | null; pctExtras: number; bultosFeriado: number; feriadoManana: string | null; esFeriado: boolean; dotacionAcotada: boolean }[]
  sabadosResumen: { total: number; personasMediana: number; acotadas: number; personasAcotadasProm: number | null; personasRestoProm: number | null; ritmo: number | null } | null
  tieneOpHora: boolean
}

export function SeccionCapacidad({ data }: { data: CapacidadData }) {
  const resumen = data.resumen

  // ---- comparativa que incluye los sábados: L-V normal vs sábado vs feriado ----
  const dowDe = (f: string) => new Date(f + 'T00:00:00.000Z').getUTCDay()
  const comparativaSab = useMemo(() => {
    const lv = data.serie.filter((s) => s.opDiasNormales > 0 && dowDe(s.fecha) >= 1 && dowDe(s.fecha) <= 5)
    const sab = data.serie.filter((s) => s.opDiasNormales > 0 && dowDe(s.fecha) === 6)
    const fer = data.feriados
    const bloque = (dias: number, bultos: number, horas: number, personas: number, n: number) => ({
      dias: n,
      bultosPorDia: n ? Math.round(bultos / n) : 0,
      personasPorDia: n ? +(personas / n).toFixed(1) : 0,
      horasPorDia: n ? Math.round(horas / n) : 0,
      ritmo: horas ? +(bultos / horas).toFixed(1) : null,
    })
    return {
      lv: bloque(lv.length, lv.reduce((a, s) => a + s.bultosNormales, 0), lv.reduce((a, s) => a + s.horasNormales, 0), lv.reduce((a, s) => a + s.ops, 0), lv.length),
      sab: bloque(sab.length, sab.reduce((a, s) => a + s.bultosNormales, 0), sab.reduce((a, s) => a + s.horasNormales, 0), sab.reduce((a, s) => a + s.ops, 0), sab.length),
      fer: bloque(fer.length, fer.reduce((a, f) => a + f.bultos, 0), fer.reduce((a, f) => a + f.horas, 0), fer.reduce((a, f) => a + f.personas, 0), fer.length),
    }
  }, [data.serie, data.feriados])

  if (!resumen) return <SinDatos mensaje="Cargá el archivo H61 (capacidad) para ver el ritmo de preparación." />

  // ---- ritmo por turno en extras (ritmo extras = bultosExtras / horasExtras) ----
  const turnosExtras = data.porTurno.map((t) => ({
    ...t,
    ritmoExtras: t.horasExtras > 0 ? +(t.bultosExtras / t.horasExtras).toFixed(1) : null,
  }))

  const diasSemanaLV = (data.porDiaSemana ?? []).filter((d) => d.dow >= 1 && d.dow <= 5)
  const sab = data.sabados ?? []
  const sabResumen = data.sabadosResumen

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Ritmo de preparación" valor={resumen.ritmoProm} formato="decimal" unidad="bultos/h" icono={Gauge} tono="exito" detalle={`Mediana de los días: ${n1(resumen.ritmoMediana)} bultos/h`} />
        <Kpi titulo="Bultos sin horas extra" valor={resumen.bultosBase} unidad="bultos" icono={Layers} detalle={`${pct(resumen.bultos ? 100 - resumen.pctExtras : null)} de la preparación, dentro de la jornada del turno`} />
        <Kpi titulo="Bultos en horas extra" valor={resumen.bultosExtras} unidad="bultos" icono={Hourglass} tono="alerta" detalle={`${pct(resumen.pctExtras)} del total · ${n(resumen.horasExtras)} h extra (+ feriados)`} />
        <Kpi titulo="Personas involucradas" valor={resumen.personas} unidad="operarios" icono={Users} detalle={`${n(resumen.actividades)} operario-días en ${resumen.dias} días · ${resumen.personasExtras} hicieron extras`} />
      </div>

      {/* Ritmo por día: lunes a viernes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ritmo de preparación por día (lunes a viernes)</CardTitle>
          <CardDescription>Bultos promedio de cada día y ritmo (bultos por hora-hombre). Los sábados se analizan aparte más abajo; los feriados no influyen en esta medición</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={diasSemanaLV} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="b" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="b" dataKey="bultosProm" name="Bultos promedio del día" fill={GG_VERDE} radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" dataKey="ritmo" name="Ritmo (bultos/h)" stroke={GG_NARANJA} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Día</TableHead>
                <TableHead className="text-right">Días</TableHead>
                <TableHead className="text-right">Bultos prom.</TableHead>
                <TableHead className="text-right">Personas prom.</TableHead>
                <TableHead className="text-right">Horas-hombre</TableHead>
                <TableHead className="text-right">Ritmo (bultos/h)</TableHead>
                <TableHead className="text-right">Mediana días</TableHead>
                <TableHead className="text-right">% extras</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diasSemanaLV.map((d) => (
                <TableRow key={d.dow}>
                  <TableCell className="font-medium">{d.dia}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.dias}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(d.bultosProm)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n1(d.personasProm)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(d.horasProm)} h</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{n1(d.ritmo)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n1(d.ritmoMediana)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(d.pctExtras)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Sábados aparte */}
      {sabResumen && sab.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Sábados (análisis aparte)</CardTitle>
              {sabResumen.acotadas > 0 && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">dotación acotada cada 15 días</Badge>}
            </div>
            <CardDescription>
              {`${sabResumen.total} sábados con actividad · mediana de dotación ${n1(sabResumen.personasMediana)} personas · ritmo ${n1(sabResumen.ritmo)} bultos/h`}
              {sabResumen.acotadas > 0 && ` · ${sabResumen.acotadas} con dotación acotada (prom. ${n1(sabResumen.personasAcotadasProm)} personas contra ${n1(sabResumen.personasRestoProm)} del resto): esos días la operación la cubre personal del turno tarde en extras`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={sab.map((s) => ({ ...s, etiqueta: fechaCorta(s.fecha) }))} margin={{ left: 4, right: 8, top: 12, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 9 }} interval={0} angle={-35} textAnchor="end" height={52} />
                <YAxis yAxisId="p" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="p" dataKey="personas" name="Dotación (personas)" radius={[3, 3, 0, 0]}>
                  {sab.map((s) => <Cell key={s.fecha} fill={s.dotacionAcotada ? '#dc2626' : GG_VERDE} />)}
                </Bar>
                <Line yAxisId="r" dataKey="ritmo" name="Ritmo (bultos/h)" stroke={GG_NARANJA} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Sábados con actividad</p>
                <p className="text-xl font-bold tabular-nums">{sabResumen.total}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Dotación mediana</p>
                <p className="text-xl font-bold tabular-nums">{n1(sabResumen.personasMediana)}</p>
                <p className="text-xs text-muted-foreground">personas por sábado</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Ritmo de los sábados</p>
                <p className="text-xl font-bold tabular-nums">{n1(sabResumen.ritmo)}</p>
                <p className="text-xs text-muted-foreground">bultos por hora-hombre</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Bultos promedio</p>
                <p className="text-xl font-bold tabular-nums">{n(sab.reduce((a, s) => a + s.bultosNormales, 0) / Math.max(1, sab.length))}</p>
                <p className="text-xs text-muted-foreground">por sábado (sin extras)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Feriados */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2"><CalendarOff className="h-4 w-4 text-red-600" /> Feriados (medición aparte)</CardTitle>
            <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">todo feriado = horas extra</Badge>
          </div>
          <CardDescription>
            Cada feriado reúne su jornada completa: la noche del turno noche previo (23 a 6) más los diurnos del día feriado. Su producción cuenta como horas extra y no influye en los promedios ni medianas de la medición normal
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border bg-red-50/40 p-3">
              <p className="text-xs text-muted-foreground">Bultos en feriados</p>
              <p className="text-xl font-bold text-red-700 tabular-nums">{n(resumen.bultosFeriado)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Feriados con actividad</p>
              <p className="text-xl font-bold tabular-nums">{resumen.diasFeriado}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Personas que trabajaron</p>
              <p className="text-xl font-bold tabular-nums">{resumen.personasFeriado}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Ritmo en feriados</p>
              <p className="text-xl font-bold tabular-nums">{n1(resumen.horasFeriado ? resumen.bultosFeriado / resumen.horasFeriado : null)}</p>
            </div>
          </div>
          {data.feriados.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Feriado</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Personas</TableHead>
                  <TableHead className="text-right">Bultos</TableHead>
                  <TableHead className="text-right">Horas</TableHead>
                  <TableHead className="text-right">Ritmo (bultos/h)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.feriados.map((f) => (
                  <TableRow key={f.fecha} className="bg-red-50/40">
                    <TableCell className="font-medium">{f.nombre}</TableCell>
                    <TableCell className="tabular-nums">{fechaCorta(f.fecha)}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.personas}</TableCell>
                    <TableCell className="text-right tabular-nums text-red-700">{n(f.bultos)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(f.horas)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{n1(f.ritmo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Comparativa: día normal L-V vs sábado vs feriado */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Sigma className="h-4 w-4" /> Comparativa: día normal vs sábado vs feriado</CardTitle>
          <CardDescription>La jornada feriada reúne la noche TN previa más los diurnos del feriado; los sábados solo trabajan pendientes. Ritmo = bultos por hora-hombre</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead></TableHead>
                <TableHead className="text-right">Lunes a viernes</TableHead>
                <TableHead className="text-right">Sábados</TableHead>
                <TableHead className="text-right">Feriados</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Jornadas medidas</TableCell>
                <TableCell className="text-right tabular-nums">{comparativaSab.lv.dias}</TableCell>
                <TableCell className="text-right tabular-nums">{comparativaSab.sab.dias}</TableCell>
                <TableCell className="text-right tabular-nums">{comparativaSab.fer.dias}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Bultos por jornada</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{n(comparativaSab.lv.bultosPorDia)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{n(comparativaSab.sab.bultosPorDia)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold text-red-700">{n(comparativaSab.fer.bultosPorDia)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Personas por jornada</TableCell>
                <TableCell className="text-right tabular-nums">{n1(comparativaSab.lv.personasPorDia)}</TableCell>
                <TableCell className="text-right tabular-nums">{n1(comparativaSab.sab.personasPorDia)}</TableCell>
                <TableCell className="text-right tabular-nums">{n1(comparativaSab.fer.personasPorDia)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Horas-hombre por jornada</TableCell>
                <TableCell className="text-right tabular-nums">{n(comparativaSab.lv.horasPorDia)}</TableCell>
                <TableCell className="text-right tabular-nums">{n(comparativaSab.sab.horasPorDia)}</TableCell>
                <TableCell className="text-right tabular-nums">{n(comparativaSab.fer.horasPorDia)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Ritmo (bultos/h)</TableCell>
                <TableCell className="text-right tabular-nums font-semibold text-emerald-700">{n1(comparativaSab.lv.ritmo)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold text-emerald-700">{n1(comparativaSab.sab.ritmo)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold text-red-700">{n1(comparativaSab.fer.ritmo)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Influencia de las horas extra */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Influencia de las horas extra en la preparación</CardTitle>
          <CardDescription>Bultos preparados dentro de la jornada del turno (verde) contra bultos preparados en horas extra (ámbar), por mes. La línea marca qué % de la preparación de cada mes dependió de extras</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={data.porMes.map((m) => ({ ...m, etiqueta: etiquetaMes(m.mes) }))} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="b" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v: number, name: string) => (name.includes('%') ? [pct(v), name] : [n(v), name])} />
              <Legend />
              <Bar yAxisId="b" dataKey="bultosBase" name="Sin extras (jornada)" stackId="a" fill={GG_VERDE} />
              <Bar yAxisId="b" dataKey="bultosExtras" name="En horas extra" stackId="a" fill={GG_NARANJA} radius={[3, 3, 0, 0]} />
              <Line yAxisId="p" dataKey="pctExtras" name="% en extras" stroke={GG_GRIS} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Ritmo por turno, incluido el ritmo en extras */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ritmo por turno (jornada y extras)</CardTitle>
          <CardDescription>Ventanas de jornada base: TM 6-14 · TT 14-22 · TN 23-06. El ritmo en extras mide solo las horas trabajadas fuera de esa ventana</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Turno</TableHead>
                <TableHead className="text-right">Op-días</TableHead>
                <TableHead className="text-right">Personas</TableHead>
                <TableHead className="text-right">Bultos sin extras</TableHead>
                <TableHead className="text-right">Bultos en extras</TableHead>
                <TableHead className="text-right">% extras</TableHead>
                <TableHead className="text-right">Horas extra</TableHead>
                <TableHead className="text-right">Ritmo jornada (bultos/h)</TableHead>
                <TableHead className="text-right">Ritmo en extras (bultos/h)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {turnosExtras.map((t) => (
                <TableRow key={t.turno}>
                  <TableCell className="font-medium">{t.nombre}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(t.opDias)}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.personas}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(t.bultosBase)}</TableCell>
                  <TableCell className="text-right tabular-nums text-amber-700">{t.bultosExtras ? n(t.bultosExtras) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{pct(t.pctExtras)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(t.horasExtras)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{n1(t.ritmoProm)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-amber-700">{n1(t.ritmoExtras)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* NEW: productividad promedio por hora sin extras y con extras */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Productividad promedio por hora: sin extras vs con extras</CardTitle>
          <CardDescription>
            Promedio de bultos preparados en cada hora del día (barras) y productividad de esa hora (bultos por persona activa, líneas) separando quienes están en su jornada base y quienes están en horas extra. Requiere el detalle operario × hora del archivo H61
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!data.tieneOpHora ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Este gráfico necesita el detalle operario × hora. Volvé a cargar el archivo H61 para habilitarlo.</p>
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={data.perfilHora} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} interval={1} />
                <YAxis yAxisId="b" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="b" dataKey="bultosJornadaProm" name="Bultos/hora — jornada (sin extras)" stackId="a" fill={GG_VERDE} />
                <Bar yAxisId="b" dataKey="bultosExtrasProm" name="Bultos/hora — extras" stackId="a" fill={GG_NARANJA} radius={[3, 3, 0, 0]} />
                <Line yAxisId="r" dataKey="ritmoJornada" name="Prod. por hora — sin extras" stroke={GG_VERDE} strokeWidth={2} dot={false} />
                <Line yAxisId="r" dataKey="ritmoExtras" name="Prod. por hora — con extras" stroke={GG_NARANJA} strokeWidth={2} strokeDasharray="4 3" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Detalle mensual compacto */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalle mensual</CardTitle>
          <CardDescription>Ritmo = bultos por hora-hombre, solo días no feriados. La producción de feriados se lista aparte</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[320px] rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Días</TableHead>
                  <TableHead className="text-right">Personas</TableHead>
                  <TableHead className="text-right">Bultos sin extras</TableHead>
                  <TableHead className="text-right">Bultos en extras</TableHead>
                  <TableHead className="text-right">% extras</TableHead>
                  <TableHead className="text-right">Ritmo prom.</TableHead>
                  <TableHead className="text-right">Mediana días</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.porMes.map((m) => (
                  <TableRow key={m.mes}>
                    <TableCell className="font-medium">{etiquetaMes(m.mes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.dias}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.personas}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(m.bultosBase)}</TableCell>
                    <TableCell className="text-right tabular-nums text-amber-700">{n(m.bultosExtras)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{pct(m.pctExtras)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{n1(m.ritmoProm)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n1(m.ritmoMediana)}</TableCell>
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
