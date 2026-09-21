'use client'

// Sección PRODUCTIVIDAD H61 del resumen: horas pico y horas valle (con
// detección mejorada — puede haber varias horas pico y varias valle),
// intensidad por turno y producción por turno.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Flame, Gauge, TrendingDown, Users } from 'lucide-react'
import { Kpi, SinDatos } from '../kpi'
import { fetchDatos, n, n1, COLORES } from '@/lib/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TituloSeccion } from './comun'

interface H61Data {
  perfilHora: { hora: number; etiqueta: string; bultos: number; operariosProm: number }[]
  porTurno: { turno: string; nombre: string; bultos: number; horas: number; opsDias: number; prodHora: number; bultosExtras: number }[]
  heat: { turno: string; valores: number[] }[]
  resumen: { bultos: number; horas: number; prodHora: number; opsUnicos: number }
}

function colorCelda(v: number, max: number): string {
  if (v <= 0) return 'bg-muted/40 text-muted-foreground/40'
  const t = v / max
  if (t > 0.8) return 'bg-[#76B41E] text-white'
  if (t > 0.6) return 'bg-[#76B41E]/80 text-white'
  if (t > 0.4) return 'bg-[#76B41E]/60 text-emerald-950'
  if (t > 0.2) return 'bg-[#76B41E]/40 text-emerald-950'
  return 'bg-[#76B41E]/25 text-emerald-950'
}

export function ProductividadResumen() {
  const { data, isLoading } = useQuery({ queryKey: ['h61'], queryFn: () => fetchDatos<H61Data>('h61') })

  // Detección mejorada de picos y valles: puede haber VARIAS horas pico y varias
  // valle. Umbral: promedio ± 0.6 desvíos estándar sobre las horas con actividad.
  const analisis = useMemo(() => {
    if (!data) return null
    const conAct = data.perfilHora.filter((p) => p.bultos > 0)
    if (!conAct.length) return null
    const prom = conAct.reduce((a, p) => a + p.bultos, 0) / conAct.length
    const std = Math.sqrt(conAct.reduce((a, p) => a + (p.bultos - prom) ** 2, 0) / conAct.length)
    const umbralPico = prom + 0.6 * std
    const umbralValle = Math.max(0, prom - 0.6 * std)
    const picos = conAct.filter((p) => p.bultos >= umbralPico).map((p) => p.etiqueta)
    const valles = conAct.filter((p) => p.bultos <= umbralValle).map((p) => p.etiqueta)
    return { prom, umbralPico, umbralValle, picos, valles, esPico: (h: number) => data.perfilHora[h].bultos >= umbralPico, esValle: (h: number) => data.perfilHora[h].bultos > 0 && data.perfilHora[h].bultos <= umbralValle }
  }, [data])

  if (isLoading) return <Skeleton className="h-72" />
  if (!data || data.resumen.bultos === 0) return <SinDatos mensaje="Cargá el archivo H61.xlsx para ver la productividad por hora." />

  const maxHeat = Math.max(1, ...data.heat.flatMap((t) => t.valores))

  return (
    <div className="space-y-4">
      <TituloSeccion icono={Gauge} id="sec-productividad" titulo="Productividad H61: picos, valles y turnos" descripcion="Horas pico y horas valle determinadas con umbral estadístico (puede haber varias de cada), intensidad por turno y producción por turno." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Bultos por hora" valor={data.resumen.prodHora} formato="decimal" unidad="bultos/h" icono={Gauge} tono="exito" detalle={`${n(data.resumen.bultos)} bultos en ${n(data.resumen.horas)} horas-hombre`} />
        <Kpi titulo="Operarios distintos" valor={data.resumen.opsUnicos} icono={Users} />
        <Kpi titulo="Horas pico" valor={analisis?.picos.length ? analisis.picos.join(', ') : '—'} formato="texto" icono={Flame} tono="atencion" detalle={`Umbral: ${n(analisis?.prom)} + 0,6σ = ${n(analisis?.umbralPico)} bultos`} />
        <Kpi titulo="Horas valle (con actividad)" valor={analisis?.valles.length ? analisis.valles.join(', ') : '—'} formato="texto" icono={TrendingDown} detalle={`Por debajo de ${n(analisis?.umbralValle)} bultos`} />
      </div>

      <div className="bg-white rounded-xl border p-4">
        <p className="text-sm font-semibold mb-1">Perfil del día: varias horas pico y varias valle</p>
        <p className="text-xs text-muted-foreground mb-2">Bultos preparados por hora del día (la madrugada del turno noche se asigna al día calendario siguiente). 🟠 picos · 🔴 valles · 🟢 resto.</p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.perfilHora} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} interval={1} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v: number) => [n(v), 'Bultos']} />
            <Bar dataKey="bultos" radius={[3, 3, 0, 0]}>
              {data.perfilHora.map((p) => (
                <Cell key={p.hora} fill={analisis?.esPico(p.hora) ? '#d97706' : analisis?.esValle(p.hora) ? '#dc2626' : COLORES[0]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {analisis && (
          <p className="text-xs text-muted-foreground mt-2">
            <b>Pico(s):</b> {analisis.picos.length ? analisis.picos.join(' · ') : '—'} &nbsp;|&nbsp; <b>Valle(s):</b> {analisis.valles.length ? analisis.valles.join(' · ') : '—'} &nbsp;|&nbsp; <b>Promedio por hora activa:</b> {n(analisis.prom)} bultos
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm font-semibold mb-1">Intensidad por turno y hora</p>
          <p className="text-xs text-muted-foreground mb-2">Bultos promedio por operario en cada hora del turno (verde más intenso = más carga)</p>
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[80px_repeat(24,1fr)] gap-1 text-[10px]">
                <div />
                {Array.from({ length: 24 }, (_, h) => <div key={h} className="text-center text-muted-foreground">{String(h).padStart(2, '0')}</div>)}
                {data.heat.map((t) => (
                  <div key={t.turno} className="contents">
                    <div className="flex items-center text-xs font-medium">{t.turno === 'M' ? 'Mañana' : t.turno === 'T' ? 'Tarde' : 'Noche'}</div>
                    {t.valores.map((v, h) => (
                      <div key={h} className={`h-7 rounded ${colorCelda(v, maxHeat)} flex items-center justify-center tabular-nums`} title={`${v} bultos/operario`}>
                        {v > 0 ? Math.round(v / 10) * 10 : ''}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm font-semibold mb-1">Producción por turno</p>
          <p className="text-xs text-muted-foreground mb-2">Bultos, horas-hombre y ritmo de cada turno; los bultos en extras muestran cuánto se depende de la extensión de la jornada</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Turno</TableHead>
                <TableHead className="text-right">Bultos</TableHead>
                <TableHead className="text-right">Horas</TableHead>
                <TableHead className="text-right">Bultos/h</TableHead>
                <TableHead className="text-right">Extras</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.porTurno.map((t) => (
                <TableRow key={t.turno}>
                  <TableCell className="font-medium">
                    {t.nombre}
                    {t.bultosExtras > 0 && <Badge variant="outline" className="ml-2 text-[10px] border-amber-200 bg-amber-50 text-amber-700">{n1((t.bultosExtras / t.bultos) * 100)}% en extras</Badge>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{n(t.bultos)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(t.horas)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{n1(t.prodHora)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(t.bultosExtras)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
