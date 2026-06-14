/**
 * Alert Worker
 * @description Processes alert notifications from the queue
 */
import { Worker, Job } from "bullmq";
import { eq } from "drizzle-orm";
import { redisConnection } from "../connection";
import { type AlertJobData } from "../queues";
import { triggerAlertsForNewError } from "../../services/alerts";
import { db } from "../../db/connection";
import { projects } from "../../db/schema";
import logger from "../../logger";
import { publishEvent } from "../../sse/publisher";

const WORKER_CONCURRENCY = parseInt(process.env.ALERT_WORKER_CONCURRENCY || "5", 10);

/**
 * Process a single alert job
 */
async function processAlert(job: Job<AlertJobData>): Promise<{ processed: boolean }> {
  const { projectId, fingerprint, isNewGroup, isRegression, level, message } = job.data;

  logger.debug("Processing alert job", {
    jobId: job.id,
    projectId,
    fingerprint,
    isNewGroup,
  });

  await triggerAlertsForNewError(projectId, fingerprint, isNewGroup, isRegression);

  // Publish SSE event for alert (fire-and-forget)
  const project = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (project[0]?.organizationId) {
    publishEvent(project[0].organizationId, {
      type: "alert:triggered",
      projectId,
      payload: { fingerprint, message, level },
      timestamp: Date.now(),
    });
  }

  return { processed: true };
}

/**
 * Alert worker instance
 */
export const alertWorker = new Worker<AlertJobData>(
  "alerts",
  processAlert,
  {
    ...redisConnection,
    concurrency: WORKER_CONCURRENCY,
    limiter: {
      max: 100,
      duration: 60000, // Max 100 alerts per minute (rate limiting)
    },
  }
);

alertWorker.on("completed", (job) => {
  logger.debug("Alert job completed", { jobId: job.id });
});

alertWorker.on("failed", (job, err) => {
  logger.error("Alert job failed", {
    jobId: job?.id,
    error: err.message,
    attempts: job?.attemptsMade,
  });
});

alertWorker.on("error", (err) => {
  logger.error("Alert worker error", { error: err.message });
});

export default alertWorker;
