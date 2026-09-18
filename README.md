# Planificación — Preparación CD

Aplicación web para **planificar el área de preparación de un centro de distribución** e identificar focos de mejora:
olas diarias, productividad por hora (H61), jornadas de 8 h vs 12 h con **extras**, **tiempos muertos** agrupados por
motivo normalizado (incluyendo **nave / pasillo / posición**) y **horas pico y valle**.

## Módulos

| Módulo | Qué resuelve |
|---|---|
| **Resumen** | KPIs generales + focos de mejora automáticos + últimas cargas de datos |
| **Planificación** | Demanda (ola + pendiente) vs preparación por día, dotación, días dependientes de extras y **simulador: qué pasa si se suprimen las extras** (faltante que quedaría como pendiente) |
| **Productividad H61** | Perfil 24 h con **hora pico y valle**, intensidad por turno×hora, circuitos, distribución de jornadas (8 h vs extras), ranking de operarios |
| **Tiempos muertos** | Pareto de motivos **agrupados y normalizados** (corrige mayúsculas/tildes/typos), explorador **por nave y pasillo** (detecta ubicaciones tipo “ESPERA E-11-124”), evolución diaria, cruce código×categoría |
| **Picking** | Tiempo muerto **entre pickings** y **entre soportes** (distribución de gaps), por operario y por día |
| **Carga de Datos** | Subida de los Excel + instrucciones del script Python para archivos grandes |

## Cómo funcionan las extras (8 h vs 12 h)

Cada operario-día se clasifica por sus horas con producción en el H61:

- **≤ 8 h** → jornada base.
- **> 8 h** → **horas extra** (típicamente jornadas de 12 h = 4 h extra).

La pestaña Planificación muestra qué días **dependen** de esas extras y cuántos bultos quedarían sin preparar
si se suprimieran (a productividad constante), es decir, el pendiente que se generaría o la dotación base a sumar.

## Carga de datos

Los archivos fuente (`.xlsx` / `.csv`) se cargan desde la pestaña **Carga de Datos** (cada carga reemplaza el dato previo de ese tipo):

1. **Ola y Pendiente** — matriz mensual (fechas en columnas, filas “Ola total” / “Pendiente” / “Total”).
2. **H61** — producción por hora por operario/circuito (una fila por operario-fecha-actividad-circuito).
3. **Tiempos muertos** — eventos con MOTIVO, OBSERVACION y minutos.
4. **Producción por picking** — log de eventos para el análisis entre pickings/soportes.

### Archivo grande (excede el chat / el límite de Vercel ~4,5 MB)

Usá el script `python/subir_archivo.py`:

```bash
pip install pandas openpyxl requests

# archivo de picking (por lotes, sin límite de tamaño)
python python/subir_archivo.py --tipo picking --archivo "produccion picking.xlsx" --url https://TU-APP.vercel.app

# también sirve para el H61
python python/subir_archivo.py --tipo h61 --archivo H61.xlsx --url https://TU-APP.vercel.app

# en desarrollo local
python python/subir_archivo.py --tipo picking --archivo picking.xlsx   # default: http://localhost:3000
```

El script **auto-detecta** las columnas (fecha, operario, hora, bultos, soporte, circuito).
Si tu archivo usa otros nombres, ajustá el diccionario `MAPEO_PICKING` al inicio del script.

## Desarrollo local

```bash
bun install            # o npm install
cp .env.example .env   # SQLite local
bun run db:push
bun run dev            # http://localhost:3000
```

## Despliegue en Vercel + Neon (PostgreSQL)

El proyecto está listo para producción con **Prisma + PostgreSQL (Neon)**:

1. Creá la base en [Neon](https://neon.tech) y copiá el *connection string* (algo como
   `postgresql://usuario:password@ep-xxxx.neon.tech/neondb?sslmode=require`).
2. Si deployás por CLI, exportalo como `DATABASE_URL` antes del build, o cargalo en
   **Vercel → Settings → Environment Variables**.
3. El build de Vercel (`scripts/vercel-build.sh`) detecta que `DATABASE_URL` es Postgres,
   usa `prisma/schema.postgres.prisma`, genera el cliente y crea las tablas (`prisma db push`).
4. Deploy:

```bash
npm i -g vercel
vercel --prod --token TU_TOKEN_VERCEL
```

Tras el deploy, cargá los datos (UI o script Python) y la app queda operativa.

## Estructura

```
src/
  app/api/
    upload/   carga de archivos xlsx/csv (FormData)
    seed/     carga desde carpeta del servidor (archivos grandes, sandbox)
    batch/    lotes JSON para el script Python
    data/     agregaciones por módulo (resumen/planificacion/h61/tm/picking)
    status/   estado de los datasets
    reset/    limpieza de datos
  lib/
    ingest.ts     pipeline de ingesta + pre-agregados de H61
    xlsx.ts       parser (incluye la matriz mensual de Ola)
    normaliza.ts  normalización de motivos + parser de ubicaciones (nave-pasillo-posición)
    agg.ts        agregaciones para el dashboard
  components/dash/  módulos del dashboard (React + shadcn/ui + recharts)
python/subir_archivo.py  uploader para archivos grandes
```

## Notas del modelo de datos

- Turnos: **M** mañana, **T** tarde, **N** noche (cruce de medianoche: las primeras 6 h del turno noche se asignan al día calendario siguiente en el perfil 24 h).
- `ESTADO = 'B'` en tiempos muertos = registros de baja (errores de carga); se excluyen por defecto (toggle en la pestaña).
- `MINUTOS_AJUSTE` reemplaza a `MINUTOS` cuando existe (minutos efectivos).
- Los códigos de MOTIVO del WMS no rotulan el motivo real; la agrupación se hace por texto normalizado de `OBSERVACION`.
