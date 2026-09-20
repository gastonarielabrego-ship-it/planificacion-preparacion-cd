'use client'

// Módulo Maquinistas (H61 de clarkistas): foco en CUÁNTAS personas realizan cada
// actividad y a QUÉ NAVES (circuito) están asignadas. Fuente: archivo "h61 maquinista.xlsx".
import { useQuery } from '@tanstack/react-query'
import { Forklift, Users, Clock3, Boxes, ArrowRightLeft, Warehouse, MapPin, UploadCloud, Info } from 'lucide-react'
import { Kpi, SinDatos } from './kpi'
import { fetchDatos, n, n1, fechaCorta, COLORES } from '@/lib/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface FilaAct {
  actividad: string
  codigo: string
  operarios: number
  personasPromDia: number | null
  dias: number
  movimientos: number
  bultos: number
  horas: number
}
interface FilaNave {
  nave: string
  codigo: string
  operarios: number
  personasPromDia: number | null
  dias: number
  movimientos: number
  bultos: number
  horas: number
}
interface MaqData {
  registros: number
  vacio?: boolean
  desde?: string
  hasta?: string
  meses?: number
  operarios?: number
  dias?: number
  personasPromDia?: number | null
  movimientos?: number
  bultos?: number
  horasHombre?: number
  navesActivas?: number
  navesPorOperarioDia?: number | null
  porActividad?: FilaAct[]
  porNave?: FilaNave[]
  matriz?: { actividad: string; nave: string; personasPromDia: number | null; operarios: number; dias: number; movimientos: number }[]
  porTurno?: { turno: string; personasPromDia: number | null; operarios: number; movimientos: number; bultos: number; porActividad: { actividad: string; personasProm: number | null; operarios: number }[] }[]
  porMesActividad?: { mes: string; actividad: string; personasProm: number }[]
  porMesNave?: { mes: string; nave: string; personasProm: number }[]
  fuentes?: { filename: string | null; rows: number; fecha: string }[]
}

const TURNO_LABEL: Record<string, string> = { M: 'Mañana (6-14)', T: 'Tarde (14-22)', N: 'Noche (23-6)', '?': 'Sin turno' }
const COLOR_ACT: Record<string, string> = { 'Actividad 2': '#059669', 'Actividad 3': '#d97706', 'Actividad 4': '#dc2626' }
const colorDe = (act: string, i: number) => COLOR_ACT[act] ?? COLORES[i % COLORES.length]

export function MaquinistasTab() {
  const { data, isLoading } = useQuery({ queryKey: ['maq'], queryFn: () => fetchDatos<MaqData>('maq') })

  if (isLoading) return <Skeleton className="h-72" />
  if (!data || data.vacio) {
    return (
      <div className="space-y-4">
        <Alert>
          <UploadCloud className="h-4 w-4" />
          <AlertTitle>Módulo Maquinistas (H61 de clarkistas) — esperando el archivo</AlertTitle>
          <AlertDescription className="leading-relaxed">
            Este módulo toma el <b>H61 de maquinistas</b> (reporte de clarkistas). Cuando lo cargues muestra:
            <b> cuántas personas realizan cada actividad</b> (2 / 3 / 4) y <b>a qué naves están asignadas</b>
            (columna CIRCUITO: AP2, PA2, BE2, AER…), además de movimientos de clark, bultos, matriz
            actividad × nave, distribución por turno y evolución mensual.
            <br />
            Se reconoce automáticamente por el nombre (que incluya “maquinista” o “clarkista”). Podés subirlo
            directo acá (por partes, sin límite de tamaño) o con el script <code className="rounded bg-muted px-1">subir_archivo.py</code>.
          </AlertDescription>
        </Alert>
        <SinDatos mensaje="No hay filas de maquinistas cargadas todavía." />
      </div>
    )
  }

  const acts = data.porActividad ?? []
  const naves = data.porNave ?? []
  const matriz = data.matriz ?? []
  const turnos = data.porTurno ?? []

  // pivot de la serie mensual por actividad: [{ mes, 'Actividad 2': x, ... }]
  const mesesSet = [...new Set((data.porMesActividad ?? []).map((m) => m.mes))].sort()
  const nombresAct = [...new Set((data.porMesActividad ?? []).map((m) => m.actividad))]
  const serieMes = mesesSet.map((mes) => {
    const fila: Record<string, string | number> = { mes }
    for (const a of nombresAct) {
      const hit = (data.porMesActividad ?? []).find((m) => m.mes === mes && m.actividad === a)
      fila[a] = hit?.personasProm ?? 0
    }
    return fila
  })

  const dotTotal = acts.reduce((acc, a) => acc + (a.personasPromDia ?? 0), 0) || 1
  // etiqueta corta para el eje del grafico horizontal ("Varias (XXX)" se recorta)
  const navesChart = naves.slice(0, 12).map((x) => ({ ...x, naveCorta: x.codigo === 'XXX' ? 'Varias' : x.nave }))

  return (
    <div className="space-y-4">
      <Alert>
        <Forklift className="h-4 w-4" />
        <AlertTitle className="text-sm">Fuente del análisis: H61 de maquinistas (clarkistas)</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          Período con datos: <b>{data.desde ? `${fechaCorta(data.desde)} → ${fechaCorta(data.hasta)}` : '—'}</b>
          {data.meses != null && <> · <b>{data.meses}</b> {data.meses === 1 ? 'mes' : 'meses'}</>}
          {(data.fuentes ?? []).length > 0 && (
            <> · Archivos tomados en cuenta: {(data.fuentes ?? []).map((f) => f.filename || '(sin nombre)').join(', ')}</>
          )}
          <br />
          Foco del módulo: <b>personas por actividad</b> y <b>naves asignadas</b> (columna CIRCUITO del reporte).
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Clarkistas activos" valor={data.operarios ?? 0} icono={Forklift} detalle={`${n(data.registros)} filas operario × nave`} />
        <Kpi titulo="Personas promedio por día" valor={data.personasPromDia ?? 0} formato="decimal" icono={Users} detalle={`${n(data.dias)} días con datos`} />
        <Kpi titulo="Horas-hombre" valor={data.horasHombre ?? 0} icono={Clock3} detalle="Horas activas únicas por persona, día y actividad" />
        <Kpi titulo="Naves con actividad" valor={data.navesActivas ?? 0} icono={Warehouse} detalle={data.navesPorOperarioDia != null ? `${n1(data.navesPorOperarioDia)} naves por persona/día` : undefined} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Bultos movidos" valor={data.bultos ?? 0} icono={Boxes} />
        <Kpi titulo="Movimientos de clark" valor={data.movimientos ?? 0} icono={ArrowRightLeft} detalle="Viajes / movimientos registrados" />
        <Kpi
          titulo="Actividad con más gente"
          valor={acts[0]?.actividad ?? '—'}
          formato="texto"
          icono={Users}
          detalle={acts[0] ? `${n1(acts[0].personasPromDia)} personas/día de ${n1(dotTotal)} (${Math.round(((acts[0].personasPromDia ?? 0) / dotTotal) * 100)}% de la dotación)` : undefined}
        />
        <Kpi
          titulo="Nave más asignada"
          valor={naves[0]?.nave ?? '—'}
          formato="texto"
          icono={MapPin}
          tono="exito"
          detalle={naves[0] ? `${n1(naves[0].personasPromDia)} personas/día · ${n(naves[0].operarios)} personas en el período` : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Personas por actividad</CardTitle>
            <CardDescription>Cuántas personas realizan cada actividad: promedio por día y dotación total del período</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={acts} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="actividad" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number, name: string) => [name === 'personasPromDia' ? n1(v) : n(v), name === 'personasPromDia' ? 'Personas/día' : 'Operarios del período']} />
                  <Bar dataKey="personasPromDia" name="personasPromDia" radius={[4, 4, 0, 0]}>
                    {acts.map((a, i) => (
                      <Cell key={a.codigo} fill={colorDe(a.actividad, i)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Actividad</TableHead>
                  <TableHead className="text-right">Personas/día</TableHead>
                  <TableHead className="text-right">% dotación</TableHead>
                  <TableHead className="text-right">Personas período</TableHead>
                  <TableHead className="text-right">Horas-hombre</TableHead>
                  <TableHead className="text-right">Bultos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {acts.map((a) => (
                  <TableRow key={a.codigo}>
                    <TableCell className="font-medium">{a.actividad}</TableCell>
                    <TableCell className="text-right tabular-nums">{n1(a.personasPromDia)}</TableCell>
                    <TableCell className="text-right tabular-nums">{Math.round(((a.personasPromDia ?? 0) / dotTotal) * 100)}%</TableCell>
                    <TableCell className="text-right tabular-nums">{n(a.operarios)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(a.horas)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(a.bultos)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Personas por nave (asignación)</CardTitle>
            <CardDescription>Top 12 naves por personas promedio por día — dónde está asignado el clark</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={navesChart} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="naveCorta" width={78} tick={{ fontSize: 11 }} interval={0} />
                  <Tooltip formatter={(v: number) => n1(v)} />
                  <Bar dataKey="personasPromDia" name="Personas/día" fill="#059669" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground">
              “Varias (XXX)” = la tarea no quedó asociada a una nave específica ({n(naves.find((x) => x.codigo === 'XXX')?.operarios ?? 0)} personas pasaron por ella).
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Matriz actividad × nave</CardTitle>
          <CardDescription>Combinaciones con más personas promedio por día: dónde se asigna la gente según la actividad</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Actividad</TableHead>
                <TableHead>Nave</TableHead>
                <TableHead className="text-right">Personas/día</TableHead>
                <TableHead className="text-right">Personas período</TableHead>
                <TableHead className="text-right">Días</TableHead>
                <TableHead className="text-right">Movimientos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matriz.slice(0, 15).map((m) => (
                <TableRow key={`${m.actividad}-${m.nave}`}>
                  <TableCell className="font-medium">{m.actividad}</TableCell>
                  <TableCell>{m.nave}</TableCell>
                  <TableCell className="text-right tabular-nums">{n1(m.personasPromDia)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(m.operarios)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(m.dias)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(m.movimientos)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Evolución mensual por actividad</CardTitle>
            <CardDescription>Personas promedio por día asignadas a cada actividad, mes a mes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serieMes} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {nombresAct.map((a, i) => (
                    <Bar key={a} dataKey={a} stackId="dot" fill={colorDe(a, i)} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Distribución por turno</CardTitle>
            <CardDescription>Personas promedio por turno y actividad dentro de cada turno</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {turnos.map((t) => (
              <div key={t.turno}>
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold">{TURNO_LABEL[t.turno] ?? t.turno}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {n1(t.personasPromDia)} personas/día · {n(t.bultos)} bultos · {n(t.movimientos)} movimientos
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {t.porActividad.map((a) => (
                    <span key={a.actividad} className="rounded-md border px-2 py-0.5 text-xs tabular-nums">
                      {a.actividad}: <b>{n1(a.personasProm)}</b> pers/día
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalle completo por nave</CardTitle>
          <CardDescription>Todas las naves del reporte ordenadas por personas promedio por día</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nave</TableHead>
                <TableHead className="text-right">Personas/día</TableHead>
                <TableHead className="text-right">Personas período</TableHead>
                <TableHead className="text-right">Días</TableHead>
                <TableHead className="text-right">Horas-hombre</TableHead>
                <TableHead className="text-right">Bultos</TableHead>
                <TableHead className="text-right">Movimientos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {naves.map((nv) => (
                <TableRow key={nv.codigo}>
                  <TableCell className="font-medium">{nv.nave}</TableCell>
                  <TableCell className="text-right tabular-nums">{n1(nv.personasPromDia)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(nv.operarios)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(nv.dias)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(nv.horas)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(nv.bultos)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(nv.movimientos)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle className="text-sm">Cómo leer las naves del reporte</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          La nave sale de la columna <b>CIRCUITO</b> del H61 de maquinistas. “Varias (XXX)” agrupa las filas donde el clark
          trabajó sobre más de una nave sin código específico; los códigos numéricos (100, 200, 998, 999) son zonas internas
          del reporte; “Sin nave” son filas sin dato. Las horas-hombre cuentan cada hora una sola vez por persona, día y
          actividad (aunque haya trabajado en varias naves en esa hora).
        </AlertDescription>
      </Alert>
    </div>
  )
}
