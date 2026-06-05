import { eq, desc } from "drizzle-orm";
import { db } from "../../db/connection";
import { stackTraceRules } from "../../db/schema";
import { DEFAULT_STACK_TRACE_RULES } from "./stackTraceRules";
import type { StackTraceRule } from "./types";

const rulesCache = new Map<string, { rules: StackTraceRule[]; cachedAt: number }>();
const CACHE_TTL = 60_000;

export async function getStackTraceRulesForProject(projectId: string): Promise<StackTraceRule[]> {
  const cached = rulesCache.get(projectId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.rules;
  }

  const rows = await db
    .select({
      matcher: stackTraceRules.matcher,
      pattern: stackTraceRules.pattern,
      action: stackTraceRules.action,
      priority: stackTraceRules.priority,
    })
    .from(stackTraceRules)
    .where(eq(stackTraceRules.projectId, projectId))
    .orderBy(desc(stackTraceRules.priority));

  const projectRules: StackTraceRule[] = rows.map((r) => ({
    matcher: r.matcher as StackTraceRule["matcher"],
    pattern: r.pattern,
    action: r.action as StackTraceRule["action"],
    priority: r.priority,
  }));

  const merged = [...projectRules, ...DEFAULT_STACK_TRACE_RULES];
  rulesCache.set(projectId, { rules: merged, cachedAt: Date.now() });
  return merged;
}
