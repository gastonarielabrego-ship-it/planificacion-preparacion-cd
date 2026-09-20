// Diagnóstico: replicar el parseo del server (XLSX.read dense + filasDelWorkbook)
// sobre el archivo REAL de picking para ver por qué no rinde filas.
const XLSX = require('xlsx')
const fs = require('fs')
const path = require('path')

const archivo = process.argv[2] || '/home/z/my-project/scripts/test_cargas/produccion picking 2026.xlsx'
console.log('Archivo:', archivo)
const buf = fs.readFileSync(archivo)
console.log('Tamaño:', (buf.length / 1024).toFixed(1), 'KB', '| primeros bytes:', buf.slice(0, 4).toString('hex'), '(504b=xlsx, d0cf=xls viejo)')

function filasDeHojaDensa(cantFilas, leer, liberar) {
  let headers = null
  const out = []
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
    out.push(obj)
    if (out.length >= 3) break
  }
  return { headers, out }
}

function* filasDelWorkbook(wb) {
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    const data = sheet['!data']
    if (data) {
      yield* (function* () {
        let headers = null
        for (let r = 0; r < data.length; r++) {
          const fila = data[r]
          data[r] = undefined
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
      })()
      continue
    }
    if (!sheet['!ref']) continue
    const rango = XLSX.utils.decode_range(sheet['!ref'])
    yield* (function* () {
      let headers = null
      for (let r = 0; r < rango.e.r + 1; r++) {
        const fila = sheet[String(r)] // ⚠️ misma lógica del server: clave numérica
        sheet[String(r)] = undefined
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
    })()
  }
}

for (const dense of [true, false]) {
  console.log('\n===== dense:', dense, '=====')
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, dense })
  console.log('Hojas:', JSON.stringify(wb.SheetNames))
  for (const name of wb.SheetNames) {
    const s = wb.Sheets[name]
    const data = s['!data']
    console.log(`- Hoja "${name}": !ref=${s['!ref'] ?? '(sin ref)'} | !data=${data ? `sí, ${data.length} filas` : 'NO'}`)
    if (data && data.length) {
      const primera = data[0]
      const conValores = primera ? primera.filter(Boolean).length : 0
      console.log(`  primera fila densa: ${primera ? conValores + ' celdas con objeto' : 'vacía'}`)
      if (primera && conValores) console.log('  muestra:', JSON.stringify(primera.slice(0, 8).map((c) => (c ? c.v : null))))
    }
    if (!data && s['!ref']) {
      const rango = XLSX.utils.decode_range(s['!ref'])
      // mostrar qué claves tiene el sheet (sparse mode)
      const claves = Object.keys(s).filter((k) => !k.startsWith('!')).slice(0, 8)
      console.log(`  claves estilo celda (sparse): ${claves.join(', ') || '(ninguna)'}`)
      const json = XLSX.utils.sheet_to_json(s, { defval: null, raw: true })
      console.log(`  sheet_to_json filas: ${json.length}`)
      if (json.length) console.log('  primera fila json:', JSON.stringify(json[0]).slice(0, 300))
    }
  }
  const it = filasDelWorkbook(wb)
  const primera = it.next()
  console.log('>> filasDelWorkbook primera:', primera.done ? 'DONE (sin filas)' : JSON.stringify(primera.value).slice(0, 300))
}
