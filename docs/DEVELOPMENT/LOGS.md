# Application Logs (Sentry-style)

ErrorWatch stores structured application logs separately from error issues — same model as Sentry `Explore → Logs`.

## Ingest

| Path | Auth | Purpose |
|------|------|---------|
| `POST /api/v1/logs` | API key | Single log |
| `POST /api/v1/batch` (`type: "log"`) | API key | Batched logs |

Logs use the `application_logs` table. They **do not** create issues.

### PHP SDK (v2.9.1+)

```php
// Monolog → logs only (NOT issues)
$log->pushHandler(new \Sentry\Monolog\LogsHandler(...)); // ErrorWatch equivalent: ErrorWatchLogger

// Never route info/debug Monolog to captureException
```

Send flat attributes in `extra` for search (`user_id`, `order_id`, etc.):

```php
[
    'level' => 'info',
    'channel' => 'application',
    'message' => 'Checkout completed',
    'extra' => ['order_id' => $order->id, 'user_id' => $user->id],
    'trace_id' => $traceId,
]
```

### HTTP status on logs (Sentry parity)

Populate `status_code` as a **structured** field — not only inside the message string:

```php
// Monolog context (Laravel MessageLogged → SDK sendLiveLog)
Log::warning('POST /orders failed', [
    'status_code' => 422,
    'log_kind' => 'http_response', // SDK sets source=http
]);
```

Resolution order in SDK `sendLiveLog`: Monolog `context.status_code` → SDK request scope (post-response) → message fallback (`Status Code : 422`).

Filter in the dashboard: `/logs?status_code=4xx` or `422`.

## Query API

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /api/v1/logs/tail` | Session | Cursor pagination, filters |
| `GET /api/v1/logs/stats` | Session | Volume buckets + optional `groupBy` |

### Filters

- `level`, `channel`, `search` (message ilike)
- `trace_id`, `user_id`, `request_id`, `env`, `release`
- `status_code`, `url`
- `attribute=key:value` (top-level `context` / `extra` keys)
- `from` / `to` (ISO datetime; stats defaults to last 24h)

## Retention

Default **7 days** (`LOG_RETENTION_DAYS` env). Cleanup runs in the aggregation worker.

## Dashboard

- **Journaux** — explorer with volume chart, expandable rows, aggregates tab
- **Issue detail → Logs** — correlated logs via `trace_id`
- **Performance → transaction → Logs** — logs for that trace

Deep link: `/dashboard/{org}/{project}/logs?traceId={trace_id}`
