/**
 * Batch-ingest reject helpers — pure, DB-free, unit-testable.
 */

export interface RejectedItem {
  index: number;
  type: string;
  reason: string;
}

/**
 * Build a compact, log/response-safe summary of rejected batch items.
 *
 * Production-safe: never includes payloads. Aggregates counts per reason and
 * per item type, plus the index of the first reject and its reason — enough to
 * diagnose "everything is being dropped" without leaking data or blowing up
 * the log line.
 */
export function summarizeRejections(rejected: RejectedItem[]): {
  count: number;
  byReason: Record<string, number>;
  byType: Record<string, number>;
  firstIndex: number | null;
  firstReason: string | null;
} {
  const byReason: Record<string, number> = {};
  const byType: Record<string, number> = {};

  for (const r of rejected) {
    byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
    byType[r.type] = (byType[r.type] ?? 0) + 1;
  }

  return {
    count: rejected.length,
    byReason,
    byType,
    firstIndex: rejected.length > 0 ? rejected[0].index : null,
    firstReason: rejected.length > 0 ? rejected[0].reason : null,
  };
}
