'use client'

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/hooks/use-toast'
import { FileSpreadsheet, HardDriveDownload, Trash2, Terminal, CheckCircle2, Loader2, Wrench } from 'lucide-react'
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
  maq: { registros: number; desde: string | null; hasta: string | null }
}

const TARJETAS = [
  { tipo: 'ola', titulo: 'Ola y Pendiente', desc: 'Bultos a preparar por día (matriz mensual). Archivo: “Ola y Pendiente (1).xlsx”', color: 'bg-emerald-100 text-emerald-800' },
  { tipo: 'h61', titulo: 'H61 — Preparación por hora', desc: 'Producción por hora de cada colaborador (8 h vs 12 h/extras + actividad). Se sube por partes automáticamente, sin límite de tamaño', color: 'bg-teal-100 text-teal-800' },
  { tipo: 'maq', titulo: 'H61 — Maquinistas (clarkistas)', desc: 'H61 de maquinistas: personas por actividad y naves asignadas (columna CIRCUITO), movimientos de clark y bultos. Archivo: “h61 maquinista.xlsx”. Se sube por partes automáticamente', color: 'bg-lime-100 text-lime-800' },
  { tipo: 'tm', titulo: 'Tiempos muertos', desc: 'Eventos con motivo y observación; se agrupan automáticamente (APRO, NAVE, PASILLO, UBICACIÓN…). Archivo: “tiempos muertos pasado.xlsx”', color: 'bg-amber-100 text-amber-800' },
  { tipo: 'picking', titulo: 'Picking (E-8)', desc: 'Reporte E-8 de producción por picking: tiempo muerto entre levantes, bultos por zona (naves), personas por actividad, recorridos, traslados y productividad neta / super neta. Archivos: “produccion picking…”, “Tiempos E-8…”. Cada carga REEMPLAZA el picking anterior; los archivos grandes se suben por partes y se procesan por tandas automáticamente', color: 'bg-rose-100 text-rose-800' },
]

const TAM_PARTE = 2 * 1024 * 1024 // 2 MB crudos por parte (~2,7 MB en base64, bajo el límite de Vercel)

function aBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const paso = 0x8000
  for (let i = 0; i < bytes.length; i += paso) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + paso)))
  }
  return btoa(bin)
}

async function postConReintentos(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let ultimo: Error | null = null
  for (let intento = 0; intento < 3; intento++) {
    try {
      const r = await fetch(body.paso ? '/api/upload/procesar' : '/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>
      if (r.ok && !j.error) return j
      const msg = String(j.error ?? `Error HTTP ${r.status} al procesar el archivo`)
      // 4xx (salvo 408/429) = error definitivo del request: no reintentar
      const definitivo = r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429
      if (definitivo) throw Object.assign(new Error(msg), { noReintentar: true })
      ultimo = new Error(msg)
    } catch (e) {
      if (e && typeof e === 'object' && (e as { noReintentar?: boolean }).noReintentar) throw e
      ultimo = e as Error
    }
    await new Promise((res) => setTimeout(res, 1500))
  }
  throw ultimo ?? new Error('Error de red al subir la parte')
}

// Pipeline por pasos para PICKING (E-8): el archivo puede tener cientos de
// miles de eventos y procesarlo entero en el servidor supera el timeout de la
// plataforma (HTTP 504). Acá el cliente dirige: parseo -> insertar en tandas
// -> cerrar. Cada paso es reanudable, por eso reintentar es seguro.
async function procesarPickingPorPasos(
  fileId: string,
  onProgreso: (msg: string) => void,
): Promise<{ insertados: number; desde?: string; hasta?: string }> {
  onProgreso('Preparando el archivo en el servidor (parseo)…')
  let p: Record<string, unknown>
  try {
    p = await postConReintentos({ paso: 'parseo', fileId })
  } catch (e) {
    const msg = (e as Error).message
    // si el parseo ya se había completado pero se perdió la respuesta, el stage
    // ya está cargado: se sigue directamente con la inserción
    if (!/no hay partes/i.test(msg)) throw e
    p = {}
  }
  const total = Number(p.filas ?? 0)
  if (!total) throw new Error('el archivo no tuvo filas utilizables')
  let insertados = 0
  let restantes = -1 // tandas que devuelve el servidor (terminator del bucle)
  let sinAvance = 0
  while (restantes !== 0) {
    const r = await postConReintentos({ paso: 'insertar', fileId })
    insertados += Number(r.insertados ?? 0)
    restantes = Number(r.restantes ?? 0)
    const faltan = total ? Math.max(0, total - insertados) : 0
    const msg = `Insertando en la base… ${insertados.toLocaleString('es')} filas`
    onProgreso(faltan > 0 ? `${msg} (quedan ${faltan.toLocaleString('es')})` : msg)
    if (restantes !== 0 && faltan === 0) break // por si el servidor no reporta tandas
    if (Number(r.insertados ?? 0) === 0) {
      sinAvance++
      if (sinAvance >= 3) throw new Error('el servidor no pudo avanzar con la inserción; probá de nuevo')
    } else {
      sinAvance = 0
    }
  }
  if (!insertados) throw new Error('no se pudo insertar ninguna fila; subí el archivo de nuevo')
  onProgreso('Cerrando la carga…')
  const c = await postConReintentos({ paso: 'cerrar', fileId })
  return { insertados: Number(c.insertados ?? insertados), desde: p.desde as string | undefined, hasta: p.hasta as string | undefined }
}

export function CargaDatosTab() {
  const [subiendo, setSubiendo] = useState<string | null>(null)
  const [res, setRes] = useState<Record<string, string>>({})
  const inputFile = useRef<Record<string, HTMLInputElement | null>>({})
  const [manteniendo, setManteniendo] = useState(false)
  const [mantInfo, setMantInfo] = useState<{ texto: string; ok: boolean } | null>(null)
  const qc = useQueryClient()
  const { toast } = useToast()

  const { data: status } = useQueryStatus()

  // Mantenimiento de la base: Neon tiene un tope de 512 MB; si una subida
  // falla con "could not extend file / 53100" hay que liberar el staging.
  async function liberarEspacio() {
    if (!confirm('¿Liberar espacio? Borra SOLO partes y tandas temporales de subidas (los datos cargados no se tocan).')) return
    setManteniendo(true)
    setMantInfo(null)
    try {
      const r = await fetch('/api/mantenimiento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = (await r.json().catch(() => ({}))) as { mensaje?: string; baseMB?: number | null; error?: string }
      if (!r.ok || j.error) throw new Error(j.error ?? `Error HTTP ${r.status}`)
      setMantInfo({
        texto: `${j.mensaje ?? 'Listo.'}${j.baseMB != null ? ` Uso actual de la base: ${j.baseMB} MB de 512 MB.` : ''}`,
        ok: true,
      })
      toast({ title: 'Mantenimiento terminado', description: j.mensaje })
      qc.invalidateQueries()
    } catch (e) {
      setMantInfo({ texto: `Error: ${(e as Error).message}`, ok: false })
      toast({ title: 'No se pudo completar el mantenimiento', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setManteniendo(false)
    }
  }

  async function subir(tipo: string) {
    const input = inputFile.current[tipo]
    const file = input?.files?.[0]
    if (!file) {
      toast({ title: 'Elegí un archivo primero', variant: 'destructive' })
      return
    }
    if (file.size === 0) {
      toast({ title: 'El archivo está vacío o no se pudo leer', variant: 'destructive' })
      return
    }
    setSubiendo(tipo)
    setRes((r) => ({ ...r, [tipo]: '' }))
    try {
      const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const total = Math.max(1, Math.ceil(file.size / TAM_PARTE))
      let j: Record<string, unknown> = {}
      for (let i = 0; i < total; i++) {
        setRes((r) => ({ ...r, [tipo]: i === 0 ? 'Subiendo…' : `Subiendo parte ${i + 1}/${total}…` }))
        const data = aBase64(await file.slice(i * TAM_PARTE, (i + 1) * TAM_PARTE).arrayBuffer())
        j = await postConReintentos({ modo: 'chunk', tipo, fileId, nombre: file.name, i, total, data })
        const recibidos = Number(j.recibidos ?? i + 1)
        if (total > 1 && j.fase === 'chunk') setRes((r) => ({ ...r, [tipo]: `Partes ${recibidos}/${total} recibidas…` }))
      }
      if (j.fase === 'armado') {
        // Picking por pasos: parseo + inserción en tandas + cierre
        const r2 = await procesarPickingPorPasos(String(j.fileId ?? fileId), (msg) => setRes((r) => ({ ...r, [tipo]: msg })))
        j = { insertados: r2.insertados, desde: r2.desde, hasta: r2.hasta }
      }
      if (j.fase !== 'procesado' && !('insertados' in j)) {
        throw new Error('el servidor no terminó de procesar el archivo; probá de nuevo')
      }
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
          Los archivos grandes (ej. H61 de ~26 MB) se suben <b>por partes</b> automáticamente — no hay límite de tamaño desde la web.
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
          <CardTitle className="text-base flex items-center gap-2"><Terminal className="h-4 w-4" /> Alternativa: cargar con el script Python</CardTitle>
          <CardDescription>
            La web ya acepta archivos grandes por partes, pero si preferís el script <code className="rounded bg-muted px-1">subir_archivo.py</code> del repositorio también funciona:
            lee el Excel/CSV, detecta las columnas y envía los datos por lotes a la API.
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

      <Separator />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Wrench className="h-4 w-4" /> Mantenimiento de la base</CardTitle>
          <CardDescription>
            Si una carga falla con “la base de datos alcanzó su límite de espacio (512 MB)”, liberá las partes temporales
            que quedaron de subidas anteriores. <b>No borra datos cargados</b> (ola, H61, maquinistas, tiempos muertos ni picking).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button size="sm" variant="outline" onClick={liberarEspacio} disabled={manteniendo} className="min-w-44">
            {manteniendo ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Liberando…</> : <><Wrench className="h-4 w-4 mr-1" /> Liberar espacio</>}
          </Button>
          {mantInfo && (
            <p className={`text-xs flex items-start gap-1 ${mantInfo.ok ? 'text-emerald-700' : 'text-red-600'}`}>
              {mantInfo.ok && <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />} {mantInfo.texto}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><HardDriveDownload className="h-4 w-4" /> Estado de los datos</CardTitle>
        </CardHeader>
        <CardContent>
          {status ? (
            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {(['ola', 'h61', 'tm', 'picking', 'maq'] as const).map((k) => (
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
