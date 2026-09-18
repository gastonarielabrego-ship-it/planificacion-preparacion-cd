#!/usr/bin/env bash
# Build de Vercel: elige el schema de Prisma segun la base de datos disponible.
set -e
cd "$(dirname "$0")/.."

if [ -n "$DATABASE_URL" ] && echo "$DATABASE_URL" | grep -qiE '^postgres(ql)?://'; then
  echo "== DATABASE_URL es PostgreSQL (Neon): usando schema.postgres.prisma =="
  cp prisma/schema.postgres.prisma prisma/schema.prisma
  npx prisma generate
  npx prisma db push --accept-data-loss --skip-generate
else
  echo "== Sin DATABASE_URL de Postgres: build sin tocar la base =="
  npx prisma generate
fi

npx next build
