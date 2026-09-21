'use client'

// Pestaña "Planificación Diaria" (3ra): el usuario carga Ola diaria + Pendiente,
// los bultos por circuito (ACT. 2, ACT. 4, Jaula, XD) y las máquinas a usar
// (tope 100, disponibles 90). Con los históricos (perfil horario por tipo de día
// y ritmo por circuito del E-8 calibrado al ritmo base H61) devuelve cuántas
// personas hacen falta por hora y por actividad, con la productividad actual
// (≈85 bult/h) y con mejoras de +5/+10/+15/+20%, y si esa dotación entra en las
// máquinas disponibles.
// Política: sábados cerrados por defecto (abrir solo cada 15 días) y domingos
// solo turno noche (TN).

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, Forklift, Users, AlertTriangle, CheckCircle2, RotateCcw, Info } from 'lucide-react'
import { SinDatos } from './kpi'
import { fetchDatos, n, n1, GG_VERDE, GG_NARANJA, GG_GRIS } from '@/lib/client'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'

interface CircuitoRitmo {
  sector: string
  etiqueta: string
  bultos: number
  horas: number
  ritmoTotal: number | null
  ritmoNeto: number | null
  pctMuerto: number | null
  share: number
  ritmoCal: number | null
}

interface PlanificadorData {
  ola: { prom: number | null; mediana: number | null; dias: number }
  pendiente: { prom: number | null; mediana: number | null; dias: number }
  demandaTotal: { prom: number | null; mediana: number | null; dias: number }
  porDiaSemana: { dow: number; dia: string; olaProm: number; olaMediana: number | null; pendProm: number; totalProm: number; totalMediana: number | null; dias: number }[]
  h61: { dias: number; bultos: number; horas: number; ritmoGlobal: number | null; ritmoBase: number | null; ritmoExtras: number | null; pctExtras: number; porTurno: { turno: string; nombre: string; ritmo: number | null; ritmoBase: number | null; ritmoExtras: number | null }[] }
  picking: { grano: string; bultos: number; prodTotal: number; prodNeta: number | null; prodSuperNeta: number | null; pctMuerto: number } | null
  perfilHora: { hora: number; etiqueta: string; bultosProm: number }[]
  planDiaria: {
    circuitos: CircuitoRitmo[]
    calibracion: { ritmoH61: number | null; ritmoE8: number | null; factor: number }
    perfiles: { lv: number[]; sab: number[]; dom: number[] }
    diasPerfil: { lv: number; sab: number; dom: number }
    ritmoHora: (number | null)[]
  }
}

// ventanas de turno: TM (6 a 14), TT (14 a 22), TN (23 a 06) — el TT cubre la hora 22
const HORAS_TM = [6, 7, 8, 9, 10, 11, 12, 13]
const HORAS_TT = [14, 15, 16, 17, 18, 19, 20, 21, 22]
const HORAS_TN = [23, 0, 1, 2, 3, 4, 5]
const ORDEN_HORAS = [...HORAS_TM, ...HORAS_TT, ...HORAS_TN]
const NOMBRE_TURNO: Record<string, string> = { TM: 'TM (6 a 14)', TT: 'TT (14 a 22)', TN: 'TN (23 a 06)' }
const DIAS_SEM = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const METAS = [0, 5, 10, 15, 20]
const ETIQUETA_HORA = (h: number) => `${String(h).padStart(2, '0')}:00`

const dowDe = (f: string) => new Date(f + 'T00:00:00.000Z').getUTCDay()
const hoyISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const parseNum = (s: string) => {
  const v = parseInt(s.replace(/[^0-9]/g, ''), 10)
  return isFinite(v) && v > 0 ? v : 0
}

const SECTORES_CLAVE = ['ACT2', 'ACT4', 'JAULA', 'XD']

// semana tipo: para cada día de la semana, demanda promedio histórica → pico simultáneo
// y bultos sin cubrir con la meta elegida y el tope de máquinas
function calcSemanaTipo(data: PlanificadorData, meta: number, maquinas: number, sabAbre: boolean) {
  const pd = data.planDiaria
  return [1, 2, 3, 4, 5, 6, 0].map((dw) => {
    const t: 'lv' | 'sab' | 'dom' = dw === 0 ? 'dom' : dw === 6 ? 'sab' : 'lv'
    let perfil = pd.perfiles[t]
    if (t === 'sab' && perfil.reduce((a, b) => a + b, 0) === 0) perfil = pd.perfiles.lv
    if (t === 'dom' && perfil.reduce((a, b) => a + b, 0) === 0) perfil = pd.perfiles.lv
    const horas = (t === 'dom' ? HORAS_TN : ORDEN_HORAS).filter((h) => perfil[h] > 0)
    const suma = horas.reduce((a, h) => a + perfil[h], 0)
    const hist = data.porDiaSemana.find((d) => d.dow === dw) ?? null
    const total = hist?.totalProm ?? 0
    const w = (h: number) => (suma > 0 ? perfil[h] / suma : 1 / Math.max(1, horas.length))
    const esc = METAS.includes(meta) ? meta : 10
    let pico = 0
    let overflow = 0
    for (const h of horas) {
      const B_h = total * w(h)
      const total_h = pd.circuitos.reduce((a, c) => {
        const ritmo = c.ritmoCal ?? c.ritmoTotal ?? pd.calibracion.ritmoH61 ?? 1
        return a + (total * (c.share / 100) * w(h)) / (ritmo * (1 + esc / 100))
      }, 0)
      pico = Math.max(pico, total_h)
      if (total_h > maquinas) overflow += B_h * (1 - maquinas / total_h)
    }
    return { dow: dw, dia: DIAS_SEM[dw], tipo: t, demanda: total, pico, overflow, abre: t !== 'sab' || sabAbre }
  })
}

export function PlanDiariaTab() {
  const { data, isLoading } = useQuery({ queryKey: ['planificador'], queryFn: () => fetchDatos<PlanificadorData>('planificador') })

  const [fecha, setFecha] = useState(hoyISO())
  const [ola, setOla] = useState<string | null>(null)
  const [pend, setPend] = useState<string | null>(null)
  const [circ, setCirc] = useState<Record<string, string> | null>(null)
  const [maquinas, setMaquinas] = useState(90)
  const [meta, setMeta] = useState(10)
  const [sabAbre, setSabAbre] = useState(false)

  const dow = dowDe(fecha)
  const tipo: 'lv' | 'sab' | 'dom' = dow === 0 ? 'dom' : dow === 6 ? 'sab' : 'lv'
  const esSab = tipo === 'sab'
  const esDom = tipo === 'dom'

  const historico = useMemo(() => data?.porDiaSemana.find((d) => d.dow === dow) ?? null, [data, dow])

  // ---- valores mostrados: mientras el usuario no edita, siguen el promedio histórico del día ----
  const olaMostrado = ola ?? String(Math.round(historico?.olaProm ?? data?.ola.prom ?? 0))
  const pendMostrado = pend ?? String(Math.round(historico?.pendProm ?? data?.pendiente.prom ?? 0))
  const totalMostrado = parseNum(olaMostrado) + parseNum(pendMostrado)
  const circMostrado = (sector: string): string => {
    if (circ && circ[sector] != null) return circ[sector]
    const c = data?.planDiaria.circuitos.find((x) => x.sector === sector)
    return String(Math.round((totalMostrado * (c?.share ?? 0)) / 100))
  }
  const volverAlHistorico = () => { setOla(null); setPend(null); setCirc(null) }

  // ================= CÁLCULO =================
  const calc = useMemo(() => {
    if (!data) return null
    const pd = data.planDiaria
    const B_total = parseNum(olaMostrado) + parseNum(pendMostrado)

    // perfil horario del tipo de día (con fallbacks si no hay datos de sábados o domingos)
    const sumaPerfilDe = (p: number[]) => p.reduce((a, b) => a + b, 0)
    let perfil = pd.perfiles[tipo]
    if (tipo === 'sab' && sumaPerfilDe(perfil) === 0) perfil = pd.perfiles.lv
    if (tipo === 'dom' && sumaPerfilDe(perfil) === 0) perfil = pd.perfiles.lv
    const esDomEfectivo = esDom

    // horas activas del día: L-V y sábado usan toda la ventana con movimiento; domingo solo TN
    const horas = (esDomEfectivo ? HORAS_TN : ORDEN_HORAS).filter((h) => perfil[h] > 0)
    const sumaPerfil = horas.reduce((a, h) => a + perfil[h], 0)
    const wDe = (h: number) => (sumaPerfil > 0 ? perfil[h] / sumaPerfil : 1 / Math.max(1, horas.length))

    // circuitos con ritmo calibrado (E-8 ajustado al ritmo base H61 ≈ 85)
    const ritmoFallback = pd.calibracion.ritmoH61 ?? data.h61.ritmoBase
    let circuitosPlan = pd.circuitos
      .map((c) => ({
        sector: c.sector,
        etiqueta: c.etiqueta,
        bultos: circ && circ[c.sector] != null ? parseNum(circ[c.sector]) : Math.round((B_total * c.share) / 100),
        ritmo: c.ritmoCal ?? c.ritmoTotal ?? ritmoFallback,
      }))
      .filter((c) => c.bultos > 0 && c.ritmo != null)
    if (circuitosPlan.length === 0 && B_total > 0 && ritmoFallback) {
      // sin circuitos cargados: planifica todo el volumen como un solo bloque
      circuitosPlan = [{ sector: 'TOTAL', etiqueta: 'Total', bultos: B_total, ritmo: ritmoFallback }]
    }
    const bultosAsignados = circuitosPlan.reduce((a, c) => a + c.bultos, 0)
    const sinAsignar = B_total - bultosAsignados

    const turnoDe = (h: number) => (HORAS_TM.includes(h) ? 'TM' : HORAS_TT.includes(h) ? 'TT' : 'TN')

    const escenarios = METAS.map((m) => {
      const filas = horas.map((h) => {
        const B_h = B_total * wDe(h)
        const porAct = circuitosPlan.map((c) => ({
          sector: c.sector,
          etiqueta: c.etiqueta,
          personas: c.ritmo ? (c.bultos * wDe(h)) / (c.ritmo * (1 + m / 100)) : 0,
        }))
        const total = porAct.reduce((a, p) => a + p.personas, 0)
        const entra = total <= maquinas + 1e-9
        const bultosCubiertos = entra ? B_h : total > 0 ? B_h * (maquinas / total) : B_h
        return {
          hora: h,
          etiqueta: ETIQUETA_HORA(h),
          bultos: B_h,
          porAct,
          total,
          entra,
          overflow: B_h - bultosCubiertos,
        }
      })
      const pico = filas.reduce((a, f) => Math.max(a, f.total), 0)
      const picoHora = filas.find((f) => f.total === pico)?.hora ?? null
      const overflowTotal = filas.reduce((a, f) => a + f.overflow, 0)
      // dotación por turno = pico simultáneo dentro de la ventana del turno
      const porTurno = (['TM', 'TT', 'TN'] as const).flatMap((t) => {
        const enTurno = filas.filter((f) => turnoDe(f.hora) === t)
        if (!enTurno.length) return []
        return [{ turno: t, nombre: NOMBRE_TURNO[t], personas: Math.ceil(enTurno.reduce((a, f) => Math.max(a, f.total), 0)) }]
      })
      const personasTurnoTotal = porTurno.reduce((a, t) => a + t.personas, 0)
      return {
        meta: m,
        filas,
        pico,
        picoHora,
        overflowTotal,
        porTurno,
        personasTurnoTotal,
        factible: pico <= maquinas + 1e-9,
      }
    })

    return { B_total, perfil, horas, wDe, circuitosPlan, bultosAsignados, sinAsignar, escenarios, tipo }
  }, [data, olaMostrado, pendMostrado, circ, maquinas, tipo, esDom])

  const seleccionado = calc?.escenarios.find((e) => e.meta === meta) ?? calc?.escenarios[calc.escenarios.length - 1] ?? null

  // ---- semana tipo (demanda histórica promedio de cada día, con la meta elegida) ----
  const semanaTipo = data ? calcSemanaTipo(data, meta, maquinas, sabAbre) : []

  if (isLoading) return <div className="grid gap-4"><Skeleton className="h-24" /><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
  if (!data || !data.h61.dias) return <SinDatos mensaje="Cargá el archivo H61 para que la planificación diaria use las productividades medidas." />

  const circuitosUI = SECTORES_CLAVE.map((s) => data.planDiaria.circuitos.find((c) => c.sector === s)).filter((c): c is CircuitoRitmo => !!c)
  const ritmoBaseMostrado = data.planDiaria.calibracion.ritmoH61 ?? data.h61.ritmoBase

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Planificación diaria: cargás lo que hay que preparar y el modelo te dice si entra</AlertTitle>
        <AlertDescription>
          <ol className="list-decimal ml-4 space-y-1 mt-1">
            <li><b>Cargás</b> ola + pendiente del día y los bultos por circuito (ACT. 2, ACT. 4, Jaula y XD). Los campos vienen precargados con el promedio histórico del día elegido; el botón «Volver al histórico» los restaura.</li>
            <li><b>El modelo</b> reparte el volumen por hora según el perfil horario histórico del tipo de día y calcula personas por hora y por circuito con el ritmo medido de cada circuito (calibrado a la productividad actual de <b>{n1(ritmoBaseMostrado)} bult/h</b>) y la meta de mejora elegida (+{meta}%).</li>
            <li><b>Tope de máquinas:</b> {maquinas} clark simultáneos (disponibles 90, tope 100). Si el pico de personas supera las máquinas, se muestra cuántos bultos quedarían sin cubrir ese día.</li>
            <li><b>Política de fines de semana:</b> sábados cerrados (abrir solo cada 15 días cuando hay que cumplir) y domingos solo turno noche (TN 23 a 06).</li>
          </ol>
        </AlertDescription>
      </Alert>

      {/* 1 · datos del día */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><CalendarClock className="h-4 w-4" /> 1 · Datos del día a planificar</CardTitle>
          <CardDescription>
            {DIAS_SEM[dow]} {fecha} · {esDom ? 'domingo: solo trabaja el TN (23 a 06)' : esSab ? 'sábado: por política no se abre salvo cada 15 días' : 'día de semana: TM + TT + TN'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="pd-fecha">Fecha</Label>
              <Input id="pd-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value || hoyISO())} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pd-ola">Ola diaria (bultos)</Label>
              <Input id="pd-ola" inputMode="numeric" placeholder="p. ej. 140000" value={olaMostrado} onChange={(e) => setOla(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pd-pend">Pendiente (bultos)</Label>
              <Input id="pd-pend" inputMode="numeric" placeholder="p. ej. 20000" value={pendMostrado} onChange={(e) => setPend(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pd-maq">Máquinas a utilizar (tope 100)</Label>
              <Input id="pd-maq" inputMode="numeric" value={String(maquinas)} onChange={(e) => setMaquinas(Math.min(100, Math.max(1, parseNum(e.target.value) || 1)))} />
              <p className="text-[11px] text-muted-foreground">Disponibles: 90 · cada máquina = 1 persona en simultáneo</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" onClick={volverAlHistorico}><RotateCcw className="h-3.5 w-3.5 mr-1" /> Volver al histórico del {DIAS_SEM[dow].toLowerCase()}</Button>
            {historico && <span className="text-xs text-muted-foreground">Promedio {DIAS_SEM[dow].toLowerCase()}: ola {n(historico.olaProm)} + pendiente {n(historico.pendProm)} = <b>{n(historico.totalProm)}</b> bultos ({historico.dias} días)</span>}
            {esSab && (
              <label className="flex items-center gap-2 text-sm border rounded-md px-3 py-1.5 bg-sky-50/60">
                <Checkbox checked={sabAbre} onCheckedChange={(v) => setSabAbre(v === true)} />
                Este sábado abre (política: solo cada 15 días)
              </label>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium mr-1">Meta de productividad:</span>
            {METAS.map((p) => (
              <Button key={p} size="sm" variant={meta === p ? 'default' : 'outline'} className={meta === p ? 'bg-[#7CB93E] hover:bg-[#5C9429]' : ''} onClick={() => setMeta(p)}>
                {p === 0 ? 'Actual (85)' : `+${p}%`}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 2 · bultos por circuito */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Forklift className="h-4 w-4" /> 2 · Bultos a preparar por circuito</CardTitle>
          <CardDescription>Reparto del volumen del día. El botón «Usar histórico» los completa según el promedio de cada circuito</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {circuitosUI.map((c) => (
              <div key={c.sector} className="space-y-1">
                <Label htmlFor={`pd-c-${c.sector}`}>{c.etiqueta}</Label>
                <Input id={`pd-c-${c.sector}`} inputMode="numeric" value={circMostrado(c.sector)} onChange={(e) => setCirc((prev) => ({ ...(prev ?? {}), [c.sector]: e.target.value }))} />
                <p className="text-[11px] text-muted-foreground">
                  Histórico: {n1(c.share)}% de los bultos · ritmo {c.ritmoCal ? n1(c.ritmoCal) : '—'} bult/h{c.pctMuerto != null ? <> · muerto {n1(c.pctMuerto)}%</> : null}
                </p>
              </div>
            ))}
          </div>
          {calc && (
            <p className={`text-xs ${Math.abs(calc.sinAsignar) > 500 ? 'text-amber-700 font-medium' : 'text-muted-foreground'}`}>
              Total a preparar: <b>{n(calc.B_total)}</b> bultos (ola {n(parseNum(olaMostrado))} + pendiente {n(parseNum(pendMostrado))}) · asignados a circuitos: {n(calc.bultosAsignados)}
              {calc.sinAsignar > 500 && <> · <b>{n(calc.sinAsignar)} bultos sin asignar</b> (se planifican con el ritmo promedio)</>}
              {calc.sinAsignar < -500 && <> · <b>excede por {n(-calc.sinAsignar)} bultos</b>: revisá los circuitos</>}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 3 · resultado con la meta elegida */}
      {calc && seleccionado && calc.B_total > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Personas-turno del día (meta +{meta}%)</p>
                <p className="text-2xl font-bold tabular-nums">{seleccionado.personasTurnoTotal}</p>
                <p className="text-[11px] text-muted-foreground">{seleccionado.porTurno.map((t) => `${t.turno}: ${t.personas}`).join(' · ')}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Pico simultáneo (hora {seleccionado.picoHora != null ? ETIQUETA_HORA(seleccionado.picoHora) : '—'})</p>
                <p className={`text-2xl font-bold tabular-nums ${seleccionado.factible ? 'text-[#5C9429]' : 'text-amber-600'}`}>{n1(seleccionado.pico)}</p>
                <p className="text-[11px] text-muted-foreground">personas a la vez · tope {maquinas} máquinas</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground flex items-center gap-1">{seleccionado.factible ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />} ¿Entra en las máquinas?</p>
                <p className={`text-2xl font-bold ${seleccionado.factible ? 'text-[#5C9429]' : 'text-amber-600'}`}>{seleccionado.factible ? 'SÍ' : 'NO'}</p>
                <p className="text-[11px] text-muted-foreground">{seleccionado.factible ? `Márgen de ${n1(maquinas - seleccionado.pico)} personas en el pico` : `Faltan ${n1(seleccionado.pico - maquinas)} personas en el pico`}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Bultos sin cubrir ese día</p>
                <p className={`text-2xl font-bold tabular-nums ${seleccionado.overflowTotal > 500 ? 'text-red-600' : 'text-[#5C9429]'}`}>{seleccionado.overflowTotal > 500 ? n(seleccionado.overflowTotal) : '0'}</p>
                <p className="text-[11px] text-muted-foreground">{seleccionado.overflowTotal > 500 ? `${n1((seleccionado.overflowTotal / calc.B_total) * 100)}% de la demanda: pasa a pendiente o abrí el sábado` : 'La dotación cubre toda la demanda'}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">3 · Personas por hora y por actividad (meta +{meta}%)</CardTitle>
              <CardDescription>Reparto horario según el perfil histórico del {tipo === 'lv' ? 'lunes a viernes' : tipo === 'sab' ? 'sábado' : 'domingo (solo TN)'} · ritmo por circuito del E-8 calibrado a la productividad actual</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={seleccionado.filas.map((f) => ({ ...f, ...Object.fromEntries(f.porAct.map((p) => [p.etiqueta, p.personas])) }))} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={50} />
                  <YAxis yAxisId="b" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <YAxis yAxisId="p" orientation="right" tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number, name: string) => (name === 'Bultos a preparar' ? [n(v), name] : [n1(v), name])} />
                  <Legend />
                  <Bar yAxisId="b" dataKey="bultos" name="Bultos a preparar" fill={GG_VERDE} radius={[2, 2, 0, 0]} />
                  <Line yAxisId="p" dataKey="total" name="Personas necesarias" stroke={GG_NARANJA} strokeWidth={2.5} dot={{ r: 2 }} />
                  <ReferenceLine yAxisId="p" y={maquinas} stroke="#dc2626" strokeDasharray="5 5" label={{ value: `Tope ${maquinas} máquinas`, fontSize: 10, fill: '#dc2626', position: 'insideTopRight' }} />
                </ComposedChart>
              </ResponsiveContainer>

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Hora</TableHead>
                      <TableHead className="text-right">Bultos</TableHead>
                      {calc.circuitosPlan.map((c) => <TableHead key={c.sector} className="text-right">{c.etiqueta}</TableHead>)}
                      <TableHead className="text-right">Total personas</TableHead>
                      <TableHead className="text-right">¿Entra en {maquinas}?</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {seleccionado.filas.map((f) => (
                      <TableRow key={f.hora} className={!f.entra ? 'bg-amber-50/60' : undefined}>
                        <TableCell className="font-medium">{f.etiqueta}</TableCell>
                        <TableCell className="text-right tabular-nums">{n(f.bultos)}</TableCell>
                        {f.porAct.map((p) => <TableCell key={p.sector} className="text-right tabular-nums">{n1(p.personas)}</TableCell>)}
                        <TableCell className="text-right tabular-nums font-semibold">{n1(f.total)}</TableCell>
                        <TableCell className="text-right">{f.entra ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">sí</Badge> : <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">+{n1(f.total - maquinas)}</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Fórmula: personas(hora) = bultos(hora) ÷ (ritmo del circuito × (1 + meta)). Personas por turno = pico simultáneo dentro de la ventana del turno. Ritmos: {calc.circuitosPlan.map((c) => `${c.etiqueta} ${n1(c.ritmo ?? 0)}`).join(' · ')} bult/h (E-8 × factor {n1(data.planDiaria.calibracion.factor)} para alinear con el ritmo base H61 de {n1(ritmoBaseMostrado)} bult/h).
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {/* 4 · comparativa de metas */}
      {calc && calc.B_total > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Forklift className="h-4 w-4" /> 4 · ¿Qué meta hace que el día entre en las máquinas?</CardTitle>
            <CardDescription>Mismo volumen ({n(calc.B_total)} bultos) planificado con la productividad actual y con mejoras de +5/+10/+15/+20%</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Meta</TableHead>
                  <TableHead className="text-right">Ritmo de planificación</TableHead>
                  <TableHead className="text-right">Personas-turno</TableHead>
                  <TableHead className="text-right">Pico simultáneo</TableHead>
                  <TableHead className="text-right">Bultos sin cubrir</TableHead>
                  <TableHead>¿Entra en {maquinas} máquinas?</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calc.escenarios.map((e) => (
                  <TableRow key={e.meta} className={e.meta === meta ? 'bg-emerald-50/50' : undefined}>
                    <TableCell className="font-medium">{e.meta === 0 ? 'Actual' : `+${e.meta}%`}</TableCell>
                    <TableCell className="text-right tabular-nums">{n1((ritmoBaseMostrado ?? 0) * (1 + e.meta / 100))} bult/h</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{e.personasTurnoTotal}</TableCell>
                    <TableCell className="text-right tabular-nums">{n1(e.pico)}</TableCell>
                    <TableCell className="text-right tabular-nums">{e.overflowTotal > 500 ? <span className="text-red-600 font-medium">{n(e.overflowTotal)}</span> : '0'}</TableCell>
                    <TableCell>{e.factible ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100"><CheckCircle2 className="h-3 w-3 mr-1" />sí</Badge> : <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100"><AlertTriangle className="h-3 w-3 mr-1" />no entra</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-3">
              Cada mejora de productividad baja la cantidad de personas por hora: si con el ritmo actual el pico no entra en las {maquinas} máquinas, la meta es la palanca para que entre — o se mueve volumen a pendiente / se abre el sábado cada 15 días.
            </p>
          </CardContent>
        </Card>
      )}

      {/* 5 · semana tipo */}
      {semanaTipo.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><CalendarClock className="h-4 w-4" /> 5 · Semana tipo con la demanda histórica (meta +{meta}%, {maquinas} máquinas)</CardTitle>
            <CardDescription>Qué días entran y qué días se rompen con el promedio histórico de cada día de la semana</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Día</TableHead>
                  <TableHead className="text-right">Demanda prom. (ola+pend.)</TableHead>
                  <TableHead className="text-right">Pico simultáneo</TableHead>
                  <TableHead className="text-right">Bultos sin cubrir</TableHead>
                  <TableHead>Veredicto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {semanaTipo.map((f) => (
                  <TableRow key={f.dow} className={f.tipo === 'sab' ? 'bg-sky-50/50' : f.tipo === 'dom' ? 'bg-indigo-50/40' : undefined}>
                    <TableCell className="font-medium">
                      {f.dia}
                      {f.tipo === 'sab' && <span className="ml-2 text-[10px] uppercase tracking-wide text-sky-700">política: cada 15 días</span>}
                      {f.tipo === 'dom' && <span className="ml-2 text-[10px] uppercase tracking-wide text-indigo-700">solo TN</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{f.demanda > 0 ? n(f.demanda) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.demanda > 0 ? n1(f.pico) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.abre && f.overflow > 500 ? <span className="text-red-600 font-medium">{n(f.overflow)}</span> : '0'}</TableCell>
                    <TableCell>
                      {!f.abre ? <Badge variant="secondary">cerrado (si abre: {n1(f.pico)} pico)</Badge>
                        : f.demanda <= 0 ? <span className="text-xs text-muted-foreground">sin datos</span>
                        : f.overflow > 500 ? <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100"><AlertTriangle className="h-3 w-3 mr-1" />no entra</Badge>
                        : <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100"><CheckCircle2 className="h-3 w-3 mr-1" />entra</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-3">
              La semana tipo usa la demanda promedio histórica de cada día y el perfil horario correspondiente. Los sábados se muestran como cerrados (política): el badge indica qué pasaría si se abre. Úsalo para decidir cuáles sábados abrir en función de la pendiente acumulada.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
