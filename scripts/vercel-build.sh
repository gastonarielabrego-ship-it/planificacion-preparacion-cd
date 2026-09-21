#!/usr/bin/env bash
# Build de Vercel: elige el schema de Prisma segun la base de datos disponible.
# Con la integracion Neon de Vercel, las vars POSTGRES_* estan presentes en build y runtime.
set -e
cd "$(dirname "$0")/.."

if [ -n "$POSTGRES_PRISMA_URL" ] || { [ -n "$DATABASE_URL" ] && echo "$DATABASE_URL" | grep -qiE '^postgres(ql)?://'; }; then
  echo "== PostgreSQL (Neon): usando schema.postgres.prisma y creando tablas si faltan =="
  cp prisma/schema.postgres.prisma prisma/schema.prisma
  npx prisma generate
  # staging descartable fuera del camino antes del push (libera espacio y evita
  # recreaciones in-place con la base llena; ver scripts/prepush-neon.cjs)
  node scripts/prepush-neon.cjs || true
  # db push solo hace falta para CREAR tablas si faltan; si la base no es
  # alcanzable (cuota de transferencia de Neon agotada, outage, IP allowlist)
  # NO debe romper el deploy: las tablas ya existen y la app es quien va a
  # reconectar en runtime.
  npx prisma db push --accept-data-loss --skip-generate \
    || echo "AVISO: base inaccesible durante el build; se omite db push y se continúa (las tablas ya existen)"
else
  echo "== Sin base Postgres configurada: build sin tocar la base =="
  npx prisma generate
fi

npx next build
