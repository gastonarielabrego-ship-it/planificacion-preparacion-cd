'use client'

import { useState } from 'react'
import { BarChart3, UploadCloud, FlaskConical, CalendarRange } from 'lucide-react'
import Image from 'next/image'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ResumenTab } from '@/components/dash/resumen'
import { ModeloTab } from '@/components/dash/modelo'
import { PlanDiariaTab } from '@/components/dash/plan-diaria'
import { CargaDatosTab } from '@/components/dash/cargadatos'

export default function Home() {
  const [tab, setTab] = useState('resumen')

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="sticky top-0 z-20 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto max-w-7xl px-4 py-2.5 flex items-center gap-3">
          <Image
            src="/logo-grupo-gestion.png"
            alt="Grupo Gestión"
            width={132}
            height={50}
            priority
            className="h-9 w-auto shrink-0"
          />
          <div className="min-w-0 border-l pl-3">
            <h1 className="text-base sm:text-lg font-bold leading-tight">Planificación — Preparación CD</h1>
            <p className="text-xs text-muted-foreground leading-tight">Ola · Capacidad H61 · Productividad · Maquinistas · Tiempos muertos · Modelo de dotación · Planificación diaria</p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4">
        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <TabsList className="flex flex-wrap h-auto gap-1 justify-start">
            <TabsTrigger value="resumen" className="gap-1.5"><BarChart3 className="h-4 w-4" /> Resumen</TabsTrigger>
            <TabsTrigger value="modelo" className="gap-1.5"><FlaskConical className="h-4 w-4" /> Modelo de Planificación</TabsTrigger>
            <TabsTrigger value="plan-diaria" className="gap-1.5"><CalendarRange className="h-4 w-4" /> Planificación Diaria</TabsTrigger>
            <TabsTrigger value="carga" className="gap-1.5"><UploadCloud className="h-4 w-4" /> Carga de Datos</TabsTrigger>
          </TabsList>

          <TabsContent value="resumen"><ResumenTab onIrACarga={() => setTab('carga')} /></TabsContent>
          <TabsContent value="modelo"><ModeloTab /></TabsContent>
          <TabsContent value="plan-diaria"><PlanDiariaTab /></TabsContent>
          <TabsContent value="carga"><CargaDatosTab /></TabsContent>
        </Tabs>
      </main>

      <footer className="mt-auto border-t bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Grupo Gestión · Área de Preparación — Centro de Distribución</span>
          <span>Datos cargados desde archivos Excel · normalización automática de motivos</span>
        </div>
      </footer>
    </div>
  )
}
