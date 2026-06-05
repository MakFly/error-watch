/**
 * Message normalization for stable grouping (Sentry-style variable stripping).
 */

const TILVEST_PREFIX_RE =
  /^(?:\[(?:User-\d+|SYSTEM)(?:\s+AS\s+User-\d+)?)\](?:\[[^\]]+\])*\[(?:ERROR|WARNING|INFO|DEBUG|RESPONSE)\]/i;

const TILVEST_METHOD_TAG_RE = /\[([A-Za-z0-9_\\]+::[A-Za-z0-9_]+)\]/;

const EXCEPTION_TYPE_RE =
  /^([A-Za-z\\]+[A-Z][a-zA-Z]*(?:Error|Exception)):\s*(.*)$/s;

/**
 * Strip Tilvest-style log prefixes: [User-N][Name][ROLE][LEVEL]
 */
export function stripLogPrefix(message: string): string {
  let result = message.trim();
  if (TILVEST_PREFIX_RE.test(result)) {
    result = result.replace(TILVEST_PREFIX_RE, "").trim();
  }
  // Residual [ADMIN][RESPONSE] style segments after user block
  result = result.replace(/^(?:\[[A-Z]+\])+\s*/i, "").trim();
  return result;
}

/**
 * Extract a pseudo exception type from Tilvest `[Class::method]` tags in messages.
 */
export function extractMethodTagType(message: string): string | null {
  const match = TILVEST_METHOD_TAG_RE.exec(message);
  if (!match) return null;
  return match[1];
}

/**
 * Normalize variable parts of an exception value for fingerprinting.
 */
export function normalizeExceptionValue(value: string): string {
  return stripLogPrefix(value)
    .replace(/0x[0-9a-f]+/gi, "<addr>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/<(\d+)>/g, "<id>")
    .replace(/\b\d{4,}\b/g, "<num>")
    .replace(/"[^"]{0,100}"/g, "<str>")
    .replace(/'[^']{0,100}'/g, "<str>")
    .replace(/\[[^\]]{0,80}\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse `Type: value` from a message when no structured exception is present.
 */
export function parseExceptionFromMessage(message: string): {
  type: string;
  value: string;
} {
  const stripped = stripLogPrefix(message);
  const match = EXCEPTION_TYPE_RE.exec(stripped);
  if (match) {
    return { type: match[1], value: match[2].trim() };
  }
  const methodTag = extractMethodTagType(stripped);
  if (methodTag) {
    const withoutTag = stripped.replace(TILVEST_METHOD_TAG_RE, "").trim();
    return { type: methodTag, value: normalizeExceptionValue(withoutTag) };
  }
  return { type: "Error", value: normalizeExceptionValue(stripped) };
}
