// Sube un archivo por partes a /api/upload (mismo protocolo que el cliente web)
// y muestra la respuesta final. Uso: node scripts/subir_chunks.mjs <ruta> <tipo>
import { readFileSync } from 'fs'

const [ruta, tipo] = process.argv.slice(2)
const URL_BASE = process.env.URL_BASE ?? 'http://localhost:3000'
const TAM = 2 * 1024 * 1024

const buf = readFileSync(ruta)
const total = Math.max(1, Math.ceil(buf.length / TAM))
const fileId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
console.log(`Archivo: ${ruta} (${(buf.length / 1024 / 1024).toFixed(2)} MB) tipo=${tipo} partes=${total}`)

let ultima = {}
for (let i = 0; i < total; i++) {
  const data = buf.subarray(i * TAM, (i + 1) * TAM).toString('base64')
  const r = await fetch(`${URL_BASE}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modo: 'chunk', tipo, fileId, nombre: ruta.split('/').pop(), i, total, data }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) { console.error('ERROR parte', i, r.status, JSON.stringify(j)); process.exit(1) }
  if (j.fase === 'chunk') {
    if (i % 5 === 0 || i === total - 1) console.log(`  parte ${i + 1}/${total} ok`)
  } else {
    ultima = j
    console.log('FINAL:', JSON.stringify(j))
  }
}
if (!('insertados' in ultima)) console.log('AVISO: el server no devolvio respuesta final (¿partes incompletas?)')
