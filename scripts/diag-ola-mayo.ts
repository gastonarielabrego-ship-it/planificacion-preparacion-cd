// Volcado completo de la hoja Mayo 2026 del archivo de Ola
import * as XLSX from 'xlsx'
import { readFileSync } from 'fs'

const buf = readFileSync('data/Ola y Pendiente (1).xlsx')
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })

function volcar(nombre: string) {
  const ws = wb.Sheets[nombre]
  if (!ws) { console.log('no existe', nombre); return }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
  console.log(`\n===== ${nombre} ===== filas=${rows.length}`)
  for (const [i, r] of rows.entries()) {
    const entries = Object.entries(r)
    const etiqueta = entries[0]
    const vals = entries.slice(1)
    const conValor = vals.filter(([, v]) => v != null && v !== 0).length
    console.log(`\n-- fila ${i} etiqueta=${JSON.stringify(etiqueta[1])} celdas_con_valor=${conValor}`)
    console.log(vals.map(([k, v]) => {
      const fecha = v instanceof Date ? v.toISOString().slice(5, 10) : String(v)
      return `${k.replace(/_\d+$/, '')}=${fecha}`
    }).join('  '))
  }
}

volcar('Mayo 2026')
volcar('Junio 2026')
