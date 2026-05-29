const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
] as const;

type SessionCookieName = (typeof SESSION_COOKIE_NAMES)[number];

type CookieLike = {
  name: string;
  value: string;
};

function isSessionCookieName(name: string): name is SessionCookieName {
  return SESSION_COOKIE_NAMES.includes(name as SessionCookieName);
}

function normalizeCookieValue(value: string): string {
  if (!/[^\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]/.test(value)) {
    return value;
  }

  return Array.from(new TextEncoder().encode(value))
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]/.test(char)
        ? char
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
}

function serializeSessionCookie(name: SessionCookieName, value: string): string {
  return `${name}=${normalizeCookieValue(value)}`;
}

export function buildSessionCookieHeader(cookies: Iterable<CookieLike>): string {
  return Array.from(cookies)
    .filter((cookie) => isSessionCookieName(cookie.name))
    .map((cookie) => serializeSessionCookie(cookie.name, cookie.value))
    .join("; ");
}

export function getSessionCookieHeader(cookieHeader: string): string {
  const sessionCookies: string[] = [];

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;

    const name = part.slice(0, separatorIndex).trim();
    if (!isSessionCookieName(name)) continue;

    const value = part.slice(separatorIndex + 1).trim();
    sessionCookies.push(serializeSessionCookie(name, value));
  }

  return sessionCookies.join("; ");
}

export function getSessionToken(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;

    const name = part.slice(0, separatorIndex).trim();
    if (!isSessionCookieName(name)) continue;

    return part.slice(separatorIndex + 1).trim() || null;
  }

  return null;
}
