// Motor de normalizacion de motivos de tiempos muertos.
// Agrupa textos escritos de forma dispar (mayusculas/minusculas, tildes, typos)
// y detecta ubicaciones del tipo NAVE-PASILLO-POSICION (ej: E-11-124, A 5 17).

export interface Ubicacion {
  nave: string
  pasillo: string
  posicion: string
}

// Limpieza basica: mayusculas, sin tildes, sin dobles espacios
export function limpiar(txt: string | null | undefined): string {
  if (!txt) return ''
  return txt
    .toString()
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

// Correccion de typos frecuentes detectados en los datos
const TYPOS: Array<[RegExp, string]> = [
  [/REPAELTIZADO/g, 'REPALETIZADO'],
  [/REPALETISADO/g, 'REPALETIZADO'],
  [/BREAFING/g, 'BRIEFING'],
  [/BRIEFIN/g, 'BRIEFING'],
  [/BRIYING/g, 'BRIEFING'],
  [/BATERIA\b/g, 'BATERIA'],
  [/BAT\s/g, 'BATERIA '],
  [/SIN BAT\b/g, 'SIN BATERIA'],
  [/INFOLOG/g, 'INFOLOG'],
  [/INFLOG/g, 'INFOLOG'],
  [/SYMBOL/g, 'SYMBOL'],
  [/SIB SYMBOL/g, 'SIN SYMBOL'],
  [/PICKEAR/g, 'PICKING'],
  [/PICKING/g, 'PICKING'],
  [/PIKING/g, 'PICKING'],
  [/MERCADEIRA/g, 'MERCADERIA'],
  [/MERCA DISPO/g, 'MERCADERIA DISPONIBLE'],
  [/UBICACIO\b/g, 'UBICACION'],
  [/PASILIO/g, 'PASILLO'],
  [/PASIL\b/g, 'PASILLO'],
  [/ALMUERSO/g, 'ALMUERZO'],
  [/ALMUERZ\b/g, 'ALMUERZO'],
  [/COMIDAS\b/g, 'COMIDA'],
]

export function corregir(txtLimpio: string): string {
  let t = txtLimpio
  for (const [re, rep] of TYPOS) t = t.replace(re, rep)
  return t
}

// Ubicacion con guiones: E-11-124 / E-07-06 / D-12-66
const RE_UB_DASH = /\b([A-Z])-(\d{1,2})-(\d{1,3})\b/
// Ubicacion con espacios: A 5 17 / A 9 100 (luego de "ESPERA" u otro texto)
const RE_UB_SPACE = /\b([A-Z]) (\d{1,2}) (\d{1,3})\b/

export function parseUbicacion(txtLimpio: string): Ubicacion | null {
  let m = RE_UB_DASH.exec(txtLimpio)
  if (!m) m = RE_UB_SPACE.exec(txtLimpio)
  if (!m) return null
  const nave = m[1]
  const pasillo = String(parseInt(m[2], 10))
  const posicion = String(parseInt(m[3], 10))
  return { nave, pasillo, posicion }
}

export interface Clasificacion {
  categoria: string
  detalle: string | null
  nave: string | null
  pasillo: string | null
  posicion: string | null
}

export const CATEGORIAS = [
  'ESPERA UBICACION',
  'APRO',
  'NAVE',
  'PASILLO',
  'ESPERA PICKING',
  'SOPORTE',
  'SIN MERCADERIA',
  'EQUIPOS Y VEHICULOS',
  'SISTEMAS',
  'PAUSAS Y RRHH',
  'OTRAS TAREAS',
  'ORDEN Y LIMPIEZA',
  'REPALETIZADO',
  'FIN DE TURNO',
  'SIN DATO',
  'OTROS',
] as const

// Clasifica una observacion de tiempo muerto en una categoria estandar.
// Prioridad: ubicacion puntual > zonas (APRO/NAVE/PASILLO) > causas operativas.
export function clasificarMotivo(
  observacion: string | null | undefined,
  motivoCode: number | null,
): Clasificacion {
  const base = limpiar(observacion)
  const t = corregir(base)
  const vacio = !t || t === '.' || t === '-' || t === 'ESP' || t === 'ESPERA' || t === 'N/A' || t === 'X'

  const sinUb: Clasificacion = { categoria: '', detalle: t || null, nave: null, pasillo: null, posicion: null }

  // 1) Ubicacion puntual nave-pasillo-posicion (el foco del usuario)
  const ub = parseUbicacion(t)
  if (ub) {
    return {
      categoria: 'ESPERA UBICACION',
      detalle: t,
      nave: ub.nave,
      pasillo: ub.pasillo,
      posicion: ub.posicion,
    }
  }

  // 2) Zonas deinteres explicitas
  if (t.includes('APRO')) return { ...sinUb, categoria: 'APRO' }
  if (t.includes('NAVE')) return { ...sinUb, categoria: 'NAVE' }
  if (t.includes('PASILLO')) return { ...sinUb, categoria: 'PASILLO' }

  // 3) Causas operativas
  if (t.includes('PICKING') && (t.includes('ESPERA') || t.includes('SIN') || t.includes('FALTA')))
    return { ...sinUb, categoria: 'ESPERA PICKING' }
  if (
    t.includes('SOPORTE') ||
    t.includes('SOPT') ||
    t.includes('SOPORT')
  )
    return { ...sinUb, categoria: 'SOPORTE' }
  if (
    t.includes('SIN MERCADERIA') ||
    t.includes('MERCADERIA DISPONIBLE') ||
    t.includes('SIN REFERENCIAS') ||
    t.includes('SIN STOCK') ||
    t.includes('SIN MERCADERÍA')
  )
    return { ...sinUb, categoria: 'SIN MERCADERIA' }
  if (
    t.includes('BATERIA') ||
    t.includes('N20') ||
    t.includes('N-20') ||
    t.includes('TRANSF') ||
    t.includes('MONTACARGA') ||
    t.includes('EQUIPO') ||
    t.includes('VEHICULO')
  )
    return { ...sinUb, categoria: 'EQUIPOS Y VEHICULOS' }
  if (
    t.includes('SISTEMA') ||
    t.includes('SAP') ||
    t.includes('RF') ||
    t.includes('SYMBOL') ||
    t.includes('INFOLOG') ||
    t.includes('USUARIO BLOQUEADO') ||
    t.includes('NOTAS BLOQUEADAS') ||
    t.includes('BLOQUEAD') ||
    t.includes('SIN SISTEMA')
  )
    return { ...sinUb, categoria: 'SISTEMAS' }
  if (
    t.includes('ALMUERZO') ||
    t.includes('COMIDA') ||
    t.includes('BRIEFING') ||
    t.includes('MEDICO') ||
    t.includes('RRHH') ||
    t.includes('DELEGADO') ||
    t.includes('REUNION') ||
    t.includes('VALE') ||
    t.includes('BAÑO') ||
    t.includes('BANO')
  )
    return { ...sinUb, categoria: 'PAUSAS Y RRHH' }
  if (t.includes('REPALETIZADO') || t.includes('REPALETIZ'))
    return { ...sinUb, categoria: 'REPALETIZADO' }
  if (t.includes('OTRAS TAREAS')) return { ...sinUb, categoria: 'OTRAS TAREAS' }
  if (t.includes('ORDEN')) return { ...sinUb, categoria: 'ORDEN Y LIMPIEZA' }
  if (t.includes('LIMPIEZA')) return { ...sinUb, categoria: 'ORDEN Y LIMPIEZA' }
  if (t.includes('FIN DE PREPA') || t.includes('FIN PREPA') || t.includes('FIN DE TURNO') || t.includes('FIN TURNO'))
    return { ...sinUb, categoria: 'FIN DE TURNO' }
  if (t.includes('ESPERA')) return { ...sinUb, categoria: 'OTROS' }
  if (vacio) return { categoria: 'SIN DATO', detalle: null, nave: null, pasillo: null, posicion: null }

  // 4) Sin texto: usar el codigo de motivo como pista generica
  if (motivoCode === 999) return { categoria: 'SIN DATO', detalle: t || null, nave: null, pasillo: null, posicion: null }
  return { ...sinUb, categoria: 'OTROS' }
}

// Etiquetas legibles de los codigos de motivo del sistema (según analisis de datos)
export const ETIQUETAS_CODIGO: Record<number, string> = {
  1: 'Código 1',
  2: 'Código 2',
  3: 'Código 3 (briefing/rrhh)',
  4: 'Código 4 (espera/orden/equipo)',
  5: 'Código 5',
  6: 'Código 6 (tareas varias)',
  7: 'Código 7',
  8: 'Código 8 (sin referencias)',
  9: 'Código 9',
  10: 'Código 10 (tareas/pausas)',
  12: 'Código 12',
  999: 'Código 999 (turno completo)',
}

export function etiquetaCodigo(code: number | null): string {
  if (code == null) return 'Sin código'
  return ETIQUETAS_CODIGO[code] ?? `Código ${code}`
}
