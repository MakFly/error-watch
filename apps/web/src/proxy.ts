import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";

import { getSessionCookieHeader, getSessionToken } from "@/lib/auth-cookies";
import { getInternalMonitoringApiUrl, getServerEnvFlag, getServerNodeEnv } from "@/lib/config";
import { routing } from "@/i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

function propagateIntlCookies(intlResponse: NextResponse, response: NextResponse): NextResponse {
  intlResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie.name, cookie.value);
  });
  // Propagate intl headers (x-next-intl-locale)
  intlResponse.headers.forEach((value, key) => {
    if (key.startsWith("x-next-intl")) {
      response.headers.set(key, value);
    }
  });
  return response;
}

const API_VERSION = "v1";

/** So API rate limits use the browser IP, not the web container (Docker internal). */
function rateLimitForwardHeaders(request: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  const xff = request.headers.get("x-forwarded-for");
  const xri = request.headers.get("x-real-ip");
  if (xff) out["X-Forwarded-For"] = xff;
  if (xri) out["X-Real-IP"] = xri;
  return out;
}

const CACHE_TTL = 30000;

type SessionCacheEntry = {
  userId: string;
  expires: number;
};

const sessionCache = new Map<string, SessionCacheEntry>();

type InstanceStatus = {
  selfHosted: boolean;
  initialized: boolean;
  allowSetup: boolean;
  allowPublicSignup: boolean;
};

function getSessionFromCache(sessionToken: string): string | null {
  const entry = sessionCache.get(sessionToken);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    sessionCache.delete(sessionToken);
    return null;
  }
  return entry.userId;
}

function setSessionCache(sessionToken: string, userId: string) {
  if (sessionCache.size > 1000) {
    const oldestKey = sessionCache.keys().next().value;
    if (oldestKey) sessionCache.delete(oldestKey);
  }
  sessionCache.set(sessionToken, { userId, expires: Date.now() + CACHE_TTL });
}

function invalidateSessionCache(sessionToken: string) {
  sessionCache.delete(sessionToken);
}

function invalidateSessionAndRedirect(
  request: NextRequest,
  redirectPath?: string,
  errorCode?: string
): NextResponse {
  const loginUrl = new URL("/login", request.url);
  if (redirectPath) {
    loginUrl.searchParams.set("redirect", redirectPath);
  }
  if (errorCode) {
    loginUrl.searchParams.set("error", errorCode);
  }
  const response = NextResponse.redirect(loginUrl);
  response.cookies.delete("better-auth.session_token");
  response.cookies.delete("__Secure-better-auth.session_token");
  return response;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const cookieHeader = request.headers.get("cookie") ?? "";
  const sessionCookieHeader = getSessionCookieHeader(cookieHeader);
  const apiUrl = getInternalMonitoringApiUrl();
  const failOpen = getServerEnvFlag("AUTH_FAIL_OPEN") || getServerNodeEnv() !== "production";
  const selfHosted = getServerEnvFlag("SELF_HOSTED");

  const isApiRoute = pathname.startsWith("/api");
  const isStaticRoute = pathname.startsWith("/_next");

  // Skip intl middleware for API routes and static assets — they don't need locale resolution
  if (isApiRoute || isStaticRoute) {
    return NextResponse.next();
  }

  // Run next-intl middleware to resolve locale and set NEXT_LOCALE cookie
  const intlResponse = intlMiddleware(request);

  const publicRoutes = ["/", "/login", "/signup", "/setup", "/invite"];
  const isPublicRoute = publicRoutes.some(
    (route) => pathname === route || (route !== "/" && pathname.startsWith(`${route}/`))
  );
  const isOnboardingRoute = pathname.startsWith("/onboarding");

  const authRoutes = ["/login", "/signup", "/setup"];
  const isAuthRoute = authRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  const sessionToken = getSessionToken(cookieHeader);
  const hasSessionCookie = sessionToken !== null;

  let instanceStatus: InstanceStatus | null = null;
  if (selfHosted) {
    try {
      const instanceRes = await fetch(`${apiUrl}/api/${API_VERSION}/instance/status`, {
        cache: "no-store",
        headers: rateLimitForwardHeaders(request),
      });

      if (!instanceRes.ok) {
        if (!failOpen) {
          return new NextResponse("Service unavailable", { status: 503 });
        }
      } else {
        instanceStatus = await instanceRes.json();
      }
    } catch (error) {
      console.error("[Middleware] Failed to fetch instance status:", error);
      if (!failOpen) {
        return new NextResponse("Service unavailable", { status: 503 });
      }
    }
  }

  if (selfHosted && instanceStatus) {
    if (!instanceStatus.initialized) {
      const shouldRedirectToSetup =
        pathname === "/" ||
        pathname === "/login" ||
        pathname.startsWith("/login/") ||
        pathname === "/signup" ||
        pathname.startsWith("/signup/");

      if (shouldRedirectToSetup) {
        return propagateIntlCookies(intlResponse, NextResponse.redirect(new URL("/setup", request.url)));
      }
    } else {
      if (pathname === "/") {
        return propagateIntlCookies(intlResponse, NextResponse.redirect(new URL("/login", request.url)));
      }

      if (
        pathname === "/setup" ||
        pathname.startsWith("/setup/") ||
        pathname === "/signup" ||
        pathname.startsWith("/signup/")
      ) {
        const redirectTarget = hasSessionCookie ? "/dashboard" : "/login";
        return propagateIntlCookies(intlResponse, NextResponse.redirect(new URL(redirectTarget, request.url)));
      }
    }
  }

  if (hasSessionCookie && isAuthRoute) {
    return propagateIntlCookies(intlResponse, NextResponse.redirect(new URL("/dashboard", request.url)));
  }

  if (isPublicRoute) {
    return intlResponse;
  }

  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return propagateIntlCookies(intlResponse, NextResponse.redirect(loginUrl));
  }

  let sessionValidationFailed = false;
  let userId: string | null = null;

  const cachedUserId = sessionToken ? getSessionFromCache(sessionToken) : null;
  if (cachedUserId) {
    userId = cachedUserId;
  } else {
    try {
      const sessionRes = await fetch(`${apiUrl}/api/auth/get-session`, {
        headers: {
          ...rateLimitForwardHeaders(request),
          ...(sessionCookieHeader ? { Cookie: sessionCookieHeader } : {}),
          ...(request.headers.get("origin") ? { Origin: request.headers.get("origin")! } : {}),
        },
        cache: "no-store",
        credentials: "include",
      });

      if (!sessionRes.ok) {
        if (sessionToken) invalidateSessionCache(sessionToken);
        return invalidateSessionAndRedirect(request, pathname);
      }

      const sessionData = await sessionRes.json();
      if (!sessionData?.user?.id) {
        if (sessionToken) invalidateSessionCache(sessionToken);
        return invalidateSessionAndRedirect(request, pathname);
      }

      userId = sessionData.user.id;
      if (sessionToken && userId) {
        setSessionCache(sessionToken, userId);
      }
    } catch (error) {
      console.error("[Middleware] Failed to validate session:", error);
      sessionValidationFailed = true;
      if (!failOpen) {
        return invalidateSessionAndRedirect(request, pathname, "auth_unavailable");
      }
    }
  }

  if (!pathname.startsWith("/dashboard") && !isOnboardingRoute) {
    return intlResponse;
  }

  if (pathname === "/dashboard" || pathname === "/dashboard/") {
    try {
      const [statusRes, orgsRes] = await Promise.all([
        fetch(`${apiUrl}/api/${API_VERSION}/onboarding/status`, {
          headers: {
            ...rateLimitForwardHeaders(request),
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          },
        }),
        fetch(`${apiUrl}/api/${API_VERSION}/organizations`, {
          headers: {
            ...rateLimitForwardHeaders(request),
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          },
        }),
      ]);

      let needsOnboarding = false;
      if (statusRes.ok) {
        const status = await statusRes.json();
        needsOnboarding = status.needsOnboarding ?? false;
      }

      if (needsOnboarding) {
        return propagateIntlCookies(intlResponse, NextResponse.redirect(new URL("/onboarding", request.url)));
      }

      if (orgsRes.ok) {
        const organizations = await orgsRes.json();
        if (organizations && organizations.length > 0) {
          return propagateIntlCookies(intlResponse, NextResponse.redirect(
            new URL(`/dashboard/${organizations[0].slug}`, request.url)
          ));
        }
      }

      return propagateIntlCookies(intlResponse, NextResponse.redirect(new URL("/onboarding", request.url)));
    } catch (error) {
      console.error("Failed to fetch organizations:", error);
      if (!failOpen) {
        return new NextResponse("Service unavailable", { status: 503 });
      }
    }
  }

  if (!sessionValidationFailed && isOnboardingRoute) {
    try {
      const statusRes = await fetch(
        `${apiUrl}/api/${API_VERSION}/onboarding/status`,
        {
          headers: {
            ...rateLimitForwardHeaders(request),
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          },
        }
      );

      if (statusRes.ok) {
        const status = await statusRes.json();
        if (!status.needsOnboarding) {
          return propagateIntlCookies(intlResponse, NextResponse.redirect(new URL("/dashboard", request.url)));
        }
      }
    } catch (error) {
      console.error("Failed to check onboarding status:", error);
      if (!failOpen) {
        return new NextResponse("Service unavailable", { status: 503 });
      }
    }
  }

  return intlResponse;
}

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|_next/webpack|.*\\.(?:ico|png|jpg|jpeg|svg|css|js|woff2?)$).*)",
  ],
};
