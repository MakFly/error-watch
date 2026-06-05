# Project Rules (`.claude/rules/`)

Project-scoped guidance for Claude Code. These files are referenced from the root
`CLAUDE.md` so they load into context when working in this repo.

| Rule | Scope |
|------|-------|
| [database.md](database.md) | PostgreSQL/Docker setup — which container the app actually uses (`infra-postgres` @ 5432, not the bundled `errorwatch-postgres` @ 55432). |

Add a new rule by dropping a `*.md` here and linking it from this table + `CLAUDE.md`.
