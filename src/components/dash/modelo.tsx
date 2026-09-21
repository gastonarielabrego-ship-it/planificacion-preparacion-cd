'use client'

// Pestaña "Modelo de Planificación": estima la dotación necesaria a partir de
// la demanda de la ola y TODAS las productividades medidas (ritmo global H61,
// ritmo base sin extras, ritmo en extras, ritmo por turno y productividad neta
// del E-8). Fórmula: personas = demanda ÷ (ritmo × horas) ÷ (1 − cobertura).

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Calculator, Users, Target, Info } from 'lucide-react'
import { SinDatos } from './kpi'
import { fetchDatos, n, n1, COLORES, GG_VERDE, GG_NARANJA, GG_GRIS } from '@/lib/client'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'

interface PlanificadorData {
  ola: { prom: number | null; mediana: number | null; dias: number }
  pendiente: { prom: number | null; mediana: number | null; dias: number }
  demandaTotal: { prom: number | null; mediana: number | null; dias: number }
  porDiaSemana: { dow: number; dia: string; olaProm: number; olaMediana: number | null; pendProm: number; totalProm: number; totalMediana: number | null; dias: number }[]
  h61: {
    dias: number
    bultos: number
    horas: number
    ritmoGlobal: number | null
    ritmoBase: number | null
    ritmoExtras: number | null
    pctExtras: number
    porTurno: { turno: string; nombre: string; bultos: number; bultosBase: number; bultosExtras: number; horas: number; horasBase: number; horasExtras: number; ritmo: number | null; ritmoBase: number | null; ritmoExtras: number | null; personasPromDia: number | null; pctExtras: number; dias: number }[]
  }
  picking: { grano: string; bultos: number; prodTotal: number; prodNeta: number | null; prodSuperNeta: number | null; pctMuerto: number } | null
  perfilHora: { hora: number; etiqueta: string; bultosProm: number }[]
}

type BaseRitmo = 'global' | 'base' | 'extras' | 'turno' | 'e8neta' | 'e8total'

function ritmoElegido(base: BaseRitmo, d: PlanificadorData, turno: string): number | null {
  if (base === 'global') return d.h61.ritmoGlobal
  if (base === 'base') return d.h61.ritmoBase
  if (base === 'extras') return d.h61.ritmoExtras
  if (base === 'turno') return d.h61.porTurno.find((t) => t.turno === turno)?.ritmo ?? d.h61.ritmoGlobal
  if (base === 'e8neta') return d.picking?.prodNeta ?? d.h61.ritmoBase
  return d.picking?.prodTotal ?? d.h61.ritmoGlobal
}

const BASES: { value: BaseRitmo; label: string; detalle: string }[] = [
  { value: 'base', label: 'Ritmo base H61 (sin horas extra)', detalle: 'Bultos por hora-hombre dentro de la jornada del turno: es el ritmo sostenible para planificar sin depender de extras' },
  { value: 'global', label: 'Ritmo global H61 (incluye extras)', detalle: 'Todo el período dividido por todas las horas: incluye lo preparado en extras, por eso es más alto' },
  { value: 'extras', label: 'Ritmo en horas extra', detalle: 'Bultos por hora-hombre trabajada fuera de la ventana del turno' },
  { value: 'turno', label: 'Ritmo base por turno (cada turno su ritmo)', detalle: 'Cada turno (TM/TT/TN) aporta su propio ritmo base medido' },
  { value: 'e8neta', label: 'Productividad neta E-8', detalle: 'Bultos por hora de tiempo neto del E-8 (sin tiempo muerto informado): el techo operativo' },
  { value: 'e8total', label: 'Productividad total E-8', detalle: 'Bultos por hora de jornada completa del E-8 (incluye el tiempo muerto informado)' },
]

export function ModeloTab() {
  const { data, isLoading } = useQuery({ queryKey: ['planificador'], queryFn: () => fetchDatos<PlanificadorData>('planificador') })

  const [base, setBase] = useState<BaseRitmo>('base')
  const [jornada, setJornada] = useState(8)
  const [extrasH, setExtrasH] = useState(0)
  const [cobertura, setCobertura] = useState(10)
  const [bultosHoraCalc, setBultosHoraCalc] = useState('500')
  const [turnosActivos, setTurnosActivos] = useState<Record<string, boolean>>({ M: true, T: true, N: true })

  const opcionesRitmo = useMemo(() => {
    if (!data) return []
    return [
      { value: 'base' as BaseRitmo, label: 'Ritmo base H61 (sin extras)', valor: data.h61.ritmoBase, sub: 'jornada del turno' },
      { value: 'global' as BaseRitmo, label: 'Ritmo global H61', valor: data.h61.ritmoGlobal, sub: 'incluye extras' },
      { value: 'extras' as BaseRitmo, label: 'Ritmo en horas extra', valor: data.h61.ritmoExtras, sub: 'fuera de la ventana' },
      { value: 'turno' as BaseRitmo, label: 'Ritmo base por turno', valor: data.h61.porTurno.find((t) => t.turno === 'M')?.ritmoBase ?? null, sub: data.h61.porTurno.map((t) => `${t.turno}: ${n1(t.ritmoBase)}`).join(' · ') },
      { value: 'e8neta' as BaseRitmo, label: 'Productividad neta E-8', valor: data.picking?.prodNeta ?? null, sub: 'sin tiempo muerto' },
      { value: 'e8total' as BaseRitmo, label: 'Productividad total E-8', valor: data.picking?.prodTotal ?? null, sub: 'con tiempo muerto' },
    ]
  }, [data])

  const calc = useMemo(() => {
    if (!data) return null
    const ritmo = ritmoElegido(base, data, 'M')
    if (!ritmo || ritmo <= 0) return null
    const horasPorPersona = jornada + extrasH
    const factor = (1 - cobertura / 100) * horasPorPersona
    const filas = data.porDiaSemana.map((d) => ({
      ...d,
      personasProm: factor > 0 ? Math.ceil(d.totalProm / (ritmo * factor)) : null,
      personasMediana: factor > 0 && d.totalMediana != null ? Math.ceil(d.totalMediana / (ritmo * factor)) : null,
      personasPromTurnos: (() => {
        if (factor <= 0) return null
        const activos = data.h61.porTurno.filter((t) => turnosActivos[t.turno] && t.bultos > 0)
        const totalBultos = activos.reduce((a, t) => a + t.bultos, 0)
        if (!totalBultos) return null
        return activos.map((t) => ({
          turno: t.turno,
          nombre: t.nombre,
          personas: Math.ceil((d.totalProm * (t.bultos / totalBultos)) / (ritmo * factor)),
        }))
      })(),
    }))
    return { ritmo, horasPorPersona, factor, filas }
  }, [data, base, jornada, extrasH, cobertura, turnosActivos])

  const calcHora = useMemo(() => {
    if (!data) return null
    const ritmo = ritmoElegido(base, data, 'M')
    if (!ritmo || ritmo <= 0) return null
    const bh = parseInt(bultosHoraCalc, 10)
    const personasParaBultosHora = isFinite(bh) && bh > 0 ? +(bh / ritmo).toFixed(1) : null
    const perfil = data.perfilHora.map((p) => ({ ...p, personas: p.bultosProm > 0 ? +(p.bultosProm / ritmo).toFixed(1) : 0 }))
    const picoPersonas = Math.max(0, ...perfil.map((p) => p.personas))
    return { ritmo, personasParaBultosHora, perfil, picoPersonas }
  }, [data, base, bultosHoraCalc])

  if (isLoading) return <div className="grid gap-4"><Skeleton className="h-24" /><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
  if (!data || !data.h61.dias) return <SinDatos mensaje="Cargá el archivo H61 para calibrar el modelo de planificación con las productividades medidas." />

  const toggleTurno = (t: string) => setTurnosActivos((prev) => ({ ...prev, [t]: !prev[t] }))
  const baseSel = BASES.find((b) => b.value === base)

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Cómo funciona el modelo</AlertTitle>
        <AlertDescription>
          El modelo cruza la <b>demanda de la ola</b> (por día de la semana, promedio y mediana) con las <b>productividades medidas</b> en H61 y el E-8.
          La fórmula es: <b>personas = demanda ÷ (ritmo × horas por persona) ÷ (1 − cobertura)</b>. Ajustá la productividad de referencia, la jornada, las horas extra disponibles y la cobertura de ausentismo, y el modelo devuelve la dotación estimada por día y por turno.
        </AlertDescription>
      </Alert>

      {/* 1. productividad de referencia */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" /> 1 · Productividad de referencia</CardTitle>
          <CardDescription>Todas las productividades medidas del período, elegí la que uses para planificar</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {opcionesRitmo.map((o) => (
              <button key={o.value} onClick={() => o.valor != null && setBase(o.value)} disabled={o.valor == null} className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-40 ${base === o.value ? 'border-[#7CB93E] bg-emerald-50 ring-1 ring-[#7CB93E]' : 'hover:bg-muted/40'}`}>
                <p className="text-xs text-muted-foreground">{o.label}</p>
                <p className="text-lg font-bold tabular-nums">{n1(o.valor)} <span className="text-xs font-normal text-muted-foreground">bultos/h</span></p>
                <p className="text-[11px] text-muted-foreground">{o.sub}</p>
              </button>
            ))}
          </div>
          <Select value={base} onValueChange={(v) => setBase(v as BaseRitmo)}>
            <SelectTrigger className="w-full sm:w-[420px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BASES.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{baseSel?.detalle}</p>
        </CardContent>
      </Card>

      {/* 2. parametros de jornada */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">2 · Parámetros de la jornada</CardTitle>
          <CardDescription>Horas que aporta cada persona y cobertura por ausentismo/bajas</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Horas de jornada por persona: <b className="tabular-nums">{jornada} h</b></Label>
            <Slider value={[jornada]} min={4} max={10} step={1} onValueChange={(v) => setJornada(v[0])} />
            <p className="text-[11px] text-muted-foreground">TM 6-14 y TT 14-22 son 8 h; TN es 7 h</p>
          </div>
          <div className="space-y-2">
            <Label>Horas extra disponibles: <b className="tabular-nums">{extrasH} h</b></Label>
            <Slider value={[extrasH]} min={0} max={4} step={1} onValueChange={(v) => setExtrasH(v[0])} />
            <p className="text-[11px] text-muted-foreground">Horas extra por persona por día (0 = planificar sin extras)</p>
          </div>
          <div className="space-y-2">
            <Label>Cobertura por ausentismo: <b className="tabular-nums">{cobertura}%</b></Label>
            <Slider value={[cobertura]} min={0} max={25} step={1} onValueChange={(v) => setCobertura(v[0])} />
            <p className="text-[11px] text-muted-foreground">Margen por bajas, licencias y rotación</p>
          </div>
        </CardContent>
      </Card>

      {/* 3. dotacion por dia */}
      {calc && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> 3 · Dotación estimada por día de la semana</CardTitle>
            <CardDescription>
              Con ritmo de {n1(calc.ritmo)} bultos/h, jornadas de {calc.horasPorPersona} h y cobertura {cobertura}%: cada persona aporta {n1(calc.ritmo * calc.factor)} bultos preparables por día. Sábados no cae ola: se trabaja con pendientes
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-sm font-medium">Turnos a cubrir:</span>
              {data.h61.porTurno.map((t) => (
                <label key={t.turno} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={!!turnosActivos[t.turno]} onCheckedChange={() => toggleTurno(t.turno)} />
                  {t.nombre} <span className="text-xs text-muted-foreground">({n1(t.pctExtras)}% extras hoy)</span>
                </label>
              ))}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Día</TableHead>
                  <TableHead className="text-right">Demanda prom. (ola + pend.)</TableHead>
                  <TableHead className="text-right">Demanda mediana</TableHead>
                  <TableHead className="text-right">Personas (prom.)</TableHead>
                  <TableHead className="text-right">Personas (mediana)</TableHead>
                  <TableHead>Reparto sugerido por turno</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calc.filas.map((f) => (
                  <TableRow key={f.dow} className={f.dow === 6 ? 'bg-sky-50/60' : undefined}>
                    <TableCell className="font-medium">{f.dia}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(f.totalProm)}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.totalMediana != null ? n(f.totalMediana) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums font-bold text-[#5C9429]">{f.personasProm ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.personasMediana ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {f.personasPromTurnos?.map((pt) => (
                          <Badge key={pt.turno} variant="secondary" className="text-[10px]">{pt.turno}: {pt.personas} pers.</Badge>
                        )) ?? <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* 4. calculadora de bultos por hora */}
      {calcHora && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Calculator className="h-4 w-4" /> 4 · ¿Cuántas personas para X bultos por hora?</CardTitle>
            <CardDescription>Convertí cualquier objetivo de bultos por hora en dotación, con la productividad elegida ({n1(calcHora.ritmo)} bultos/h por persona)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="bh">Bultos por hora a preparar</Label>
                <Input id="bh" type="number" min={1} value={bultosHoraCalc} onChange={(e) => setBultosHoraCalc(e.target.value)} className="w-40" />
              </div>
              <div className="rounded-lg border-2 border-[#7CB93E] bg-emerald-50 px-4 py-2">
                <p className="text-xs text-muted-foreground">Personas necesarias</p>
                <p className="text-2xl font-bold text-[#5C9429] tabular-nums">{calcHora.personasParaBultosHora ?? '—'} <span className="text-sm font-normal text-muted-foreground">personas</span></p>
              </div>
              <div className="rounded-lg border px-4 py-2">
                <p className="text-xs text-muted-foreground">Pico del perfil horario</p>
                <p className="text-2xl font-bold tabular-nums">{n1(calcHora.picoPersonas)} <span className="text-sm font-normal text-muted-foreground">personas en la hora pico</span></p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={calcHora.perfil} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} interval={1} />
                <YAxis yAxisId="b" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <YAxis yAxisId="p" orientation="right" tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number, name: string) => (name === 'Personas necesarias' ? [n1(v), name] : [n(v), name])} />
                <Legend />
                <Bar yAxisId="b" dataKey="bultosProm" name="Bultos promedio por hora" fill={GG_VERDE} radius={[2, 2, 0, 0]} />
                <Line yAxisId="p" dataKey="personas" name="Personas necesarias" stroke={GG_NARANJA} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted-foreground">
              La línea naranja muestra cuántas personas se necesitan en cada hora del día para cubrir el perfil promedio de bultos con el ritmo elegido. El pico horario define la dotación mínima que hay que tener disponible en esa franja.
            </p>
          </CardContent>
        </Card>
      )}

      {/* tabla de referencia: ritmos por turno */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Referencia: ritmos medidos por turno</CardTitle>
          <CardDescription>Todos los ritmos del H61 disponibles para calibrar el modelo</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Turno</TableHead>
                <TableHead className="text-right">Personas prom./día</TableHead>
                <TableHead className="text-right">Bultos</TableHead>
                <TableHead className="text-right">Horas</TableHead>
                <TableHead className="text-right">Ritmo total</TableHead>
                <TableHead className="text-right">Ritmo base</TableHead>
                <TableHead className="text-right">Ritmo extras</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.h61.porTurno.map((t, i) => (
                <TableRow key={t.turno}>
                  <TableCell className="font-medium">{t.nombre}</TableCell>
                  <TableCell className="text-right tabular-nums">{n1(t.personasPromDia)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(t.bultos)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(t.horas)} h</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold" style={{ color: COLORES[i % COLORES.length] }}>{n1(t.ritmo)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-emerald-700">{n1(t.ritmoBase)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-amber-700">{n1(t.ritmoExtras)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40">
                <TableCell className="font-bold">Total</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums font-bold">{n(data.h61.bultos)}</TableCell>
                <TableCell className="text-right tabular-nums font-bold">{n(data.h61.horas)} h</TableCell>
                <TableCell className="text-right tabular-nums font-bold">{n1(data.h61.ritmoGlobal)}</TableCell>
                <TableCell className="text-right tabular-nums font-bold text-emerald-700">{n1(data.h61.ritmoBase)}</TableCell>
                <TableCell className="text-right tabular-nums font-bold text-amber-700">{n1(data.h61.ritmoExtras)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
