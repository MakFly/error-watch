/**
 * tRPC Router - defines all available procedures
 * @description All procedures except auth.getSession require authentication
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import superjson from "superjson";
import { router, publicProcedure, createCallerFactory, createTRPCContext } from "./trpc";
import { api } from "../api";
import { adminRouter } from "./routers/admin";
import { computeInsights } from "@/lib/insights";

/**
 * Protected procedure middleware - requires authentication
 */
const protectedProcedure = publicProcedure.use(async (opts) => {
  const { session } = opts.ctx;

  if (!session?.user?.id) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required. Please log in.",
    });
  }

  return opts.next({
    ctx: {
      ...opts.ctx,
      session,
      userId: session.user.id,
      user: session.user,
    },
  });
});

/**
 * Auth router - public (getSession must be public)
 */
const authRouter = router({
  getSession: publicProcedure.query(async () => {
    return api.auth.getSession();
  }),
});

const instanceRouter = router({
  getStatus: publicProcedure.query(async () => {
    return api.instance.getStatus();
  }),

  bootstrap: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(100),
        email: z.string().email(),
        password: z.string().min(8).max(200),
      })
    )
    .mutation(async ({ input }) => {
      return api.instance.bootstrap(input);
    }),
});

/**
 * Groups router - protected
 */
const groupsRouter = router({
  getAll: protectedProcedure
    .input(
      z.object({
        env: z.string().optional(),
        dateRange: z.enum(["24h", "7d", "30d", "90d", "all"]).optional(),
        projectId: z.string().uuid().optional(),
        search: z.string().optional(),
        level: z.enum(["fatal", "error", "warning", "info", "debug"]).optional(),
        levels: z.array(z.string()).optional(),
        httpStatus: z.number().int().min(100).max(599).optional(),
        httpStatusFamily: z.enum(["1xx", "2xx", "3xx", "4xx", "5xx"]).optional(),
        status: z.enum(["unresolved", "resolved", "all"]).optional(),
        sort: z.enum(["lastSeen", "firstSeen", "count"]).optional(),
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(100).optional(),
        cursor: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      return api.groups.getAll(input);
    }),

  getById: protectedProcedure
    .input(z.object({ fingerprint: z.string() }))
    .query(async ({ input }) => {
      return api.groups.getById(input.fingerprint);
    }),

  getIssueDetail: protectedProcedure
    .input(
      z.object({
        fingerprint: z.string(),
        page: z.number().positive().optional(),
        limit: z.number().positive().optional(),
      })
    )
    .query(async ({ input }) => {
      return api.groups.getIssueDetail(input.fingerprint, input.page, input.limit);
    }),

  getEvents: protectedProcedure
    .input(z.object({
      fingerprint: z.string(),
      page: z.number().optional(),
      limit: z.number().optional()
    }))
    .query(async ({ input }) => {
      return api.groups.getEvents(input.fingerprint, input.page, input.limit);
    }),

  getTimeline: protectedProcedure
    .input(z.object({ fingerprint: z.string() }))
    .query(async ({ input }) => {
      return api.groups.getTimeline(input.fingerprint);
    }),

  updateAssignment: protectedProcedure
    .input(z.object({
      fingerprint: z.string(),
      assignedTo: z.string().nullable(),
    }))
    .mutation(async ({ input }) => {
      return api.groups.updateAssignment(input.fingerprint, input.assignedTo);
    }),

  updatePriority: protectedProcedure
    .input(z.object({
      fingerprint: z.string(),
      priority: z.enum(["low", "medium", "high"]),
    }))
    .mutation(async ({ input }) => {
      return api.groups.updatePriority(input.fingerprint, input.priority);
    }),

  updateSnooze: protectedProcedure
    .input(z.object({
      fingerprint: z.string(),
      until: z.string().datetime().nullable(),
    }))
    .mutation(async ({ input }) => {
      return api.groups.updateSnooze(input.fingerprint, input.until);
    }),

  delete: protectedProcedure
    .input(z.object({ fingerprint: z.string() }))
    .mutation(async ({ input }) => {
      return api.groups.delete(input.fingerprint);
    }),

  // Resolve / reopen. The API attributes resolution to the authenticated user
  // (BetterAuth session); no userId needed in the input.
  updateStatus: protectedProcedure
    .input(z.object({
      fingerprint: z.string(),
      status: z.enum(["unresolved", "resolved"]),
    }))
    .mutation(async ({ input }) => {
      return api.groups.updateStatus(input.fingerprint, input.status);
    }),

  getStatusHistory: protectedProcedure
    .input(z.object({ fingerprint: z.string() }))
    .query(async ({ input }) => {
      return api.groups.getStatusHistory(input.fingerprint);
    }),

  getActivity: protectedProcedure
    .input(z.object({ fingerprint: z.string() }))
    .query(async ({ input }) => {
      return api.groups.getActivity(input.fingerprint);
    }),

  getReleases: protectedProcedure
    .input(z.object({ fingerprint: z.string() }))
    .query(async ({ input }) => {
      return api.groups.getReleases(input.fingerprint);
    }),

  getCorrelatedSignals: protectedProcedure
    .input(z.object({ fingerprint: z.string() }))
    .query(async ({ input }) => {
      return api.groups.getCorrelatedSignals(input.fingerprint);
    }),

  merge: protectedProcedure
    .input(z.object({
      parentFingerprint: z.string(),
      childFingerprints: z.array(z.string()).min(1).max(50),
    }))
    .mutation(async ({ input }) => {
      return api.groups.merge(input.parentFingerprint, input.childFingerprints);
    }),

  unmerge: protectedProcedure
    .input(z.object({ fingerprint: z.string() }))
    .mutation(async ({ input }) => {
      return api.groups.unmerge(input.fingerprint);
    }),

});

/**
 * Re-export insight type for use by client code
 */
export type { StatsInsight } from "@/lib/insights";

/**
 * Stats router - protected
 */
const statsRouter = router({
  getGlobal: protectedProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }).optional())
    .query(async ({ input }) => {
      return api.stats.getGlobal(input?.projectId);
    }),

  getTimeline: protectedProcedure
    .input(z.object({
      range: z.enum(["24h", "7d", "30d"]).optional(),
      projectId: z.string().uuid().optional(),
    }).optional())
    .query(async ({ input }) => {
      return api.stats.getTimeline(input?.range || "30d", input?.projectId);
    }),

  getEnvBreakdown: protectedProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }).optional())
    .query(async ({ input }) => {
      return api.stats.getEnvBreakdown(input?.projectId);
    }),

  getSeverityBreakdown: protectedProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }).optional())
    .query(async ({ input }) => {
      return api.stats.getSeverityBreakdown(input?.projectId);
    }),

  getDashboardStats: protectedProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }).optional())
    .query(async ({ input }) => {
      return api.stats.getDashboardStats(input?.projectId);
    }),

  /**
   * Get computed insights from stats data
   * Analyzes trends, patterns, and stability metrics
   */
  getInsights: protectedProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }).optional())
    .query(async ({ input }) => {
      try {
        const [timeline, envBreakdown] = await Promise.all([
          api.stats.getTimeline("30d", input?.projectId),
          api.stats.getEnvBreakdown(input?.projectId),
        ]);

        return computeInsights(timeline ?? [], envBreakdown ?? []);
      } catch {
        return [
          {
            type: "neutral" as const,
            icon: "shield" as const,
            title: "Unable to analyze",
            message: "Could not compute insights at this time",
            sentiment: "neutral" as const,
          },
        ];
      }
    }),
});

/**
 * Organizations router - protected
 */
const organizationsRouter = router({
  getAll: protectedProcedure.query(async () => {
    return api.organizations.getAll();
  }),

  canCreate: protectedProcedure.query(async () => {
    return api.organizations.canCreate();
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ input }) => {
      return api.organizations.create(input.name);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      return api.organizations.delete(input.id);
    }),
});

/**
 * Projects router - protected
 */
const projectsRouter = router({
  getAll: protectedProcedure.query(async () => {
    return api.projects.getAll();
  }),

  getCurrent: protectedProcedure.query(async () => {
    return api.projects.getCurrent();
  }),

  setCurrent: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      return api.projects.setCurrent(input.projectId);
    }),

  canCreate: protectedProcedure.query(async () => {
    return api.projects.canCreate();
  }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      organizationId: z.string().uuid(),
      environment: z.enum(["production", "staging", "development"]).optional(),
      platform: z.enum(["symfony", "laravel", "vuejs", "react", "nextjs", "nuxtjs", "nodejs", "hono", "fastify", "metrics-agent"])
    }))
    .mutation(async ({ input }) => {
      return api.projects.create(input);
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(100).optional(),
      environment: z.enum(["production", "staging", "development"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return api.projects.update(id, data);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      return api.projects.delete(input.id);
    }),
});

/**
 * Members router - protected
 */
const membersRouter = router({
  getByOrganization: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ input }) => {
      return api.members.getByOrganization(input.organizationId);
    }),

  invite: protectedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      email: z.string().email(),
      method: z.enum(["token", "direct"]).optional().default("token")
    }))
    .mutation(async ({ input }) => {
      return api.members.invite(input.organizationId, input.email, input.method);
    }),

  checkInvite: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      return api.members.checkInvite(input.token);
    }),

  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      return api.members.acceptInvite(input.token);
    }),

  redeemInvite: publicProcedure
    .input(
      z.object({
        token: z.string(),
        name: z.string().trim().min(1).max(100),
        password: z.string().min(8).max(200),
      })
    )
    .mutation(async ({ input }) => {
      return api.members.redeemInvite(input.token, input.name, input.password);
    }),

  remove: protectedProcedure
    .input(z.object({ memberId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      return api.members.remove(input.memberId);
    }),
});

/**
 * Onboarding router - protected
 */
const onboardingRouter = router({
  getStatus: protectedProcedure.query(async () => {
    return api.onboarding.getStatus();
  }),

  setup: protectedProcedure
    .input(z.object({
      organizationName: z.string().min(1).max(100),
      projectName: z.string().min(1).max(100),
      environment: z.enum(["production", "staging", "development"]).optional(),
      platform: z.enum(["symfony", "laravel", "vuejs", "react", "nextjs", "nuxtjs", "nodejs", "hono", "fastify", "metrics-agent"])
    }))
    .mutation(async ({ input }) => {
      return api.onboarding.setup(input);
    }),
});

/**
 * API Keys router - protected
 */
const apiKeysRouter = router({
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      return api.apiKeys.getAll(input.projectId);
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      name: z.string().min(1).max(100)
    }))
    .mutation(async ({ input }) => {
      return api.apiKeys.create(input.projectId, input.name);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      return api.apiKeys.delete(input.id);
    }),
});

/**
 * Alerts router - protected
 */
const alertsRouter = router({
  getRules: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      return api.alerts.getRules(input.projectId);
    }),

  createRule: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      name: z.string().min(1).max(100),
      type: z.enum(["new_error", "threshold", "regression"]),
      threshold: z.number().positive().optional(),
      windowMinutes: z.number().positive().optional(),
      channel: z.enum(["email", "slack", "webhook", "discord", "telegram", "github", "gitlab"]),
      config: z.object({
        email: z.string().email().optional(),
        slackWebhook: z.string().url().optional(),
        webhookUrl: z.string().url().optional(),
        discordWebhook: z.string().url().optional(),
        telegramBotToken: z.string().optional(),
        telegramChatId: z.string().optional(),
        githubToken: z.string().optional(),
        githubRepo: z.string().optional(),
        gitlabToken: z.string().optional(),
        gitlabProjectId: z.string().optional(),
        gitlabUrl: z.string().url().optional(),
        levelFilter: z.array(z.enum(["fatal", "error", "warning", "info", "debug"])).optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      return api.alerts.createRule(input);
    }),

  updateRule: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      updates: z.object({
        name: z.string().min(1).max(100).optional(),
        type: z.enum(["new_error", "threshold", "regression"]).optional(),
        threshold: z.number().positive().optional(),
        windowMinutes: z.number().positive().optional(),
        channel: z.enum(["email", "slack", "webhook", "discord", "telegram", "github", "gitlab"]).optional(),
        config: z.object({
          email: z.string().email().optional(),
          slackWebhook: z.string().url().optional(),
          webhookUrl: z.string().url().optional(),
          discordWebhook: z.string().url().optional(),
          telegramBotToken: z.string().optional(),
          telegramChatId: z.string().optional(),
          githubToken: z.string().optional(),
          githubRepo: z.string().optional(),
          gitlabToken: z.string().optional(),
          gitlabProjectId: z.string().optional(),
          gitlabUrl: z.string().url().optional(),
          levelFilter: z.array(z.enum(["fatal", "error", "warning", "info", "debug"])).optional(),
        }).optional(),
        enabled: z.boolean().optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      return api.alerts.updateRule(input.id, input.updates);
    }),

  deleteRule: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      return api.alerts.deleteRule(input.id);
    }),

  getNotifications: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      return api.alerts.getNotifications(input.projectId);
    }),
});

/**
 * Project Settings router - protected
 */
const projectSettingsRouter = router({
  get: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      return api.projectSettings.get(input.projectId);
    }),

  update: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      timezone: z.string().optional(),
      retentionDays: z.number().min(7).max(365).optional(),
      autoResolve: z.boolean().optional(),
      autoResolveDays: z.number().min(3).max(60).optional(),
      eventsEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { projectId, ...data } = input;
      return api.projectSettings.update(projectId, data);
  }),
});

/**
 * Billing router - protected
 */
const billingRouter = router({
  getSummary: protectedProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }).optional())
    .query(async ({ input }) => {
      return api.billing.getSummary(input?.projectId);
    }),

  createCheckout: protectedProcedure
    .input(z.object({
      plan: z.enum(["pro", "team", "enterprise"]).optional()
    }).optional())
    .mutation(async ({ input }) => {
      return api.billing.createCheckout(input?.plan || "pro");
    }),

  createPortal: protectedProcedure
    .mutation(async () => {
      return api.billing.createPortal();
    }),
});

/**
 * Replay router - protected
 */
const replayRouter = router({
  getSessions: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      page: z.number().optional().default(1),
      limit: z.number().optional().default(20),
    }))
    .query(async ({ input }) => {
      return api.replay.getSessions(input.projectId, input.page, input.limit);
    }),

  getSessionsWithErrors: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      filters: z.object({
        deviceType: z.enum(["desktop", "mobile", "tablet"]).optional(),
        browser: z.string().optional(),
        os: z.string().optional(),
        durationMin: z.number().optional(),
        durationMax: z.number().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        errorCountMin: z.number().optional(),
        severity: z.enum(["fatal", "error", "warning", "info", "debug"]).optional(),
      }).optional(),
      page: z.number().optional().default(1),
      limit: z.number().optional().default(20),
    }))
    .query(async ({ input }) => {
      return api.replay.getSessionsWithErrors(
        input.projectId,
        input.filters,
        input.page,
        input.limit
      );
    }),

  getSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ input }) => {
      return api.replay.getSession(input.sessionId);
    }),

  getSessionEvents: protectedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      errorEventId: z.string().uuid().optional(), // Filter by specific error (Sentry-like)
      errorTime: z.string().optional(), // Error timestamp for time window filtering
    }))
    .query(async ({ input }) => {
      return api.replay.getSessionEvents(input.sessionId, input.errorEventId, input.errorTime);
    }),
});

/**
 * User router - protected
 */
const userRouter = router({
  getProfile: protectedProcedure.query(async () => {
    return api.user.getProfile();
  }),

  updateProfile: protectedProcedure
    .input(z.object({
      name: z.string().max(100).optional(),
      image: z.string().url().optional(),
    }))
    .mutation(async ({ input }) => {
      return api.user.updateProfile(input);
    }),

  getSessions: protectedProcedure.query(async () => {
    return api.user.getSessions();
  }),

  revokeSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      return api.user.revokeSession(input.sessionId);
    }),

  revokeAllSessions: protectedProcedure.mutation(async () => {
    return api.user.revokeAllSessions();
  }),

  canChangePassword: protectedProcedure.query(async () => {
    return api.user.canChangePassword();
  }),
});

/**
 * Performance router - protected
 */
const performanceRouter = router({
  getTransactions: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      op: z.string().optional(),
      page: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(100).optional(),
      dateRange: z.enum(["24h", "7d", "30d", "90d", "6m", "1y"]).optional(),
    }))
    .query(async ({ input }) => {
      return api.performance.getTransactions(input.projectId, {
        op: input.op,
        page: input.page,
        limit: input.limit,
        dateRange: input.dateRange,
      });
    }),

  getTransaction: protectedProcedure
    .input(z.object({ transactionId: z.string() }))
    .query(async ({ input }) => {
      return api.performance.getTransaction(input.transactionId);
    }),

  getSlowest: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      dateRange: z.enum(["24h", "7d", "30d", "90d", "6m", "1y"]).optional(),
    }))
    .query(async ({ input }) => {
      return api.performance.getSlowest(input.projectId, input.dateRange);
    }),

  getSpanAnalysis: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      dateRange: z.enum(["24h", "7d", "30d", "90d", "6m", "1y"]).optional(),
    }))
    .query(async ({ input }) => {
      return api.performance.getSpanAnalysis(input.projectId, input.dateRange);
    }),

  getApdex: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      dateRange: z.enum(["24h", "7d", "30d", "90d", "6m", "1y"]).optional(),
    }))
    .query(async ({ input }) => {
      return api.performance.getApdex(input.projectId, input.dateRange);
    }),

  getServerStats: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      dateRange: z.enum(["24h", "7d", "30d", "90d", "6m", "1y"]).optional(),
    }))
    .query(async ({ input }) => {
      return api.performance.getServerStats(input.projectId, input.dateRange);
    }),

  getTopEndpoints: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      dateRange: z.enum(["24h", "7d", "30d", "90d", "6m", "1y"]).optional(),
    }))
    .query(async ({ input }) => {
      return api.performance.getTopEndpoints(input.projectId, input.dateRange);
    }),

  getThroughputTimeline: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      dateRange: z.enum(["24h", "7d", "30d", "90d", "6m", "1y"]).optional(),
      name: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return api.performance.getThroughputTimeline(input.projectId, input.dateRange, input.name);
    }),

  getDurationTimeline: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      dateRange: z.enum(["24h", "7d", "30d", "90d", "6m", "1y"]).optional(),
      name: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return api.performance.getDurationTimeline(input.projectId, input.dateRange, input.name);
    }),

  getExternalCalls: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      dateRange: z.enum(["24h", "7d", "30d", "90d", "6m", "1y"]).optional(),
    }))
    .query(async ({ input }) => {
      return api.performance.getExternalCalls(input.projectId, input.dateRange);
    }),

  getCache: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      dateRange: z.enum(["24h", "7d", "30d", "90d", "6m", "1y"]).optional(),
    }))
    .query(async ({ input }) => {
      return api.performance.getCache(input.projectId, input.dateRange);
    }),

  getQueues: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      dateRange: z.enum(["24h", "7d", "30d", "90d", "6m", "1y"]).optional(),
    }))
    .query(async ({ input }) => {
      return api.performance.getQueues(input.projectId, input.dateRange);
    }),

  getEndpointDetail: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      name: z.string().min(1),
      dateRange: z.enum(["24h", "7d", "30d", "90d", "6m", "1y"]).optional(),
    }))
    .query(async ({ input }) => {
      return api.performance.getEndpointDetail(input.projectId, input.name, input.dateRange);
    }),

  getWebVitals: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      dateRange: z.enum(["24h", "7d", "30d", "90d", "6m", "1y"]).optional(),
    }))
    .query(async ({ input }) => {
      return api.performance.getWebVitals(input.projectId, input.dateRange);
    }),

});

/**
 * Logs router - protected
 */
const logsFilterInput = z.object({
  projectId: z.string().uuid(),
  level: z.enum(["debug", "info", "warning", "error"]).optional(),
  channel: z.string().max(100).optional(),
  search: z.string().max(200).optional(),
  statusCode: z.string().max(4).optional(),
  url: z.string().max(2000).optional(),
  traceId: z.string().max(64).optional(),
  spanId: z.string().max(32).optional(),
  requestId: z.string().max(200).optional(),
  userId: z.string().max(200).optional(),
  env: z.string().max(50).optional(),
  release: z.string().max(200).optional(),
  attribute: z.string().max(200).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const logsRouter = router({
  tail: protectedProcedure
    .input(logsFilterInput.extend({
      limit: z.number().int().positive().max(500).optional(),
      cursor: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return api.logs.tail(input);
    }),
  stats: protectedProcedure
    .input(logsFilterInput.extend({
      groupBy: z.enum(["level", "channel", "message"]).optional(),
    }))
    .query(async ({ input }) => {
      return api.logs.stats(input);
    }),
});

/**
 * Cron Monitoring router - protected
 */
const cronRouter = router({
  getMonitors: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      return api.cron.getMonitors(input.projectId);
    }),

  getMonitor: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return api.cron.getMonitor(input.id);
    }),

  createMonitor: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      name: z.string().min(1).max(100),
      slug: z.string().min(1).max(100),
      schedule: z.string().optional(),
      timezone: z.string().optional(),
      toleranceMinutes: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input }) => {
      return api.cron.createMonitor(input);
    }),

  updateMonitor: protectedProcedure
    .input(z.object({
      id: z.string(),
      updates: z.object({
        name: z.string().min(1).max(100).optional(),
        slug: z.string().min(1).max(100).optional(),
        schedule: z.string().optional(),
        timezone: z.string().optional(),
        toleranceMinutes: z.number().int().positive().optional(),
        status: z.enum(["active", "paused", "disabled"]).optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      return api.cron.updateMonitor(input.id, input.updates);
    }),

  deleteMonitor: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return api.cron.deleteMonitor(input.id);
    }),

  getCheckins: protectedProcedure
    .input(z.object({
      monitorId: z.string(),
      page: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }))
    .query(async ({ input }) => {
      return api.cron.getCheckins(input.monitorId, input.page, input.limit);
    }),

  getTimeline: protectedProcedure
    .input(z.object({ monitorId: z.string() }))
    .query(async ({ input }) => {
      return api.cron.getTimeline(input.monitorId);
    }),
});

/**
 * Attention router - protected
 * Returns prioritized error groups based on composite score
 */
const attentionRouter = router({
  getTop: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }).optional())
    .query(async ({ input }) => {
      return api.attention.getTop(input?.projectId, input?.limit ?? 8);
    }),
});

/**
 * Infrastructure Monitoring router - protected
 */
const infrastructureRouter = router({
  getHosts: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      return api.infrastructure.getHosts(input.projectId);
    }),

  getLatest: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      return api.infrastructure.getLatest(input.projectId);
    }),

  getHistory: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      hostId: z.string(),
      dateRange: z.enum(["1h", "6h", "24h", "7d"]),
    }))
    .query(async ({ input }) => {
      return api.infrastructure.getHistory(input.projectId, input.hostId, input.dateRange);
    }),
});

/**
 * App router - combines all routers
 */
export const appRouter = router({
  auth: authRouter,
  instance: instanceRouter,
  groups: groupsRouter,
  stats: statsRouter,
  organizations: organizationsRouter,
  projects: projectsRouter,
  projectSettings: projectSettingsRouter,
  members: membersRouter,
  apiKeys: apiKeysRouter,
  alerts: alertsRouter,
  onboarding: onboardingRouter,
  billing: billingRouter,
  replay: replayRouter,
  user: userRouter,
  performance: performanceRouter,
  logs: logsRouter,
  attention: attentionRouter,
  cron: cronRouter,
  infrastructure: infrastructureRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;

/**
 * Server-side caller for Server Components
 */
export const createCaller = createCallerFactory(appRouter);

export const getServerCaller = async () => {
  const context = await createTRPCContext();
  return createCaller(context);
};

/**
 * Server-side helpers for SSR prefetch + HydrationBoundary
 */
import { createServerSideHelpers } from "@trpc/react-query/server";

export const createSSRHelpers = async () => {
  const context = await createTRPCContext();
  return createServerSideHelpers({
    router: appRouter,
    ctx: context,
    transformer: superjson,
  });
};
