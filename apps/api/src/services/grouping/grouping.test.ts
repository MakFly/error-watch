import { describe, expect, it } from "bun:test";
import { computeFingerprintSync } from "./computeFingerprint";
import { computeGroupMetadata } from "./computeGroupMetadata";
import { stripLogPrefix, normalizeExceptionValue } from "./normalizeMessage";
import { pickThrowSiteFrame } from "./pickFrames";
import { applyStackTraceRules } from "./stackTraceRules";

describe("normalizeMessage", () => {
  it("strips Tilvest user prefix", () => {
    const raw =
      "[User-150][Julien Tourteau][ADMIN][ERROR] Distributor: <150> not found";
    expect(stripLogPrefix(raw)).toBe("Distributor: <150> not found");
  });

  it("normalizes numeric ids in values", () => {
    expect(normalizeExceptionValue("User 12345 failed")).toContain("<num>");
  });
});

describe("pickThrowSiteFrame", () => {
  it("skips logging infra and picks business frame", () => {
    const frames = applyStackTraceRules([
      { filename: "/app/vendor/laravel/Router.php", lineno: 800 },
      { filename: "/app/app/Services/Main/DocumentService.php", lineno: 489, function: "getUserInputValue" },
      { filename: "/app/app/Tilvest/Logger/Logger.php", lineno: 56, function: "error" },
    ]);

    const site = pickThrowSiteFrame(frames);
    expect(site?.filename).toContain("DocumentService.php");
    expect(site?.lineno).toBe(489);
  });
});

describe("computeFingerprintSync", () => {
  it("groups same error across different user prefixes", () => {
    const frames = [
      { filename: "/app/app/Services/Main/DocumentService.php", lineno: 489, function: "getUserInputValue", in_app: true },
      { filename: "/app/app/Tilvest/Logger/Logger.php", lineno: 56, in_app: true },
    ];

    const base = {
      projectId: "proj-1",
      frames,
      exceptionType: "Error",
      stack: "",
    };

    const fp1 = computeFingerprintSync({
      ...base,
      message: "[User-150][ADMIN][ERROR] Distributor: <150> not found",
      exceptionValue: "[User-150][ADMIN][ERROR] Distributor: <150> not found",
    });

    const fp2 = computeFingerprintSync({
      ...base,
      message: "[User-999][ADMIN][ERROR] Distributor: <999> not found",
      exceptionValue: "[User-999][ADMIN][ERROR] Distributor: <999> not found",
    });

    expect(fp1).toBe(fp2);
  });
});

describe("computeGroupMetadata", () => {
  it("builds Sentry-style title and culprit", () => {
    const frames = applyStackTraceRules([
      { filename: "/app/app/Services/Business/DocumentationService.php", lineno: 235, function: "userInformation" },
    ]);

    const meta = computeGroupMetadata({
      message: "Distributor: <150> not found",
      frames,
      exceptionType: "RuntimeException",
      exceptionValue: "Distributor: <150> not found",
    });

    expect(meta.title).toMatch(/^RuntimeException:/);
    expect(meta.file).toContain("DocumentationService.php");
    expect(meta.culprit).toContain("userInformation");
  });
});
