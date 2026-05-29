/**
 * REST API client utilities
 * Using API v1
 */

import { logApiCall, createApiTimer } from '@/lib/api-logger';
import { buildSessionCookieHeader, getSessionCookieHeader } from '@/lib/auth-cookies';
import { getInternalMonitoringApiUrl } from '@/lib/config';

export const API_VERSION = "v1";

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export function getApiUrl(): string {
  return getInternalMonitoringApiUrl();
}

export function getApiBase(): string {
  return `${getApiUrl()}/api/${API_VERSION}`;
}

/** Forward client IP to the monitoring API so SSR requests are not all keyed as the web container. */
async function mergeIncomingForwardingHeaders(headers: Record<string, string>): Promise<void> {
  if (typeof window !== "undefined") return;
  try {
    const { headers: getHeaders } = await import("next/headers");
    const incoming = await getHeaders();
    const xff = incoming.get("x-forwarded-for");
    const xri = incoming.get("x-real-ip");
    if (xff) headers["X-Forwarded-For"] = xff;
    if (xri) headers["X-Real-IP"] = xri;
  } catch {
    // Outside a Next request (e.g. build) — omit forwarding
  }
}

function normalizeCookieHeader(headers: Record<string, string>): void {
  const cookieHeader = headers["Cookie"] ?? headers["cookie"];
  if (!cookieHeader) return;

  const sessionCookieHeader = getSessionCookieHeader(cookieHeader);
  delete headers["cookie"];

  if (sessionCookieHeader) {
    headers["Cookie"] = sessionCookieHeader;
  } else {
    delete headers["Cookie"];
  }
}

export async function fetchAPI<T>(endpoint: string, options?: RequestInit & { cookie?: string }): Promise<T> {
  const apiUrl = getApiUrl();
  const apiBase = getApiBase();

  // Determine if endpoint is already versioned or needs base URL
  const url = endpoint.startsWith("/api/")
    ? `${apiUrl}${endpoint}`
    : `${apiBase}${endpoint}`;

  const method = (options?.method || 'GET') as HttpMethod;
  const body = options?.body ? JSON.parse(options.body as string) : undefined;
  const getElapsedTime = createApiTimer();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };

  // Forward cookie if provided, or try to get from server-side cookies
  if (options?.cookie) {
    const sessionCookieHeader = getSessionCookieHeader(options.cookie);
    if (sessionCookieHeader) {
      headers["Cookie"] = sessionCookieHeader;
    }
  } else {
    try {
      const { cookies } = await import("next/headers");
      const cookieStore = await cookies();
      const sessionCookieHeader = buildSessionCookieHeader(cookieStore.getAll());
      if (sessionCookieHeader) {
        headers["Cookie"] = sessionCookieHeader;
      }
    } catch {
      // Not in a Server Component context, ignore
    }
  }

  normalizeCookieHeader(headers);
  await mergeIncomingForwardingHeaders(headers);

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: "include", // Important pour envoyer les cookies côté client
  });

  const duration = getElapsedTime();
  const hasAuth = !!(headers as Record<string, string>)["Cookie"];

  if (!res.ok) {
    logApiCall({ method, url, status: res.status, duration, hasAuth, body, error: res.statusText });
    const { TRPCError } = await import("@trpc/server");
    const codeMap: Record<number, ConstructorParameters<typeof TRPCError>[0]["code"]> = {
      400: "BAD_REQUEST",
      401: "UNAUTHORIZED",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      405: "METHOD_NOT_SUPPORTED",
      408: "TIMEOUT",
      409: "CONFLICT",
      413: "PAYLOAD_TOO_LARGE",
      422: "UNPROCESSABLE_CONTENT",
      429: "TOO_MANY_REQUESTS",
      499: "CLIENT_CLOSED_REQUEST",
    };
    throw new TRPCError({
      code: codeMap[res.status] ?? "INTERNAL_SERVER_ERROR",
      message: `API error: ${res.status} ${res.statusText}`,
    });
  }

  logApiCall({ method, url, status: res.status, duration, hasAuth, body });

  const data = await res.json();
  return data;
}
