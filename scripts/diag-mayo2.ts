// Comparar ola de mayo vs producción H61 diaria para detectar corrimiento de fechas
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function main() {
  const desde = new Date('2026-04-25T00:00:00.000Z')
  const hasta = new Date('2026-06-10T00:00:00.000Z')
  const ola = await db.olaDia.findMany({ where: { fecha: { gte: desde, lte: hasta } }, orderBy: { fecha: 'asc' } })
  const h61 = await db.h61OpDia.groupBy({
    by: ['fecha'], where: { fecha: { gte: desde, lte: hasta } },
    _sum: { bultos: true }, _count: { _all: true },
  })
  const h61Map = new Map(h61.map((r) => [r.fecha.toISOString().slice(0, 10), r._sum.bultos ?? 0]))
  const dow = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

  console.log('fecha        dow  ola      pend     total    | H61 bultos')
  for (const r of ola) {
    const d = r.fecha.toISOString().slice(0, 10)
    const w = dow[r.fecha.getUTCDay()]
    const h = h61Map.get(d) ?? 0
    console.log(`${d} ${w}  ${Math.round(r.ola).toLocaleString('es').padStart(8)} ${Math.round(r.pendiente).toLocaleString('es').padStart(9)} ${Math.round(r.total).toLocaleString('es').padStart(9)} | ${h.toLocaleString('es').padStart(9)}`)
  }

  // ¿Días que existen en H61 pero no en ola?
  const olaDias = new Set(ola.map((r) => r.fecha.toISOString().slice(0, 10)))
  const faltan = [...h61Map.entries()].filter(([d]) => !olaDias.has(d)).sort()
  console.log('\nDías con H61 pero SIN ola:', faltan.map(([d, h]) => `${d}(${h.toLocaleString('es')})`).join(', '))
}
main().finally(() => db.$disconnect())
