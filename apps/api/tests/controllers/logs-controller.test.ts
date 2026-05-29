import { describe, expect, test } from "bun:test";
import { buildLogRow } from "../../src/controllers/v1/LogsController";

describe("LogsController", () => {
  test("keeps HTTP metadata on stored rows and live events", () => {
    const projectId = "project-1";
    const { row, sse } = buildLogRow(
      {
        level: "warning",
        channel: "application",
        message: "POST /orders failed",
        source: "http",
        url: "https://example.test/orders?token=secret",
        status_code: "422",
        request_id: "req_123",
        user_id: "user_123",
        trace_id: "trace_123",
        span_id: "span_123",
      },
      projectId,
    );

    expect(row.statusCode).toBe(422);
    expect(row.url).toContain("/orders");
    expect(row.requestId).toBe("req_123");
    expect(row.userId).toBe("user_123");
    expect(row.traceId).toBe("trace_123");
    expect(row.spanId).toBe("span_123");

    expect(sse.statusCode).toBe(422);
    expect(sse.url).toContain("/orders");
    expect(sse.requestId).toBe("req_123");
    expect(sse.userId).toBe("user_123");
    expect(sse.traceId).toBe("trace_123");
    expect(sse.spanId).toBe("span_123");
  });
});
