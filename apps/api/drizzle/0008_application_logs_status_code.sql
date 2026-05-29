-- Carry HTTP status on trace/request application logs so they can be filtered
-- alongside the error feed. `application_logs` previously had no status column,
-- so request/response trace logs landed without their HTTP status_code.
-- Nullable: CLI / app / deprecation logs have no HTTP status.

ALTER TABLE "application_logs" ADD COLUMN IF NOT EXISTS "status_code" integer;

-- Partial composite index for the tail filter (project + status family/exact,
-- ordered by recency). Skips the long tail of status-less logs.
CREATE INDEX IF NOT EXISTS idx_application_logs_project_status_created
  ON application_logs (project_id, status_code, created_at DESC)
  WHERE status_code IS NOT NULL;
