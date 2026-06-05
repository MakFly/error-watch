#!/usr/bin/env bash
#
# db-reset.sh — Drop + recreate the dev database and restore it from a dump in data/.
#
# Targets the DB the app actually uses: the shared `infra-postgres` Docker container
# (localhost:5432, user/pwd test/test, DB errorwatch). See .claude/rules/database.md.
#
# The dumps in data/ are plain `pg_dump` SQL with --clean but WITHOUT --create, so we
# drop + recreate the database at the cluster level, then pipe the dump into it.
#
# Usage:
#   scripts/db-reset.sh                 # restore from the latest data/*.sql (with confirmation)
#   scripts/db-reset.sh path/to.sql     # restore from a specific dump (.sql or .sql.gz)
#   scripts/db-reset.sh -y              # skip the confirmation prompt
#   scripts/db-reset.sh --list          # list available dumps and exit
#
# Override defaults via env: PG_CONTAINER, PG_USER, PG_DB, DATA_DIR.
#
set -euo pipefail
shopt -s nullglob   # unmatched globs expand to nothing, not the literal pattern

# ── Config (overridable via env) ────────────────────────────────────────────
PG_CONTAINER="${PG_CONTAINER:-infra-postgres}"
PG_USER="${PG_USER:-test}"
PG_DB="${PG_DB:-errorwatch}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${DATA_DIR:-$PROJECT_ROOT/data}"

ASSUME_YES=0
DUMP=""

# ── Args ────────────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    -y|--yes)   ASSUME_YES=1 ;;
    --list)
      echo "Dumps in $DATA_DIR:"
      dumps=("$DATA_DIR"/*.sql "$DATA_DIR"/*.sql.gz)
      if (( ${#dumps[@]} )); then ls -1t "${dumps[@]}"; else echo "  (none)"; fi
      exit 0
      ;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "Unknown option: $arg" >&2; exit 2 ;;
    *)
      DUMP="$arg" ;;
  esac
done

# ── Resolve dump file ───────────────────────────────────────────────────────
if [[ -z "$DUMP" ]]; then
  # Most recent .sql / .sql.gz by mtime
  dumps=("$DATA_DIR"/*.sql "$DATA_DIR"/*.sql.gz)
  (( ${#dumps[@]} )) && DUMP="$(ls -1t "${dumps[@]}" | head -n1)"
fi
if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "✗ No dump found. Looked in: $DATA_DIR (pass a path or use --list)." >&2
  exit 1
fi

# ── Preconditions ───────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "✗ docker not found in PATH." >&2; exit 1
fi
if ! docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
  echo "✗ Container '$PG_CONTAINER' is not running." >&2
  echo "  Running postgres containers:" >&2
  docker ps --filter ancestor=postgres:16-alpine --format '    {{.Names}}\t{{.Ports}}' >&2 || true
  exit 1
fi

DUMP_SIZE="$(du -h "$DUMP" | cut -f1)"

# ── Confirm (destructive) ───────────────────────────────────────────────────
cat <<EOF

  ⚠  DESTRUCTIVE — this DROPs and recreates a database.

     Container : $PG_CONTAINER
     User      : $PG_USER
     Database  : $PG_DB        (will be DROPPED and recreated)
     Dump      : $DUMP  ($DUMP_SIZE)

EOF
if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "  Type the database name '$PG_DB' to confirm: " reply
  if [[ "$reply" != "$PG_DB" ]]; then
    echo "  Aborted." >&2; exit 1
  fi
fi

# ── Helpers ─────────────────────────────────────────────────────────────────
# psql against the maintenance DB (postgres) for cluster-level ops.
psql_admin() {
  docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d postgres "$@"
}

echo
echo "→ Terminating active connections to '$PG_DB'…"
psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$PG_DB' AND pid <> pg_backend_pid();" >/dev/null

echo "→ Dropping database '$PG_DB'…"
psql_admin -c "DROP DATABASE IF EXISTS \"$PG_DB\";"

echo "→ Creating database '$PG_DB' (owner $PG_USER)…"
psql_admin -c "CREATE DATABASE \"$PG_DB\" OWNER \"$PG_USER\";"

# Plain pg_dump (no --create) does NOT include CREATE ROLE — roles are global. The dump
# assigns ownership via `OWNER TO <role>`; create any referenced role that's missing so
# the restore doesn't fail with `role "<x>" does not exist`.
echo "→ Ensuring roles referenced by the dump exist…"
if [[ "$DUMP" == *.gz ]]; then ROLE_SRC=(gunzip -c "$DUMP"); else ROLE_SRC=(cat "$DUMP"); fi
ROLES="$("${ROLE_SRC[@]}" 2>/dev/null | grep -oE 'OWNER TO [^;]+;' | sed -E 's/OWNER TO //; s/;$//; s/"//g' | sort -u)"
while IFS= read -r role; do
  [[ -z "$role" || "$role" == "$PG_USER" ]] && continue
  echo "    • role '$role'"
  psql_admin -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$role') THEN CREATE ROLE \"$role\" LOGIN; END IF; END \$\$;"
done <<< "$ROLES"

echo "→ Restoring from $(basename "$DUMP") ($DUMP_SIZE)… this can take a while."
if [[ "$DUMP" == *.gz ]]; then
  gunzip -c "$DUMP" | docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB"
else
  docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" < "$DUMP"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
TABLES="$(docker exec -i "$PG_CONTAINER" psql -tAU "$PG_USER" -d "$PG_DB" \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" | tr -d '[:space:]')"

echo
echo "✓ Done. Database '$PG_DB' restored — $TABLES tables in schema 'public'."
