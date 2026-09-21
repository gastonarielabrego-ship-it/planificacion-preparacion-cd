'use client'

// Pestaña "Benchmark de Mercado": contrasta los indicadores del CD de secos
// (60.000 m²) contra valores de referencia del mercado para un depósito
// convencional de esa escala. Los valores de mercado son orientativos y son
// EDITABLES: el usuario puede calibrarlos con sus datos reales (se guardan en
// localStorage). La brecha se muestra con semáforo y las palancas cuantifican
// el impacto de cerrar cada brecha.

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Target, Gauge, Clock, Hourglass, Forklift, Boxes, Warehouse, TrendingUp, RotateCcw, Info, Users } from 'lucide-react'
import { Kpi, SinDatos } from './kpi'
import { fetchDatos, n, n1 } from '@/lib/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import type { CapacidadData } from './secciones/seccion-capacidad'
import type { TMData, PickingData } from './secciones/seccion-tm'
import type { MaqData } from './secciones/seccion-maquinistas'

const SUPERFICIE_M2 = 60000
const HORAS_JORNADA = 8
const DIAS_MES = 21

// Referencias orientativas de mercado para un depósito de secos convencional
// (~60.000 m², picking manual). Editables desde la tabla.
const MERCADO_DEFAULT = {
  ritmo: 110,        // bultos por persona-hora (jornada)
  extras: 6,         // % de bultos preparados en horas extra
  muerto: 12,        // % de la jornada en tiempo muerto
  espera: 3,         // % de la jornada en espera de piking
  movClark: 120,     // movimientos por clarkista por día
  bultosM2: 65,      // bultos por m² por mes
}
type ClaveMercado = keyof typeof MERCADO_DEFAULT

const FILAS: { clave: ClaveMercado; metrica: string; unidad: string; mejor: 'alto' | 'bajo'; fuente: string }[] = [
  { clave: 'ritmo', metrica: 'Ritmo de preparación', unidad: 'bultos por persona-hora', mejor: 'alto', fuente: 'Capacidad H61: bultos ÷ horas-hombre (días normales)' },
  { clave: 'extras', metrica: 'Horas extra', unidad: '% de los bultos', mejor: 'bajo', fuente: 'Capacidad H61: bultos en extras ÷ bultos totales' },
  { clave: 'muerto', metrica: 'Tiempo muerto', unidad: '% de la jornada', mejor: 'bajo', fuente: 'E-8: horas muertas ÷ horas informadas' },
  { clave: 'espera', metrica: 'Espera de piking', unidad: '% de la jornada', mejor: 'bajo', fuente: 'E-8: % de jornada × participación de la espera en el muerto (TM)' },
  { clave: 'movClark', metrica: 'Movimientos por clarkista', unidad: 'por día', mejor: 'alto', fuente: 'Maquinistas: movimientos ÷ día ÷ personas promedio' },
  { clave: 'bultosM2', metrica: 'Uso de la superficie', unidad: 'bultos por m² al mes', mejor: 'alto', fuente: `Capacidad H61 ÷ ${n(SUPERFICIE_M2)} m²` },
]

const CLAVE_STORAGE = 'benchmark-mercado-v1'

type Estado = 'verde' | 'naranja' | 'rojo'

export function BenchmarkTab() {
  const capacidad = useQuery({ queryKey: ['capacidad'], queryFn: () => fetchDatos<CapacidadData>('capacidad') })
  const h61 = useQuery({ queryKey: ['h61'], queryFn: () => fetchDatos<{ resumen: { bultos: number; horas: number; prodHora: number; opsUnicos: number } }>('h61') })
  const tm = useQuery({ queryKey: ['tm'], queryFn: () => fetchDatos<TMData>('tm') })
  const picking = useQuery({ queryKey: ['picking'], queryFn: () => fetchDatos<PickingData>('picking') })
  const maq = useQuery({ queryKey: ['maq'], queryFn: () => fetchDatos<MaqData>('maq') })

  const [mercado, setMercado] = useState<Record<ClaveMercado, number>>(MERCADO_DEFAULT)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CLAVE_STORAGE)
      // carga única de los valores guardados por el usuario (después de hidratar)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setMercado({ ...MERCADO_DEFAULT, ...JSON.parse(raw) })
    } catch { /* valores por defecto */ }
  }, [])
  const setValor = (k: ClaveMercado, v: number) => {
    const nuevo = { ...mercado, [k]: v }
    setMercado(nuevo)
    try { localStorage.setItem(CLAVE_STORAGE, JSON.stringify(nuevo)) } catch { /* sin storage */ }
  }

  const cap = capacidad.data
  const esperando = capacidad.isLoading || h61.isLoading
  if (esperando) return <SinDatos mensaje="Cargando indicadores del CD…" />
  if (!cap?.resumen) return <SinDatos mensaje="Cargá el archivo H61 para comparar contra el mercado." />

  const resumen = cap.resumen
  const meses = Math.max(1, cap.porMes.length)
  const bultosMes = (resumen.bultos + resumen.bultosFeriado) / meses
  const horasMes = h61.data?.resumen.horas ? h61.data.resumen.horas / meses : null

  // personas promedio por día L-V (ponderado por cantidad de días de cada día de semana)
  const lv = cap.porDiaSemana.filter((d) => d.dow >= 1 && d.dow <= 5)
  const diasLV = lv.reduce((a, d) => a + d.dias, 0)
  const personasProm = diasLV ? lv.reduce((a, d) => a + d.personasProm * d.dias, 0) / diasLV : null

  const esperaCat = tm.data?.porCategoria.find((c) => c.categoria === 'ESPERA PICKING')
  // espera como % de la jornada, consistente con la fila de tiempo muerto (E-8):
  // pctMuerto del E-8 × participación de la espera dentro del muerto (TM)
  const esperaPct = picking.data?.tiempos.pctMuerto != null && esperaCat
    ? picking.data.tiempos.pctMuerto * (esperaCat.pct / 100)
    : null
  const movPorClark = maq.data && !maq.data.vacio && maq.data.dias && maq.data.personasPromDia
    ? maq.data.movimientos / maq.data.dias / maq.data.personasPromDia
    : null

  const nuestros: Record<ClaveMercado, number | null> = {
    ritmo: resumen.ritmoProm,
    extras: resumen.pctExtras,
    muerto: picking.data?.tiempos.pctMuerto ?? null,
    espera: esperaPct,
    movClark: movPorClark,
    bultosM2: bultosMes / SUPERFICIE_M2,
  }

  const estado = (fila: (typeof FILAS)[number]): Estado => {
    const nuestro = nuestros[fila.clave]
    const ref = mercado[fila.clave]
    if (nuestro == null || !ref) return 'naranja'
    const ratio = nuestro / ref
    if (fila.mejor === 'alto') return ratio >= 1 ? 'verde' : ratio >= 0.85 ? 'naranja' : 'rojo'
    return ratio <= 1 ? 'verde' : ratio <= 1.2 ? 'naranja' : 'rojo'
  }
  const brecha = (fila: (typeof FILAS)[number]): number | null => {
    const nuestro = nuestros[fila.clave]
    const ref = mercado[fila.clave]
    if (nuestro == null || !ref) return null
    return fila.mejor === 'alto' ? ((nuestro - ref) / ref) * 100 : ((ref - nuestro) / ref) * 100
  }
  const COLOR: Record<Estado, string> = {
    verde: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    naranja: 'border-amber-200 bg-amber-50 text-amber-700',
    rojo: 'border-red-200 bg-red-50 text-red-700',
  }
  const TEXTO: Record<Estado, string> = { verde: 'a nivel o mejor', naranja: 'cerca del mercado', rojo: 'por debajo del mercado' }

  // ---- palancas: impacto de cerrar cada brecha ----
  const ritmo = nuestros.ritmo
  const palancaRitmo = ritmo && ritmo > 0 && personasProm
    ? personasProm * (1 - ritmo / mercado.ritmo)
    : null
  const palancaMuerto = (() => {
    const muerto = nuestros.muerto
    if (muerto == null || !horasMes || !ritmo) return null
    const horasRecuperables = horasMes * Math.max(0, (muerto - mercado.muerto) / 100)
    return { horas: horasRecuperables, bultos: horasRecuperables * ritmo }
  })()
  const palancaExtras = (() => {
    if (!ritmo) return null
    const deltaBultos = (bultosMes * Math.max(0, resumen.pctExtras - mercado.extras)) / 100
    return { horas: deltaBultos / ritmo, bultos: deltaBultos }
  })()

  return (
    <div className="space-y-4">
      <div className="rounded-lg border-l-4 border-l-[#7CB93E] bg-white px-4 py-3 shadow-sm">
        <h2 className="text-base font-bold leading-tight flex items-center gap-2"><Target className="h-5 w-5 text-[#5C9429]" /> Benchmark contra el mercado — depósito de secos de {n(SUPERFICIE_M2)} m²</h2>
        <p className="text-xs text-muted-foreground leading-snug mt-0.5">
          Compara los indicadores del CD con valores de referencia del mercado para un centro de distribución de secos convencional de esta escala (picking manual, sin automatización). Los valores de mercado son <b>orientativos y editables</b>: ajustalos con tus datos reales y la comparación se recalcula al instante.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi titulo="Bultos preparados" valor={Math.round(bultosMes)} unidad="bultos/mes" icono={Boxes} tono="exito" detalle={`${n(resumen.bultos + resumen.bultosFeriado)} bultos en ${meses} meses`} />
        <Kpi titulo="Densidad de producción" valor={bultosMes / SUPERFICIE_M2} formato="decimal" unidad="bultos/m²/mes" icono={Warehouse} detalle={`Sobre ${n(SUPERFICIE_M2)} m² de depósito`} />
        <Kpi titulo="Dotación promedio L-V" valor={personasProm == null ? null : n1(personasProm)} formato="texto" unidad={personasProm == null ? undefined : 'personas/día'} icono={TrendingUp} detalle="Operarios H61 por día (lunes a viernes)" />
        <Kpi titulo="Personas por 1.000 m²" valor={personasProm == null ? null : n1(personasProm / (SUPERFICIE_M2 / 1000))} formato="texto" icono={Users} detalle="Densidad de dotación sobre la superficie" />
        <Kpi titulo="Superficie por operario" valor={personasProm == null ? null : Math.round(SUPERFICIE_M2 / personasProm)} unidad="m²/persona" icono={Warehouse} detalle="Indicador de uso del espacio por dotación" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" /> Nuestro CD vs mercado</CardTitle>
          <CardDescription>Editá los valores de la columna mercado (se guardan en este navegador) para calibrar la comparación</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Métrica</TableHead>
                <TableHead className="text-right">Nuestro CD</TableHead>
                <TableHead className="text-right">Mercado (editable)</TableHead>
                <TableHead className="text-right">Brecha</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Fuente del dato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {FILAS.map((f) => {
                const nuestro = nuestros[f.clave]
                const est = estado(f)
                const br = brecha(f)
                return (
                  <TableRow key={f.clave}>
                    <TableCell>
                      <p className="font-medium leading-tight">{f.metrica}</p>
                      <p className="text-[11px] text-muted-foreground">{f.unidad}</p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{nuestro == null ? '—' : f.unidad.startsWith('%') ? `${n1(nuestro)}%` : n1(nuestro)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Input
                          type="number"
                          step="0.5"
                          min="0"
                          value={mercado[f.clave]}
                          onChange={(e) => setValor(f.clave, Number(e.target.value) || 0)}
                          className="h-8 w-24 text-right tabular-nums"
                          aria-label={`Referencia de mercado: ${f.metrica}`}
                        />
                        {f.unidad.startsWith('%') && <span className="text-xs text-muted-foreground">%</span>}
                      </div>
                    </TableCell>
                    <TableCell className={`text-right tabular-nums font-semibold ${br != null && br >= 0 ? 'text-emerald-700' : br != null && br < -15 ? 'text-red-700' : 'text-amber-700'}`}>
                      {br == null ? '—' : `${br >= 0 ? '+' : ''}${n1(br)}%`}
                    </TableCell>
                    <TableCell><Badge variant="outline" className={COLOR[est]}>{TEXTO[est]}</Badge></TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{f.fuente}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Gauge className="h-4 w-4" /> Palanca 1 · Cerrar la brecha de ritmo</CardTitle>
            <CardDescription>Pasar de {ritmo == null ? '—' : n1(ritmo)} a {n1(mercado.ritmo)} bultos/persona-hora</CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed">
            {palancaRitmo == null ? (
              <p className="text-muted-foreground">Sin datos suficientes para cuantificar.</p>
            ) : palancaRitmo <= 0 ? (
              <p className="text-emerald-700 font-medium">El ritmo del CD ya está a nivel o mejor que la referencia de mercado.</p>
            ) : (
              <p>
                Con el mismo volumen mensual, preparar al ritmo de mercado necesitaría ≈ <b>{n1(palancaRitmo)} personas menos por día</b> — capacidad liberada para crecer sin sumar dotación, o para sostener la ola con menos horas extra.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" /> Palanca 2 · Bajar el tiempo muerto</CardTitle>
            <CardDescription>Del {nuestros.muerto == null ? '—' : `${n1(nuestros.muerto)}%`} actual al {n1(mercado.muerto)}% de mercado</CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed">
            {palancaMuerto == null ? (
              <p className="text-muted-foreground">Sin datos suficientes para cuantificar (requiere el E-8).</p>
            ) : palancaMuerto.horas <= 0 ? (
              <p className="text-emerald-700 font-medium">El tiempo muerto del CD ya está a nivel o mejor que la referencia.</p>
            ) : (
              <p>
                Cerrar la brecha libera ≈ <b>{n(palancaMuerto.bultos)} bultos por mes</b> ({n1(palancaMuerto.horas)} horas-hombre recuperadas) — es capacidad sin contratar a nadie, y la espera de piking es el principal motivo atacable.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Hourglass className="h-4 w-4" /> Palanca 3 · Reducir horas extra</CardTitle>
            <CardDescription>Del {n1(resumen.pctExtras)}% actual al {n1(mercado.extras)}% de mercado</CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed">
            {palancaExtras == null ? (
              <p className="text-muted-foreground">Sin datos suficientes para cuantificar.</p>
            ) : palancaExtras.horas <= 0 ? (
              <p className="text-emerald-700 font-medium">Las horas extra ya están a nivel o mejor que la referencia.</p>
            ) : (
              <p>
                Alcanzar el nivel de mercado evita ≈ <b>{n1(palancaExtras.horas)} horas extra por mes</b> ({n(palancaExtras.bultos)} bultos que hoy se preparan fuera de jornada) — se logra con mejor planificación de la ola y de la dotación por turno.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Info className="h-4 w-4" /> Qué mirar en el benchmark</CardTitle>
          <CardDescription>Lectura de la comparación para este depósito</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed">
          <p>
            <Forklift className="inline h-3.5 w-3.5 mr-1 text-muted-foreground" />
            <b>Movimientos por clarkista:</b> si estamos por debajo del mercado con la misma dotación, la asignación por nave/actividad y el recorrido de apros son el foco; el mapa de calor día × hora de la sección Maquinistas muestra dónde se concentran.
          </p>
          <p>
            <Warehouse className="inline h-3.5 w-3.5 mr-1 text-muted-foreground" />
            <b>Densidad (bultos/m²):</b> en un depósito de {n(SUPERFICIE_M2)} m², cada punto de densidad equivale a {n(SUPERFICIE_M2 / 100)} bultos al mes. Si el mercado prepara más en la misma superficie, la diferencia suele estar en el ritmo por persona y en el tiempo muerto, no en el espacio.
          </p>
          <p>
            <Hourglass className="inline h-3.5 w-3.5 mr-1 text-muted-foreground" />
            <b>Horas extra:</b> el mercado referencial opera con extras puntuales ({n1(MERCADO_DEFAULT.extras)}%). Un nivel estructuralmente mayor indica dotación base insuficiente para la ola típica — la pestaña Planificación Diaria permite dimensionarla día por día.
          </p>
          <p className="text-xs text-muted-foreground pt-1 border-t">
            Nota metodológica: los valores de mercado son referencias orientativas de la industria para depósitos de secos convencionales de gran escala (picking manual, turno diurno + noche) y sirven como punto de partida. Ajustalos con benchmarks reales de tu operador logístico o de cámaras del sector; la aplicación recalcula brechas y palancas automáticamente. Los indicadores del CD se calculan sobre el período cargado (ver fuentes en cada fila).
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => { setMercado(MERCADO_DEFAULT); try { localStorage.removeItem(CLAVE_STORAGE) } catch { /* sin storage */ } }}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          <RotateCcw className="h-3 w-3" /> Restaurar valores de mercado por defecto
        </button>
      </div>
    </div>
  )
}
