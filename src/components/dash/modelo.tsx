'use client'

// Pestaña "Modelo de Planificación" — orientada a AUMENTAR la productividad,
// no a mantenerla. Parte del ritmo medido (H61 / E-8) como línea de base y
// exige una meta de mejora (reducir tiempo muerto, esperas, etc.): la misma
// ola se prepara con menos personas, o la misma dotación rinde más.
// Fórmula: personas = demanda ÷ (ritmo META × horas útiles por persona).

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Calculator, Users, Target, Info, TrendingUp, ArrowRight } from 'lucide-react'
import { SinDatos } from './kpi'
import { fetchDatos, n, n1, COLORES, GG_VERDE, GG_NARANJA, GG_GRIS } from '@/lib/client'
import { ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
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
import { Button } from '@/components/ui/button'

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
  if (base === 'turno') return d.h61.porTurno.find((t) => t.turno === turno)?.ritmoBase ?? d.h61.ritmoBase
  if (base === 'e8neta') return d.picking?.prodNeta ?? d.h61.ritmoBase
  return d.picking?.prodTotal ?? d.h61.ritmoGlobal
}

const BASES: { value: BaseRitmo; label: string; detalle: string }[] = [
  { value: 'base', label: 'Ritmo base H61 (sin horas extra)', detalle: 'Bultos por hora-hombre dentro de la jornada del turno: el ritmo sostenible de partida' },
  { value: 'global', label: 'Ritmo global H61 (incluye extras)', detalle: 'Todo el período dividido por todas las horas, incluye lo preparado en extras' },
  { value: 'extras', label: 'Ritmo en horas extra', detalle: 'Bultos por hora-hombre trabajada fuera de la ventana del turno' },
  { value: 'turno', label: 'Ritmo base por turno (cada turno su ritmo)', detalle: 'Parte del ritmo base medido del turno mañana; cada turno mejora desde su propia medida' },
  { value: 'e8neta', label: 'Productividad neta E-8', detalle: 'Bultos por hora neta del E-8 (sin tiempo muerto informado): el techo operativo' },
  { value: 'e8total', label: 'Productividad total E-8', detalle: 'Bultos por hora de jornada completa del E-8 (con el tiempo muerto informado)' },
]

export function ModeloTab() {
  const { data, isLoading } = useQuery({ queryKey: ['planificador'], queryFn: () => fetchDatos<PlanificadorData>('planificador') })

  const [base, setBase] = useState<BaseRitmo>('base')
  const [meta, setMeta] = useState(10)
  const [jornada, setJornada] = useState(8)
  const [extrasH, setExtrasH] = useState(0)
  const [cobertura, setCobertura] = useState(10)
  const [bultosHoraCalc, setBultosHoraCalc] = useState('500')
  const [turnosActivos, setTurnosActivos] = useState<Record<string, boolean>>({ M: true, T: true, N: true })

  const ritmoPartida = useMemo(() => (data ? ritmoElegido(base, data, 'M') : null), [data, base])

  const calc = useMemo(() => {
    if (!data || !ritmoPartida || ritmoPartida <= 0) return null
    const ritmoMeta = ritmoPartida * (1 + meta / 100)
    const horasPorPersona = jornada + extrasH
    const factor = (1 - cobertura / 100) * horasPorPersona
    if (factor <= 0) return null
    const filas = data.porDiaSemana.map((d) => {
      const personasHoy = Math.ceil(d.totalProm / (ritmoPartida * factor))
      const personasMeta = Math.ceil(d.totalProm / (ritmoMeta * factor))
      const ahorro = personasHoy - personasMeta
      return {
        ...d,
        personasHoy,
        personasMeta,
        ahorro,
        ahorroPct: personasHoy > 0 ? (ahorro / personasHoy) * 100 : 0,
        personasMetaTurnos: (() => {
          const activos = data.h61.porTurno.filter((t) => turnosActivos[t.turno] && t.bultos > 0)
          const totalBultos = activos.reduce((a, t) => a + t.bultos, 0)
          if (!totalBultos) return null
          return activos.map((t) => ({
            turno: t.turno,
            nombre: t.nombre,
            personas: Math.ceil((d.totalProm * (t.bultos / totalBultos)) / (ritmoMeta * factor)),
          }))
        })(),
      }
    })
    const totalHoy = filas.reduce((a, f) => a + f.personasHoy, 0)
    const totalMeta = filas.reduce((a, f) => a + f.personasMeta, 0)
    return { ritmoPartida, ritmoMeta, horasPorPersona, factor, filas, totalHoy, totalMeta, ahorroTotal: totalHoy - totalMeta }
  }, [data, ritmoPartida, meta, jornada, extrasH, cobertura, turnosActivos])

  // Escenarios sugeridos a partir de los datos medidos
  const escenarios = useMemo(() => {
    if (!data || !ritmoPartida || ritmoPartida <= 0) return []
    const list: { label: string; metaPct: number }[] = []
    const m = data.picking?.pctMuerto ?? 0
    if (m > 0) {
      const pct = (m / 2) / (100 - m / 2) * 100
      list.push({ label: `Recortar a la mitad el tiempo muerto del E-8 (${n1(m)}% de la jornada) → ≈ +${n1(pct)}%`, metaPct: +pct.toFixed(1) })
    }
    const techo = data.picking?.prodNeta
    if (techo != null && ritmoPartida < techo) {
      list.push({ label: `Llegar al techo operativo E-8 (productividad neta ${n1(techo)} bult/h) → +${n1(((techo / ritmoPartida - 1) * 100))}%`, metaPct: +((techo / ritmoPartida - 1) * 100).toFixed(1) })
    }
    return list
  }, [data, ritmoPartida])

  const calcHora = useMemo(() => {
    if (!calc) return null
    const bh = parseInt(bultosHoraCalc, 10)
    const personasParaBultosHora = isFinite(bh) && bh > 0 ? +(bh / calc.ritmoMeta).toFixed(1) : null
    const perfil = data?.perfilHora.map((p) => ({ ...p, personas: p.bultosProm > 0 ? +(p.bultosProm / calc.ritmoMeta).toFixed(1) : 0 })) ?? []
    const picoPersonas = Math.max(0, ...perfil.map((p) => p.personas))
    return { personasParaBultosHora, perfil, picoPersonas }
  }, [calc, data, bultosHoraCalc])

  if (isLoading) return <div className="grid gap-4"><Skeleton className="h-24" /><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
  if (!data || !data.h61.dias) return <SinDatos mensaje="Cargá el archivo H61 para calibrar el modelo de planificación con las productividades medidas." />

  const toggleTurno = (t: string) => setTurnosActivos((prev) => ({ ...prev, [t]: !prev[t] }))
  const baseSel = BASES.find((b) => b.value === base)
  const techo = data.picking?.prodNeta ?? null
  const superaTecho = techo != null && calc != null && calc.ritmoMeta > techo

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Cómo funciona: el modelo exige mejorar la productividad, no mantenerla</AlertTitle>
        <AlertDescription>
          <ol className="list-decimal ml-4 space-y-1 mt-1">
            <li><b>Demanda:</b> qué hay que preparar cada día (ola + pendiente, promedio y mediana).</li>
            <li><b>Productividad:</b> se parte del ritmo <b>medido</b> (línea de base) y se fija una <b>meta de mejora</b> — por ejemplo recortando el tiempo muerto y las esperas. Planificar con el ritmo de hoy sería aceptar la productividad actual; el modelo siempre planifica con el ritmo objetivo.</li>
            <li><b>Dotación:</b> personas = demanda ÷ (ritmo meta × horas útiles por persona). A mayor productividad, menos personas para la misma ola — o la misma dotación termina antes y rinde más.</li>
          </ol>
        </AlertDescription>
      </Alert>

      {/* 1. demanda */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">1 · Demanda a preparar por día de la semana</CardTitle>
          <CardDescription>Ola + pendiente: lo que llega a preparar. Sábados no cae ola, se trabaja con pendientes</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Día</TableHead>
                <TableHead className="text-right">Ola prom.</TableHead>
                <TableHead className="text-right">Pendiente prom.</TableHead>
                <TableHead className="text-right">Demanda prom.</TableHead>
                <TableHead className="text-right">Demanda mediana</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.porDiaSemana.map((d) => (
                <TableRow key={d.dow} className={d.dow === 6 ? 'bg-sky-50/60' : undefined}>
                  <TableCell className="font-medium">{d.dia}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(d.olaProm)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(d.pendProm)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{n(d.totalProm)}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.totalMediana != null ? n(d.totalMediana) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 2. productividad: partida → meta */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" /> 2 · Productividad: de la medida actual a la meta de mejora</CardTitle>
          <CardDescription>Elegí el ritmo de partida (medido) y fijá cuánto lo vamos a mejorar — el modelo planifica con la meta</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>Productividad de partida (medida)</Label>
              <Select value={base} onValueChange={(v) => setBase(v as BaseRitmo)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BASES.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{baseSel?.detalle}</p>
              {techo != null && <p className="text-xs text-muted-foreground">Referencia: techo operativo E-8 (productividad neta) = <b>{n1(techo)} bultos/h</b></p>}
            </div>
            <div className="rounded-lg border-2 border-[#7CB93E] bg-emerald-50/60 p-4 flex flex-col justify-center gap-3">
              <div className="flex items-center justify-center gap-4">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Ritmo medido hoy</p>
                  <p className="text-2xl font-bold tabular-nums text-[#58595B]">{n1(ritmoPartida)}</p>
                  <p className="text-[11px] text-muted-foreground">bultos/h por persona</p>
                </div>
                <ArrowRight className="h-6 w-6 text-[#7CB93E]" />
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Meta de planificación</p>
                  <p className="text-2xl font-bold tabular-nums text-[#5C9429]">{calc ? n1(calc.ritmoMeta) : '—'}</p>
                  <p className="text-[11px] text-muted-foreground">bultos/h por persona</p>
                </div>
              </div>
              {superaTecho && (
                <p className="text-[11px] text-amber-700 text-center">⚠ La meta supera el techo operativo medido por el E-8 ({n1(techo)} bult/h): alcanzable solo si se elimina casi todo el tiempo muerto informado</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Meta de mejora sobre la productividad: <b className="tabular-nums text-[#5C9429]">+{meta}%</b></Label>
            <Slider value={[meta]} min={0} max={30} step={1} onValueChange={(v) => setMeta(v[0])} />
            <div className="flex flex-wrap gap-2">
              {[5, 10, 15, 20].map((p) => (
                <Button key={p} size="sm" variant={meta === p ? 'default' : 'outline'} className={meta === p ? 'bg-[#7CB93E] hover:bg-[#5C9429]' : ''} onClick={() => setMeta(p)}>+{p}%</Button>
              ))}
              {escenarios.map((e) => (
                <Button key={e.label} size="sm" variant="outline" className="border-[#F08A00] text-[#B86A00] hover:bg-orange-50" onClick={() => setMeta(e.metaPct)} title={e.label}>
                  <TrendingUp className="h-3.5 w-3.5 mr-1" />{e.metaPct > 0 ? `+${n1(e.metaPct)}%` : `${n1(e.metaPct)}%`} (escenario)
                </Button>
              ))}
            </div>
            {escenarios.length > 0 && <p className="text-xs text-muted-foreground">Los escenarios naranjas salen de los datos medidos: {escenarios.map((e) => e.label).join(' · ')}</p>}
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
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
          </div>
          {calc && <p className="text-xs text-muted-foreground">Con estos parámetros cada persona aporta <b>{n1(calc.ritmoMeta * calc.factor)}</b> bultos preparables por día (ritmo meta × {calc.horasPorPersona} h × {100 - cobertura}% útil).</p>}
        </CardContent>
      </Card>

      {/* 3. dotacion: hoy vs meta */}
      {calc && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> 3 · Dotación necesaria: con la productividad de hoy vs con la meta</CardTitle>
            <CardDescription>
              La diferencia es el resultado directo de la mejora de productividad: menos personas para la misma ola (o la misma gente rindiendo más)
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
                  <TableHead className="text-right">Demanda prom.</TableHead>
                  <TableHead className="text-right">Personas con ritmo actual</TableHead>
                  <TableHead className="text-right">Personas con la meta (+{meta}%)</TableHead>
                  <TableHead className="text-right">Ahorro</TableHead>
                  <TableHead>Reparto sugerido por turno (con meta)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calc.filas.map((f) => (
                  <TableRow key={f.dow} className={f.dow === 6 ? 'bg-sky-50/60' : undefined}>
                    <TableCell className="font-medium">{f.dia}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(f.totalProm)}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.personasHoy}</TableCell>
                    <TableCell className="text-right tabular-nums font-bold text-[#5C9429]">{f.personasMeta}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.ahorro > 0 ? <span className="font-semibold text-emerald-700">−{f.ahorro} ({n1(f.ahorroPct)}%)</span> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {f.personasMetaTurnos?.map((pt) => (
                          <Badge key={pt.turno} variant="secondary" className="text-[10px]">{pt.turno}: {pt.personas} pers.</Badge>
                        )) ?? <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-emerald-50/60">
                  <TableCell className="font-bold">Semana</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums font-bold">{calc.totalHoy}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold text-[#5C9429]">{calc.totalMeta}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold text-emerald-700">−{calc.ahorroTotal}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={calc.filas.map((f) => ({ dia: f.dia, hoy: f.personasHoy, meta: f.personasMeta }))} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="dia" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="hoy" name="Personas con ritmo actual" fill={GG_GRIS} radius={[3, 3, 0, 0]} />
                <Bar dataKey="meta" name="Personas con la meta de productividad" fill={GG_VERDE} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted-foreground">
              Fórmula: personas = demanda ÷ (ritmo meta × {calc.horasPorPersona} h) ÷ {100 - cobertura}% útil. El ahorro de la semana ({calc.ahorroTotal} personas-turno) es lo que permite cubrir más demanda, reducir extras o liberar horas.
            </p>
          </CardContent>
        </Card>
      )}

      {/* 4. calculadora + perfil horario con meta */}
      {calcHora && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Calculator className="h-4 w-4" /> 4 · Personas por hora con la meta de productividad</CardTitle>
            <CardDescription>Perfil horario: cuántas personas hacen falta en cada hora del día al ritmo meta de {calc ? n1(calc.ritmoMeta) : '—'} bultos/h</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="bh">Bultos por hora a preparar</Label>
                <Input id="bh" type="number" min={1} value={bultosHoraCalc} onChange={(e) => setBultosHoraCalc(e.target.value)} className="w-40" />
              </div>
              <div className="rounded-lg border-2 border-[#7CB93E] bg-emerald-50 px-4 py-2">
                <p className="text-xs text-muted-foreground">Personas necesarias (con la meta)</p>
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
                <Tooltip formatter={(v: number, name: string) => (name === 'Personas necesarias (meta)' ? [n1(v), name] : [n(v), name])} />
                <Legend />
                <Bar yAxisId="b" dataKey="bultosProm" name="Bultos promedio por hora" fill={GG_VERDE} radius={[2, 2, 0, 0]} />
                <Line yAxisId="p" dataKey="personas" name="Personas necesarias (meta)" stroke={GG_NARANJA} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted-foreground">
              La línea naranja muestra cuántas personas se necesitan en cada hora para cubrir el perfil promedio de bultos al ritmo meta. El pico horario define la dotación mínima de esa franja; los valles indican cuándo reasignar personas a apros o reabastecimiento.
            </p>
          </CardContent>
        </Card>
      )}

      {/* tabla de referencia: ritmos por turno */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Referencia: ritmos medidos por turno</CardTitle>
          <CardDescription>Base de medición sobre la que se fija la meta de mejora</CardDescription>
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
