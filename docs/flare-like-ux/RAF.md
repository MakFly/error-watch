# RAF — Alignement ErrorWatch « comme Flare/Sentry »

> Handoff pour reprise (Codex / autre session). Lis aussi `PLAN.md` (même dossier).
> Date : 2026-06-13.

## TL;DR

Objectif : **simplifier l'UX** (3 piliers Errors/Performance/Logs) **et** adopter le **protocole Flare**
(payload à attributs plats OTel). On ne rattrape pas des features — ErrorWatch en a déjà plus que Flare.

Stratégie protocole = **additive** : l'ancien chemin Sentry (`/api/v1/envelope`) reste intact, le chemin
Flare (`/api/v1/errors`) est ajouté à côté. Option `protocol` (défaut `envelope`).

## Branches & commits (rien poussé)

**error-watch** — branche `feat/flare-like-ux`
- `e3d0a46` docs: plan
- `7ac3f58` feat(ux): sidebar 4 piliers + groupe « Plus » replié
- `5a0ea1b` revert de l'accueil errors-first (décision user : tableau de bord conservé)
- `a62ee44` docs: acte 1.4 annulée / 1.3 N/A
- `6f6aa1c` feat(api): endpoint Flare `/api/v1/errors`

**errorwatch-sdk-php** (repo séparé, cloné dans `../errorwatch-sdk-php`) — branche `feat/flare-protocol`
- `ce5e5a7` feat: protocole Flare (FlareSerializer, ErrorWatch::make, Options.protocol, Client, HttpTransport)
- `f8becb7` feat(laravel): intégration honore `protocol=flare`

## FAIT ✅

- **Vague 1.1** — sidebar épurée (`apps/web/src/components/errorwatch-sidebar.tsx`, i18n en/fr). 4 piliers + « Plus » replié.
- **Vague 1.3** — vérifiée **N/A** : la vue détail d'erreur est déjà façon Sentry (1 action primaire, header→onglets→rail). Ne pas refondre sans raison.
- **Vague 1.4** — **ANNULÉE** par le user : le tableau de bord (`[projectSlug]/page.tsx`) reste tel quel.
- **Vague 2 (errors, protocole)** :
  - API : `POST /api/v1/errors` (`apps/api/src/controllers/v1/ErrorsController.ts` + `routes/v1/errors.ts`). Valide le payload Flare, `flareToEnvelope()` mappe attributs plats → champs internes, **réutilise le pipeline existant** (normalizer + dedup + grouping + worker). `extra.attributes` préserve tout. Header `x-api-token` accepté (fallback `middleware/api-key.ts`).
  - SDK core : `FlareSerializer` (envelope→Flare), `ErrorWatch::make()`, `Options.protocol`, `Client` sérialise si flare, `HttpTransport.$eventPath`.
  - SDK Laravel : `MonitoringClient` + `Laravel/Transport/HttpTransport` routent vers `/api/v1/errors` quand `protocol=flare` (config `ERRORWATCH_PROTOCOL`).
  - **Vérifié end-to-end** : app Laravel exemple → exception → `/api/v1/errors` → groupe en base avec attributs OTel (`http.url`, `http.method`, `environment`, `server.name`). Tests : 391 SDK verts + 4 `FlareSerializerTest`.

## RAF (reste à faire) — priorisé

### P1 — Rendre les attributs Flare *exploitables* (Vague 2.5)
Aujourd'hui les attributs plats sont **stockés mais pas exposés** (ils dorment dans `error_events.extra.attributes`).
1. **DB** : colonne `attributes JSONB` (index GIN) sur `error_events` — `apps/api/src/db/schema.ts` + `bun run db:push`.
2. **Ingestion** : `flareToEnvelope`/worker écrivent dans cette colonne (au lieu de seulement `extra`).
3. **UI** : section « Attributes » dans le détail d'erreur — `apps/web/src/components/issue-detail/` (nouvel onglet ou bloc dans `EventSourcePanel`), via un champ tRPC exposé par `groups.getEvents`.

### P2 — Vague 3 : Traces OTel (spans + span events + glows)
Modèle cible Flare : `Trace → Span → SpanEvent` (events = exception/cache/log/**glow** *dans* les spans).
- SDK : `SpanEvent` (ns + attributs) dans `Laravel/Tracing/Span.php` + `Symfony/Model/{Transaction,Span}.php` ; Query/Cache/HttpListeners émettent des span events ; alias `addGlow()`.
- API : table `span_events` + `POST /api/v1/traces` (même approche additive que `/errors` ; réutiliser `PerformanceController`).
- UI : marqueurs d'events sur le waterfall (`components/performance/{TransactionDetail,WaterfallGrid,SpanBar}.tsx`).

### P3 — Vague 4 : Summary & Aggregate views
- API : agrégats manquants par entry-point (**jobs, commands, views, queries**) ; agrégat « Appears in »/« Breakdown ». `services/aggregation.worker.ts` + router `performance`.
- UI : pages summary dédiées sous `apps/web/.../performance/`.

### P4 — Vague 5 : parité config/notifs/intégrations
- SDK : **censoring configurable** (remplacer le scrubbing hardcodé de `src/Profiler/RequestProfile.php`) : `censorBodyFields/Headers/Cookies/ClientIps`.
- API (`services/alerts.ts`) : canaux **Microsoft Teams** + **SMS** ; intégrations **Jira** + **Linear** + « Share » manuel depuis une erreur.

### P5 — Finitions Vague 1 (optionnel, faible valeur/risque)
- Renommer la **route** `/issues` → `/errors` (le label dit déjà « Errors »). Touche `apps/web/.../issues/` (dossier), `proxy.ts`, tous les liens internes. Risque de casse > valeur. À faire seulement si voulu.
- Vocabulaire : remplacer « Issues » par « Errors » partout (i18n, titres).

### Endpoints Flare encore à faire (si on veut la compat protocole complète)
`/api/v1/logs` au format Flare (payload events) et `/api/v1/traces` — voir spec dans le référentiel (ci-dessous).

## Setup pour reprendre

- **Env isolé** : Postgres bundled `:55432` + Redis `:56379` (PAS la shared infra `:5432`). `.env` du repo généré par `make install` pointe sur 55432. DB : `docker exec errorwatch-postgres psql -U errorwatch -d errorwatch`. **Colonnes en snake_case** (`last_seen`, `exception_type`, `user_context`…).
- **Lancer** : `bun run dev` (API :3333 + Web :4001). ⚠️ NE PAS sauvegarder plein de fichiers d'un coup → `tsx watch` part en restart-storm (récupère, mais bruyant).
- **Dashboard** : `http://localhost:4001/dashboard/tilvest/distrib-app` — login `dev@test.com` / `password123`.
- **Exemple Laravel** (`examples/laravel-api`, :8008) : routes de test `GET /api/v1/test/{error,warning,divide-by-zero}`, ou `make example-laravel-test`.
- **Typecheck** : `cd apps/api && bunx tsc --noEmit` ; `cd apps/web && bunx tsc --noEmit`. SDK : `vendor/bin/phpunit`.

## ⚠️ Câblage local NON commité (à connaître / nettoyer)

Dans `examples/laravel-api/` (working tree de error-watch, non commité) :
- `composer.json`/`composer.lock` : path-repo `errorwatch/sdk-php` symlinké vers `../../../errorwatch-sdk-php` (`@dev`) — pour utiliser le SDK local. **Ne pas commiter** (chemin local machine).
- `.env` (gitignored) : `ERRORWATCH_PROTOCOL=flare`, `ERRORWATCH_TRANSPORT_MODE=sync`.
- `storage/run.pid` : untracked (PID serveur exemple).
Pour revenir à l'état Packagist : `composer require errorwatch/sdk-php:^2.9` dans l'exemple + retirer le repo `errorwatch-local`.

## Référentiel Flare (source de vérité protocole)

Doc Flare complète aspirée en markdown : `../../snifferwatch/flare-docs/` (165 pages).
Spec protocole utile ici : `flare-docs/protocol/errors/payload.md`, `.../traces/payload.md`, `.../logs/payload.md`,
`.../general/attribute-formats.md`. Le contrat `/api/v1/errors` suit `errors/payload.md`.
