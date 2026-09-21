// Prepush para el deploy en Vercel (Neon). Se ejecuta ANTES de `prisma db push`.
//
// Problema: Neon tiene un tope duro de proyecto (512 MB). El staging de subidas
// (UploadChunk con partes base64/texto) llenó la base y, además, el cambio de
// tipo de la columna `data` a bytea exige recrear la tabla, lo que no hay
// espacio para hacerlo in-place con la base llena.
//
// Solución: UploadChunk es staging descartable (cada reintento de subida vuelve
// a mandar todas las partes), así que se DROPea directamente — DROP libera los
// archivos en disco al instante, y `db push` la recrea con el tipo nuevo.
// UploadStage se vacía con DELETE (no cambia de tipo) y VACUUM marca el espacio
// como reutilizable. Nunca se tocan tablas de datos.
const { PrismaClient } = require('@prisma/client')

async function main() {
  const p = new PrismaClient()
  try {
    await p.$executeRawUnsafe(`DROP TABLE IF EXISTS "UploadChunk"`)
    console.log('prepush: UploadChunk eliminada (staging descartable, la recrea db push)')
    const stage = await p.uploadStage
      .deleteMany({})
      .then((r) => r.count)
      .catch(() => -1)
    console.log(`prepush: UploadStage limpiada (${stage} tandas)`)
    for (const t of ['UploadStage', 'UploadBatch']) {
      await p.$executeRawUnsafe(`VACUUM ANALYZE "${t}"`).catch(() => {})
    }
    console.log('prepush: VACUUM ok')
  } finally {
    await p.$disconnect().catch(() => {})
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    // no debe romper el deploy: db push puede seguir sin esto si la base ya está limpia
    console.error('prepush (no fatal):', e.message)
    process.exit(0)
  })
