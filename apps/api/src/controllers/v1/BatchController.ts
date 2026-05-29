/**
 * Batch Controller
 * @description Single ingest endpoint that accepts an array of mixed telemetry
 * items (events, logs, transactions) so SDKs can send one HTTP request per
 * host-request instead of one POST per item. Each item is processed with the
 * exact same logic as its unitary endpoint (shared helpers), so behaviour and
 * validation stay identical. One bad item never drops the whole batch.
 */
import type { Context } from "hono";
import type { AppEnv } from "../../types/hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../db/connection";
import { applicationLogs, projects } from "../../db/schema";
import logger from "../../logger";
import { isRedisAvailable } from "../../queue/connection";
import { canAcceptEvent } from "../../services/quotas";
import { getProjectPlan } from "../../services/subscriptions";
import { ProjectSettingsRepository } from "../../repositories/ProjectSettingsRepository";
import { publishEvent } from "../../sse/publisher";
import { envelopeSchema, enqueueEnvelopeEvent } from "./EnvelopeController";
import { logsIngestSchema, buildLogRow } from "./LogsController";
import { transactionPayloadSchema, persistTransaction } from "./PerformanceController";
import { summarizeRejections } from "../../utils/batch";

const isProduction = process.env.NODE_ENV === "production";

const batchSchema = z.object({
  items: z
    .array(
      z.object({
        type: z.enum(["event", "log", "transaction"]),
        payload: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1)
    .max(500),
});

export const submitBatch = async (c: Context<AppEnv>) => {
  try {
    const input = batchSchema.parse(await c.req.json());

    const apiKeyData = c.get("apiKey");
    const projectId = apiKeyData?.projectId;
    if (!projectId) {
      return c.json({ error: "Invalid API key", code: "INVALID_API_KEY" }, 401);
    }

    // Project-scoped ingestion toggle (checked once for the whole batch).
    const projectSettings = await ProjectSettingsRepository.findByProjectId(projectId);
    if (projectSettings?.eventsEnabled === false) {
      return c.json({ error: "Event ingestion disabled", code: "INGESTION_DISABLED" }, 403);
    }

    // Quota (checked once; events are the metered item).
    const plan = await getProjectPlan(projectId);
    const quotaCheck = await canAcceptEvent(projectId, plan);
    const eventsAllowed = quotaCheck.allowed;

    const redisUp = await isRedisAvailable();

    const accepted = { events: 0, logs: 0, transactions: 0 };
    const rejected: Array<{ index: number; type: string; reason: string }> = [];
    // Cheap, payload-free detail for the FIRST reject only — surfaced in the
    // aggregate warn log so "everything is dropping" is diagnosable without
    // logging per-item or leaking telemetry bodies.
    let firstRejectDetail: string | null = null;

    const logRows: Array<typeof applicationLogs.$inferInsert> = [];
    const logSse: Array<Record<string, unknown>> = [];

    for (let i = 0; i < input.items.length; i += 1) {
      const item = input.items[i];
      try {
        switch (item.type) {
          case "event": {
            if (!eventsAllowed || !redisUp) {
              rejected.push({ index: i, type: item.type, reason: eventsAllowed ? "redis_unavailable" : "quota_exceeded" });
              break;
            }
            const parsed = envelopeSchema.parse(item.payload);
            const res = await enqueueEnvelopeEvent(parsed, projectId);
            if (res.queued) accepted.events += 1;
            break;
          }
          case "log": {
            const parsed = logsIngestSchema.parse(item.payload);
            const { row, sse } = buildLogRow(parsed, projectId);
            logRows.push(row);
            logSse.push(sse);
            accepted.logs += 1;
            break;
          }
          case "transaction": {
            const parsed = transactionPayloadSchema.parse(item.payload);
            await persistTransaction(parsed, projectId);
            accepted.transactions += 1;
            break;
          }
        }
      } catch (itemErr) {
        rejected.push({
          index: i,
          type: item.type,
          reason: itemErr instanceof z.ZodError ? "validation_error" : "processing_error",
        });
        if (firstRejectDetail === null) {
          // Truncate to keep the log line cheap and avoid leaking payloads.
          const detail = itemErr instanceof z.ZodError
            ? itemErr.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; ")
            : itemErr instanceof Error ? itemErr.message : "Unknown";
          firstRejectDetail = detail.slice(0, 200);
        }
      }
    }

    // Aggregate every rejected item (including ZodErrors) at warn level so
    // silent drops are observable. Counts + first reason, never payloads.
    if (rejected.length > 0) {
      const summary = summarizeRejections(rejected);
      logger.warn("Batch items rejected", {
        projectId,
        ...summary,
        firstDetail: firstRejectDetail,
        total: input.items.length,
      });
    }

    // Flush buffered logs in a single batch insert.
    if (logRows.length > 0) {
      await db.insert(applicationLogs).values(logRows);
    }

    // Real-time fan-out (one org lookup for the whole batch).
    if (logSse.length > 0) {
      const project = await db
        .select({ organizationId: projects.organizationId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      const orgId = project[0]?.organizationId;
      if (orgId) {
        for (const log of logSse) {
          publishEvent(orgId, {
            type: "log:new",
            projectId,
            payload: { log: log as never, sampled: false },
            timestamp: Date.now(),
          }).catch(() => {});
        }
      }
    }

    // In production we expose a compact reason summary (counts only, no item
    // payloads) instead of hiding rejects entirely; dev gets the full per-item
    // detail for debugging.
    return c.json(
      {
        success: true,
        accepted,
        rejected: rejected.length,
        rejectedSummary: rejected.length > 0 ? summarizeRejections(rejected).byReason : undefined,
        errors: isProduction ? undefined : rejected,
      },
      202,
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      logger.warn("Invalid batch input", {
        issues: e.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`),
      });
      return c.json({ error: "Invalid input", code: "VALIDATION_ERROR" }, 400);
    }
    logger.error("Failed to ingest batch", { error: e instanceof Error ? e.message : "Unknown" });
    return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
  }
};
