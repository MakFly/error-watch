/**
 * HTTP status-code helpers shared by log ingestion and tail/group filtering.
 *
 * No DB import — pure functions, unit-testable in isolation.
 */

/**
 * Coerce an arbitrary value into a sane HTTP status code, or return null.
 *
 * Mirrors the `debug->>'status_code'` cast guard in GroupRepository: only an
 * integer in the valid HTTP range (100–599) is accepted. Numeric strings are
 * tolerated (SDKs send `"422"` as often as `422`); anything else — floats,
 * out-of-range, "unknown", objects — yields null and is silently ignored
 * rather than poisoning the row.
 */
export function coerceStatusCode(value: unknown): number | null {
  let n: number | null = null;

  if (typeof value === "number" && Number.isInteger(value)) {
    n = value;
  } else if (typeof value === "string" && /^[0-9]{3}$/.test(value.trim())) {
    n = Number(value.trim());
  }

  if (n === null || n < 100 || n > 599) return null;
  return n;
}

export type StatusCodeFilter =
  | { kind: "exact"; code: number }
  | { kind: "family"; min: number; max: number };

/**
 * Parse a status-code filter token. Accepts an exact 3-digit code ("422") or
 * an HTTP status family ("2xx", "4xx", "5xx", case-insensitive) → an inclusive
 * range. Returns null for anything unrecognised so callers can ignore garbage
 * (backward-compatible: an absent/invalid filter is simply not applied).
 */
export function parseStatusCodeFilter(raw: string | undefined | null): StatusCodeFilter | null {
  if (!raw) return null;
  const token = raw.trim().toLowerCase();

  const family = /^([1-5])xx$/.exec(token);
  if (family) {
    const base = Number(family[1]) * 100;
    return { kind: "family", min: base, max: base + 99 };
  }

  if (/^[0-9]{3}$/.test(token)) {
    const code = Number(token);
    if (code >= 100 && code <= 599) return { kind: "exact", code };
  }

  return null;
}
