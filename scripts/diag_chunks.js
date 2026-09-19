// Diagnóstico: ¿el problema es el archivo o el armado por chunks?
const fs = require('fs')
const crypto = require('crypto')
const path = require('path')
process.chdir('/home/z/my-project')
const XLSX = require('xlsx')

const ruta = 'tmp/H61_GRANDE_TEST.xlsx'
const raw = fs.readFileSync(ruta)
console.log('archivo:', ruta, (raw.length / 1024 / 1024).toFixed(2), 'MB sha1=', crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12))

// 1) SheetJS puede leer el original?
try {
  const wb = XLSX.read(raw, { type: 'buffer', cellDates: true })
  console.log('[1] XLSX.read original OK, hojas:', wb.SheetNames.length)
} catch (e) {
  console.log('[1] XLSX.read original FALLA:', e.message)
  process.exit(0)
}

// 2) ciclo chunk -> b64 -> join -> decode
const TAM = 2 * 1024 * 1024
const total = Math.ceil(raw.length / TAM)
const partes = []
for (let i = 0; i < total; i++) partes.push(raw.subarray(i * TAM, (i + 1) * TAM).toString('base64'))
const b64 = partes.join('')
const buf = Buffer.from(b64, 'base64')
console.log('[2] rearmado:', (buf.length / 1024 / 1024).toFixed(2), 'MB sha1=', crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12), 'partes:', total, 'b64:', (b64.length / 1024 / 1024).toFixed(2), 'MB')
console.log('[2] bytes identicos:', raw.equals(buf))

// 3) ¿el JSON.stringify/parse altera el base64? (simula el viaje HTTP)
const rt = JSON.parse(JSON.stringify({ data: b64 })).data
console.log('[3] b64 intacto tras JSON:', rt === b64)
const buf2 = Buffer.from(rt, 'base64')
console.log('[3] bytes identicos tras JSON:', raw.equals(buf2))
