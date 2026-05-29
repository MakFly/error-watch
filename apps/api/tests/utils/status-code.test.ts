/**
 * Tests for HTTP status-code helpers used by log ingestion (coerceStatusCode)
 * and tail/group filtering (parseStatusCodeFilter). Pure functions, no DB.
 */
import { describe, test, expect } from "bun:test";
import { coerceStatusCode, parseStatusCodeFilter } from "../../src/utils/status-code";

describe("coerceStatusCode", () => {
  test("accepts a valid integer status code", () => {
    expect(coerceStatusCode(422)).toBe(422);
    expect(coerceStatusCode(200)).toBe(200);
    expect(coerceStatusCode(599)).toBe(599);
    expect(coerceStatusCode(100)).toBe(100);
  });

  test("accepts a 3-digit numeric string (SDKs often send strings)", () => {
    expect(coerceStatusCode("404")).toBe(404);
    expect(coerceStatusCode(" 503 ")).toBe(503);
  });

  test("rejects out-of-range codes", () => {
    expect(coerceStatusCode(99)).toBeNull();
    expect(coerceStatusCode(600)).toBeNull();
    expect(coerceStatusCode("999")).toBeNull();
  });

  test("rejects garbage (mirrors the debug->>'status_code' cast guard)", () => {
    expect(coerceStatusCode("unknown")).toBeNull();
    expect(coerceStatusCode("4xx")).toBeNull();
    expect(coerceStatusCode("42")).toBeNull(); // not 3 digits
    expect(coerceStatusCode("0422")).toBeNull(); // 4 digits
    expect(coerceStatusCode(422.5)).toBeNull(); // not an integer
    expect(coerceStatusCode(null)).toBeNull();
    expect(coerceStatusCode(undefined)).toBeNull();
    expect(coerceStatusCode({})).toBeNull();
  });
});

describe("parseStatusCodeFilter", () => {
  test("parses an exact 3-digit code", () => {
    expect(parseStatusCodeFilter("422")).toEqual({ kind: "exact", code: 422 });
    expect(parseStatusCodeFilter(" 200 ")).toEqual({ kind: "exact", code: 200 });
  });

  test("parses a family token into an inclusive range", () => {
    expect(parseStatusCodeFilter("4xx")).toEqual({ kind: "family", min: 400, max: 499 });
    expect(parseStatusCodeFilter("5XX")).toEqual({ kind: "family", min: 500, max: 599 });
    expect(parseStatusCodeFilter("2xx")).toEqual({ kind: "family", min: 200, max: 299 });
  });

  test("returns null for empty / unrecognised / out-of-range tokens", () => {
    expect(parseStatusCodeFilter(undefined)).toBeNull();
    expect(parseStatusCodeFilter(null)).toBeNull();
    expect(parseStatusCodeFilter("")).toBeNull();
    expect(parseStatusCodeFilter("6xx")).toBeNull();
    expect(parseStatusCodeFilter("0xx")).toBeNull();
    expect(parseStatusCodeFilter("99")).toBeNull();
    expect(parseStatusCodeFilter("700")).toBeNull();
    expect(parseStatusCodeFilter("abc")).toBeNull();
  });
});

/**
 * Mirrors the LogsController.tail filter decision: which SQL condition does a
 * given status_code query string produce? (= vs BETWEEN vs no filter)
 */
describe("tail status_code filter decision (mirrors LogsController.tail)", () => {
  function decide(raw: string | undefined): string {
    const f = parseStatusCodeFilter(raw);
    if (!f) return "no-filter";
    if (f.kind === "exact") return `eq ${f.code}`;
    return `between ${f.min} ${f.max}`;
  }

  test("exact code → equality", () => {
    expect(decide("422")).toBe("eq 422");
  });

  test("family → range", () => {
    expect(decide("5xx")).toBe("between 500 599");
    expect(decide("4xx")).toBe("between 400 499");
  });

  test("absent/garbage → no filter (backward compatible)", () => {
    expect(decide(undefined)).toBe("no-filter");
    expect(decide("")).toBe("no-filter");
    expect(decide("garbage")).toBe("no-filter");
  });
});
