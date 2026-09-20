import { NextRequest, NextResponse } from 'next/server'
import { bytesDeArchivo, listarDiags } from '@/lib/diag'

export const runtime = 'nodejs'
export const maxDuration = 60

// Diagnóstico remoto de subidas rechazadas por "el archivo no tiene filas
// legibles". Cuando ese error ocurre, /api/upload y /api/upload/procesar
// guardan un diagnóstico en UploadStage (fileId "diag:<id>") y CONSERVAN las
// partes del archivo en UploadChunk. Con esto se puede:
//
//   GET /api/upload/diag                      -> lista los últimos diagnósticos
//   GET /api/upload/diag?fileId=X&bytes=65536 -> devuelve los primeros N bytes
//                                                del archivo original (base64)
//
// Es solo lectura y no expone nada que el propio usuario no haya subido.
export async function GET(req: NextRequest) {
  try {
    const fileId = req.nextUrl.searchParams.get('fileId')
    if (fileId) {
      const max = Math.min(Math.max(Number(req.nextUrl.searchParams.get('bytes') ?? 65536), 64), 1024 * 1024)
      const res = await bytesDeArchivo(fileId.slice(0, 120), max)
      if (!res) {
        return NextResponse.json({ error: 'no hay partes guardadas para ese fileId (¿ya se reintentó la subida? cada intento borra las partes anteriores)' }, { status: 404 })
      }
      return NextResponse.json({ fileId, ...res })
    }
    const diags = await listarDiags()
    return NextResponse.json({ ok: true, cantidad: diags.length, diags })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 500 })
  }
}
