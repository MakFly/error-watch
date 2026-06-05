import { eq } from "drizzle-orm";
import { db } from "../../db/connection";
import { stackTraceRules } from "../../db/schema";
import { DEFAULT_STACK_TRACE_RULES } from "./stackTraceRules";

/**
 * Seed per-project stack trace rules from Laravel/Symfony defaults.
 * Idempotent: skips if the project already has any rules.
 */
export async function seedDefaultStackTraceRules(projectId: string): Promise<void> {
  const existing = await db
    .select({ id: stackTraceRules.id })
    .from(stackTraceRules)
    .where(eq(stackTraceRules.projectId, projectId))
    .limit(1);

  if (existing.length > 0) return;

  const now = new Date();
  await db.insert(stackTraceRules).values(
    DEFAULT_STACK_TRACE_RULES.map((rule) => ({
      id: crypto.randomUUID(),
      projectId,
      matcher: rule.matcher,
      pattern: rule.pattern,
      action: rule.action,
      priority: rule.priority ?? 0,
      description: `Default ${rule.matcher} rule`,
      createdAt: now,
    })),
  );
}
