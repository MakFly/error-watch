CREATE INDEX IF NOT EXISTS idx_application_logs_context_gin
  ON application_logs USING gin (context jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_application_logs_extra_gin
  ON application_logs USING gin (extra jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_application_logs_project_trace_created
  ON application_logs(project_id, trace_id, created_at DESC)
  WHERE trace_id IS NOT NULL;
