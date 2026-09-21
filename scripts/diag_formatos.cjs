// Matriz de formatos: ver cuáles hacen que filasDelWorkbook no rinda filas
// con la MISMA lógica del server (SheetJS 0.18.5, dense:true).
const XLSX = require('xlsx')
const fs = require('fs')

const filas = [
  ['CODUTI', 'NOMUTI', 'FECHA', 'HORA', 'CODACT', 'BULTOS'],
  ['P11710', 'CARUSO ROMINA', '2026-07-06', '06:12:01', '004', 1],
  ['P11711', 'PEREZ JUAN', '2026-07-06', '06:15:30', '002', 3],
]

function* filasDeHojaDensa(cantFilas, leer, liberar) {
  let headers = null
  for (let r = 0; r < cantFilas; r++) {
    const fila = leer(r)
    liberar(r)
    if (!fila) continue
    if (!headers) {
      headers = fila.map((c) => (c && c.v != null ? String(c.v).trim() : ''))
      continue
    }
    const obj = {}
    let conValor = false
    for (let c = 0; c < fila.length; c++) {
      const cel = fila[c]
      if (!cel || cel.v == null) continue
      const h = headers[c]
      if (h) obj[h] = cel.v
      conValor = true
    }
    if (!conValor) continue
    yield obj
  }
}

function* filasDelWorkbook(wb) {
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    const data = sheet['!data']
    if (data) {
      yield* filasDeHojaDensa(data.length, (r) => data[r], (r) => { data[r] = undefined })
      continue
    }
    if (!sheet['!ref']) continue
    const rango = XLSX.utils.decode_range(sheet['!ref'])
    yield* filasDeHojaDensa(
      rango.e.r + 1,
      (r) => sheet[String(r)],
      (r) => { sheet[String(r)] = undefined },
    )
  }
}

function probar(nombre, buf) {
  console.log('\n=== ' + nombre + ' ===')
  let wb
  try {
    wb = XLSX.read(buf, { type: 'buffer', cellDates: true, dense: true })
  } catch (e) {
    console.log('XLSX.read THROWS:', e.message.slice(0, 120))
    return
  }
  const info = wb.SheetNames.map((n) => {
    const s = wb.Sheets[n]
    const claves = Object.keys(s).filter((k) => !k.startsWith('!'))
    return `"${n}" ref=${s['!ref'] ?? '-'} !data=${s['!data'] ? 'sí' : 'no'} claves=${claves.slice(0, 4).join('|')}`
  })
  console.log('Hojas:', info.join('  ;;  '))
  try {
    const it = filasDelWorkbook(wb)
    const primera = it.next()
    if (primera.done || !primera.value || !Object.keys(primera.value).length) {
      console.log('>> RESULTADO: "el archivo no tiene filas legibles" ❌')
    } else {
      console.log('>> OK primera fila:', JSON.stringify(primera.value).slice(0, 140))
    }
  } catch (e) {
    console.log('>> generador THROWS:', e.message.slice(0, 120))
  }
}

// 1) CSV UTF-8
probar('CSV UTF-8 (,) ', Buffer.from('CODUTI,NOMUTI,FECHA,HORA,CODACT,BULTOS\nP11710,CARUSO,2026-07-06,06:12:01,004,1\nP11711,PEREZ,2026-07-06,06:15:30,002,3\n'))
// 2) CSV UTF-16 LE con BOM
const csv16 = Buffer.from('CODUTI,NOMUTI,FECHA,HORA,CODACT,BULTOS\nP11710,CARUSO,2026-07-06,06:12:01,004,1\n', 'utf16le')
probar('CSV UTF-16 LE BOM', Buffer.concat([Buffer.from([0xff, 0xfe]), csv16]))
// 3) CSV punto y coma
probar('CSV UTF-8 (;) ', Buffer.from('CODUTI;NOMUTI;FECHA;HORA;CODACT;BULTOS\nP11710;CARUSO;2026-07-06;06:12:01;004;1\n'))
// 4) XLSX con fila de título arriba (celda única en A1, encabezados en fila 2)
{
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([['Reporte de Producción Picking E-8'], filas[0], filas[1], filas[2]])
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  probar('XLSX con fila de título', out)
}
// 5) XLS (BIFF8)
{
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(filas)
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' })
  probar('XLS (BIFF8)', out)
}
// 6) XLSB
{
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(filas)
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsb' })
  probar('XLSB', out)
}
// 7) ODS
{
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(filas)
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'ods' })
  probar('ODS', out)
}
// 8) XLSX denso con !data (hoja 2 vacía primero + hoja con datos)
{
  const wb = XLSX.utils.book_new()
  const wsVacio = XLSX.utils.aoa_to_sheet([[]])
  XLSX.utils.book_append_sheet(wb, wsVacio, 'Portada')
  const ws = XLSX.utils.aoa_to_sheet(filas)
  XLSX.utils.book_append_sheet(wb, ws, 'Datos')
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  probar('XLSX portada vacía + datos', out)
}
// 9) XLSX hoja de "Portada" con título y datos en hoja 2
{
  const wb = XLSX.utils.book_new()
  const wsVacio = XLSX.utils.aoa_to_sheet([['REPORTE E-8'], ['generado 2026-09-20']])
  XLSX.utils.book_append_sheet(wb, wsVacio, 'Portada')
  const ws = XLSX.utils.aoa_to_sheet(filas)
  XLSX.utils.book_append_sheet(wb, ws, 'Datos')
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  probar('XLSX portada con título + datos hoja 2', out)
}
