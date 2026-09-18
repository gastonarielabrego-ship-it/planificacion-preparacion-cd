#!/usr/bin/env bash
# Build de Vercel: elige el schema de Prisma segun la base de datos disponible.
# Con la integracion Neon de Vercel, las vars POSTGRES_* estan presentes en build y runtime.
set -e
cd "$(dirname "$0")/.."

if [ -n "$POSTGRES_PRISMA_URL" ] || { [ -n "$DATABASE_URL" ] && echo "$DATABASE_URL" | grep -qiE '^postgres(ql)?://'; }; then
  echo "== PostgreSQL (Neon): usando schema.postgres.prisma y creando tablas si faltan =="
  cp prisma/schema.postgres.prisma prisma/schema.prisma
  npx prisma generate
  npx prisma db push --accept-data-loss --skip-generate
else
  echo "== Sin base Postgres configurada: build sin tocar la base =="
  npx prisma generate
fi

npx next build
