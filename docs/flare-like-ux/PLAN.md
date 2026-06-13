# Plan — Rendre ErrorWatch aussi simple que Flare / Sentry

> Statut : **actif**. Branche : `feat/flare-like-ux`.
> Auteur initial : session de cadrage (comparaison ligne-à-ligne avec la doc Flare aspirée).

## Objectif

Rendre l'expérience ErrorWatch **aussi simple et lisible que Flare / Sentry**.

Le problème actuel n'est **pas** un manque de fonctionnalités — ErrorWatch en a déjà **plus** que Flare
(session replay, infra monitoring Go, cron monitoring, N+1 detection, sourcemaps auto, agrégats Apdex).
Le problème est que ce surplus rend la navigation **fourre-tout** : 9 entrées de nav de même niveau,
une vue détail d'erreur dense, pas de hiérarchie produit claire.

**Principe directeur : on épure et on hiérarchise avant d'ajouter quoi que ce soit.**

## Ce qui rend Flare/Sentry « simples » (principes à appliquer)

1. **3 piliers visibles, point.** Errors (le produit), Performance, Logs. Tout le reste est secondaire.
2. **L'erreur est l'objet central.** La vue détail d'erreur est l'écran le plus soigné : stack → contexte → occurrences, avec des **onglets d'insights** (où ? qui ? quand ?) plutôt que tout empilé.
3. **Le secondaire est rangé, pas supprimé.** Replays / Infra / Crons / Stats vivent dans un groupe « Plus » ou contextualisés, pas au même niveau qu'Errors.
4. **Vocabulaire cohérent.** Un seul nom par concept (Sentry : « Issues ». Flare : « Errors »). Pas « issues » + « errors » + « groups » mélangés.
5. **Densité maîtrisée.** Une action primaire par écran, le reste dans un menu.

## État actuel (constat factuel)

**Navigation** (`apps/web/src/components/errorwatch-sidebar.tsx`) — 2 groupes, 9 entrées :
- Monitoring : Dashboard, Issues, Logs
- Observability : Performance, Replays, Stats, Crons, Infrastructure

**Modèle de données** : Sentry-like (envelope, `contexts`/`tags`/`extra` imbriqués, breadcrumbs, `Transaction→Span` propriétaire). Flare est OTel-like (attributs **plats**, `Trace→Span→SpanEvent`, glows, endpoints séparés errors/traces/logs).

## Vagues (ordre d'exécution)

L'ordre est **simplicité d'abord**, protocole ensuite. On valide visuellement chaque vague sur l'instance locale + l'exemple Laravel avant de passer à la suivante.

---

### Vague 1 — Simplification de l'UX (PRIORITÉ, = « petit a » du produit)

**Objectif** : passer de « fourre-tout » à « 3 piliers + secondaire rangé », sans rien casser.

| # | Changement | Fichiers |
|---|-----------|----------|
| 1.1 | Refondre la sidebar : groupe **Principal** (Dashboard, Errors, Performance, Logs) + groupe repliable **Plus** (Replays, Crons, Infrastructure, Stats) | `apps/web/src/components/errorwatch-sidebar.tsx` |
| 1.2 | Uniformiser le vocabulaire : « Issues » → **« Errors »** partout (route, i18n, titres) | `src/messages/en-US.json`, `src/messages/fr.json`, libellés sidebar/pages |
| 1.3 | Épurer la vue détail d'erreur | ~~`IssueDetailView.tsx`~~ — **vérifié : déjà façon Sentry (1 action primaire, header → onglets → rail). Rien à refondre.** |
| 1.4 | ~~Page d'accueil recentrée errors-first~~ | **ANNULÉ par décision utilisateur (2026-06-13) : le tableau de bord reste tel quel** (widgets perf conservés). Commit revert `5a0ea1b`. |

**Critères de succès (vérifiables)** :
- La sidebar affiche **4 entrées principales** max au premier niveau ; le reste est sous « Plus » replié par défaut.
- Aucune route cassée (toutes les pages existantes restent accessibles).
- `bun run build` passe (web).
- Vérif visuelle sur `localhost:4001` : un nouvel utilisateur identifie Errors/Performance/Logs en < 3 s.

---

### Vague 2 — Errors au format Flare (protocole)

**Objectif** : ingérer un payload d'erreur à **attributs plats** (conventions OTel), en parallèle du format actuel (stratégie additive, pas de rupture).

| # | Changement | Fichiers |
|---|-----------|----------|
| 2.1 | Façade statique `ErrorWatch::make($key)` (pattern Flare) | SDK `src/ErrorWatch.php` (nouveau) |
| 2.2 | Sérialiseur attributs plats (`http.*`, `db.*`, `laravel.user.id`) + `seenAtUnixNano`, `openFrameIndex`, `trackingUuid` | SDK `src/Flare/FlareSerializer.php` (nouveau), `src/Event/Event.php` |
| 2.3 | Frames au format Flare `{method,file,line,class,codeSnippet}` | SDK `src/Exception/Frame.php` |
| 2.4 | Endpoint `/api/v1/errors` + adaptateur payload plat → moteur de grouping existant | API `apps/api/src/routes/v1/errors.ts`, `controllers/v1/ErrorsController.ts` (nouveaux) |
| 2.5 | Colonne `attributes JSONB` (index GIN) sur `error_events` | API `apps/api/src/db/schema.ts` |

**Critères de succès** : un POST exemple (payload Flare) sur `/api/v1/errors` crée un groupe + occurrence visibles dans le dashboard ; les anciens endpoints continuent de fonctionner.

---

### Vague 3 — Traces OTel : spans + span events + glows

**Objectif** : modèle `Trace→Span→SpanEvent` ; les events (exception/cache/log/**glow**) deviennent des marqueurs **dans** les spans — la signature visuelle de Flare.

| # | Changement | Fichiers |
|---|-----------|----------|
| 3.1 | Introduire `SpanEvent` (timestamp ns + attributs) | SDK `src/Laravel/Tracing/Span.php`, `src/Symfony/Model/{Transaction,Span}.php` |
| 3.2 | Query/Cache/HTTP listeners → émettent des span events rattachés au span courant | SDK `QueryListener`, `CacheListener`, `HttpClientListener` |
| 3.3 | API `glows` (alias des breadcrumbs Laravel), `addBreadcrumb` deprecated | SDK |
| 3.4 | Table `span_events` + route `/api/v1/traces` | API `apps/api/src/db/schema.ts`, `routes/v1/traces.ts` |
| 3.5 | Waterfall : afficher les span events comme marqueurs sur la timeline (rouge = exception) + panneau détail span (events fired) | `apps/web/src/components/performance/{TransactionDetail,WaterfallGrid,SpanBar}.tsx` |

**Critères de succès** : une trace de l'exemple Laravel montre des spans avec marqueurs d'events ; clic sur un span → attributs + events listés.

---

### Vague 4 — Summary & Aggregate views (signature Flare)

| # | Changement | Fichiers |
|---|-----------|----------|
| 4.1 | Agrégats par entry-point manquants : **jobs, commands, views, queries** (existant : requests/cache/http/queues) | API router `performance.*`, `aggregation.worker.ts` |
| 4.2 | Agrégat « Appears in » / « Breakdown » (un span/query à travers N traces) | API |
| 4.3 | Pages summary dédiées par entry-point (bar graph response-time + line graph throughput + table triée p95) | `apps/web/.../performance/{jobs,commands,views,queries}/page.tsx` |

**Critères de succès** : pages summary jobs/commands/views accessibles, alimentées par l'exemple.

---

### Vague 5 — Censoring configurable + parité notifs/intégrations

| # | Changement | Fichiers |
|---|-----------|----------|
| 5.1 | Censoring **configurable** (remplace le scrubbing hardcodé) : `censorBodyFields/Headers/Cookies/ClientIps/Session` | SDK `src/Options.php`, `src/Profiler/RequestProfile.php` |
| 5.2 | Canaux notifs manquants : **Microsoft Teams**, **SMS** | API `apps/api/src/services/alerts.ts` |
| 5.3 | Intégrations issues manquantes : **Jira**, **Linear** + action « Share » manuelle depuis une erreur | API `services/alerts.ts`, router `groups/alerts` |

---

## Ce qu'on NE touche PAS (on dépasse déjà Flare ici)

Session replay (rrweb), infra monitoring (Go agent), cron monitoring, sourcemaps auto, N+1 detection,
agrégats Apdex, multi-tenant. **Ne pas régresser pour « ressembler ».** On les **range** (Vague 1), on ne les retire pas.

## Setup de test (instance locale)

- Infra + app : `make install` puis `make dev` → Dashboard `:4001`, API `:3333`.
- Exemple Laravel : `make example-laravel` (setup auth + clé API + start). Routes de test :
  `GET /api/v1/test/error`, `/test/warning`, `/test/divide-by-zero`.
- Pour tester les modifs **du SDK** : pointer `examples/laravel-api/composer.json` vers le SDK local
  (repository `path` vers `../../../errorwatch-sdk-php`) au lieu de `errorwatch/sdk-php: ^2.9`.

## Convention de travail

- Une vague = une série de commits ciblés, vérifiés (build + visuel) avant la suivante.
- Pas de refacto opportuniste hors scope. Chaque changement trace vers une ligne de ce plan.
