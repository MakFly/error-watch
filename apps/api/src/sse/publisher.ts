import { Redis } from "ioredis";
import logger from "../logger";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Dedicated Redis client for publishing (separate from BullMQ)
const pubClient = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
});

let connected = false;

async function ensureConnected(): Promise<boolean> {
  if (connected) return true;
  try {
    await pubClient.connect();
    connected = true;
    return true;
  } catch {
    return false;
  }
}

pubClient.on("error", (err) => {
  logger.warn("SSE pub client error", { error: err.message });
  connected = false;
});

export interface SSEEvent {
  type: "issue:new" | "issue:updated" | "issue:regressed" | "alert:triggered" | "transaction:new" | "replay:new" | "log:new";
  projectId: string;
  payload: {
    fingerprint?: string;
    message?: string;
    level?: string;
    sessionId?: string;
    transactionId?: string;
    log?: {
      id: string;
      timestamp: string;
      level: string;
      channel: string;
      message: string;
      source: string;
      env?: string | null;
      release?: string | null;
      url?: string | null;
      statusCode?: number | null;
      requestId?: string | null;
      userId?: string | null;
      traceId?: string | null;
      spanId?: string | null;
    };
    sampled?: boolean;
  };
  timestamp: number;
}

export async function publishEvent(orgId: string, event: SSEEvent): Promise<void> {
  try {
    if (!(await ensureConnected())) return;
    await pubClient.publish(`sse:org:${orgId}`, JSON.stringify(event));
  } catch (err) {
    // Fire-and-forget: don't block the worker if Redis pub fails
    logger.warn("SSE publish failed", { orgId, type: event.type, error: err });
  }
}

export async function closePubClient(): Promise<void> {
  if (connected) {
    await pubClient.quit();
    connected = false;
  }
}

export interface MetricsEvent {
  hostId: string;
  hostname: string;
  os: string;
  osVersion: string | null;
  architecture: string | null;
  cpu: {
    user: number;
    system: number;
    idle: number;
    iowait?: number;
    steal?: number;
    nice?: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    available: number;
    cached?: number;
    buffers?: number;
    swapTotal?: number;
    swapUsed?: number;
    swapFree?: number;
  };
  disks: Array<{
    device: string;
    mountPoint: string;
    total: number;
    used: number;
    free: number;
    inodesTotal?: number;
    inodesUsed?: number;
    inodesFree?: number;
    readBytes?: number;
    writeBytes?: number;
  }> | null;
  networks: Array<{
    interface: string;
    rxBytes: number;
    txBytes: number;
    rxPackets?: number;
    txPackets?: number;
    rxErrors?: number;
    txErrors?: number;
    rxDropped?: number;
    txDropped?: number;
  }> | null;
  tags: Record<string, string> | null;
  timestamp: string;
}

export async function publishMetrics(projectId: string, metrics: MetricsEvent): Promise<void> {
  try {
    if (!(await ensureConnected())) return;
    await pubClient.publish(`sse:metrics:${projectId}`, JSON.stringify(metrics));
  } catch (err) {
    logger.warn("Metrics SSE publish failed", { projectId, error: err });
  }
}
