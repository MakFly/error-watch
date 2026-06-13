/**
 * API Key Middleware
 * @description Validates API keys for SDK event submission
 */
import type { Context, Next } from "hono";
import { cacheApiKey, getCachedApiKey, isApiKeyFormat, validateApiKey } from "../services/api-keys";
import logger from "../logger";
import type { AppEnv } from "../types/hono";

/**
 * API Key validation middleware
 */
export async function apiKeyMiddleware(c: Context<AppEnv>, next: Next) {
  // Accept Flare's `x-api-token` header as a fallback for protocol compatibility.
  const apiKey = c.req.header("X-API-Key") ?? c.req.header("x-api-token");

  // Check if API key is present
  if (!apiKey) {
    logger.warn("Missing API key in request", {
      path: c.req.path,
      method: c.req.method,
    });
    return c.json(
      { error: "API key required", code: "MISSING_API_KEY" },
      401
    );
  }

  // Validate format before database lookup
  if (!isApiKeyFormat(apiKey)) {
    logger.warn("Invalid API key format", {
      length: apiKey.length,
      prefix: apiKey.slice(0, 8),
    });
    return c.json(
      { error: "Invalid API key format", code: "INVALID_API_KEY_FORMAT" },
      401
    );
  }

  // Check cache first
  const cached = getCachedApiKey(apiKey);
  if (cached) {
    c.set("apiKey", {
      id: cached.id,
      projectId: cached.projectId,
    });
    return next();
  }

  // Validate against database
  const validatedKey = await validateApiKey(apiKey);

  if (!validatedKey) {
    logger.warn("Invalid API key", {
      keyPrefix: apiKey.slice(0, 12),
    });
    return c.json(
      { error: "Invalid API key", code: "INVALID_API_KEY" },
      401
    );
  }

  // Cache the validated key
  cacheApiKey(apiKey, {
    id: validatedKey.id,
    projectId: validatedKey.projectId,
  });

  // Inject projectId into context for use in event handler
  c.set("apiKey", {
    id: validatedKey.id,
    projectId: validatedKey.projectId,
  });

  logger.debug("API key validated", {
    projectId: validatedKey.projectId,
    keyId: validatedKey.id.slice(0, 8),
  });

  await next();
}

/**
 * Extract API key type (live or test)
 */
export function getApiKeyType(apiKey: string): "live" | "test" | null {
  const match = apiKey.match(/^ew_(live|test)_/);
  return match ? (match[1] as "live" | "test") : null;
}
