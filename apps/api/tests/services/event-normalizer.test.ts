import { describe, expect, test } from "bun:test";

import {
  extractHttpStatusCodeFromMessage,
  normalizeEvent,
} from "../../src/services/eventNormalizer";

describe("eventNormalizer HTTP status extraction", () => {
  test("extracts explicit response status codes from Laravel admin logs", () => {
    expect(
      extractHttpStatusCodeFromMessage(
        "[2026-05-29][Etienne Michel][ADMIN][RESPONSE][OK] Status Code : 200"
      )
    ).toBe(200);
    expect(extractHttpStatusCodeFromMessage("[RESPONSE] Status Code : 201")).toBe(201);
  });

  test("prefers the explicit response status over an ambiguous profiler status", () => {
    const event = normalizeEvent(
      {
        message: "[2026-05-29][Etienne Michel][ADMIN][RESPONSE][OK] Status Code : 200",
        env: "dev",
        level: "info",
        created_at: Date.now(),
        profile: {
          url: "http://127.0.0.1:8000/iapi/v2/admin/dashboard/kpis",
          method: "GET",
          status_code: 500,
        },
      },
      "project-1",
      true
    );

    expect(event.statusCode).toBe(200);
    expect(event.url).toBe("http://127.0.0.1:8000/iapi/v2/admin/dashboard/kpis");
  });

  test("does not turn non-error request logs into fake 500 issues", () => {
    const event = normalizeEvent(
      {
        message: "[2026-05-29][Etienne Michel][ADMIN][REQUEST] GET http://127.0.0.1:8000/iapi/v2/admin/dashboard/kpis",
        env: "dev",
        level: "warning",
        created_at: Date.now(),
        profile: {
          url: "http://127.0.0.1:8000/iapi/v2/admin/dashboard/kpis",
          method: "GET",
          status_code: 500,
        },
      },
      "project-1",
      true
    );

    expect(event.statusCode).toBeNull();
  });
});
