/**
 * Reprocess error groups with grouping engine v3.
 *
 * Usage (from repo root):
 *   cd apps/api && bun run --env-file=../../.env ../../scripts/reprocess-groups.ts --dry-run --project=<uuid>
 *   cd apps/api && bun run --env-file=../../.env ../../scripts/reprocess-groups.ts --project=<uuid>
 */
import { eq, sql, and, desc } from "drizzle-orm";
import { db } from "../apps/api/src/db/connection";
import {
  errorGroups,
  errorEvents,
  fingerprintAliases,
  fingerprintRules,
} from "../apps/api/src/db/schema";
import {
  computeFingerprintSync,
  computeGroupMetadata,
  GROUPING_CONFIG_VERSION,
  resolveFrames,
} from "../apps/api/src/services/grouping";
import { getStackTraceRulesForProject } from "../apps/api/src/services/grouping/loadStackTraceRules";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const projectArg = args.find((a) => a.startsWith("--project="));
const projectId = projectArg?.split("=")[1];

if (!projectId) {
  console.error("Missing --project=<projectId>");
  process.exit(1);
}

type FpMapping = { oldFp: string; newFp: string; message: string; title: string };

async function getCustomRules(pid: string) {
  return db
    .select({ pattern: fingerprintRules.pattern, groupKey: fingerprintRules.groupKey })
    .from(fingerprintRules)
    .where(eq(fingerprintRules.projectId, pid))
    .orderBy(desc(fingerprintRules.priority));
}

async function main() {
  console.log(`Reprocessing project ${projectId} (dry-run=${dryRun})`);

  const stackTraceRules = await getStackTraceRulesForProject(projectId);
  const customRules = await getCustomRules(projectId);

  const events = await db
    .select()
    .from(errorEvents)
    .where(eq(errorEvents.projectId, projectId))
    .orderBy(errorEvents.createdAt);

  console.log(`Scanning ${events.length} events…`);

  const eventFpMap = new Map<string, string>();
  const mergeMap = new Map<string, Set<string>>();

  for (const evt of events) {
    const frames = resolveFrames(
      evt.frames as Parameters<typeof resolveFrames>[0],
      evt.stack,
      stackTraceRules,
    );

    const newFp = computeFingerprintSync(
      {
        projectId,
        message: evt.exceptionValue ?? evt.stack.slice(0, 500),
        stack: evt.stack,
        frames,
        exceptionType: evt.exceptionType,
        exceptionValue: evt.exceptionValue,
        exceptionValues: evt.exceptionValues as Parameters<typeof computeFingerprintSync>[0]["exceptionValues"],
        file: undefined,
        line: undefined,
        customRules,
      },
      stackTraceRules,
    );

    eventFpMap.set(evt.id, newFp);

    if (evt.fingerprint !== newFp) {
      if (!mergeMap.has(newFp)) mergeMap.set(newFp, new Set());
      mergeMap.get(newFp)!.add(evt.fingerprint);
    }
  }

  const mappings: FpMapping[] = [];
  for (const [newFp, oldFps] of mergeMap) {
    for (const oldFp of oldFps) {
      const sample = events.find((e) => e.fingerprint === oldFp);
      mappings.push({
        oldFp,
        newFp,
        message: sample?.exceptionValue ?? oldFp,
        title: oldFp,
      });
    }
  }

  console.log(`Would remap ${mappings.length} fingerprint(s):`);
  for (const m of mappings.slice(0, 20)) {
    console.log(`  ${m.oldFp.slice(0, 12)}… → ${m.newFp.slice(0, 12)}…`);
  }
  if (mappings.length > 20) console.log(`  … and ${mappings.length - 20} more`);

  if (dryRun) {
    console.log("Dry-run complete — no writes.");
    return;
  }

  await db.transaction(async (tx) => {
    for (const m of mappings) {
      await tx
        .insert(fingerprintAliases)
        .values({
          oldFingerprint: m.oldFp,
          newFingerprint: m.newFp,
          projectId,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: fingerprintAliases.oldFingerprint,
          set: { newFingerprint: m.newFp },
        });
    }

    for (const evt of events) {
      const newFp = eventFpMap.get(evt.id)!;
      if (evt.fingerprint === newFp) continue;

      await tx
        .update(errorEvents)
        .set({ fingerprint: newFp, regroupedAt: new Date() })
        .where(eq(errorEvents.id, evt.id));
    }

    const targetFps = new Set([...eventFpMap.values()]);

    for (const fp of targetFps) {
      const fpEvents = events.filter((e) => eventFpMap.get(e.id) === fp);
      if (fpEvents.length === 0) continue;

      const latest = fpEvents[fpEvents.length - 1];
      const frames = resolveFrames(
        latest.frames as Parameters<typeof resolveFrames>[0],
        latest.stack,
        stackTraceRules,
      );
      const meta = computeGroupMetadata({
        message: latest.exceptionValue ?? "",
        frames,
        exceptionType: latest.exceptionType,
        exceptionValue: latest.exceptionValue,
        exceptionValues: latest.exceptionValues as Parameters<typeof computeGroupMetadata>[0]["exceptionValues"],
      });

      const count = fpEvents.length;
      const firstSeen = fpEvents[0].createdAt;
      const lastSeen = fpEvents[fpEvents.length - 1].createdAt;

      await tx
        .insert(errorGroups)
        .values({
          fingerprint: fp,
          projectId,
          message: meta.exceptionValue,
          title: meta.title,
          file: meta.file,
          line: meta.line,
          culprit: meta.culprit,
          url: latest.url,
          level: latest.level,
          count,
          firstSeen,
          lastSeen,
          exceptionType: meta.exceptionType,
          exceptionValue: meta.exceptionValue,
          groupingConfigVersion: GROUPING_CONFIG_VERSION,
        })
        .onConflictDoUpdate({
          target: errorGroups.fingerprint,
          set: {
            count: sql`(SELECT count(*)::int FROM error_events WHERE fingerprint = ${fp})`,
            firstSeen: sql`(SELECT min(created_at) FROM error_events WHERE fingerprint = ${fp})`,
            lastSeen: sql`(SELECT max(created_at) FROM error_events WHERE fingerprint = ${fp})`,
            title: meta.title,
            file: meta.file,
            line: meta.line,
            culprit: meta.culprit,
            exceptionType: meta.exceptionType,
            exceptionValue: meta.exceptionValue,
            groupingConfigVersion: GROUPING_CONFIG_VERSION,
          },
        });
    }

    const orphaned = await tx
      .select({ fingerprint: errorGroups.fingerprint })
      .from(errorGroups)
      .where(
        and(
          eq(errorGroups.projectId, projectId),
          sql`NOT EXISTS (SELECT 1 FROM error_events e WHERE e.fingerprint = ${errorGroups.fingerprint})`,
        ),
      );

    for (const row of orphaned) {
      await tx.delete(errorGroups).where(eq(errorGroups.fingerprint, row.fingerprint));
    }

    console.log(`Removed ${orphaned.length} orphan group(s).`);
  });

  console.log("Reprocess complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
