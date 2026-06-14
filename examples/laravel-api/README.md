# ErrorWatch — Laravel API Example

A complete Laravel 12 REST API example showcasing [ErrorWatch](https://errorwatch.io) SDK integration. This project implements a Task Manager API with Sanctum token authentication, tags, filtering, and automatic error/APM reporting to ErrorWatch.

## What this demonstrates

- **Exception capture** — unhandled exceptions are automatically sent to ErrorWatch
- **Query tracing** — Eloquent queries are tracked (N+1 detection included)
- **Breadcrumbs** — HTTP requests, SQL queries, auth events are recorded automatically
- **Log integration** — `Log::warning()`, `Log::error()` etc. appear in ErrorWatch
- **User context** — authenticated user is attached to every event
- **Test routes** — `/api/v1/test/error` and `/api/v1/test/warning` let you trigger events instantly
- **APM test routes** — `/api/v1/test/perf/*` trigger slow queries, N+1, external calls, cache ops

## Prerequisites

- PHP 8.2+
- Composer
- SQLite (built into PHP — no separate install needed)
- ErrorWatch running locally (`make dev` from the repo root)

## Quick start

```bash
# From the repository root — single command, idempotent:
make example NAME=laravel
```

This installs composer deps, generates `APP_KEY`, creates the SQLite DB, runs
migrations + seeds, provisions an org+project+API key in ErrorWatch via the
dev seed endpoint, writes the key into `examples/laravel-api/.env`, starts
`php artisan serve` on `:8008` in background, and fires `/api/v1/test/*` to
populate the dashboard. The terminal prints the dashboard URL.

Re-running `make example NAME=laravel` is safe: existing org/project are
reused, a fresh API key is issued and stored in `.env`.

```bash
make example-status NAME=laravel   # PID + port
make example-down   NAME=laravel   # stop the server
make example-reset  NAME=laravel   # wipe vendor/.env/sqlite (destructive)
```

### Manual setup (alternative)

If you prefer to run the steps yourself:

```bash
composer install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite
php artisan migrate --seed
php artisan serve
```

## SDK path setup

The example uses a local path repository for `errorwatch/sdk-php`. Composer
tries two locations in order:

1. `../../packages/sdk-laravel` — the monorepo convention (`packages/` is gitignored; clone the SDK there)
2. `../../../errorwatch-sdk-php` — standalone clone next to the monorepo

Composer picks the first path that exists. If neither resolves, `composer install` fails —
clone [errorwatch-sdk-php](https://github.com/MakFly/errorwatch-sdk-laravel) into one of those locations.

## ErrorWatch configuration

`make example NAME=laravel` writes these vars for you. To target a non-local
ErrorWatch instance, edit `.env` after the first run:

```env
ERRORWATCH_ENABLED=true
ERRORWATCH_ENDPOINT=http://localhost:3333   # or https://api.errorwatch.io
ERRORWATCH_API_KEY=your-project-api-key
```

Publish the config if you need to customise it further:

```bash
php artisan vendor:publish --tag=errorwatch-config
```

## Seed credentials

After running `php artisan migrate --seed`, two users are created:

| Name | Email | Password |
|------|-------|----------|
| Test User | test@example.com | password |
| Demo User | demo@errorwatch.io | password |

The Demo User has 20 tasks with random statuses/priorities and 5 tags pre-assigned.

## API endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/register` | Register a new user |
| POST | `/api/v1/login` | Login and get Sanctum token |
| POST | `/api/v1/logout` | Revoke current token (auth required) |
| GET | `/api/v1/me` | Get current user (auth required) |

### Tasks (auth required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/tasks` | List tasks (filter: `?status=pending&priority=high`) |
| POST | `/api/v1/tasks` | Create a task |
| GET | `/api/v1/tasks/{id}` | Get a task |
| PUT/PATCH | `/api/v1/tasks/{id}` | Update a task |
| DELETE | `/api/v1/tasks/{id}` | Delete a task |
| POST | `/api/v1/tasks/{id}/tags` | Attach tags (`{"tag_ids": [1, 2]}`) |
| DELETE | `/api/v1/tasks/{id}/tags` | Detach tags (`{"tag_ids": [1]}`) |

### Tags (auth required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/tags` | List all tags |
| POST | `/api/v1/tags` | Create a tag |
| GET | `/api/v1/tags/{id}` | Get a tag |
| PUT/PATCH | `/api/v1/tags/{id}` | Update a tag |
| DELETE | `/api/v1/tags/{id}` | Delete a tag |

### ErrorWatch test routes (public)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/test/error` | Throws a RuntimeException → captured by ErrorWatch |
| GET | `/api/v1/test/warning` | Logs a warning → sent to ErrorWatch |
| GET | `/api/v1/test/divide-by-zero` | Division by zero error |

### APM / Performance test routes (public)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/test/perf/slow` | 300ms sleep + slow DB query → transaction with high duration |
| GET | `/api/v1/test/perf/n-plus-one` | Loads tasks then accesses `user` per row → N+1 detection |
| GET | `/api/v1/test/perf/external-call` | HTTP call to httpbin.org → external call tracing |
| GET | `/api/v1/test/perf/cache` | Cache put/get/forget → cache operations tracing |

## Quick test with curl

```bash
# Register
curl -s -X POST http://localhost:8000/api/v1/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","password":"password","password_confirmation":"password"}' | jq

# Login
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}' | jq -r '.token')

# List tasks
curl -s http://localhost:8000/api/v1/tasks \
  -H "Authorization: Bearer $TOKEN" | jq

# Create a task
curl -s -X POST http://localhost:8000/api/v1/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"My first task","priority":"high","status":"pending"}' | jq

# Trigger an error (captured by ErrorWatch)
curl -s http://localhost:8000/api/v1/test/error
```

## Task model fields

| Field | Type | Values |
|-------|------|--------|
| `title` | string | required |
| `description` | text | optional |
| `status` | enum | `pending`, `in_progress`, `done` |
| `priority` | enum | `low`, `medium`, `high` |
| `due_date` | date | optional, format `Y-m-d` |

## Project structure

```
app/
├── Enums/
│   ├── TaskPriority.php
│   └── TaskStatus.php
├── Http/
│   ├── Controllers/Api/V1/
│   │   ├── AuthController.php
│   │   ├── TagController.php
│   │   └── TaskController.php
│   ├── Requests/
│   │   ├── StoreTagRequest.php
│   │   ├── StoreTaskRequest.php
│   │   ├── UpdateTagRequest.php
│   │   └── UpdateTaskRequest.php
│   └── Resources/
│       ├── TagResource.php
│       ├── TaskCollection.php
│       └── TaskResource.php
├── Models/
│   ├── Tag.php
│   ├── Task.php
│   └── User.php
config/
└── errorwatch.php   # ErrorWatch SDK configuration
routes/
└── api.php          # All API routes under /api/v1/
```
