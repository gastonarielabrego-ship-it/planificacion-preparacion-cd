// Genera archivos de prueba problemáticos para el diagnóstico de "sin filas legibles"
const XLSX = require('xlsx')
const fs = require('fs')

const filas = [
  ['CODUTI', 'NOMUTI', 'FECHA', 'HORA', 'CODACT', 'ZONSTS', 'BULTOS', 'MINUTOS'],
  ['P11710', 'CARUSO ROMINA', '2026-07-06', '06:12:01', '004', 'S', 1, '0,5'],
  ['P11711', 'PEREZ JUAN', '2026-07-06', '06:15:30', '002', 'S', 3, '1,2'],
  ['P11712', 'GOMEZ ANA', '2026-07-06', '06:18:45', '004', 'T', 2, '0,8'],
]

// 1) Workbook totalmente VACÍO (hoja sin celdas)
{
  const wb = XLSX.utils.book_new()
  const ws = {}
  ws['!ref'] = 'A1:B2'
  XLSX.utils.book_append_sheet(wb, ws, 'Vacia')
  XLSX.writeFile(wb, '/tmp/test_vacio.xlsx', { bookType: 'xlsx' })
  console.log('creado /tmp/test_vacio.xlsx')
}
// ver ref: writeFile con sheet sin celdas puede fallar; alternativa: celdas con solo estilos
{
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([[]])
  ws['!ref'] = 'A1'
  XLSX.utils.book_append_sheet(wb, wb2ws(), 'Hoja1')
  function wb2ws() { return ws }
  XLSX.writeFile(wb, '/tmp/test_vacio2.xlsx', { bookType: 'xlsx' })
  console.log('creado /tmp/test_vacio2.xlsx')
}

// 2) SOLO fórmulas sin valores cacheados (celdas con f, sin v)
{
  const wb = XLSX.utils.book_new()
  const ws = {}
  ws['!ref'] = 'A1:H4'
  // encabezados como strings normales (con valor)
  const heads = filas[0]
  heads.forEach((h, i) => {
    const ref = XLSX.utils.encode_cell({ r: 0, c: i })
    ws[ref] = { t: 's', v: h }
  })
  // datos como fórmulas SIN v
  for (let r = 1; r < filas.length; r++) {
    for (let c = 0; c < 8; c++) {
      const ref = XLSX.utils.encode_cell({ r, c })
      ws[ref] = { t: 'n', f: `A${r + 1}&"${filas[r][c]}"` } // f sin v
    }
  }
  const wb2 = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb2, ws, 'Formulas')
  XLSX.writeFile(wb2, '/tmp/test_formulas.xlsx', { bookType: 'xlsx' })
  console.log('creado /tmp/test_formulas.xlsx')
}

// 3) Título arriba de los encabezados (debe seguir fallando el MAPEO, no el parseo)
{
  const wb = XLSX.utils.book_new()
  const aoa = [['REPORTE PRODUCCION PICKING E-8'], ...filas]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb2 = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb2, ws, 'Sheet1')
  XLSX.writeFile(wb2, '/tmp/test_titulo.xlsx', { bookType: 'xlsx' })
  console.log('creado /tmp/test_titulo.xlsx')
}

// 4) HTML guardado como .xlsx
fs.writeFileSync('/tmp/test_html.xlsx', Buffer.from('<html><body><table><tr><td>HOLA</td></tr></table></body></html>'))
console.log('creado /tmp/test_html.xlsx')

// 5) PDF con extensión xlsx
fs.writeFileSync('/tmp/test_pdf.xlsx', Buffer.from('%PDF-1.4 ...'))
console.log('creado /tmp/test_pdf.xlsx')

// 6) CSV UTF-16 con BOM (caso común de export WMS)
{
  const csv = 'CODUTI;NOMUTI;FECHA;HORA;CODACT;BULTOS\nP11710;CARUSO;2026-07-06;06:12:01;004;1\nP11711;PEREZ;2026-07-06;06:15:30;002;3\n'
  const b16 = Buffer.from(csv, 'utf16le')
  fs.writeFileSync('/tmp/test_csv16.xlsx', Buffer.concat([Buffer.from([0xff, 0xfe]), b16]))
  console.log('creado /tmp/test_csv16.xlsx (CSV UTF-16 con extensión .xlsx)')
}
