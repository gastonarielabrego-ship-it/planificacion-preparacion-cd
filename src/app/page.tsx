'use client'

import { useState } from 'react'
import { Warehouse, BarChart3, CalendarRange, Gauge, Timer, Boxes, UploadCloud } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ResumenTab } from '@/components/dash/resumen'
import { PlanificacionTab } from '@/components/dash/planificacion'
import { ProductividadTab } from '@/components/dash/productividad'
import { TiemposMuertosTab } from '@/components/dash/tiemposmuertos'
import { PickingTab } from '@/components/dash/picking'
import { CargaDatosTab } from '@/components/dash/cargadatos'

export default function Home() {
  const [tab, setTab] = useState('resumen')

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="sticky top-0 z-20 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-white shrink-0">
            <Warehouse className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold leading-tight">Planificación — Preparación CD</h1>
            <p className="text-xs text-muted-foreground leading-tight">Olas · Productividad H61 · Extras 8h/12h · Tiempos muertos · Horas pico y valle</p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4">
        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <TabsList className="flex flex-wrap h-auto gap-1 justify-start">
            <TabsTrigger value="resumen" className="gap-1.5"><BarChart3 className="h-4 w-4" /> Resumen</TabsTrigger>
            <TabsTrigger value="planificacion" className="gap-1.5"><CalendarRange className="h-4 w-4" /> Planificación</TabsTrigger>
            <TabsTrigger value="productividad" className="gap-1.5"><Gauge className="h-4 w-4" /> Productividad H61</TabsTrigger>
            <TabsTrigger value="tm" className="gap-1.5"><Timer className="h-4 w-4" /> Tiempos muertos</TabsTrigger>
            <TabsTrigger value="picking" className="gap-1.5"><Boxes className="h-4 w-4" /> Picking</TabsTrigger>
            <TabsTrigger value="carga" className="gap-1.5"><UploadCloud className="h-4 w-4" /> Carga de Datos</TabsTrigger>
          </TabsList>

          <TabsContent value="resumen"><ResumenTab onIrACarga={() => setTab('carga')} /></TabsContent>
          <TabsContent value="planificacion"><PlanificacionTab /></TabsContent>
          <TabsContent value="productividad"><ProductividadTab /></TabsContent>
          <TabsContent value="tm"><TiemposMuertosTab /></TabsContent>
          <TabsContent value="picking"><PickingTab /></TabsContent>
          <TabsContent value="carga"><CargaDatosTab /></TabsContent>
        </Tabs>
      </main>

      <footer className="mt-auto border-t bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Área de Preparación — Centro de Distribución · focos de mejora operativa</span>
          <span>Datos cargados desde archivos Excel · normalización automática de motivos</span>
        </div>
      </footer>
    </div>
  )
}
