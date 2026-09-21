// RECUPERACION TOTAL de datos: reimporta los Excel fuente (carpeta upload/) al
// proyecto Neon LIMPIO usando exactamente los mismos parsers del prod (src/lib/ingest.ts).
//
// Uso:  bun scripts/recuperar-todo.ts <maq|h61|tm|picking>
// Env:  POSTGRES_PRISMA_URL + POSTGRES_URL_NON_POOLING apuntando al proyecto limpio.
import * as XLSX from 'xlsx'
import { ingestRows, autoMapPicking, type TipoCarga } from '../src/lib/ingest'
import { filasDelWorkbook } from '../src/lib/xlsx'
import { db } from '../src/lib/db'

// pre-calentar la conexion con reintentos (el compute del proyecto claim se
// suspende y el primer intento a veces no alcanza el cold start)
async function conectar(): Promise<void> {
  for (let i = 1; i <= 6; i++) {
    try {
      await db.$connect()
      await db.$queryRaw`SELECT 1`
      console.log(`conexion OK (intento ${i})`)
      return
    } catch (e) {
      console.log(`conexion intento ${i} fallo: ${String(e?.message ?? e).split('\n')[0].slice(0, 90)}`)
      await new Promise((r) => setTimeout(r, 4000))
    }
  }
  throw new Error('no se pudo conectar a la base limpia')
}

const CONF: Record<string, { file: string; sheet?: string; batch: string }> = {
  maq: { file: 'upload/h61 maquinista.xlsx', sheet: 'Datos', batch: 'recup-maq-orig' },
  h61: { file: 'upload/H61.xlsx', sheet: 'Datos', batch: 'recup-h61-orig' },
  tm: { file: 'upload/tiempos muertos pasado.xlsx', sheet: 'Datos', batch: 'recup-tm-orig' },
  picking: { file: 'upload/Productividad X Circuito (1).xlsx', sheet: 'Colaborador', batch: 'recup-picking-orig' },
}

const tipo = process.argv[2] as TipoCarga
if (!tipo || !CONF[tipo]) {
  console.error('uso: bun scripts/recuperar-todo.ts <maq|h61|tm|picking>')
  process.exit(1)
}
const conf = CONF[tipo]
await conectar()

console.log(`[${tipo}] leyendo ${conf.file} ...`)
const t0 = Date.now()
// cellDates: true = IGUAL que la ruta canonica de carga (/api/seed)
const wb = XLSX.readFile(conf.file, { dense: true, cellDates: true })
console.log(`[${tipo}] workbook leido (${((Date.now() - t0) / 1000).toFixed(0)}s), hojas: ${wb.SheetNames.join(', ')}`)

// streaming con el mismo generador del prod (bajo consumo de memoria)
const filas = filasDelWorkbook(wb)

// mapeo de picking: auto-deteccion con la primera fila (igual que ingestPicking)
let mapping = null
if (tipo === 'picking') {
  let muestra: Record<string, unknown> | undefined
  for (const r of filas) { muestra = r; break }
  if (!muestra) { console.error('sin filas'); process.exit(1) }
  mapping = autoMapPicking(muestra)
  console.log(`[${tipo}] mapping auto:`, JSON.stringify(mapping))
}

;(async () => {
  const t1 = Date.now()
  // re-iterable: envuelve el generador ya consumido? No: filasDelWorkbook se
  // consume una vez, así que se re-lee el workbook desde el inicio si picking
  // ya lo consumió para la muestra.
  const fuente: Iterable<Record<string, unknown>> = tipo === 'picking'
    ? filasDelWorkbook(XLSX.readFile(conf.file, { dense: true, cellDates: true }))
    : filas
  const res = await ingestRows(tipo, fuente, { batchId: conf.batch, filename: conf.file, mapping })
  console.log(`[${tipo}] LISTO en ${((Date.now() - t1) / 1000).toFixed(0)}s -> insertados=${res.insertados.toLocaleString('es-AR')} errores=${res.errores} desde=${res.desde} hasta=${res.hasta}`)
  process.exit(0)
})().catch((e) => {
  console.error(`[${tipo}] ERROR:`, e?.message ?? e)
  process.exit(1)
})
