// Test de conexion directa al Neon original (bloqueado por cuota de transferencia)
const { Client } = require('pg')
const fs = require('fs')

const envFile = fs.readFileSync('/tmp/.env.vercel-original', 'utf8')
const get = (k) => {
  const line = envFile.split('\n').find((l) => l.startsWith(k + '='))
  if (!line) return null
  let v = line.split('=').slice(1).join('=')
  v = v.replace(/^"/, '').replace(/"$/, '')
  return v
}

async function tryConn(label, url, timeoutMs) {
  const c = new Client({ connectionString: url, connectionTimeoutMillis: timeoutMs, ssl: { rejectUnauthorized: false } })
  try {
    await c.connect()
    const r = await c.query('SELECT COUNT(*)::int AS n FROM "OlaDia"')
    console.log(`${label}: CONECTA ✓ | OlaDia = ${r.rows[0].n} filas`)
    await c.end()
    return true
  } catch (e) {
    console.log(`${label}: FALLA ✗ | ${e.message.split('\n')[0]}`)
    try { await c.end() } catch {}
    return false
  }
}

;(async () => {
  const pooled = get('POSTGRES_PRISMA_URL')
  const direct = get('POSTGRES_URL_NON_POOLING')
  const okP = await tryConn('POOLER  ', pooled, 15000)
  if (!okP) await tryConn('DIRECTO ', direct, 15000)
  process.exit(0)
})()
