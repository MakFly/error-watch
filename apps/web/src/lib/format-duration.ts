export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

export function durationCls(ms: number): string {
  if (ms >= 1000) return "text-status-critical";
  if (ms >= 300) return "text-status-warning";
  return "text-foreground";
}
