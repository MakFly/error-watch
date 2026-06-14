import { fetchAPI } from './client';
import type {
  TransactionsResponse,
  TransactionWithSpans,
  SlowestTransaction,
  SpanAnalysis,
  ApdexScore,
  ServerStats,
  EndpointImpact,
  ThroughputBucket,
  DurationBucket,
  ExternalCallSummary,
  CacheSummary,
  QueueSummary,
  EndpointDetail,
  PerformanceDateRange,
  WebVitalsResponse,
} from './types';

export const getTransactions = async (
  projectId: string,
  options?: { op?: string; page?: number; limit?: number; dateRange?: PerformanceDateRange }
): Promise<TransactionsResponse> => {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  if (options?.op) params.set("op", options.op);
  if (options?.page) params.set("page", String(options.page));
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.dateRange) params.set("dateRange", options.dateRange);
  return fetchAPI<TransactionsResponse>(`/performance/transactions?${params.toString()}`);
};

export const getTransaction = async (
  transactionId: string
): Promise<TransactionWithSpans> => {
  return fetchAPI<TransactionWithSpans>(`/performance/transactions/${transactionId}`);
};

export const getSlowest = async (
  projectId: string,
  dateRange?: PerformanceDateRange
): Promise<SlowestTransaction[]> => {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  if (dateRange) params.set("dateRange", dateRange);
  return fetchAPI<SlowestTransaction[]>(`/performance/slowest?${params.toString()}`);
};

export const getSpanAnalysis = async (
  projectId: string,
  dateRange?: PerformanceDateRange
): Promise<SpanAnalysis> => {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  if (dateRange) params.set("dateRange", dateRange);
  return fetchAPI<SpanAnalysis>(`/performance/span-analysis?${params.toString()}`);
};

export const getApdex = async (
  projectId: string,
  dateRange?: PerformanceDateRange
): Promise<ApdexScore> => {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  if (dateRange) params.set("dateRange", dateRange);
  return fetchAPI<ApdexScore>(`/performance/apdex?${params.toString()}`);
};

export const getServerStats = async (
  projectId: string,
  dateRange?: PerformanceDateRange
): Promise<ServerStats> => {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  if (dateRange) params.set("dateRange", dateRange);
  return fetchAPI<ServerStats>(`/performance/server-stats?${params.toString()}`);
};

export const getTopEndpoints = async (
  projectId: string,
  dateRange?: PerformanceDateRange
): Promise<EndpointImpact[]> => {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  if (dateRange) params.set("dateRange", dateRange);
  return fetchAPI<EndpointImpact[]>(`/performance/top-endpoints?${params.toString()}`);
};

export const getThroughputTimeline = async (
  projectId: string,
  dateRange?: PerformanceDateRange,
  name?: string
): Promise<ThroughputBucket[]> => {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  if (dateRange) params.set("dateRange", dateRange);
  if (name) params.set("name", name);
  return fetchAPI<ThroughputBucket[]>(`/performance/throughput-timeline?${params.toString()}`);
};

export const getDurationTimeline = async (
  projectId: string,
  dateRange?: PerformanceDateRange,
  name?: string
): Promise<DurationBucket[]> => {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  if (dateRange) params.set("dateRange", dateRange);
  if (name) params.set("name", name);
  return fetchAPI<DurationBucket[]>(`/performance/duration-timeline?${params.toString()}`);
};

export const getExternalCalls = async (
  projectId: string,
  dateRange?: PerformanceDateRange
): Promise<ExternalCallSummary[]> => {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  if (dateRange) params.set("dateRange", dateRange);
  return fetchAPI<ExternalCallSummary[]>(`/performance/external-calls?${params.toString()}`);
};

export const getCache = async (
  projectId: string,
  dateRange?: PerformanceDateRange
): Promise<CacheSummary> => {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  if (dateRange) params.set("dateRange", dateRange);
  return fetchAPI<CacheSummary>(`/performance/cache?${params.toString()}`);
};

export const getQueues = async (
  projectId: string,
  dateRange?: PerformanceDateRange
): Promise<QueueSummary> => {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  if (dateRange) params.set("dateRange", dateRange);
  return fetchAPI<QueueSummary>(`/performance/queues?${params.toString()}`);
};

export const getEndpointDetail = async (
  projectId: string,
  name: string,
  dateRange?: PerformanceDateRange
): Promise<EndpointDetail> => {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  params.set("name", name);
  if (dateRange) params.set("dateRange", dateRange);
  return fetchAPI<EndpointDetail>(`/performance/endpoint-detail?${params.toString()}`);
};

export const getWebVitals = async (
  projectId: string,
  dateRange?: PerformanceDateRange
): Promise<WebVitalsResponse> => {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  if (dateRange) params.set("dateRange", dateRange);
  return fetchAPI<WebVitalsResponse>(`/performance/web-vitals?${params.toString()}`);
};

