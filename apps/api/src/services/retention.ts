import { db, pgClient } from "../db/connection";
import { applicationLogs, errorEvents, errorGroups, notifications } from "../db/schema";
import { lt } from "drizzle-orm";
import logger from "../logger";
import type { RetentionStats } from "../types/services";

const DEFAULT_EVENT_RETENTION_DAYS = 30;
const DEFAULT_NOTIFICATION_RETENTION_DAYS = 90;

export async function cleanupOldEvents(retentionDays: number = DEFAULT_EVENT_RETENTION_DAYS): Promise<number> {
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  logger.info("Starting event cleanup", { retentionDays, cutoffDate: cutoffDate.toISOString() });

  const result = await db
    .delete(errorEvents)
    .where(lt(errorEvents.createdAt, cutoffDate))
    .returning({ id: errorEvents.id });

  const deletedCount = result.length;

  logger.info("Event cleanup completed", { deletedCount });
  return deletedCount;
}

export async function cleanupOrphanedGroups(): Promise<number> {
  logger.info("Starting orphaned group cleanup");

  // Single batch DELETE using a NOT IN subquery instead of N individual deletes
  const deleted = await pgClient<{ fingerprint: string }[]>`
    DELETE FROM error_groups
    WHERE fingerprint NOT IN (
      SELECT DISTINCT fingerprint FROM error_events
    )
    RETURNING fingerprint
  `;

  const deletedCount = deleted.length;

  if (deletedCount === 0) {
    logger.info("No orphaned groups found");
  } else {
    logger.info("Orphaned group cleanup completed", { deletedCount });
  }

  return deletedCount;
}

export async function cleanupOldNotifications(retentionDays: number = DEFAULT_NOTIFICATION_RETENTION_DAYS): Promise<number> {
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  logger.info("Starting notification cleanup", { retentionDays, cutoffDate: cutoffDate.toISOString() });

  const result = await db
    .delete(notifications)
    .where(lt(notifications.createdAt, cutoffDate))
    .returning({ id: notifications.id });

  const deletedCount = result.length;

  logger.info("Notification cleanup completed", { deletedCount });
  return deletedCount;
}

const DEFAULT_LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || "7", 10);

export async function cleanupOldApplicationLogs(
  retentionHours: number = DEFAULT_LOG_RETENTION_DAYS * 24,
): Promise<number> {
  const cutoffDate = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

  logger.info("Starting application logs cleanup", { retentionHours, cutoffDate: cutoffDate.toISOString() });

  const result = await db
    .delete(applicationLogs)
    .where(lt(applicationLogs.createdAt, cutoffDate))
    .returning({ id: applicationLogs.id });

  const deletedCount = result.length;
  logger.info("Application logs cleanup completed", { deletedCount });

  return deletedCount;
}

export async function runRetentionCleanup(
  eventRetentionDays: number = DEFAULT_EVENT_RETENTION_DAYS,
  notificationRetentionDays: number = DEFAULT_NOTIFICATION_RETENTION_DAYS
): Promise<RetentionStats> {
  logger.info("Starting full retention cleanup", {
    eventRetentionDays,
    notificationRetentionDays,
  });

  const eventsDeleted = await cleanupOldEvents(eventRetentionDays);
  const groupsDeleted = await cleanupOrphanedGroups();
  const notificationsDeleted = await cleanupOldNotifications(notificationRetentionDays);

  const stats: RetentionStats = {
    eventsDeleted,
    groupsDeleted,
    notificationsDeleted,
  };

  logger.info("Full retention cleanup completed", {
    eventsDeleted: stats.eventsDeleted,
    groupsDeleted: stats.groupsDeleted,
    notificationsDeleted: stats.notificationsDeleted,
  });
  return stats;
}

export async function updateGroupCounts(): Promise<void> {
  logger.info("Updating group event counts");

  await pgClient`
    UPDATE error_groups
    SET count = (
      SELECT COUNT(*)
      FROM error_events
      WHERE error_events.fingerprint = error_groups.fingerprint
    )
  `;

  logger.info("Group counts updated");
}

export async function getRetentionStats(retentionDays: number = DEFAULT_EVENT_RETENTION_DAYS): Promise<{
  eventsToDelete: number;
  oldestEvent: Date | null;
  newestEvent: Date | null;
}> {
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const [countResult] = await pgClient<{ count: bigint }[]>`
    SELECT COUNT(*) as count
    FROM error_events
    WHERE created_at < ${cutoffDate.getTime()}
  `;

  const [oldestResult] = await pgClient<{ oldest: Date | null }[]>`
    SELECT MIN(created_at) as oldest
    FROM error_events
  `;

  const [newestResult] = await pgClient<{ newest: Date | null }[]>`
    SELECT MAX(created_at) as newest
    FROM error_events
  `;

  return {
    eventsToDelete: countResult ? Number(countResult.count) : 0,
    oldestEvent: oldestResult?.oldest ?? null,
    newestEvent: newestResult?.newest ?? null,
  };
}
