/**
 * Queue definitions for BullMQ
 * @description Defines all queues used by the monitoring server
 */
import { Queue } from "bullmq";
import { redisConnection } from "./connection";

/**
 * Event queue - processes error events from SDKs
 */
export const eventQueue = new Queue("events", {
  ...redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 1000, // Keep last 1000 completed jobs
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  },
});

/**
 * Replay queue - processes session replay data
 */
export const replayQueue = new Queue("replays", {
  ...redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600,
      count: 500,
    },
    removeOnFail: {
      age: 86400,
    },
  },
});

/**
 * Alert queue - processes alert notifications (email, Slack, webhooks)
 */
export const alertQueue = new Queue("alerts", {
  ...redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 7200, // Keep for 2 hours
      count: 500,
    },
    removeOnFail: {
      age: 172800, // Keep failed for 48 hours (important for debugging)
    },
  },
});

/**
 * Job data types
 */
export interface EventJobData {
  projectId: string;
  message: string;
  file: string;
  line: number;
  column?: number;
  stack: string;
  env: string;
  url: string | null;
  level: "fatal" | "error" | "warning" | "info" | "debug";
  statusCode: number | null;
  breadcrumbs: unknown;
  sessionId: string | null;
  release?: string | null;
  userId?: string | null;
  createdAt: string;
  // v2 enriched fields
  exceptionType?: string;
  exceptionValue?: string;
  platform?: string;
  serverName?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  userContext?: {
    id?: string;
    email?: string;
    ip_address?: string;
    username?: string;
  };
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    query_string?: string;
    data?: unknown;
  };
  contexts?: Record<string, unknown>;
  sdk?: { name: string; version: string };
  frames?: Array<{
    filename: string;
    function?: string | null;
    lineno?: number | null;
    colno?: number | null;
    in_app?: boolean;
    context_line?: string | null;
    pre_context?: string[] | null;
    post_context?: string[] | null;
  }>;
  fingerprintVersion?: 1 | 2 | 3;
  // SDK-supplied explicit fingerprint (overrides auto-generation when set)
  sdkFingerprint?: string | null;
  // Sentry exception.values[] (chained exceptions, root = last entry)
  exceptionValues?: Array<{
    type: string;
    value: string;
    mechanism?: { type?: string; handled?: boolean; source?: string } | null;
  }> | null;
  mechanism?: { type?: string; handled?: boolean; source?: string } | null;
  // Distributed tracing correlation (W3C traceparent)
  traceId?: string | null;
  spanId?: string | null;
  // Full request profile (laravel-web-profiler parity), persisted as-is in
  // error_events.debug. Null when SDK profiler is disabled or unsupported.
  debug?: Record<string, unknown> | null;
}

export interface ReplayJobData {
  projectId: string;
  sessionId: string;
  events: string | null;
  error: {
    message: string;
    file?: string;
    line?: number;
    stack?: string;
    level: "fatal" | "error" | "warning" | "info" | "debug";
  };
  url: string | null;
  userAgent: string | null;
  timestamp: number;
  release?: string | null;
}

export interface AlertJobData {
  projectId: string;
  fingerprint: string;
  isNewGroup: boolean;
  isRegression: boolean;
  level: string;
  message: string;
}

/**
 * Aggregation queue - nightly aggregation & cleanup cron jobs
 */
export const aggregationQueue = new Queue("aggregation", {
  ...redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 10000,
    },
    removeOnComplete: {
      age: 86400, // Keep for 24 hours
      count: 100,
    },
    removeOnFail: {
      age: 604800, // Keep failed for 7 days
    },
  },
});

export type AggregationJobType = "aggregate-hourly" | "aggregate-daily" | "cleanup-expired";

export interface AggregationJobData {
  type: AggregationJobType;
  targetDate?: string; // ISO date string
}

/**
 * Metrics queue - processes system metrics from agents
 */
export const metricsQueue = new Queue("metrics", {
  ...redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: {
      age: 3600,
      count: 5000,
    },
    removeOnFail: {
      age: 86400,
    },
  },
});

/**
 * Cron monitor queue — checks for missed/overdue cron jobs
 */
export const cronMonitorQueue = new Queue("cron-monitor", {
  ...redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600,
      count: 100,
    },
    removeOnFail: {
      age: 86400,
    },
  },
});

export interface CronMonitorJobData {
  type: "check-missed";
}

export interface MetricsJobData {
  projectId: string;
  hostId: string;
  hostname: string;
  os: string;
  osVersion?: string;
  architecture?: string;
  cpu: string;
  memory: string;
  disks: string | null;
  networks: string | null;
  tags: string | null;
  timestamp: string;
}
