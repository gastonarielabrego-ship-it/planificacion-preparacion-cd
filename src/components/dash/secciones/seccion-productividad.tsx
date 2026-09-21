'use client'

// Sección "Productividad H61" del Resumen: horas pico y horas valle
// (determinadas con umbral estadístico y agrupadas en rangos, porque el perfil
// del día tiene VARIOS picos y VARIOS valles), intensidad por turno y
// producción por turno.

import { useMemo } from 'react'
import { Gauge, TrendingUp, TrendingDown, Zap } from 'lucide-react'
import { Kpi, SinDatos } from '../kpi'
import { n, n1, COLORES, GG_VERDE, GG_NARANJA, GG_GRIS } from '@/lib/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, Cell, ReferenceLine, ComposedChart, Line } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

export interface HoraPerfil {
  hora: number
  etiqueta: string
  bultosProm: number
}
export interface H61PorTurno {
  turno: string
  nombre: string
  bultos: number
  horas: number
  opsDias: number
  bultosExtras: number
  prodHora: number
}

interface Rango {
  tipo: 'pico' | 'valle'
  desde: number
  hasta: number
  etiqueta: string
  prom: number
  desvioVsMedia: number // % sobre/debajo de la media
}

function clasificarPerfil(perfil: HoraPerfil[]): { rangos: Rango[]; media: number; horaPico: HoraPerfil | null; horaValle: HoraPerfil | null } {
  const activas = perfil.filter((p) => p.bultosProm > 0)
  if (!activas.length) return { rangos: [], media: 0, horaPico: null, horaValle: null }
  const vals = activas.map((p) => p.bultosProm)
  const media = vals.reduce((a, b) => a + b, 0) / vals.length
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - media) ** 2, 0) / vals.length)

  // Umbrales estadísticos: pico >= media + 0,5 SD; valle <= media - 0,5 SD.
  // Con perfiles multimetrales aparecen VARIOS rangos pico y VARIOS valles.
  const umbralPico = media + 0.5 * sd
  const umbralValle = Math.max(0, media - 0.5 * sd)

  const rangos: Rango[] = []
  const construirRangos = (tipo: 'pico' | 'valle', dentro: (v: number) => boolean) => {
    let desde: number | null = null
    for (const p of perfil) {
      const activa = p.bultosProm > 0 && dentro(p.bultosProm)
      if (activa && desde === null) desde = p.hora
      if ((!activa || p.hora === 23) && desde !== null) {
        const hasta = activa && p.hora === 23 ? p.hora : p.hora - 1
        const fr = perfil.slice(desde, hasta + 1)
        const prom = fr.reduce((a, x) => a + x.bultosProm, 0) / fr.length
        rangos.push({
          tipo,
          desde,
          hasta,
          etiqueta: `${String(desde).padStart(2, '0')}:00–${String(hasta).padStart(2, '0')}:59`,
          prom,
          desvioVsMedia: media ? +(((prom - media) / media) * 100).toFixed(1) : 0,
        })
        desde = null
      }
    }
  }
  construirRangos('pico', (v) => v >= umbralPico)
  construirRangos('valle', (v) => v <= umbralValle)

  // Fallback: si el perfil es muy parejo y no hay picos/valles, top 3 y bottom 3 horas activas
  if (!rangos.some((r) => r.tipo === 'pico')) {
    const top = [...activas].sort((a, b) => b.bultosProm - a.bultosProm).slice(0, 3)
    for (const p of top) rangos.push({ tipo: 'pico', desde: p.hora, hasta: p.hora, etiqueta: `${String(p.hora).padStart(2, '0')}:00`, prom: p.bultosProm, desvioVsMedia: media ? +(((p.bultosProm - media) / media) * 100).toFixed(1) : 0 })
  }
  if (!rangos.some((r) => r.tipo === 'valle')) {
    const bottom = [...activas].sort((a, b) => a.bultosProm - b.bultosProm).slice(0, 3)
    for (const p of bottom) rangos.push({ tipo: 'valle', desde: p.hora, hasta: p.hora, etiqueta: `${String(p.hora).padStart(2, '0')}:00`, prom: p.bultosProm, desvioVsMedia: media ? +(((p.bultosProm - media) / media) * 100).toFixed(1) : 0 })
  }

  rangos.sort((a, b) => (a.tipo === b.tipo ? a.desde - b.desde : a.tipo === 'pico' ? -1 : 1))
  const horaPico = [...activas].sort((a, b) => b.bultosProm - a.bultosProm)[0] ?? null
  const horaValle = [...activas].sort((a, b) => a.bultosProm - b.bultosProm)[0] ?? null
  return { rangos, media, horaPico, horaValle }
}

export function SeccionProductividad({ perfilHora, porTurno }: { perfilHora: HoraPerfil[]; porTurno: H61PorTurno[] }) {
  const { rangos, media, horaPico, horaValle } = useMemo(() => clasificarPerfil(perfilHora), [perfilHora])

  const chartData = useMemo(() => perfilHora.map((p) => {
    const r = rangos.find((x) => x.desde <= p.hora && p.hora <= x.hasta)
    return { ...p, clase: r?.tipo ?? 'normal' }
  }), [perfilHora, rangos])

  const turnosOrden = [...porTurno].sort((a, b) => b.prodHora - a.prodHora)
  const prodMax = turnosOrden[0]
  const bultosTot = porTurno.reduce((a, t) => a + t.bultos, 0)

  if (!perfilHora.length || bultosTot === 0) return <SinDatos mensaje="Cargá el archivo H61 (productividad) para ver horas pico, valle y producción por turno." />

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Hora pico del día" valor={horaPico?.etiqueta ?? '—'} formato="texto" icono={TrendingUp} tono="atencion" detalle={horaPico ? `${n(horaPico.bultosProm)} bultos promedio (media del día: ${n(media)})` : null} />
        <Kpi titulo="Hora valle del día" valor={horaValle?.etiqueta ?? '—'} formato="texto" icono={TrendingDown} detalle={horaValle ? `${n(horaValle.bultosProm)} bultos promedio` : null} />
        <Kpi titulo="Rangos pico detectados" valor={rangos.filter((r) => r.tipo === 'pico').length} icono={Zap} tono="exito" detalle={rangos.filter((r) => r.tipo === 'pico').map((r) => r.etiqueta).join(' · ') || '—'} />
        <Kpi titulo="Rangos valle detectados" valor={rangos.filter((r) => r.tipo === 'valle').length} icono={TrendingDown} detalle={rangos.filter((r) => r.tipo === 'valle').map((r) => r.etiqueta).join(' · ') || '—'} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Horas pico y horas valle del día</CardTitle>
          <CardDescription>
            El perfil del día tiene varios picos y varios valles: se marcan las horas por encima/debajo de media desviación estándar de la media horaria (línea gris). Naranja = pico, gris = valle, verde = hora normal
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} interval={1} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => n(v)} />
              <ReferenceLine y={media} stroke={GG_GRIS} strokeDasharray="6 3" label={{ value: `Media ${n(media)}`, position: 'insideTopRight', fontSize: 10, fill: GG_GRIS }} />
              <Bar dataKey="bultosProm" name="Bultos promedio por hora" radius={[3, 3, 0, 0]}>
                {chartData.map((p, i) => <Cell key={i} fill={p.clase === 'pico' ? GG_NARANJA : p.clase === 'valle' ? '#9ca3af' : GG_VERDE} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Rango horario</TableHead>
                <TableHead className="text-right">Bultos prom./hora</TableHead>
                <TableHead className="text-right">Desvío vs media</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rangos.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Badge variant="outline" className={r.tipo === 'pico' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-gray-200 bg-gray-50 text-gray-600'}>
                      {r.tipo === 'pico' ? 'pico' : 'valle'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium tabular-nums">{r.etiqueta}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(r.prom)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-semibold ${r.desvioVsMedia >= 0 ? 'text-amber-700' : 'text-gray-500'}`}>
                    {r.desvioVsMedia >= 0 ? '+' : ''}{n1(r.desvioVsMedia)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Intensidad por turno</CardTitle>
            <CardDescription>Productividad de cada turno (bultos por hora-hombre): qué turno prepara más rápido</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={turnosOrden} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="nombre" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => n1(v)} />
                <Bar dataKey="prodHora" name="Bultos por hora-hombre" radius={[3, 3, 0, 0]}>
                  {turnosOrden.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Producción por turno</CardTitle>
            <CardDescription>Bultos preparados por turno en el período (de dentro de la jornada y de horas extra)</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={turnosOrden} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="nombre" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v: number) => n(v)} />
                <Legend />
                <Bar dataKey="bultos" name="Sin extras" stackId="a" fill={GG_VERDE} />
                <Bar dataKey="bultosExtras" name="En extras" stackId="a" fill={GG_NARANJA} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Gauge className="h-4 w-4" /> Producción e intensidad por turno</CardTitle>
          <CardDescription>La intensidad es la productividad (bultos por hora-hombre); el turno más intenso es {prodMax?.nombre} con {n1(prodMax?.prodHora)} bultos/h</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Turno</TableHead>
                <TableHead className="text-right">Op-días</TableHead>
                <TableHead className="text-right">Bultos</TableHead>
                <TableHead className="text-right">Bultos en extras</TableHead>
                <TableHead className="text-right">% del total</TableHead>
                <TableHead className="text-right">Horas-hombre</TableHead>
                <TableHead className="text-right">Intensidad (bultos/h)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {turnosOrden.map((t) => (
                <TableRow key={t.turno}>
                  <TableCell className="font-medium">{t.nombre}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(t.opsDias)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(t.bultos)}</TableCell>
                  <TableCell className="text-right tabular-nums text-amber-700">{t.bultosExtras ? n(t.bultosExtras) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{n1(bultosTot ? (t.bultos / bultosTot) * 100 : 0)}%</TableCell>
                  <TableCell className="text-right tabular-nums">{n(t.horas)} h</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{n1(t.prodHora)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
