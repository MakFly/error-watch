export type PerformanceDateRange = "24h" | "7d" | "30d" | "90d" | "6m" | "1y";

export type Transaction = {
  id: string;
  projectId: string;
  name: string;
  op: string;
  traceId: string | null;
  parentSpanId: string | null;
  status: string | null;
  duration: number;
  startTimestamp: Date;
  endTimestamp: Date;
  tags: string | null;
  data: string | null;
  env: string;
  createdAt: Date;
};

export type Span = {
  id: string;
  transactionId: string;
  parentSpanId: string | null;
  op: string;
  description: string | null;
  status: string | null;
  duration: number;
  startTimestamp: Date;
  endTimestamp: Date;
  data: string | null;
};

export type TransactionWithSpans = Transaction & {
  spans: Span[];
};

export type TransactionsResponse = {
  transactions: Transaction[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type SlowestTransaction = {
  name: string;
  op: string;
  avgDuration: number;
  maxDuration: number;
  count: number;
};

export interface SpanOpSummary {
  op: string;
  count: number;
  totalDuration: number;
  avgDuration: number;
}

export interface DuplicateQuery {
  description: string;
  count: number;
  totalDuration: number;
}

export interface N1Query {
  description: string;
  count: number;
  totalDuration: number;
  transactionId: string;
  transactionName: string;
}

export interface SlowQuery {
  description: string;
  duration: number;
  transactionId: string;
  transactionName: string;
}

export interface SpanAnalysis {
  byOp: SpanOpSummary[];
  n1Queries: N1Query[];
  frequentQueries: DuplicateQuery[];
  slowQueries: SlowQuery[];
}

export interface ApdexScore {
  score: number;
  total: number;
  satisfied: number;
  tolerating: number;
  frustrated: number;
  threshold: number;
}

export interface ServerStats {
  throughput: number;
  totalTransactions: number;
  errorRate: number;
  errorCount: number;
  avgDuration: number;
  p95Duration: number;
}

export interface EndpointImpact {
  name: string;
  op: string;
  count: number;
  avgDuration: number;
  totalDuration: number;
  errorCount: number;
  percentOfTotal: number;
}

// Timeline types for charts
export interface ThroughputBucket {
  bucket: string;
  count: number;
  errorCount: number;
}

export interface DurationBucket {
  bucket: string;
  p50: number;
  p75: number;
  p95: number;
}

// External HTTP calls aggregated by host+method
export interface ExternalCallSummary {
  host: string;
  method: string | null;
  count: number;
  avgDuration: number;
  p95Duration: number;
  maxDuration: number;
  errorCount: number;
  errorRate: number;        // percent, 2 decimals
  percentOfTotal: number;   // percent of total call count
}

// Cache operations aggregated by op
export interface CacheOpSummary {
  op: string;
  count: number;
  hits: number;
  misses: number;
  hitRate: number;          // percent, 2 decimals
  avgDuration: number;
  p95Duration: number;
}

export interface CacheSummary {
  entries: CacheOpSummary[];
  summary: {
    totalCount: number;
    totalHits: number;
    totalMisses: number;
    hitRate: number;
  };
}

// Queue / message-bus operations aggregated by messageClass + op
export interface QueueOpSummary {
  op: string;
  messageClass: string;
  transport: string | null;
  count: number;
  avgDuration: number;
  p95Duration: number;
  maxDuration: number;
  errorCount: number;
  errorRate: number;
}

export interface QueueSummary {
  entries: QueueOpSummary[];
  summary: {
    totalCount: number;
    totalErrors: number;
    errorRate: number;
    avgDuration: number;
  };
}

// Web Vitals
export interface WebVitalMetric {
  name: string;
  count: number;
  p75: number;
  p95: number;
  rating: "good" | "needs-improvement" | "poor" | "unknown";
}

export interface WebVitalsResponse {
  metrics: Record<string, WebVitalMetric>;
  totalSamples: number;
}

// Endpoint detail
export interface EndpointDetailSummary {
  name: string;
  op: string;
  count: number;
  avgDuration: number;
  p50: number;
  p95: number;
  p99: number;
  maxDuration: number;
  errorCount: number;
  errorRate: number;
}

export interface EndpointTopQuery {
  description: string;
  count: number;
  totalDuration: number;
  avgDuration: number;
}

export interface EndpointRecentTransaction {
  id: string;
  duration: number;
  status: string | null;
  startTimestamp: Date;
}

export interface EndpointDetail {
  endpoint: EndpointDetailSummary | null;
  topQueries: EndpointTopQuery[];
  recentTransactions: EndpointRecentTransaction[];
}

