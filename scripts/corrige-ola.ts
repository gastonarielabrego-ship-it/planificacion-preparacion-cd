// Corrige los datos de la ola en la DB local (upsert de TODAS las fechas
// re-parseadas con el parser corregido) y genera el payload 2026 para producción.
import * as XLSX from 'xlsx'
import { readFileSync, writeFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { matrizOlaARecords } from '../src/lib/xlsx'

const db = new PrismaClient()

async function main() {
  const wb = XLSX.read(readFileSync('data/Ola y Pendiente (1).xlsx'), { type: 'buffer', cellDates: true, dense: true })
  const recs = matrizOlaARecords(wb)

  // dedupe last-wins (igual que ingestOla: la hoja posterior gana; los
  // placeholders de fin de mes de una hoja son reemplazados por la hoja del mes real)
  const vistos = new Map<string, { fecha: string; ola: number; pendiente: number; total: number }>()
  for (const r of recs) {
    vistos.set(String(r.fecha), {
      fecha: String(r.fecha),
      ola: Math.round(Number(r.ola)),
      pendiente: Math.round(Number(r.pendiente)),
      total: Math.round(Number(r.total)),
    })
  }
  const unicos = [...vistos.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))
  console.log('filas parseadas:', recs.length, '| fechas únicas:', unicos.length)

  // ---- LOCAL: reemplazar toda la tabla OlaDia con los valores corregidos ----
  await db.olaDia.deleteMany({})
  for (let i = 0; i < unicos.length; i += 400) {
    const c = unicos.slice(i, i + 400)
    await db.olaDia.createMany({ data: c.map((r) => ({ fecha: new Date(r.fecha + 'T00:00:00.000Z'), ola: r.ola, pendiente: r.pendiente, total: r.total })) })
  }
  const total = await db.olaDia.count()
  console.log('DB local OlaDia filas:', total)

  // ---- PRODUCCIÓN: payload 2026 (mantiene el alcance actual: 2026 sin julio) ----
  const f2026 = unicos.filter((r) => r.fecha.startsWith('2026'))
  writeFileSync('tmp/ola-2026-corregida.json', JSON.stringify({ tabla: 'ola', reemplazar: true, final: false, rows: f2026 }))
  console.log('payload producción (2026):', f2026.length, 'filas → tmp/ola-2026-corregida.json')

  // verificación mayo
  const mayo = f2026.filter((r) => r.fecha.startsWith('2026-05'))
  const sO = mayo.reduce((a, r) => a + r.ola, 0)
  const sP = mayo.reduce((a, r) => a + r.pendiente, 0)
  console.log('mayo 2026 corregido: ola=', sO.toLocaleString('es'), 'pend=', sP.toLocaleString('es'), '| días=', mayo.length)
}

main().finally(() => db.$disconnect())
