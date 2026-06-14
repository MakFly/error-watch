#!/usr/bin/env bash
# =============================================================================
# example-bootstrap.sh — one-shot orchestrator for examples/<NAME>
# Usage: scripts/example-bootstrap.sh <NAME> [up|down|reset|status]
#   NAME = symfony | laravel
#   action defaults to "up"
#
# What "up" does (idempotent):
#   1. Verify local deps (php, composer, bun, curl, jq).
#   2. Verify ErrorWatch API is reachable at $ERRORWATCH_API_URL.
#   3. Install example deps (composer install) if missing.
#   4. If no API key cached in examples/<NAME>/.env, hit /api/v1/dev/seed-example
#      to provision org+project+key, then write the resulting key into .env.
#   5. Start the example server in background, write PID file.
#   6. Trigger the per-example data generators so the dashboard fills up.
#   7. Print the dashboard URL.
# =============================================================================
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
DIM='\033[2m'
RESET='\033[0m'

NAME="${1:-}"
ACTION="${2:-up}"

if [ -z "$NAME" ]; then
  echo -e "${RED}Usage: $0 <symfony|laravel> [up|down|reset|status]${RESET}"
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

API_URL="${ERRORWATCH_API_URL:-http://localhost:3333}"
WEB_URL="${ERRORWATCH_WEB_URL:-http://localhost:4001}"

# ---- per-example config ----
case "$NAME" in
  symfony)
    EXAMPLE_DIR="examples/example-symfony"
    PORT="${EXAMPLE_SYMFONY_PORT:-8088}"
    PID_FILE="$EXAMPLE_DIR/var/run.pid"
    LOG_FILE="$EXAMPLE_DIR/var/server.log"
    PLATFORM="symfony"
    ;;
  laravel)
    EXAMPLE_DIR="examples/laravel-api"
    PORT="${EXAMPLE_LARAVEL_PORT:-8008}"
    PID_FILE="$EXAMPLE_DIR/storage/run.pid"
    LOG_FILE="$EXAMPLE_DIR/storage/server.log"
    PLATFORM="laravel"
    ;;
  *)
    echo -e "${RED}Unknown example: $NAME (expected symfony or laravel)${RESET}"
    exit 2
    ;;
esac

ENV_FILE="$EXAMPLE_DIR/.env"
ENV_EXAMPLE="$EXAMPLE_DIR/.env.example"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo -e "${RED}Missing dependency: $1${RESET}"
    exit 1
  }
}

server_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

# Returns the PID listening on $PORT, or empty string.
port_pid() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p {if (match($0, /pid=[0-9]+/)) { s=substr($0, RSTART+4, RLENGTH-4); print s; exit }}'
  fi
}

# Kill whatever holds $PORT (dev-only, fine to be aggressive).
free_port() {
  local pid
  pid=$(port_pid || true)
  if [ -n "$pid" ]; then
    echo -e "${YELLOW}  Port $PORT held by PID $pid — releasing it${RESET}"
    kill "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$PID_FILE" 2>/dev/null || true
}

stop_server() {
  if server_running; then
    local pid
    pid=$(cat "$PID_FILE")
    kill "$pid" 2>/dev/null || true
    sleep 1
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo -e "${GREEN}Stopped $NAME server (PID $pid)${RESET}"
  else
    rm -f "$PID_FILE" 2>/dev/null || true
    local orphan
    orphan=$(port_pid || true)
    if [ -n "$orphan" ]; then
      echo -e "${YELLOW}Orphan listener on :$PORT (PID $orphan) — killing${RESET}"
      kill "$orphan" 2>/dev/null || true
      sleep 1
      kill -9 "$orphan" 2>/dev/null || true
    else
      echo -e "${DIM}$NAME server not running${RESET}"
    fi
  fi
}

print_status() {
  if server_running; then
    echo -e "${GREEN}● $NAME${RESET}  PID $(cat "$PID_FILE")  port $PORT"
  else
    echo -e "${DIM}○ $NAME  (stopped)${RESET}"
  fi
}

# -------------------------------------------------------------------- ACTIONS
case "$ACTION" in
  status)
    print_status
    exit 0
    ;;
  down)
    stop_server
    exit 0
    ;;
  reset)
    stop_server
    case "$NAME" in
      symfony)
        rm -rf "$EXAMPLE_DIR/vendor" "$EXAMPLE_DIR/var" "$EXAMPLE_DIR/composer.lock"
        ;;
      laravel)
        rm -rf "$EXAMPLE_DIR/vendor" "$EXAMPLE_DIR/composer.lock" \
               "$EXAMPLE_DIR/storage/run.pid" "$EXAMPLE_DIR/storage/server.log" \
               "$EXAMPLE_DIR/database/database.sqlite"
        ;;
    esac
    rm -f "$ENV_FILE"
    echo -e "${GREEN}✓ Reset $NAME — run 'make example NAME=$NAME' to reinstall.${RESET}"
    exit 0
    ;;
  up)
    : # fall through
    ;;
  *)
    echo -e "${RED}Unknown action: $ACTION (expected up|down|reset|status)${RESET}"
    exit 2
    ;;
esac

echo -e "${CYAN}=== Bootstrap example: $NAME ===${RESET}"

# ---- 1. dep checks ----
require_cmd php
require_cmd composer
require_cmd curl

# ---- 2. API reachable ----
if ! curl -fsS -o /dev/null --max-time 3 "$API_URL/health" 2>/dev/null \
   && ! curl -fsS -o /dev/null --max-time 3 "$API_URL/" 2>/dev/null; then
  echo -e "${RED}ErrorWatch API not reachable at $API_URL${RESET}"
  echo -e "${YELLOW}  Run 'make infra-up && make dev' first.${RESET}"
  exit 1
fi

# ---- 3. install deps ----
if [ ! -d "$EXAMPLE_DIR/vendor" ]; then
  echo -e "${YELLOW}Installing composer dependencies in $EXAMPLE_DIR...${RESET}"
  (cd "$EXAMPLE_DIR" && composer install --no-interaction --prefer-dist --quiet)
fi

# ---- 4. ensure .env + API key ----
mkdir -p "$(dirname "$PID_FILE")"

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    echo -e "${DIM}Created $ENV_FILE from .env.example${RESET}"
  else
    : > "$ENV_FILE"
  fi
fi

CURRENT_KEY=$(grep -E "^ERRORWATCH_API_KEY=" "$ENV_FILE" | tail -1 | cut -d'=' -f2- || true)
NEEDS_SEED=true
case "$CURRENT_KEY" in
  ""|"change-me"|"your-project-api-key"|"\"change-me\""|"\"your-project-api-key\"") NEEDS_SEED=true ;;
  *) NEEDS_SEED=false ;;
esac

# Override: if EXAMPLE_API_KEY is set in the env (passed via `make example NAME=… KEY=…`),
# pin the example to that key instead of auto-seeding a new workspace. Useful to push
# fake data into an existing project the user already created in the dashboard.
if [ -n "${EXAMPLE_API_KEY:-}" ]; then
  case "$EXAMPLE_API_KEY" in
    ew_live_*|ew_test_*) ;;
    *)
      echo -e "${RED}EXAMPLE_API_KEY does not look like an ErrorWatch key (expected prefix ew_live_ or ew_test_)${RESET}"
      exit 1
      ;;
  esac
  echo -e "${YELLOW}Pinning example to provided API key (skipping auto-seed)${RESET}"
  {
    grep -vE "^ERRORWATCH_(ENABLED|ENDPOINT|API_KEY|PROTOCOL|PROFILER|SERVER_NAME|GIT_COMMIT|GIT_BRANCH|GIT_DIRTY|TRANSPORT_MODE)=" "$ENV_FILE" 2>/dev/null || true
    echo "ERRORWATCH_ENABLED=true"
    echo "ERRORWATCH_ENDPOINT=$API_URL"
    echo "ERRORWATCH_API_KEY=$EXAMPLE_API_KEY"
  } > "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  NEEDS_SEED=false

  # Resolve key → (orgSlug, projectSlug) for the dashboard URL we print at the end.
  LOOKUP_PAYLOAD=$(printf '{"key":"%s"}' "$EXAMPLE_API_KEY")
  LOOKUP_RESPONSE=$(curl -fsS -X POST "$API_URL/api/v1/dev/lookup-key" \
    -H "Content-Type: application/json" -d "$LOOKUP_PAYLOAD" 2>/dev/null || true)
  if [ -n "$LOOKUP_RESPONSE" ]; then
    if command -v jq >/dev/null 2>&1; then
      ORG_SLUG=$(printf '%s' "$LOOKUP_RESPONSE" | jq -r '.organization.slug // empty')
      PROJECT_SLUG=$(printf '%s' "$LOOKUP_RESPONSE" | jq -r '.project.slug // empty')
    else
      read -r ORG_SLUG PROJECT_SLUG <<EOF
$(printf '%s' "$LOOKUP_RESPONSE" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("organization",{}).get("slug",""), d.get("project",{}).get("slug",""))')
EOF
    fi
    if [ -n "$ORG_SLUG" ] && [ -n "$PROJECT_SLUG" ]; then
      echo -e "${GREEN}  ✓ Pinned to org=$ORG_SLUG project=$PROJECT_SLUG${RESET}"
    fi
  else
    ORG_SLUG=""
    PROJECT_SLUG=""
    echo -e "${YELLOW}  Could not resolve project for that key (continuing anyway).${RESET}"
  fi
fi

if [ "$NEEDS_SEED" = "true" ]; then
  echo -e "${YELLOW}Seeding example workspace via $API_URL/api/v1/dev/seed-example...${RESET}"
  SEED_PAYLOAD=$(printf '{"name":"%s","platform":"%s"}' "$NAME" "$PLATFORM")
  SEED_RESPONSE=$(curl -fsS -X POST "$API_URL/api/v1/dev/seed-example" \
    -H "Content-Type: application/json" \
    -d "$SEED_PAYLOAD")

  if command -v jq >/dev/null 2>&1; then
    API_KEY=$(printf '%s' "$SEED_RESPONSE" | jq -r '.apiKey.key // empty')
    ORG_SLUG=$(printf '%s' "$SEED_RESPONSE" | jq -r '.organization.slug // empty')
    PROJECT_SLUG=$(printf '%s' "$SEED_RESPONSE" | jq -r '.project.slug // empty')
  else
    require_cmd python3
    read -r API_KEY ORG_SLUG PROJECT_SLUG <<EOF
$(printf '%s' "$SEED_RESPONSE" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("apiKey",{}).get("key",""), d.get("organization",{}).get("slug",""), d.get("project",{}).get("slug",""))')
EOF
  fi

  if [ -z "$API_KEY" ] || [ "$API_KEY" = "null" ]; then
    echo -e "${RED}Failed to extract API key from seed response:${RESET}"
    echo "$SEED_RESPONSE"
    exit 1
  fi

  # Write/overwrite ERRORWATCH_* in .env
  {
    grep -vE "^ERRORWATCH_(ENABLED|ENDPOINT|API_KEY|PROTOCOL|PROFILER|SERVER_NAME|GIT_COMMIT|GIT_BRANCH|GIT_DIRTY|TRANSPORT_MODE)=" "$ENV_FILE" 2>/dev/null || true
    echo "ERRORWATCH_ENABLED=true"
    echo "ERRORWATCH_ENDPOINT=$API_URL"
    echo "ERRORWATCH_API_KEY=$API_KEY"
  } > "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  echo -e "${GREEN}  ✓ Seeded org=$ORG_SLUG project=$PROJECT_SLUG${RESET}"
else
  # Existing key path: still enforce the profiler demo transport/settings so
  # rerunning the example validates the dashboard's real profile sections.
  {
    grep -vE "^ERRORWATCH_(ENABLED|ENDPOINT|API_KEY|PROTOCOL|PROFILER|SERVER_NAME|GIT_COMMIT|GIT_BRANCH|GIT_DIRTY|TRANSPORT_MODE)=" "$ENV_FILE" 2>/dev/null || true
    echo "ERRORWATCH_ENABLED=true"
    echo "ERRORWATCH_ENDPOINT=$API_URL"
    echo "ERRORWATCH_API_KEY=$CURRENT_KEY"
  } > "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"

  # Re-derive ORG_SLUG / PROJECT_SLUG for the dashboard URL print at the end,
  # unless they were already filled by the EXAMPLE_API_KEY lookup above.
  : "${ORG_SLUG:=errorwatch-examples}"
  : "${PROJECT_SLUG:=$NAME}"
fi

# ---- 5. Per-example post-install (Laravel needs key:generate + sqlite + migrate) ----
case "$NAME" in
  laravel)
    pushd "$EXAMPLE_DIR" >/dev/null
    if grep -q "^APP_KEY=$" .env || ! grep -q "^APP_KEY=" .env; then
      php artisan key:generate --quiet --force
    fi
    [ -f database/database.sqlite ] || touch database/database.sqlite
    php artisan migrate --force --quiet 2>/dev/null || true
    php artisan db:seed --force --quiet 2>/dev/null || true
    popd >/dev/null
    ;;
  symfony)
    # SQLite Doctrine schema + sample data (idempotent, the command no-ops if already set up)
    (cd "$EXAMPLE_DIR" && php bin/console app:setup-db --quiet 2>/dev/null) || true
    ;;
esac

# ---- 6. start server (background) ----
if server_running; then
  echo -e "${DIM}Server already running (PID $(cat "$PID_FILE"))${RESET}"
else
  free_port
  mkdir -p "$(dirname "$LOG_FILE")"
  case "$NAME" in
    symfony)
      (cd "$EXAMPLE_DIR" && exec php -S "0.0.0.0:$PORT" -t public public/index.php) > "$LOG_FILE" 2>&1 &
      ;;
    laravel)
      (cd "$EXAMPLE_DIR" && exec php artisan serve --port="$PORT" --host=0.0.0.0) > "$LOG_FILE" 2>&1 &
      ;;
  esac
  echo $! > "$PID_FILE"
  sleep 2
  if server_running; then
    echo -e "${GREEN}  ✓ Started $NAME on http://localhost:$PORT (PID $(cat "$PID_FILE"))${RESET}"
  else
    echo -e "${RED}  Failed to start server. See $LOG_FILE${RESET}"
    tail -n 20 "$LOG_FILE" 2>/dev/null || true
    exit 1
  fi
fi

# ---- 7. trigger data generation ----
echo -e "${YELLOW}Generating sample data...${RESET}"
hit() {
  # 5xx is expected (trigger routes throw on purpose) — only -s -o discard, no -f.
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$1" || echo "000")
  printf "  %b%s%b  %s\n" "$DIM" "$code" "$RESET" "$1"
}
case "$NAME" in
  symfony)
    for flavour in runtime type logic; do
      hit "http://localhost:$PORT/trigger/error?flavour=$flavour"
    done
    for route in http-call cache log slow-query db-list db-n-plus-one; do
      hit "http://localhost:$PORT/trigger/$route"
    done
    (cd "$EXAMPLE_DIR" && for i in 1 2 3; do php bin/console app:cron:demo --quiet 2>/dev/null || true; done) || true
    ;;
  laravel)
    for i in 1 2 3 4 5; do
      hit "http://localhost:$PORT/api/v1/test/error?sample=$i"
    done
    for i in 1 2 3; do
      hit "http://localhost:$PORT/api/v1/test/warning?sample=$i"
      hit "http://localhost:$PORT/api/v1/test/perf/slow?sample=$i"
      hit "http://localhost:$PORT/api/v1/test/perf/n-plus-one?sample=$i"
      hit "http://localhost:$PORT/api/v1/test/perf/cache?sample=$i"
    done
    for i in 1 2; do
      hit "http://localhost:$PORT/api/v1/test/divide-by-zero?sample=$i"
    done
    hit "http://localhost:$PORT/api/v1/test/perf/external-call?sample=1"
    ;;
esac
echo -e "${GREEN}  ✓ Sample data sent.${RESET}"

# ---- 8. final summary ----
echo ""
echo -e "${GREEN}=== $NAME example ready ===${RESET}"
echo -e "  Server:    ${CYAN}http://localhost:$PORT${RESET}"
echo -e "  Logs:      ${DIM}$LOG_FILE${RESET}"
if [ -n "$ORG_SLUG" ] && [ -n "$PROJECT_SLUG" ]; then
  echo -e "  Dashboard: ${CYAN}$WEB_URL/dashboard/$ORG_SLUG/$PROJECT_SLUG/issues${RESET}"
else
  echo -e "  Dashboard: ${CYAN}$WEB_URL/dashboard${RESET} ${DIM}(open your project's Issues page)${RESET}"
fi
echo ""
echo -e "  Stop:  ${CYAN}make example-down NAME=$NAME${RESET}"
echo -e "  Reset: ${CYAN}make example-reset NAME=$NAME${RESET}"
