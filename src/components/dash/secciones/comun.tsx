'use client'

// Comunes de las secciones del Resumen único: identidad Grupo Gestión,
// utilidades de mediana y encabezados de sección.

import type { LucideIcon } from 'lucide-react'

// Colores institucionales Grupo Gestión (tomados del logo)
export const VERDE = '#76B41E'
export const NARANJA = '#E09020'
export const GRIS = '#54565A'

export function mediana(vals: number[]): number {
  if (!vals.length) return 0
  const s = [...vals].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Encabezado de cada sección del resumen
export function TituloSeccion({ icono: Icono, id, titulo, descripcion }: { icono: LucideIcon; id: string; titulo: string; descripcion: string }) {
  return (
    <div id={id} className="scroll-mt-24 flex items-start gap-3 pt-5 border-t first:border-t-0 first:pt-0">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#76B41E]/10 text-[#5a8a17]">
        <Icono className="h-5 w-5" />
      </span>
      <div>
        <h2 className="text-lg font-bold leading-tight">{titulo}</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">{descripcion}</p>
      </div>
    </div>
  )
}

// Mapa de calor simple en cuadrícula (usado por maquinistas y picking)
export function MapaCalor({
  filas,
  columnas,
  valor,
  formato,
  tituloCelda,
  anchoFila = 'w-24',
}: {
  filas: { clave: string; etiqueta: string }[]
  columnas: { clave: string; etiqueta: string }[]
  valor: (fila: string, col: string) => number | null
  formato?: (v: number) => string
  tituloCelda?: (fila: string, col: string, v: number | null) => string
  anchoFila?: string
}) {
  const max = Math.max(0, ...filas.flatMap((f) => columnas.map((c) => valor(f.clave, c.clave) ?? 0)))
  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="flex">
          <div className={`${anchoFila} shrink-0`} />
          {columnas.map((c) => (
            <div key={c.clave} className="flex-1 min-w-14 px-0.5 pb-1 text-center text-[10px] font-medium text-muted-foreground">{c.etiqueta}</div>
          ))}
        </div>
        {filas.map((f) => (
          <div key={f.clave} className="flex items-center">
            <div className={`${anchoFila} shrink-0 pr-1 text-xs font-medium truncate`} title={f.etiqueta}>{f.etiqueta}</div>
            {columnas.map((c) => {
              const v = valor(f.clave, c.clave)
              const t = max > 0 && v != null && v > 0 ? v / max : 0
              const bg = t <= 0 ? 'bg-muted/40 text-muted-foreground/50' : t > 0.8 ? 'bg-[#76B41E] text-white' : t > 0.6 ? 'bg-[#76B41E]/80 text-white' : t > 0.4 ? 'bg-[#76B41E]/60 text-emerald-950' : t > 0.2 ? 'bg-[#76B41E]/40 text-emerald-950' : 'bg-[#76B41E]/25 text-emerald-950'
              return (
                <div key={c.clave} className={`flex-1 min-w-14 m-0.5 h-8 rounded flex items-center justify-center text-[10px] tabular-nums ${bg}`} title={tituloCelda ? tituloCelda(f.clave, c.clave, v) : undefined}>
                  {v != null && v > 0 ? (formato ? formato(v) : Math.round(v)) : ''}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
