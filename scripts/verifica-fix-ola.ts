// Verifica el parser REAL (post-fix) y genera filas corregidas 2026 para re-importar
import * as XLSX from 'xlsx'
import { readFileSync, writeFileSync } from 'fs'
import { matrizOlaARecords } from '../src/lib/xlsx'

const wb = XLSX.read(readFileSync('data/Ola y Pendiente (1).xlsx'), { type: 'buffer', cellDates: true, dense: true })
const recs = matrizOlaARecords(wb)
console.log('filas totales parseadas:', recs.length)

const mayo = recs.filter((r) => String(r.fecha).startsWith('2026-05'))
console.log('\n== Mayo 2026 (corregido) ==')
let sumO = 0, sumP = 0
for (const r of mayo) { sumO += Number(r.ola); sumP += Number(r.pendiente) }
for (const r of mayo) console.log(r.fecha, 'ola=', Number(r.ola).toLocaleString('es'), 'pend=', Number(r.pendiente).toLocaleString('es'))
console.log('TOTAL mayo: ola=', Math.round(sumO).toLocaleString('es'), 'pend=', Math.round(sumP).toLocaleString('es'))

const hayJulio = recs.filter((r) => String(r.fecha).startsWith('2026-07'))
console.log('\nfilas julio 2026 (debe ser 0, no hay datos):', hayJulio.length)

// filas 2026 para producción (mantiene el alcance actual de 212 días)
const filas2026 = recs
  .filter((r) => String(r.fecha).startsWith('2026'))
  .map((r) => ({ fecha: r.fecha, ola: Math.round(Number(r.ola)), pendiente: Math.round(Number(r.pendiente)), total: Math.round(Number(r.total)) }))
writeFileSync('tmp/ola-2026-corregida.json', JSON.stringify(filas2026))
console.log('\nfilas 2026 para re-importar:', filas2026.length, '→ tmp/ola-2026-corregida.json')
