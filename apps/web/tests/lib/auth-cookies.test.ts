import { describe, expect, test } from "vitest";
import {
  buildSessionCookieHeader,
  getSessionCookieHeader,
  getSessionToken,
} from "@/lib/auth-cookies";

describe("auth cookie helpers", () => {
  test("keeps only Better Auth session cookies", () => {
    const header = getSessionCookieHeader(
      "theme=dark; better-auth.session_token=abc123; marketing=ignored"
    );

    expect(header).toBe("better-auth.session_token=abc123");
  });

  test("serializes decoded cookie values without non-ASCII header characters", () => {
    const header = buildSessionCookieHeader([
      { name: "profile", value: "Kevin 😀" },
      { name: "better-auth.session_token", value: "abc😀123" },
    ]);

    expect(header).toBe("better-auth.session_token=abc%F0%9F%98%80123");
    expect([...header].every((char) => char.charCodeAt(0) <= 255)).toBe(true);
  });

  test("handles malformed unicode without throwing", () => {
    const header = buildSessionCookieHeader([
      { name: "better-auth.session_token", value: "abc\ud83d123" },
    ]);

    expect(header).toBe("better-auth.session_token=abc%EF%BF%BD123");
  });

  test("extracts the raw session token used for middleware caching", () => {
    expect(getSessionToken("foo=bar; __Secure-better-auth.session_token=secure-token"))
      .toBe("secure-token");
  });
});
