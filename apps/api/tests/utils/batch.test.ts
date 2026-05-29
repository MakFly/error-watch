/**
 * Tests for the batch reject summary helper (P3.1 — stop silent rejection).
 * Pure function, no DB.
 */
import { describe, test, expect } from "bun:test";
import { summarizeRejections } from "../../src/utils/batch";

describe("summarizeRejections", () => {
  test("returns zeroed summary for no rejects", () => {
    const s = summarizeRejections([]);
    expect(s.count).toBe(0);
    expect(s.byReason).toEqual({});
    expect(s.byType).toEqual({});
    expect(s.firstIndex).toBeNull();
    expect(s.firstReason).toBeNull();
  });

  test("aggregates counts per reason and per type", () => {
    const s = summarizeRejections([
      { index: 1, type: "log", reason: "validation_error" },
      { index: 3, type: "log", reason: "validation_error" },
      { index: 5, type: "event", reason: "quota_exceeded" },
      { index: 7, type: "transaction", reason: "processing_error" },
    ]);

    expect(s.count).toBe(4);
    expect(s.byReason).toEqual({
      validation_error: 2,
      quota_exceeded: 1,
      processing_error: 1,
    });
    expect(s.byType).toEqual({ log: 2, event: 1, transaction: 1 });
  });

  test("captures the first reject's index and reason", () => {
    const s = summarizeRejections([
      { index: 9, type: "event", reason: "redis_unavailable" },
      { index: 2, type: "log", reason: "validation_error" },
    ]);
    expect(s.firstIndex).toBe(9);
    expect(s.firstReason).toBe("redis_unavailable");
  });
});
