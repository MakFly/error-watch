# Database (PostgreSQL — Docker)

The dev database is **PostgreSQL 16 running in Docker**. Two Postgres containers may be
present on the host — **they are NOT interchangeable**. Always target the one the app
actually connects to.

## Which container the app uses

The app reads `DATABASE_URL` from the **root `.env`**:

```
DATABASE_URL=postgresql://test:test@localhost:5432/errorwatch
```

| Container | Host port | User / Pwd | DB | Role |
|-----------|-----------|------------|-----|------|
| **`infra-postgres`** ✅ | `5432` | `test` / `test` | `errorwatch` | **The live dev DB.** Shared infra from `~/Documents/infra`. App connects here. |
| `errorwatch-postgres` | `55432` | `errorwatch` / `$POSTGRES_PASSWORD` | `errorwatch` | Project-bundled Postgres (`docker-compose.yml`). **Not used** in the current dev setup. |

> The project's own `docker-compose.yml` (service `postgres` → container `errorwatch-postgres`,
> published on `55432`) exists for self-contained/prod runs. In day-to-day local dev we plug onto
> the shared `infra-postgres` on `5432` and do **not** start the bundled one.
> See `~/.claude/.../memory/local-dev-shared-infra.md`.

## Connecting (psql)

```bash
# The DB the app uses (shared infra)
docker exec -it infra-postgres psql -U test -d errorwatch

# One-off query
docker exec infra-postgres psql -U test -d errorwatch -tAc "SELECT count(*) FROM error_events;"
```

## Rules

- **Never** run schema changes against `errorwatch-postgres` (55432) expecting them to affect dev —
  the app won't see them. Use `infra-postgres` (5432).
- Schema is managed by **Drizzle**. Apply changes with `bun run db:push` (dev) — never hand-edit
  tables to change schema; edit the Drizzle schema and push.
- Migrations in containers run via `apps/api/docker-entrypoint.sh` (auto `drizzle-kit push` on boot).
- Don't hardcode credentials in code — everything comes from the root `.env`.
- Before destructive SQL (DROP/TRUNCATE/DELETE without WHERE), stop and confirm with the user.
- Launch dev with `bun run dev` (skips `make dev`'s infra-up so it doesn't fight the shared infra).
