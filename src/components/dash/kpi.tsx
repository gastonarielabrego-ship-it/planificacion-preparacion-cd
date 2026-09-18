'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { n, n1, pct } from '@/lib/client'
import type { LucideIcon } from 'lucide-react'

interface Props {
  titulo: string
  valor: number | string | null
  unidad?: string
  detalle?: string | null
  icono?: LucideIcon
  formato?: 'entero' | 'decimal' | 'porcentaje' | 'texto'
  tono?: 'normal' | 'alerta' | 'exito' | 'atencion'
  cargando?: boolean
}

export function Kpi({ titulo, valor, unidad, detalle, icono: Icono, formato = 'entero', tono = 'normal', cargando }: Props) {
  const val = formato === 'entero' ? n(valor as number) : formato === 'decimal' ? n1(valor as number) : formato === 'porcentaje' ? pct(valor as number) : (valor ?? '—')
  const tonoClase = {
    normal: 'text-foreground',
    alerta: 'text-red-600',
    exito: 'text-emerald-600',
    atencion: 'text-amber-600',
  }[tono]
  return (
    <Card className="border shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground leading-tight">{titulo}</p>
          {Icono && <Icono className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />}
        </div>
        {cargando ? (
          <Skeleton className="h-7 w-24 mt-2" />
        ) : (
          <p className={cn('text-xl font-bold tabular-nums mt-1.5', tonoClase)}>
            {val}
            {unidad && <span className="text-xs font-medium text-muted-foreground ml-1">{unidad}</span>}
          </p>
        )}
        {detalle && <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{detalle}</p>}
      </CardContent>
    </Card>
  )
}

export function SinDatos({ mensaje = 'Todavía no hay datos cargados para este módulo.' }: { mensaje?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-10 text-center">
      <p className="text-sm font-medium text-muted-foreground">{mensaje}</p>
      <p className="text-xs text-muted-foreground/70">Cargá los archivos en la pestaña “Carga de Datos”.</p>
    </div>
  )
}
