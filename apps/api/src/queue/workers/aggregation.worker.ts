/**
 * Aggregation Worker
 * @description Processes nightly aggregation and cleanup cron jobs
 */
import { Worker, Job } from "bullmq";
import { redisConnection } from "../connection";
import { aggregationQueue, type AggregationJobData } from "../queues";
import {
  aggregateHourlyMetrics,
  aggregateHourlyTransactions,
  aggregateDailyFromHourly,
  cleanupExpiredPerformanceData,
  cleanupOldAggregates,
} from "../../services/aggregation";
import { cleanupOldApplicationLogs, cleanupOldEvents, cleanupOrphanedGroups } from "../../services/retention";
import logger from "../../logger";

/**
 * Process aggregation jobs
 */
async function processAggregation(job: Job<AggregationJobData>): Promise<Record<string, unknown>> {
  const { type, targetDate } = job.data;

  // Default to yesterday if no target date
  const date = targetDate
    ? new Date(targetDate)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);

  logger.info("Processing aggregation job", { type, date: date.toISOString() });

  switch (type) {
    case "aggregate-hourly": {
      const metrics = await aggregateHourlyMetrics(date);
      const transactions = await aggregateHourlyTransactions(date);
      return { type, metrics, transactions };
    }

    case "aggregate-daily": {
      const result = await aggregateDailyFromHourly(date);
      return { type, ...result };
    }

    case "cleanup-expired": {
      const perfCleanup = await cleanupExpiredPerformanceData(30);
      const aggregateCleanup = await cleanupOldAggregates(12);
      const eventsDeleted = await cleanupOldEvents(30);
      const groupsDeleted = await cleanupOrphanedGroups();
      const logsDeleted = await cleanupOldApplicationLogs();
      return {
        type,
        performance: perfCleanup,
        aggregates: aggregateCleanup,
        eventsDeleted,
        groupsDeleted,
        logsDeleted,
      };
    }

    default:
      throw new Error(`Unknown aggregation job type: ${type}`);
  }
}

/**
 * Aggregation worker instance
 */
export const aggregationWorker = new Worker<AggregationJobData>(
  "aggregation",
  processAggregation,
  {
    ...redisConnection,
    concurrency: 1, // Sequential processing — aggregation is heavy
  }
);

aggregationWorker.on("completed", (job, result) => {
  logger.info("Aggregation job completed", {
    jobId: job.id,
    type: job.data.type,
    result,
  });
});

aggregationWorker.on("failed", (job, err) => {
  logger.error("Aggregation job failed", {
    jobId: job?.id,
    type: job?.data.type,
    error: err.message,
    attempts: job?.attemptsMade,
  });
});

aggregationWorker.on("error", (err) => {
  logger.error("Aggregation worker error", { error: err.message });
});

/**
 * Schedule recurring aggregation cron jobs.
 * Call this once at startup.
 */
export async function scheduleAggregationJobs(): Promise<void> {
  // Remove existing repeatable jobs to avoid duplicates
  const existingJobs = await aggregationQueue.getRepeatableJobs();
  for (const job of existingJobs) {
    await aggregationQueue.removeRepeatableByKey(job.key);
  }

  // Hourly aggregation — runs at 2:00 AM UTC daily
  await aggregationQueue.add(
    "aggregate-hourly",
    { type: "aggregate-hourly" },
    {
      repeat: { pattern: "0 2 * * *" },
      jobId: "aggregate-hourly-cron",
    }
  );

  // Daily rollup — runs at 3:00 AM UTC daily
  await aggregationQueue.add(
    "aggregate-daily",
    { type: "aggregate-daily" },
    {
      repeat: { pattern: "0 3 * * *" },
      jobId: "aggregate-daily-cron",
    }
  );

  // Cleanup — runs at 4:00 AM UTC daily
  await aggregationQueue.add(
    "cleanup-expired",
    { type: "cleanup-expired" },
    {
      repeat: { pattern: "0 4 * * *" },
      jobId: "cleanup-expired-cron",
    }
  );

  logger.info("Aggregation cron jobs scheduled", {
    jobs: ["aggregate-hourly (2:00 UTC)", "aggregate-daily (3:00 UTC)", "cleanup-expired (4:00 UTC)"],
  });
}

export default aggregationWorker;
