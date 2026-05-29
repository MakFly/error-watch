#!/usr/bin/env bash
# Create .env from .env.example and fill in missing secrets with generated values.
# Idempotent: existing non-empty, non-placeholder values are preserved.

set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env"
ENV_EXAMPLE=".env.example"

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
RESET='\033[0m'

if ! command -v openssl >/dev/null 2>&1; then
  echo -e "${RED}openssl is required but not installed.${RESET}" >&2
  exit 1
fi

if [ ! -f "$ENV_EXAMPLE" ]; then
  echo -e "${RED}Missing $ENV_EXAMPLE${RESET}" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo -e "${GREEN}Created $ENV_FILE from $ENV_EXAMPLE${RESET}"
else
  echo -e "${CYAN}Using existing $ENV_FILE${RESET}"
fi

gen_secret() {
  openssl rand -base64 48 | tr -d '\n/+=' | head -c 48
}

set_env_value() {
  local key="$1"
  local value="$2"
  local escaped
  escaped=$(printf '%s' "$value" | sed -e 's/[\/&|]/\\&/g')
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i.bak -E "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

get_env_value() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" | head -n1 | cut -d'=' -f2- || true
}

ensure_secret() {
  local key="$1"
  local placeholder="${2:-}"
  local current
  current=$(get_env_value "$key")

  if [ -z "$current" ] || [ "$current" = "$placeholder" ]; then
    local new_value
    new_value=$(gen_secret)
    set_env_value "$key" "$new_value"
    echo -e "  ${GREEN}generated${RESET} $key"
  else
    echo -e "  ${YELLOW}kept${RESET}      $key"
  fi
}

echo -e "${CYAN}Ensuring local secrets:${RESET}"
ensure_secret "POSTGRES_PASSWORD"
ensure_secret "BETTER_AUTH_SECRET"
ensure_secret "ADMIN_API_KEY"
ensure_secret "API_KEY_HASH_SECRET" "your-secret-here"

# Keep DATABASE_URL in sync with POSTGRES_PASSWORD, but only for the default
# dockerized dev setup (host=localhost, port=55432). External/custom URLs are left alone.
PG_PWD=$(get_env_value "POSTGRES_PASSWORD")
CURRENT_DB_URL=$(get_env_value "DATABASE_URL")
if [ -n "$PG_PWD" ] && [[ "$CURRENT_DB_URL" =~ @localhost:55432/ ]]; then
  DB_URL="postgresql://errorwatch:${PG_PWD}@localhost:55432/errorwatch"
  if [ "$CURRENT_DB_URL" != "$DB_URL" ]; then
    set_env_value "DATABASE_URL" "$DB_URL"
    echo -e "  ${GREEN}synced${RESET}    DATABASE_URL"
  else
    echo -e "  ${YELLOW}kept${RESET}      DATABASE_URL"
  fi
fi

echo -e "${GREEN}Env ready.${RESET}"
