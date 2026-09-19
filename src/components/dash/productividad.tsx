'use client'

import { useQuery } from '@tanstack/react-query'
import { Flame, Gauge, Hourglass, TrendingDown, TrendingUp, Users } from 'lucide-react'
import { Kpi, SinDatos } from './kpi'
import { fetchDatos, n, n1, pct, COLORES } from '@/lib/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, ReferenceLine } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'

interface H61Data {
  perfilHora: { hora: number; etiqueta: string; bultos: number; operariosProm: number }[]
  pico: { hora: number; etiqueta: string; bultos: number }
  valle: { hora: number; etiqueta: string; bultos: number }
  porTurno: { turno: string; nombre: string; bultos: number; horas: number; opsDias: number; prodHora: number; bultosExtras: number }[]
  heat: { turno: string; valores: number[] }[]
  circuitos: { circuito: string; bultos: number }[]
  distribucion: { horas: number; opsDia: number }[]
  extrasResumen: { opsDiasTotal: number; opsDiasConExtras: number; pctOpsDiasConExtras: number; horasExtras: number; bultosExtras: number; bultosTotales: number; pctBultosExtras: number }
  operariosTop: { operario: string; nombre: string; bultos: number; horas: number; prodHora: number; extras: number; dias: number }[]
  operariosBottom: { operario: string; nombre: string; bultos: number; horas: number; prodHora: number; extras: number; dias: number }[]
  operariosExtras: { operario: string; nombre: string; extras: number; dias: number }[]
  serie: { fecha: string; bultos: number; horas: number; ops: number; prodHora: number }[]
  resumen: { bultos: number; horas: number; prodHora: number; opsUnicos: number }
}

function colorCelda(v: number, max: number): string {
  if (v <= 0) return 'bg-muted/40 text-muted-foreground/40'
  const t = v / max
  if (t > 0.8) return 'bg-emerald-700 text-white'
  if (t > 0.6) return 'bg-emerald-500/80 text-white'
  if (t > 0.4) return 'bg-emerald-400/70 text-emerald-950'
  if (t > 0.2) return 'bg-emerald-200/80 text-emerald-950'
  return 'bg-emerald-100/80 text-emerald-900'
}

export function ProductividadTab() {
  const { data, isLoading } = useQuery({ queryKey: ['h61'], queryFn: () => fetchDatos<H61Data>('h61') })

  if (isLoading) return <div className="grid gap-4"><Skeleton className="h-24" /><Skeleton className="h-72" /></div>
  if (!data || data.resumen.bultos === 0) return <SinDatos mensaje="Cargá el archivo H61.xlsx para ver la productividad por hora." />

  const { resumen, extrasResumen: ex } = data
  const maxHeat = Math.max(1, ...data.heat.flatMap((t) => t.valores))

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Producción total" valor={resumen.bultos} icono={Gauge} detalle={`${n(resumen.horas)} horas-hombre informadas`} />
        <Kpi titulo="Bultos por hora" valor={resumen.prodHora} formato="decimal" icono={Gauge} tono="exito" detalle="Promedio global del período" />
        <Kpi titulo="Hora pico" valor={data.pico.etiqueta} formato="texto" icono={Flame} detalle={`${n(data.pico.bultos)} bultos acumulados en esa hora`} tono="atencion" />
        <Kpi titulo="Hora valle (con actividad)" valor={data.valle.etiqueta} formato="texto" icono={TrendingDown} detalle={`${n(data.valle.bultos)} bultos acumulados`} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Operarios-distintos" valor={resumen.opsUnicos} icono={Users} />
        <Kpi titulo="Operario-días con extras" valor={ex.opsDiasConExtras} icono={Hourglass} detalle={`${pct(ex.pctOpsDiasConExtras)} de ${n(ex.opsDiasTotal)} operario-días`} tono="atencion" />
        <Kpi titulo="Horas extra" valor={ex.horasExtras} unidad="h" icono={Hourglass} detalle="Horas por encima de la jornada de 8 h" />
        <Kpi titulo="Producción en extras" valor={ex.pctBultosExtras} formato="porcentaje" icono={TrendingUp} detalle={`${n(ex.bultosExtras)} bultos`} tono="alerta" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Horas pico y valle — perfil del día</CardTitle>
          <CardDescription>Bultos preparados por hora del día (las primeras 6 h del turno noche se asignan al día calendario siguiente)</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.perfilHora} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} interval={1} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => [n(v), 'Bultos']} />
              <Bar dataKey="bultos" radius={[3, 3, 0, 0]}>
                {data.perfilHora.map((p) => (
                  <Cell key={p.hora} fill={p.hora === data.pico.hora ? '#d97706' : p.hora === data.valle.hora ? '#dc2626' : COLORES[0]} />
                ))}
              </Bar>
              <ReferenceLine y={0} stroke="#9ca3af" />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted-foreground mt-2">🟠 hora pico ({data.pico.etiqueta}) · 🔴 hora valle ({data.valle.etiqueta}) · 🟢 resto</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Intensidad por turno y hora</CardTitle>
          <CardDescription>Bultos promedio por operario en cada hora del turno (verde más intenso = más carga)</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
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
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Producción por turno</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Turno</TableHead>
                  <TableHead className="text-right">Bultos</TableHead>
                  <TableHead className="text-right">Horas</TableHead>
                  <TableHead className="text-right">Bultos/h</TableHead>
                  <TableHead className="text-right">Extras (bultos)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.porTurno.map((t) => (
                  <TableRow key={t.turno}>
                    <TableCell className="font-medium">{t.nombre}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(t.bultos)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(t.horas)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{n1(t.prodHora)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(t.bultosExtras)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Distribución de jornadas</CardTitle>
            <CardDescription>Operario-días según horas con producción (8 h = jornada base; 11-12 h = extras)</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.distribucion} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="horas" tick={{ fontSize: 11 }} label={{ value: 'horas con producción', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v: number) => [n(v), 'Operario-días']} />
                <Bar dataKey="opsDia" radius={[3, 3, 0, 0]}>
                  {data.distribucion.map((d) => <Cell key={d.horas} fill={d.horas <= 8 ? COLORES[0] : COLORES[1]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Productividad por circuito</CardTitle>
            <CardDescription>Bultos preparados por circuito de picking</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(260, data.circuitos.length * 22)}>
              <BarChart data={data.circuitos} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000000)}M`} />
                <YAxis type="category" dataKey="circuito" width={60} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [n(v), 'Bultos']} />
                <Bar dataKey="bultos" fill={COLORES[3]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Operarios con más horas extra</CardTitle>
            <CardDescription>Candidatos a revisar dotación, rotación o contratación</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-72 rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Operario</TableHead>
                    <TableHead className="text-right">Horas extra</TableHead>
                    <TableHead className="text-right">Días</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.operariosExtras.map((o) => (
                    <TableRow key={o.operario}>
                      <TableCell><span className="font-medium">{o.nombre}</span> <span className="text-xs text-muted-foreground">({o.operario})</span></TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-amber-700">{o.extras}</TableCell>
                      <TableCell className="text-right tabular-nums">{o.dias}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Top 15 operarios por productividad</CardTitle><CardDescription>Mínimo 80 horas en el período</CardDescription></CardHeader>
          <CardContent>
            <ScrollArea className="h-80 rounded-md border">
              <TablaOperarios rows={data.operariosTop} />
            </ScrollArea>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Operarios con menor productividad</CardTitle><CardDescription>Oportunidad de capacitación o realojo de circuito</CardDescription></CardHeader>
          <CardContent>
            <ScrollArea className="h-80 rounded-md border">
              <TablaOperarios rows={data.operariosBottom} />
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function TablaOperarios({ rows }: { rows: { operario: string; nombre: string; bultos: number; horas: number; prodHora: number; extras: number; dias: number }[] }) {
  return (
    <Table>
      <TableHeader className="sticky top-0 bg-background">
        <TableRow>
          <TableHead>Operario</TableHead>
          <TableHead className="text-right">Bultos</TableHead>
          <TableHead className="text-right">Horas</TableHead>
          <TableHead className="text-right">Bultos/h</TableHead>
          <TableHead className="text-right">Días</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((o) => (
          <TableRow key={o.operario}>
            <TableCell><span className="font-medium">{o.nombre}</span> <span className="text-xs text-muted-foreground">({o.operario})</span></TableCell>
            <TableCell className="text-right tabular-nums">{n(o.bultos)}</TableCell>
            <TableCell className="text-right tabular-nums">{n(o.horas)}</TableCell>
            <TableCell className="text-right tabular-nums font-semibold">{n1(o.prodHora)}</TableCell>
            <TableCell className="text-right tabular-nums">{o.dias}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
