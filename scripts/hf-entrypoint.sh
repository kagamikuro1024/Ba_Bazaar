#!/usr/bin/env bash
set -Eeuo pipefail

export PATH="/usr/lib/postgresql/15/bin:${PATH}"
export NODE_ENV="${NODE_ENV:-production}"
export API_PORT="${API_PORT:-3001}"
export PUBLIC_PORT="${PORT:-${PUBLIC_PORT:-7860}}"
export WEB_DIST="${WEB_DIST:-/app/apps/web/dist}"
export API_INTERNAL_URL="${API_INTERNAL_URL:-http://127.0.0.1:${API_PORT}}"

API_PID=""
WEB_PID=""
EMBEDDED_DB="${EMBEDDED_DB:-0}"

cleanup() {
  trap - EXIT

  if [ -n "${WEB_PID}" ] && kill -0 "${WEB_PID}" 2>/dev/null; then
    kill "${WEB_PID}" 2>/dev/null || true
  fi

  if [ -n "${API_PID}" ] && kill -0 "${API_PID}" 2>/dev/null; then
    kill "${API_PID}" 2>/dev/null || true
  fi

  if [ "${EMBEDDED_DB}" = "1" ] && [ -n "${PGDATA:-}" ] && [ -s "${PGDATA}/postmaster.pid" ]; then
    pg_ctl -D "${PGDATA}" -m fast stop >/dev/null 2>&1 || true
  fi
}

trap cleanup INT TERM EXIT

if [ -z "${JWT_SECRET:-}" ]; then
  export JWT_SECRET
  JWT_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
  echo "JWT_SECRET was not provided; generated an ephemeral runtime secret."
fi

if [ -z "${CORS_ORIGIN:-}" ] && [ -n "${SPACE_HOST:-}" ]; then
  export CORS_ORIGIN="https://${SPACE_HOST}"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  EMBEDDED_DB="1"

  if [ -d /data ] && [ -w /data ]; then
    export PGDATA="${PGDATA:-/data/postgres}"
  else
    export PGDATA="${PGDATA:-/home/user/pgdata}"
  fi

  export PGSOCKET_DIR="${PGSOCKET_DIR:-/home/user/postgres-socket}"
  export PGHOST="${PGHOST:-127.0.0.1}"
  export PGPORT="${PGPORT:-5432}"
  export PGDATABASE="${PGDATABASE:-ba_bazaar}"
  export PGUSER="${PGUSER:-ba_bazaar}"
  export PGPASSWORD="${PGPASSWORD:-ba_bazaar}"
  export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}?schema=public"
  export HF_AUTO_SEED="${HF_AUTO_SEED:-true}"

  mkdir -p "${PGDATA}" "${PGSOCKET_DIR}"

  if [ ! -s "${PGDATA}/PG_VERSION" ]; then
    initdb -D "${PGDATA}" --encoding=UTF8 --locale=C --auth-local=trust --auth-host=scram-sha-256
  fi

  pg_ctl \
    -D "${PGDATA}" \
    -l "${PGDATA}/server.log" \
    -o "-c listen_addresses=127.0.0.1 -p ${PGPORT} -k ${PGSOCKET_DIR}" \
    start

  until pg_isready -h "${PGSOCKET_DIR}" -p "${PGPORT}" >/dev/null 2>&1; do
    sleep 1
  done

  DB_SUPERUSER="$(id -un)"

  psql -h "${PGSOCKET_DIR}" -p "${PGPORT}" -U "${DB_SUPERUSER}" -d postgres \
    -v ON_ERROR_STOP=1 \
    -v app_user="${PGUSER}" \
    -v app_password="${PGPASSWORD}" \
    -v app_db="${PGDATABASE}" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'app_db', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'app_db') \gexec
SQL
else
  export HF_AUTO_SEED="${HF_AUTO_SEED:-false}"
fi

cd /app/apps/api
./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma

if [ "${HF_AUTO_SEED}" = "true" ]; then
  USER_COUNT="$(psql "${DATABASE_URL}" -tAc 'select count(*) from users;' 2>/dev/null | tr -d '[:space:]' || true)"

  if [ -z "${USER_COUNT}" ] || [ "${USER_COUNT}" = "0" ]; then
    ./node_modules/.bin/tsx prisma/seed.ts
  fi
fi

node dist/main.js &
API_PID="$!"

until node -e "fetch(process.argv[1]).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" "http://127.0.0.1:${API_PORT}/health"; do
  if ! kill -0 "${API_PID}" 2>/dev/null; then
    wait "${API_PID}"
  fi
  sleep 1
done

node /app/scripts/hf-web-server.mjs &
WEB_PID="$!"

wait -n "${API_PID}" "${WEB_PID}"
