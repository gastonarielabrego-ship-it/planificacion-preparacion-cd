// Pipeline por pasos para la carga web de Picking (E-8): los archivos de eventos
// pueden tener cientos de miles de filas y procesarlos en una sola llamada al
// servidor supera el timeout de Vercel (HTTP 504). Este módulo soporta:
//   1) parseo:  workbook -> filas mapeadas -> UploadStage (JSON compacto por tandas)
//   2) insertar: UploadStage -> PickingEvento por tandas, con delete+insert atómicos
//   3) cerrar:  cierra el batch (UploadBatch)
// Cada paso es idempotente/reanudable: el cliente los invoca en bucle.

import { db } from '@/lib/db'

const TAM_TANDA_FILAS = 2000 // filas por registro UploadStage

export interface PickingMapeada {
  fecha: Date
  operario: string
  nombre: string | null
  horaMin: number | null
  bultos: number | null
  soporte: string | null
  circuito: string | null
  actividad: string | null
  zona: string | null
  ubicacion: string | null
  nivel: string | null
  minutos: number | null
}

// Codificación compacta (array posicional) para achicar el JSON en la DB:
// [fechaISO, operario, nombre, horaMin, bultos, soporte, circuito, actividad, zona, ubicacion, nivel, minutos]
export function filaAArray(m: PickingMapeada): unknown[] {
  return [
    m.fecha.toISOString().slice(0, 10),
    m.operario,
    m.nombre,
    m.horaMin,
    m.bultos,
    m.soporte,
    m.circuito,
    m.actividad,
    m.zona,
    m.ubicacion,
    m.nivel,
    m.minutos,
  ]
}

export function arrayAFila(a: unknown[], batch: string): Record<string, unknown> | null {
  if (!Array.isArray(a) || a.length !== 12) return null
  if (typeof a[0] !== 'string' || typeof a[1] !== 'string' || !a[1]) return null
  const fecha = new Date(`${a[0]}T00:00:00.000Z`)
  if (isNaN(fecha.getTime())) return null
  return {
    batch,
    fecha,
    operario: a[1],
    nombre: a[2] ?? null,
    horaMin: a[3] ?? null,
    bultos: a[4] ?? null,
    soporte: a[5] ?? null,
    circuito: a[6] ?? null,
    actividad: a[7] ?? null,
    zona: a[8] ?? null,
    ubicacion: a[9] ?? null,
    nivel: a[10] ?? null,
    minutos: a[11] ?? null,
  }
}

// Guarda una tanda de filas mapeadas en UploadStage como un único JSON
export async function guardarTanda(fileId: string, tanda: PickingMapeada[]) {
  if (!tanda.length) return
  await db.uploadStage.create({
    data: { fileId, data: JSON.stringify(tanda.map(filaAArray)) },
  })
}

const TAM_TANDA_INSERT = 25 // registros UploadStage por llamada (25 × 2000 = 50k filas máx)

// Inserta la próxima tanda de filas staged en PickingEvento y borra lo insertado
// (atómico: si falla algo no queda ni duplicado ni hueco). Devuelve cuántas
// filas insertó y cuántas quedan en stage.
export async function insertarTandaPicking(fileId: string): Promise<{ insertados: number; restantes: number }> {
  const lotes = await db.uploadStage.findMany({
    where: { fileId },
    orderBy: { id: 'asc' },
    take: TAM_TANDA_INSERT,
  })
  if (!lotes.length) return { insertados: 0, restantes: 0 }

  const batch = fileId
  const filas: Record<string, unknown>[] = []
  for (const l of lotes) {
    let arr: unknown
    try {
      arr = JSON.parse(l.data)
    } catch {
      continue // tanda corrupta: se descarta (se borra igual abajo)
    }
    if (!Array.isArray(arr)) continue
    for (const a of arr) {
      const f = arrayAFila(a, batch)
      if (f) filas.push(f)
    }
  }

  const ids = lotes.map((l) => l.id)
  await db.$transaction(async (tx) => {
    for (let i = 0; i < filas.length; i += 1000) {
      await tx.pickingEvento.createMany({ data: filas.slice(i, i + 1000) as never })
    }
    await tx.uploadStage.deleteMany({ where: { id: { in: ids } } })
  })

  const restantes = await db.uploadStage.count({ where: { fileId } })
  return { insertados: filas.length, restantes }
}

export const tamTandaFilas = TAM_TANDA_FILAS
