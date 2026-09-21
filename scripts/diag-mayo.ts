// Diagnóstico de datos de mayo: Ola vs H61 por mes
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function main() {
  const ola = await db.olaDia.findMany({ orderBy: { fecha: 'asc' } })
  console.log('OlaDia total filas:', ola.length, 'rango:', ola[0]?.fecha.toISOString().slice(0, 10), '→', ola[ola.length - 1]?.fecha.toISOString().slice(0, 10))

  const porMes = new Map<string, { dias: number; ola: number; pend: number; tot: number; maxOla: number; minOla: number }>()
  for (const r of ola) {
    const m = r.fecha.toISOString().slice(0, 7)
    const a = porMes.get(m) ?? { dias: 0, ola: 0, pend: 0, tot: 0, maxOla: 0, minOla: Infinity }
    a.dias++; a.ola += r.ola; a.pend += r.pendiente; a.tot += r.total
    a.maxOla = Math.max(a.maxOla, r.ola); a.minOla = Math.min(a.minOla, r.ola)
    porMes.set(m, a)
  }
  console.log('\n== OLA por mes ==')
  console.log('mes      dias  ola_total   pend_total   total     ola_prom  ola_max')
  for (const [m, a] of [...porMes.entries()].sort()) {
    console.log(`${m}  ${String(a.dias).padStart(4)}  ${Math.round(a.ola).toLocaleString('es').padStart(10)}  ${Math.round(a.pend).toLocaleString('es').padStart(10)}  ${Math.round(a.tot).toLocaleString('es').padStart(10)}  ${(a.ola / a.dias).toFixed(1).padStart(8)}  ${Math.round(a.maxOla).toLocaleString('es')}`)
  }

  // H61 bultos por mes
  const h61 = await db.h61OpDia.groupBy({
    by: ['fecha'], _sum: { bultos: true, bultosBase: true, bultosExtras: true, horasActivas: true },
  })
  const h61Mes = new Map<string, { dias: number; bultos: number; base: number; extras: number; horas: number }>()
  for (const r of h61) {
    const m = r.fecha.toISOString().slice(0, 7)
    const a = h61Mes.get(m) ?? { dias: 0, bultos: 0, base: 0, extras: 0, horas: 0 }
    a.dias++; a.bultos += r._sum.bultos ?? 0; a.base += r._sum.bultosBase ?? 0; a.extras += r._sum.bultosExtras ?? 0; a.horas += r._sum.horasActivas ?? 0
    h61Mes.set(m, a)
  }
  console.log('\n== H61 por mes ==')
  console.log('mes      dias  bultos        base          extras       %extra  horas')
  for (const [m, a] of [...h61Mes.entries()].sort()) {
    const pct = a.base + a.extras ? (100 * a.extras) / (a.base + a.extras) : 0
    console.log(`${m}  ${String(a.dias).padStart(4)}  ${a.bultos.toLocaleString('es').padStart(12)}  ${a.base.toLocaleString('es').padStart(12)}  ${a.extras.toLocaleString('es').padStart(12)}  ${pct.toFixed(1).padStart(5)}%  ${a.horas.toLocaleString('es')}`)
  }

  // Detalle de mayo de la ola: cada día
  const mayo = ola.filter((r) => r.fecha.toISOString().slice(0, 7) === '2026-05')
  console.log('\n== OLA mayo día por día ==')
  for (const r of mayo) {
    const d = r.fecha.toISOString().slice(0, 10)
    const dow = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][r.fecha.getUTCDay()]
    console.log(`${d} ${dow}  ola=${Math.round(r.ola).toLocaleString('es').padStart(9)}  pend=${Math.round(r.pendiente).toLocaleString('es').padStart(9)}  total=${Math.round(r.total).toLocaleString('es').padStart(9)}`)
  }
}

main().finally(() => db.$disconnect())
