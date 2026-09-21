// Genera archivos Excel sinteticos para sembrar el sandbox y verificar la UI.
// H61: preparadores (bultos por hora) | MAQ: maquinistas (movimientos + apros)
import * as XLSX from 'xlsx'
import { writeFileSync } from 'fs'

const HORAS = Array.from({ length: 24 }, (_, i) => `HORA_${String(i).padStart(2, '0')}`)

// ---- H61 de preparadores: 10 operarios x 12 dias (L-V), 2 turnos ----
const h61Rows: Record<string, unknown>[] = []
for (let d = 0; d < 12; d++) {
  const date = new Date(Date.UTC(2026, 4, 4 + d)) // 4..15 mayo 2026
  const dow = date.getUTCDay()
  if (dow === 0 || dow === 6) continue
  const ymd = +`${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
  for (let o = 1; o <= 10; o++) {
    const operario = `OP${String(o).padStart(3, '0')}`
    const turno = o <= 6 ? 'M' : 'T'
    const fila: Record<string, unknown> = {
      FECHA: ymd, OPERARIO: operario, NOMBRE: `Operario ${o}`, FUNCION: 'PREPARADOR',
      TURNO: turno, ACTIVIDAD: o % 3 === 0 ? '4' : '2', CIRCUITO: `N${(o % 3) + 1}`,
    }
    let total = 0
    const horasDia = turno === 'M' ? [6, 7, 8, 9, 10, 11, 12, 13] : [14, 15, 16, 17, 18, 19, 20, 21]
    for (const h of horasDia) {
      const b = 95 + ((o * 7 + h * 3) % 25) // 95..119 bultos/h
      fila[HORAS[h]] = b
      total += b
    }
    fila.TOTAL = total
    h61Rows.push(fila)
  }
}

// ---- MAQ: 4 clarkistas x 12 dias, con movimientos por hora y TOT_APROS ----
const maqRows: Record<string, unknown>[] = []
for (let d = 0; d < 12; d++) {
  const date = new Date(Date.UTC(2026, 4, 4 + d))
  const dow = date.getUTCDay()
  if (dow === 0 || dow === 6) continue
  const ymd = +`${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
  for (let o = 1; o <= 4; o++) {
    const operario = `CL${String(o).padStart(3, '0')}`
    const esApros = o <= 2 // 2 clarks de apros, 2 de homogeneos
    const turno = o <= 2 ? 'M' : 'T'
    const fila: Record<string, unknown> = {
      FECHA: ymd, OPERARIO: operario, NOIMBRE: `Clarkista ${o}`, TURNO: turno,
      TURNO_DESC: esApros ? 'TM' : 'TT', FUNCION: 'CLARKISTA', FUNCION_DESC: 'Clark',
      ACTIVIDAD: o % 2 === 0 ? '4' : '2', CIRCUITO: `N${o}`,
    }
    let total = 0
    const horasDia = turno === 'M' ? [6, 7, 8, 9, 10, 11, 12, 13] : [14, 15, 16, 17, 18, 19, 20, 21]
    for (const h of horasDia) {
      const mov = (esApros ? 14 : 12) + ((o * 5 + h) % 9) // ~12..22 mov/h
      fila[HORAS[h]] = mov
      total += mov
    }
    fila.TOTAL = total
    fila.TOT_BULTOS = total * 6
    fila.TOT_APROS = esApros ? Math.round(total * 0.9) : 0
    fila.TOT_APROS_PARCIAL = 0
    fila.TOT_HOMOGENEOS = esApros ? 0 : Math.round(total * 0.95)
    maqRows.push(fila)
  }
}

const wbH61 = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wbH61, XLSX.utils.json_to_sheet(h61Rows), 'H61')
writeFileSync('/home/z/my-project/data/H61.xlsx', XLSX.write(wbH61, { type: 'buffer', bookType: 'xlsx' }))

const wbMaq = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wbMaq, XLSX.utils.json_to_sheet(maqRows), 'MAQ')
writeFileSync('/home/z/my-project/data/Maquinistas.xlsx', XLSX.write(wbMaq, { type: 'buffer', bookType: 'xlsx' }))

console.log('H61 rows:', h61Rows.length, '| MAQ rows:', maqRows.length)
