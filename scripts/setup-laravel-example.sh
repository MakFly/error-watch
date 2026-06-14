#!/usr/bin/env bash
# =============================================================================
# Setup ErrorWatch Laravel API example
# Authenticates to ErrorWatch API, fetches the first project's API key
# (or creates one), and injects it into examples/laravel-api/.env
# =============================================================================
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

API_URL="${ERRORWATCH_API_URL:-http://localhost:3333}"
LARAVEL_DIR="examples/laravel-api"
COOKIE_JAR=$(mktemp)
trap "rm -f $COOKIE_JAR" EXIT

echo -e "${CYAN}=== ErrorWatch Laravel Example Setup ===${RESET}"
echo ""

# ---- Step 1: Authenticate ----
echo -e "${YELLOW}Step 1: Authenticating to ErrorWatch API...${RESET}"

# Check if user provided credentials via env vars, otherwise prompt
EMAIL="${ERRORWATCH_EMAIL:-}"
PASSWORD="${ERRORWATCH_PASSWORD:-}"

if [ -z "$EMAIL" ]; then
  read -rp "  ErrorWatch email: " EMAIL
fi
if [ -z "$PASSWORD" ]; then
  read -rsp "  ErrorWatch password: " PASSWORD
  echo ""
fi

LOGIN_RESPONSE=$(curl -s -c "$COOKIE_JAR" -w "\n%{http_code}" \
  -X POST "$API_URL/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

HTTP_CODE=$(echo "$LOGIN_RESPONSE" | tail -1)
LOGIN_BODY=$(echo "$LOGIN_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" != "200" ]; then
  echo -e "${RED}  Login failed (HTTP $HTTP_CODE). Check your credentials.${RESET}"
  echo "  Response: $LOGIN_BODY"
  exit 1
fi

echo -e "${GREEN}  Authenticated successfully.${RESET}"

# ---- Step 2: Get first project ----
echo -e "${YELLOW}Step 2: Fetching projects...${RESET}"

PROJECTS_RESPONSE=$(curl -s -b "$COOKIE_JAR" "$API_URL/api/v1/projects")
PROJECT_ID=$(echo "$PROJECTS_RESPONSE" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data[0]['id'] if data else '')" 2>/dev/null || true)
PROJECT_NAME=$(echo "$PROJECTS_RESPONSE" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data[0]['name'] if data else '')" 2>/dev/null || true)

if [ -z "$PROJECT_ID" ]; then
  echo -e "${RED}  No projects found. Create a project in the dashboard first.${RESET}"
  exit 1
fi

echo -e "${GREEN}  Found project: $PROJECT_NAME ($PROJECT_ID)${RESET}"

# ---- Step 3: Create API key ----
echo -e "${YELLOW}Step 3: Creating API key for project...${RESET}"

KEY_RESPONSE=$(curl -s -b "$COOKIE_JAR" -w "\n%{http_code}" \
  -X POST "$API_URL/api/v1/api-keys" \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$PROJECT_ID\",\"name\":\"laravel-example-$(date +%s)\"}")

KEY_HTTP_CODE=$(echo "$KEY_RESPONSE" | tail -1)
KEY_BODY=$(echo "$KEY_RESPONSE" | sed '$d')

if [ "$KEY_HTTP_CODE" != "200" ]; then
  echo -e "${RED}  Failed to create API key (HTTP $KEY_HTTP_CODE).${RESET}"
  echo "  Response: $KEY_BODY"
  exit 1
fi

API_KEY=$(echo "$KEY_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['key'])" 2>/dev/null || true)

if [ -z "$API_KEY" ]; then
  echo -e "${RED}  Failed to extract API key from response.${RESET}"
  exit 1
fi

echo -e "${GREEN}  API key created: ${API_KEY:0:12}...${RESET}"

# ---- Step 4: Setup Laravel .env ----
echo -e "${YELLOW}Step 4: Configuring $LARAVEL_DIR/.env...${RESET}"

if [ ! -f "$LARAVEL_DIR/.env" ]; then
  cp "$LARAVEL_DIR/.env.example" "$LARAVEL_DIR/.env"
  echo -e "  ${CYAN}Created .env from .env.example${RESET}"
fi

# Update ErrorWatch settings in .env
if grep -q "ERRORWATCH_ENABLED" "$LARAVEL_DIR/.env"; then
  sed -i '' 's/^ERRORWATCH_ENABLED=.*/ERRORWATCH_ENABLED=true/' "$LARAVEL_DIR/.env"
  sed -i '' "s|^ERRORWATCH_ENDPOINT=.*|ERRORWATCH_ENDPOINT=$API_URL|" "$LARAVEL_DIR/.env"
  sed -i '' "s/^ERRORWATCH_API_KEY=.*/ERRORWATCH_API_KEY=$API_KEY/" "$LARAVEL_DIR/.env"
else
  cat >> "$LARAVEL_DIR/.env" <<EOF

# ErrorWatch SDK
ERRORWATCH_ENABLED=true
ERRORWATCH_ENDPOINT=$API_URL
ERRORWATCH_API_KEY=$API_KEY
EOF
fi

echo -e "${GREEN}  .env configured:${RESET}"
echo -e "    ERRORWATCH_ENABLED=true"
echo -e "    ERRORWATCH_ENDPOINT=$API_URL"
echo -e "    ERRORWATCH_API_KEY=${API_KEY:0:12}..."

# ---- Step 5: Install Laravel deps ----
echo -e "${YELLOW}Step 5: Installing Laravel dependencies...${RESET}"

cd "$LARAVEL_DIR"

if ! command -v composer &> /dev/null; then
  echo -e "${RED}  composer not found. Install it: https://getcomposer.org${RESET}"
  exit 1
fi

composer install --quiet

# Generate app key if missing
if grep -q "^APP_KEY=$" .env; then
  php artisan key:generate --quiet
  echo -e "  ${CYAN}App key generated${RESET}"
fi

# Create SQLite database if needed
if [ ! -f database/database.sqlite ]; then
  touch database/database.sqlite
  echo -e "  ${CYAN}SQLite database created${RESET}"
fi

php artisan migrate --force --quiet 2>/dev/null || true

echo -e "${GREEN}  Laravel ready.${RESET}"

echo ""
echo -e "${GREEN}=== Setup complete! ===${RESET}"
echo ""
echo -e "  Start the Laravel server:"
echo -e "    ${CYAN}cd $LARAVEL_DIR && php artisan serve --port=8008${RESET}"
echo ""
echo -e "  Test error reporting:"
echo -e "    ${CYAN}curl http://localhost:8008/api/v1/test/error${RESET}"
echo -e "    ${CYAN}curl http://localhost:8008/api/v1/test/warning${RESET}"
echo ""
echo -e "  Test APM / performance monitoring:"
echo -e "    ${CYAN}curl http://localhost:8008/api/v1/test/perf/slow${RESET}"
echo -e "    ${CYAN}curl http://localhost:8008/api/v1/test/perf/n-plus-one${RESET}"
echo -e "    ${CYAN}curl http://localhost:8008/api/v1/test/perf/external-call${RESET}"
echo -e "    ${CYAN}curl http://localhost:8008/api/v1/test/perf/cache${RESET}"
echo ""
echo -e "  Then check your ErrorWatch dashboard for incoming errors and performance data."
