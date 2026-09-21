'use client'

// Pestaña única "Resumen" con toda la información que sirve para planificar la
// ola: Ola, Capacidad H61 (con sábados, feriados, extras y productividad por
// hora sin/con extras), Productividad H61 (picos/valles, intensidad, producción
// por turno), Maquinistas (actividades, tareas, horarios, cruce con tiempos
// muertos), Tiempos muertos (versión resumen) y E-8 (tiempo muerto entre piking).

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Waves, Gauge, Activity, Forklift, Timer, Boxes, FileDown, Loader2, type LucideIcon } from 'lucide-react'
import { SinDatos } from './kpi'
import { fetchDatos, fechaCorta } from '@/lib/client'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { SeccionOla, type DiaOla } from './secciones/seccion-ola'
import { SeccionCapacidad, type CapacidadData } from './secciones/seccion-capacidad'
import { SeccionProductividad, type HoraPerfil, type H61PorTurno } from './secciones/seccion-productividad'
import { SeccionMaquinistas, type MaqData } from './secciones/seccion-maquinistas'
import { SeccionTiemposMuertos, SeccionE8, type TMData, type PickingData } from './secciones/seccion-tm'

function TituloSeccion({ icono: Icono, titulo, detalle }: { icono: LucideIcon; titulo: string; detalle: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border-l-4 border-l-[#7CB93E] bg-white px-4 py-3 shadow-sm">
      <Icono className="h-5 w-5 mt-0.5 shrink-0 text-[#5C9429]" />
      <div>
        <h2 className="text-base font-bold leading-tight">{titulo}</h2>
        <p className="text-xs text-muted-foreground leading-snug mt-0.5">{detalle}</p>
      </div>
    </div>
  )
}

function SkeletonSeccion() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-16 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  )
}

export function ResumenTab({ onIrACarga }: { onIrACarga: () => void }) {
  const ola = useQuery({ queryKey: ['ola'], queryFn: () => fetchDatos<{ serie: DiaOla[] }>('ola') })
  const capacidad = useQuery({ queryKey: ['capacidad'], queryFn: () => fetchDatos<CapacidadData>('capacidad') })
  const h61 = useQuery({ queryKey: ['h61'], queryFn: () => fetchDatos<{ perfilHora: (HoraPerfil & { bultos: number })[]; porTurno: H61PorTurno[]; resumen: { bultos: number; horas: number; prodHora: number; opsUnicos: number } }>('h61') })
  const maq = useQuery({ queryKey: ['maq'], queryFn: () => fetchDatos<MaqData>('maq') })
  const tm = useQuery({ queryKey: ['tm'], queryFn: () => fetchDatos<TMData>('tm') })
  const picking = useQuery({ queryKey: ['picking'], queryFn: () => fetchDatos<PickingData>('picking') })

  const [descargando, setDescargando] = useState(false)
  const descargarInforme = async () => {
    setDescargando(true)
    try {
      const res = await fetch('/api/informe', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Informe_Preparacion_CD_${new Date().toISOString().slice(0, 10)}.pptx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(`No se pudo generar el informe: ${(e as Error).message}`)
    } finally {
      setDescargando(false)
    }
  }

  const todoVacio = [ola, capacidad, h61, maq, tm, picking].every((q) => !q.isLoading && !q.data)

  return (
    <div className="space-y-6">
      {/* Barra de acciones */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Toda la información del período en una sola vista para planificar la ola de preparación.
          {capacidad.data?.resumen && <> Período H61: {fechaCorta(capacidad.data.serie[0]?.fecha)} → {fechaCorta(capacidad.data.serie[capacidad.data.serie.length - 1]?.fecha)}</>}
        </p>
        <Button onClick={descargarInforme} disabled={descargando} className="bg-[#7CB93E] hover:bg-[#5C9429] text-white">
          {descargando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
          Descargar informe (PowerPoint)
        </Button>
      </div>

      {todoVacio ? (
        <div className="space-y-3">
          <SinDatos mensaje="Aún no hay datos cargados. Empezá cargando los archivos Excel en Carga de Datos." />
          <div className="text-center">
            <button onClick={onIrACarga} className="text-sm text-[#5C9429] underline">Ir a Carga de Datos</button>
          </div>
        </div>
      ) : null}

      {/* 1. OLA */}
      <section className="space-y-4">
        <TituloSeccion icono={Waves} titulo="1 · Ola — ¿cuánto hay que preparar por día?" detalle="Comportamiento de la ola por día de semana y por mes, con promedio y mediana, para entender el macro de lo que llega a preparar" />
        {ola.isLoading ? <SkeletonSeccion /> : ola.error ? <SinDatos mensaje={`Error: ${(ola.error as Error).message}`} /> : <SeccionOla serie={ola.data?.serie ?? []} />}
      </section>

      {/* 2. CAPACIDAD H61 */}
      <section className="space-y-4">
        <TituloSeccion icono={Gauge} titulo="2 · Capacidad H61 — ritmo de preparación" detalle="Ritmo por día, sábados aparte, feriados y comparativa; influencia de las horas extra, ritmo por turno en extras y productividad promedio por hora sin extras y con extras" />
        {capacidad.isLoading ? <SkeletonSeccion /> : capacidad.error ? <SinDatos mensaje={`Error: ${(capacidad.error as Error).message}`} /> : <SeccionCapacidad data={capacidad.data as CapacidadData} />}
      </section>

      {/* 3. PRODUCTIVIDAD H61 */}
      <section className="space-y-4">
        <TituloSeccion icono={Activity} titulo="3 · Productividad H61 — horas pico y valle por turno" detalle="Horas pico y valle determinadas por desvío estadístico (hay varios), intensidad por turno y producción por turno" />
        {h61.isLoading || capacidad.isLoading ? <SkeletonSeccion /> : (
          <SeccionProductividad
            perfilHora={(capacidad.data?.perfilHora ?? []).map((p) => ({ hora: p.hora, etiqueta: p.etiqueta, bultosProm: p.bultosProm }))}
            porTurno={h61.data?.porTurno ?? []}
          />
        )}
      </section>

      {/* 4. MAQUINISTAS */}
      <section className="space-y-4">
        <TituloSeccion icono={Forklift} titulo="4 · Maquinistas (clarkistas) — personas, tareas y horarios" detalle="Personas por actividad y tarea (apros/homogéneos), distribución por turno, movimientos por mes por persona, mapa de calor de apros, movimientos por horario y cruce con la espera de piking" />
        {maq.isLoading || tm.isLoading ? <SkeletonSeccion /> : maq.error ? <SinDatos mensaje={`Error: ${(maq.error as Error).message}`} /> : (
          <SeccionMaquinistas data={maq.data as MaqData} esperaPikingPorHora={tm.data?.porHoraEsperaPiking ?? []} />
        )}
      </section>

      {/* 5. TIEMPOS MUERTOS */}
      <section className="space-y-4">
        <TituloSeccion icono={Timer} titulo="5 · Tiempos muertos — dónde y cuándo se pierde el tiempo" detalle="Pareto de motivos agrupados (espera de piking unificada), espera por nave, por turno y por hora" />
        {tm.isLoading ? <SkeletonSeccion /> : tm.error ? <SinDatos mensaje={`Error: ${(tm.error as Error).message}`} /> : (
          <SeccionTiemposMuertos data={tm.data as TMData} horasH61={h61.data?.resumen?.horas ?? 0} />
        )}
      </section>

      {/* 6. E-8 */}
      {picking.data && !picking.data.vacio && picking.data.registros > 0 && (
        <section className="space-y-4">
          <TituloSeccion icono={Boxes} titulo="6 · E-8 — tiempo muerto entre piking" detalle="Promedio y mediana del tiempo muerto entre piking, horario en que se concentra, mapa de calor, % de la jornada y naves donde se identifica" />
          <SeccionE8 data={picking.data} />
        </section>
      )}
    </div>
  )
}
