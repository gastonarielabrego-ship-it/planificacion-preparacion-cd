'use client'

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/hooks/use-toast'
import { FileSpreadsheet, HardDriveDownload, Trash2, Terminal, CheckCircle2, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { n } from '@/lib/client'

interface StatusData {
  ola: { registros: number; desde: string | null; hasta: string | null }
  h61: { registros: number; desde: string | null; hasta: string | null }
  tm: { registros: number; desde: string | null; hasta: string | null }
  picking: { registros: number; desde: string | null; hasta: string | null }
  prodcirc: { registros: number; desde: string | null; hasta: string | null }
}

const TARJETAS = [
  { tipo: 'ola', titulo: 'Ola y Pendiente', desc: 'Bultos a preparar por día (matriz mensual). Archivo: “Ola y Pendiente (1).xlsx”', color: 'bg-emerald-100 text-emerald-800' },
  { tipo: 'h61', titulo: 'H61 — Preparación por hora', desc: 'Producción por hora de cada colaborador (8 h vs 12 h/extras). Archivo: “H61.xlsx” (grande: recomendada la vía Python o seed del servidor)', color: 'bg-teal-100 text-teal-800' },
  { tipo: 'tm', titulo: 'Tiempos muertos', desc: 'Eventos con motivo y observación; se agrupan automáticamente (APRO, NAVE, PASILLO, UBICACIÓN…). Archivo: “tiempos muertos pasado.xlsx”', color: 'bg-amber-100 text-amber-800' },
  { tipo: 'picking', titulo: 'Producción por picking', desc: 'Log de picking para estimar tiempo muerto entre pickings y entre soportes. Es el archivo que excede el chat: cargar con el script Python', color: 'bg-rose-100 text-rose-800' },
  { tipo: 'prodcirc', titulo: 'Productividad X Circuito', desc: 'Tiempos (total/muerto/neto/super neto) y producción por colaborador, sector, día y turno. Archivos: “Productividad X Circuito…”, “Tiempos E-8…” (se acumulan, no se reemplazan)', color: 'bg-indigo-100 text-indigo-800' },
]

export function CargaDatosTab() {
  const [subiendo, setSubiendo] = useState<string | null>(null)
  const [res, setRes] = useState<Record<string, string>>({})
  const inputFile = useRef<Record<string, HTMLInputElement | null>>({})
  const qc = useQueryClient()
  const { toast } = useToast()

  const { data: status } = useQueryStatus()

  async function subir(tipo: string) {
    const input = inputFile.current[tipo]
    const file = input?.files?.[0]
    if (!file) {
      toast({ title: 'Elegí un archivo primero', variant: 'destructive' })
      return
    }
    setSubiendo(tipo)
    setRes((r) => ({ ...r, [tipo]: '' }))
    try {
      const fd = new FormData()
      fd.append('tipo', tipo)
      fd.append('file', file)
      const r = await fetch('/api/upload', { method: 'POST', body: fd })
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>
      if (!r.ok || j.error) throw new Error(String(j.error ?? `Error HTTP ${r.status} al procesar el archivo`))
      setRes((prev) => ({ ...prev, [tipo]: `OK: ${n(j.insertados as number | null)} filas procesadas (${j.desde ?? ''} → ${j.hasta ?? ''})` }))
      toast({ title: `Carga de ${tipo} completada`, description: `${n(j.insertados as number | null)} filas` })
      qc.invalidateQueries()
    } catch (e) {
      const msg = (e as Error).message
      setRes((prev) => ({ ...prev, [tipo]: `Error: ${msg}` }))
      toast({ title: 'Error en la carga', description: msg, variant: 'destructive' })
    } finally {
      setSubiendo(null)
      if (input) input.value = ''
    }
  }

  async function resetear(tipo: string) {
    if (!confirm(`¿Eliminar todos los datos de "${tipo}"?`)) return
    await fetch('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo }) })
    toast({ title: `Datos de ${tipo} eliminados` })
    qc.invalidateQueries()
  }

  return (
    <div className="space-y-4">
      <Alert>
        <FileSpreadsheet className="h-4 w-4" />
        <AlertTitle>Carga de archivos Excel</AlertTitle>
        <AlertDescription>
          Cada carga <b>reemplaza</b> los datos previos de ese tipo. Las fechas se detectan automáticamente.
          Para el H61 (26 MB) y el archivo de picking (excede el chat) usá la vía del script Python, que también sirve en producción (Vercel tiene límite de ~4,5 MB por request).
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-2">
        {TARJETAS.map((t) => (
          <Card key={t.tipo}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Badge variant="secondary" className={t.color}>{t.tipo.toUpperCase()}</Badge>
                  {t.titulo}
                </CardTitle>
                {status && (
                  <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {n(status[t.tipo as keyof StatusData]?.registros ?? 0)} filas
                  </span>
                )}
              </div>
              <CardDescription>{t.desc}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  ref={(el) => { inputFile.current[t.tipo] = el }}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="h-9 flex-1 min-w-44"
                />
                <Button size="sm" onClick={() => subir(t.tipo)} disabled={subiendo === t.tipo} className="min-w-28">
                  {subiendo === t.tipo ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Procesando…</> : <>Cargar</>}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => resetear(t.tipo)} title="Borrar datos de este tipo">
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </div>
              {res[t.tipo] && (
                <p className={`text-xs flex items-center gap-1 ${res[t.tipo].startsWith('OK') ? 'text-emerald-700' : 'text-red-600'}`}>
                  {res[t.tipo].startsWith('OK') && <CheckCircle2 className="h-3.5 w-3.5" />} {res[t.tipo]}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Separator />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Terminal className="h-4 w-4" /> Cargar el archivo grande con Python</CardTitle>
          <CardDescription>
            Para el archivo de producción por picking (y también H61), usá el script <code className="rounded bg-muted px-1">subir_archivo.py</code> del repositorio.
            Lee el Excel/CSV, detecta las columnas y envía los datos por lotes a la API — sin límite de tamaño.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md bg-slate-900 text-slate-100 p-4 text-xs leading-relaxed overflow-x-auto font-mono">
            <p className="text-slate-400"># 1) instalar dependencias (una vez)</p>
            <p>pip install pandas openpyxl requests</p>
            <p className="text-slate-400 mt-2"># 2) apuntar a la app y subir el archivo de picking</p>
            <p>python subir_archivo.py --tipo picking --archivo "produccion picking.xlsx" --url https://TU-APP.vercel.app</p>
            <p className="text-slate-400 mt-2"># también sirve para el H61 (reemplaza datos previos):</p>
            <p>python subir_archivo.py --tipo h61 --archivo H61.xlsx --url https://TU-APP.vercel.app</p>
            <p className="text-slate-400 mt-2"># en local: --url http://localhost:3000</p>
          </div>
          <p className="text-xs text-muted-foreground">
            El script auto-detecta columnas (fecha, operario, hora, bultos, soporte, circuito) y muestra el mapeo elegido antes de enviar.
            Si tu archivo usa otros nombres, ajustá el diccionario <code className="rounded bg-muted px-1">MAPEO_PICKING</code> al inicio del script.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><HardDriveDownload className="h-4 w-4" /> Estado de los datos</CardTitle>
        </CardHeader>
        <CardContent>
          {status ? (
            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {(['ola', 'h61', 'tm', 'picking'] as const).map((k) => (
                <div key={k} className="rounded-md border p-3">
                  <p className="font-semibold uppercase text-xs text-muted-foreground">{k}</p>
                  <p className="tabular-nums">{n(status[k].registros)} filas</p>
                  <p className="text-xs text-muted-foreground">
                    {status[k].desde ? `${status[k].desde.slice(0, 10)} → ${status[k].hasta?.slice(0, 10)}` : 'sin datos'}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
function useQueryStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: async (): Promise<StatusData> => {
      const r = await fetch('/api/status', { cache: 'no-store' })
      return r.json()
    },
  })
}
