'use client'

// Sección "Ola" del Resumen consolidado: cómo se comporta la ola por día de
// semana y por mes, con promedio y mediana, para entender el macro de lo que
// hay que preparar por día.

import { useMemo } from 'react'
import { Waves, ClipboardList, TrendingUp, Equal } from 'lucide-react'
import { Kpi, SinDatos } from '../kpi'
import { n, COLORES } from '@/lib/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine, ComposedChart, Line } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CalendarOff } from 'lucide-react'

export interface DiaOla {
  fecha: string
  diaSemana: string
  esFinde: boolean
  semana: string
  ola: number
  pendiente: number
  total: number
}

const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const ORDEN_DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const etiquetaMes = (ym: string) => `${MESES_ABR[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`

function mediana(vals: number[]): number {
  if (!vals.length) return 0
  const s = [...vals].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function SeccionOla({ serie }: { serie: DiaOla[] }) {
  // ---- por día de la semana: promedio y mediana ----
  const porDiaSem = useMemo(() => {
    const ag = new Map<string, { olaVals: number[]; pendVals: number[]; totVals: number[] }>()
    for (const s of serie) {
      let a = ag.get(s.diaSemana)
      if (!a) { a = { olaVals: [], pendVals: [], totVals: [] }; ag.set(s.diaSemana, a) }
      if (s.ola > 0) a.olaVals.push(s.ola)
      if (s.pendiente > 0) a.pendVals.push(s.pendiente)
      if (s.ola > 0 || s.pendiente > 0) a.totVals.push(s.total)
    }
    return ORDEN_DIAS.filter((d) => ag.has(d)).map((nombre) => {
      const a = ag.get(nombre)!
      return {
        dia: nombre.slice(0, 3),
        diaCompleto: nombre,
        OlaProm: a.olaVals.length ? a.olaVals.reduce((x, y) => x + y, 0) / a.olaVals.length : 0,
        OlaMed: mediana(a.olaVals),
        PendProm: a.pendVals.length ? a.pendVals.reduce((x, y) => x + y, 0) / a.pendVals.length : 0,
        TotalProm: a.totVals.length ? a.totVals.reduce((x, y) => x + y, 0) / a.totVals.length : 0,
        TotalMed: mediana(a.totVals),
        dias: a.olaVals.length,
      }
    })
  }, [serie])

  // ---- por mes: promedio y mediana (sobre días con ola) ----
  const porMes = useMemo(() => {
    const ag = new Map<string, { olaVals: number[]; ola: number; pend: number; dias: number; diasConOla: number }>()
    for (const s of serie) {
      const k = s.fecha.slice(0, 7)
      let a = ag.get(k)
      if (!a) { a = { olaVals: [], ola: 0, pend: 0, dias: 0, diasConOla: 0 }; ag.set(k, a) }
      a.dias += 1
      if (s.ola > 0) { a.olaVals.push(s.ola); a.ola += s.ola; a.diasConOla += 1 }
      a.pend += s.pendiente
    }
    return [...ag.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, a]) => ({
      mes,
      etiqueta: etiquetaMes(mes),
      OlaProm: a.diasConOla ? a.ola / a.diasConOla : 0,
      OlaMed: mediana(a.olaVals),
      olaTotal: a.ola,
      pendTotal: a.pend,
      total: a.ola + a.pend,
      diasConOla: a.diasConOla,
    }))
  }, [serie])

  const conOla = serie.filter((s) => s.ola > 0)
  const promOla = conOla.length ? conOla.reduce((a, s) => a + s.ola, 0) / conOla.length : null
  const medOla = conOla.length ? mediana(conOla.map((s) => s.ola)) : null
  const totalPend = serie.reduce((a, s) => a + s.pendiente, 0)

  if (!serie.length) return <SinDatos mensaje="Cargá el archivo de Ola y Pendiente para ver el análisis de la ola." />

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Promedio de la ola" valor={promOla == null ? null : Math.round(promOla)} unidad="bultos/día" icono={TrendingUp} tono="exito" detalle={`Sobre ${conOla.length} días con ola (lun a vie)`} />
        <Kpi titulo="Mediana de la ola" valor={medOla == null ? null : Math.round(medOla)} unidad="bultos/día" icono={Equal} detalle="El día típico: la mitad de los días cae por debajo" />
        <Kpi titulo="Ola recibida total" valor={conOla.reduce((a, s) => a + s.ola, 0)} unidad="bultos" icono={Waves} detalle={`${serie.length} días en el período`} />
        <Kpi titulo="Pendientes trabajados" valor={totalPend} unidad="bultos" icono={ClipboardList} tono="atencion" detalle="Sáb y dom no cae ola: solo pendientes" />
      </div>

      <Alert>
        <CalendarOff className="h-4 w-4" />
        <AlertTitle>La ola no cae sábados y domingos</AlertTitle>
        <AlertDescription>
          De lunes a viernes llega la <b>ola</b> (bultos a preparar del día) y además se procesa <b>pendiente</b> acumulado. Los <b>sábados</b> se trabaja únicamente con pendientes y los <b>domingos</b> generalmente no hay actividad. Por eso el promedio y la mediana se calculan solo sobre los días con ola — así se entiende cuánto hay que preparar por día.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ola por día de la semana</CardTitle>
            <CardDescription>Promedio (barra) y mediana (marca) de bultos por día de la semana</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={porDiaSem} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v: number) => n(v)} />
                <Legend />
                <Bar dataKey="OlaProm" name="Ola promedio" fill={COLORES[0]} radius={[3, 3, 0, 0]} />
                <Bar dataKey="PendProm" name="Pendiente promedio" fill={COLORES[1]} radius={[3, 3, 0, 0]} />
                <Line dataKey="OlaMed" name="Mediana de la ola" stroke={COLORES[2]} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ola por mes: promedio y mediana</CardTitle>
            <CardDescription>Demanda diaria promedio de cada mes contra su mediana (el día típico del mes)</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={porMes} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v: number) => n(v)} />
                <Legend />
                <Bar dataKey="OlaProm" name="Promedio diario de la ola" fill={COLORES[0]} radius={[3, 3, 0, 0]} />
                <Line dataKey="OlaMed" name="Mediana diaria" stroke={COLORES[1]} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalle mensual de la ola</CardTitle>
          <CardDescription>Promedio y mediana calculados sobre los días con ola de cada mes</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px] rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Días c/ ola</TableHead>
                  <TableHead className="text-right">Ola del mes</TableHead>
                  <TableHead className="text-right">Pendiente del mes</TableHead>
                  <TableHead className="text-right">Prom. ola/día</TableHead>
                  <TableHead className="text-right">Mediana ola/día</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porMes.map((m) => (
                  <TableRow key={m.mes}>
                    <TableCell className="font-medium">{m.etiqueta}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.diasConOla}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(m.olaTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.pendTotal > 0 ? n(m.pendTotal) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{n(m.OlaProm)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{n(m.OlaMed)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalle por día de la semana</CardTitle>
          <CardDescription>Cuánto hay que preparar cada día de la semana: promedio y mediana del total (ola + pendiente)</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Día</TableHead>
                <TableHead className="text-right">Días c/ ola</TableHead>
                <TableHead className="text-right">Ola prom.</TableHead>
                <TableHead className="text-right">Ola mediana</TableHead>
                <TableHead className="text-right">Pendiente prom.</TableHead>
                <TableHead className="text-right">Total prom.</TableHead>
                <TableHead className="text-right">Total mediana</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {porDiaSem.map((d) => (
                <TableRow key={d.diaCompleto}>
                  <TableCell className="font-medium">{d.diaCompleto}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.dias}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.OlaProm ? n(d.OlaProm) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.OlaMed ? n(d.OlaMed) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.PendProm ? n(d.PendProm) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{d.TotalProm ? n(d.TotalProm) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{d.TotalMed ? n(d.TotalMed) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
