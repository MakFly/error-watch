/**
 * tRPC base configuration
 * @see https://trpc.io/docs/server/setup
 */
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { cookies } from "next/headers";
import { cache } from "react";
import { buildSessionCookieHeader } from "@/lib/auth-cookies";
import { getInternalMonitoringApiUrl } from "@/lib/config";

/**
 * Session type from BetterAuth
 */
interface Session {
  user: {
    id: string;
    email: string;
    name?: string;
    image?: string;
  };
}

/**
 * Context for tRPC procedures
 */
export interface Context {
  session: Session | null;
}

/**
 * Cached session fetch - deduplicates within a single RSC render pass
 */
const getSessionFromCookie = cache(async (cookieHeader: string): Promise<Session | null> => {
  const response = await fetch(`${getInternalMonitoringApiUrl()}/api/auth/get-session`, {
    headers: { Cookie: cookieHeader },
    cache: "no-store",
  });
  if (response.ok) {
    const data = await response.json();
    if (data?.user?.id) return { user: data.user } as Session;
  }
  return null;
});

/**
 * Create tRPC context with session from cookies
 */
export const createTRPCContext = async (): Promise<Context> => {
  let session: Session | null = null;

  try {
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();

    const cookieHeader = buildSessionCookieHeader(allCookies);

    if (cookieHeader) {
      session = await getSessionFromCookie(cookieHeader);
    }
  } catch (error) {
    console.debug("[tRPC] Failed to get session:", error);
  }

  return { session };
};

/**
 * Initialize tRPC
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

/**
 * Exports
 */
export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
export const middleware = t.middleware;
