#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() {
  printf 'LedgerHarbour: %s\n' "$*" >&2
  exit 1
}

mode=${1:-}
[[ $# -le 1 && ( -z $mode || $mode == --check ) ]] || fail 'Uso: production.sh [--check]'

repo=https://github.com/andresleosan/LedgerHarbour.git
api=https://api.github.com/repos/andresleosan/LedgerHarbour/actions/workflows/ci.yml/runs
branch=refs/heads/main
site=https://ledgerharbour.pages.dev
state=${LEDGERHARBOUR_RELEASE_STATE:?Indica el directorio privado de publicación}
[[ -d $state && ! -L $state && -O $state && $(stat -c %a -- "$state") == 700 ]] ||
  fail 'El directorio de publicación debe pertenecer al operador y tener permisos 0700.'
exec 9>"$state/release.lock"
flock -n 9 || exit 0

remote_main() {
  git ls-remote --exit-code "$repo" "$branch" | cut -f1
}

revision=$(remote_main)
[[ $revision =~ ^[0-9a-f]{40}$ ]] || fail 'GitHub no devolvió un commit válido de main.'
runs=$(curl -fsS --connect-timeout 8 --max-time 20 --get "$api" \
  --data-urlencode 'branch=main' --data-urlencode 'event=push' \
  --data-urlencode "head_sha=$revision" --data-urlencode 'per_page=1')
if ! jq -e --arg sha "$revision" '
  .workflow_runs[0] |
  .event == "push" and .head_branch == "main" and .head_sha == $sha
    and .status == "completed" and .conclusion == "success"
' >/dev/null <<<"$runs"; then
  printf 'LedgerHarbour: esperando CI verde para %s.\n' "$revision"
  exit 0
fi

if [[ $mode == --check ]]; then
  printf 'LedgerHarbour: %s es el tip de main y tiene CI verde.\n' "$revision"
  exit 0
fi

: "${LEDGERHARBOUR_RUNTIME_ENV:?Indica el archivo de entorno de producción}"
: "${LEDGERHARBOUR_DB_COMPOSE:?Indica el Compose privado de la red de PostgreSQL}"
: "${LEDGERHARBOUR_ORIGIN_PORT:?Indica el puerto de loopback reservado}"
[[ $LEDGERHARBOUR_ORIGIN_PORT =~ ^[0-9]{1,5}$ ]] || fail 'Puerto de origen inválido.'
compose_file=$state/compose.production.yaml
for file in "$LEDGERHARBOUR_RUNTIME_ENV" "$LEDGERHARBOUR_DB_COMPOSE" "$compose_file"; do
  [[ $file = /* && -f $file && ! -L $file && -O $file && $(stat -c %a -- "$file") == 600 ]] ||
    fail 'Los archivos de entorno y Compose deben ser privados, absolutos y tener permisos 0600.'
done
export LEDGERHARBOUR_RUNTIME_ENV LEDGERHARBOUR_ORIGIN_PORT

gitdir=$state/source.git
[[ -d $gitdir ]] || git init --quiet --bare --template= "$gitdir"
git --git-dir="$gitdir" fetch --quiet --depth=1 --no-tags "$repo" "$branch"
[[ $(git --git-dir="$gitdir" rev-parse FETCH_HEAD) == "$revision" ]] ||
  fail 'main avanzó durante la verificación. Se comprobará de nuevo en la próxima ejecución.'

migration_tree=$(git --git-dir="$gitdir" rev-parse "$revision:src/db/migrations")
[[ -r $state/verified-migrations && $(<"$state/verified-migrations") == "$migration_tree" ]] ||
  fail 'Hay migraciones pendientes de verificar en PostgreSQL. Se conserva la versión actual.'

build=$(mktemp -d "$state/build.XXXXXXXX")
trap 'rm -rf -- "$build"' EXIT
git --git-dir="$gitdir" archive "$revision" | tar -x -C "$build"
image=ledgerharbour:$revision

compose() {
  LEDGERHARBOUR_IMAGE=$1 docker compose --env-file /dev/null \
    -f "$compose_file" -f "$LEDGERHARBOUR_DB_COMPOSE" "${@:2}"
}

probe() {
  local code
  code=$(curl -sS --connect-timeout 3 --max-time 5 -o /dev/null -w '%{http_code}' "$1/login" 2>/dev/null) &&
    [[ $code == 200 ]]
}

wait_for_login() {
  local attempt
  for attempt in {1..15}; do
    probe "$1" && return 0
    sleep 2
  done
  return 1
}

running=$(compose "$image" ps -q app)
previous=
if [[ -n $running ]]; then
  previous=$(docker inspect --format '{{.Config.Image}}' "$running")
fi
if [[ $previous == "$image" ]] && probe "$site"; then
  printf 'LedgerHarbour: %s ya está en producción.\n' "$revision"
  exit 0
fi

if [[ $(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image" 2>/dev/null || true) != "$revision" ]]; then
  docker build --label "org.opencontainers.image.revision=$revision" --tag "$image" "$build"
fi

if ! compose "$image" run --rm --no-deps -T --entrypoint node app -e '
  const { Client } = require("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  (async () => {
    try {
      await client.connect();
      await client.query("BEGIN READ ONLY");
      await client.query("SELECT 1 FROM public.businesses LIMIT 1");
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  })().catch(() => { process.exitCode = 1; });
' >/dev/null 2>&1; then
  fail 'La imagen candidata no pudo consultar PostgreSQL con el rol de la aplicación.'
fi

[[ $(remote_main) == "$revision" ]] ||
  fail 'main avanzó antes de publicar. Se conserva la versión actual.'

origin=http://127.0.0.1:$LEDGERHARBOUR_ORIGIN_PORT
if compose "$image" up -d --no-deps app &&
  wait_for_login "$origin" && wait_for_login "$site"; then
  printf 'LedgerHarbour: %s publicado y verificado en %s.\n' "$revision" "$site"
  exit 0
fi

if [[ -n $previous && $previous != "$image" ]]; then
  compose "$previous" up -d --no-deps app && wait_for_login "$origin" ||
    fail 'Falló la comprobación y la recuperación del origen.'
elif [[ -z $previous ]]; then
  compose "$image" stop app || fail 'Falló la comprobación y la detención del candidato.'
fi
fail 'Falló la comprobación de la publicación. Revisa el origen y Pages.'
