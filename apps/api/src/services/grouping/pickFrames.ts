import type { GroupingFrame } from "./types";

export function frameIsInApp(frame: GroupingFrame): boolean {
  if (frame.in_app === false) return false;
  if (frame.in_app === true) return true;
  const file = frame.filename ?? "";
  return !isVendorPath(file);
}

function isVendorPath(file: string): boolean {
  return (
    file.includes("/vendor/") ||
    file.includes("node_modules") ||
    file.includes("[internal]") ||
    file === ""
  );
}

/** Logging infrastructure paths excluded from throw-site selection. */
function isLoggingInfraPath(file: string): boolean {
  return (
    /\/Tilvest\/Logger\//i.test(file) ||
    /\/Illuminate\/Log\//i.test(file) ||
    /\/Illuminate\/Events\//i.test(file) ||
    /IapiLogger\.php$/i.test(file) ||
    /ApiLogger\.php$/i.test(file) ||
    /\/Monolog\//i.test(file)
  );
}

/**
 * Sentry convention: frames oldest → newest; throw site = last meaningful in-app frame.
 */
export function pickThrowSiteFrame(frames: GroupingFrame[] | undefined): GroupingFrame | undefined {
  if (!frames || frames.length === 0) return undefined;

  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const f = frames[i];
    if (!frameIsInApp(f)) continue;
    if (isLoggingInfraPath(f.filename)) continue;
    return f;
  }

  // Fallback: last in-app even if logging infra
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    if (frameIsInApp(frames[i])) return frames[i];
  }

  return frames[frames.length - 1];
}

/**
 * In-app frames used for stack-based fingerprinting (Sentry: in-app only).
 */
export function pickGroupingFrames(frames: GroupingFrame[] | undefined): GroupingFrame[] {
  if (!frames || frames.length === 0) return [];
  const inApp = frames.filter((f) => frameIsInApp(f) && !isLoggingInfraPath(f.filename));
  if (inApp.length > 0) return inApp;
  return frames.filter((f) => frameIsInApp(f));
}

/**
 * Deepest frame index (0-based) for comparing which event has a better anchor.
 */
export function throwSiteDepth(frames: GroupingFrame[] | undefined): number {
  const site = pickThrowSiteFrame(frames);
  if (!site || !frames) return -1;
  return frames.indexOf(site);
}
