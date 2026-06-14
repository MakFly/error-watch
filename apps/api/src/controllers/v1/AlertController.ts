import type { AuthContext } from "../../types/context";
import { z } from "zod";
import { AlertService } from "../../services/AlertService";
import logger from "../../logger";

export const list = async (c: AuthContext) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");

  if (!projectId) {
    return c.json({ error: "projectId query parameter required" }, 400);
  }

  try {
    const rules = await AlertService.list(projectId as string, userId);
    return c.json(rules);
  } catch (error: any) {
    if (error.message === "Project not found" || error.message === "Access denied") {
      return c.json({ error: error.message }, 403);
    }
    logger.error("Failed to list alert rules", { error });
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const create = async (c: AuthContext) => {
  const userId = c.get("userId");

  const schema = z.object({
    projectId: z.string().min(1),
    name: z.string().min(1).max(100),
    type: z.enum(["new_error", "threshold", "regression"]),
    threshold: z.number().optional(),
    windowMinutes: z.number().optional(),
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
  });

  try {
    const input = schema.parse(await c.req.json());

    if (input.type === "threshold") {
      if (!input.threshold || !input.windowMinutes) {
        return c.json(
          { error: "Threshold rules require threshold and windowMinutes" },
          400
        );
      }
    }

    if (input.channel === "email" && !input.config.email) {
      return c.json({ error: "Email channel requires email address" }, 400);
    }
    if (input.channel === "slack" && !input.config.slackWebhook) {
      return c.json({ error: "Slack channel requires webhook URL" }, 400);
    }
    if (input.channel === "webhook" && !input.config.webhookUrl) {
      return c.json({ error: "Webhook channel requires webhook URL" }, 400);
    }
    if (input.channel === "discord" && !input.config.discordWebhook) {
      return c.json({ error: "Discord channel requires webhook URL" }, 400);
    }
    if (input.channel === "telegram" && (!input.config.telegramBotToken || !input.config.telegramChatId)) {
      return c.json({ error: "Telegram channel requires bot token and chat ID" }, 400);
    }
    if (input.channel === "github" && (!input.config.githubToken || !input.config.githubRepo)) {
      return c.json({ error: "GitHub channel requires token and repository" }, 400);
    }
    if (input.channel === "gitlab" && (!input.config.gitlabToken || !input.config.gitlabProjectId)) {
      return c.json({ error: "GitLab channel requires token and project ID" }, 400);
    }

    const rule = await AlertService.create(userId, input);
    return c.json(rule);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid input", details: error.issues }, 400);
    }
    if (error.message === "Project not found" || error.message === "Access denied") {
      return c.json({ error: error.message }, 403);
    }
    logger.error("Failed to create alert rule", { error });
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const update = async (c: AuthContext) => {
  const userId = c.get("userId");
  const ruleId = c.req.param("id");

  const schema = z.object({
    name: z.string().min(1).max(100).optional(),
    type: z.enum(["new_error", "threshold", "regression"]).optional(),
    threshold: z.number().optional(),
    windowMinutes: z.number().optional(),
    channel: z.enum(["email", "slack", "webhook", "discord", "telegram", "github", "gitlab"]).optional(),
    config: z
      .object({
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
      })
      .optional(),
    enabled: z.boolean().optional(),
  });

  try {
    const input = schema.parse(await c.req.json());

    if (input.channel && input.config) {
      if (input.channel === "telegram" && (!input.config.telegramBotToken || !input.config.telegramChatId)) {
        return c.json({ error: "Telegram channel requires bot token and chat ID" }, 400);
      }
      if (input.channel === "email" && !input.config.email) {
        return c.json({ error: "Email channel requires email address" }, 400);
      }
      if (input.channel === "slack" && !input.config.slackWebhook) {
        return c.json({ error: "Slack channel requires webhook URL" }, 400);
      }
      if (input.channel === "discord" && !input.config.discordWebhook) {
        return c.json({ error: "Discord channel requires webhook URL" }, 400);
      }
      if (input.channel === "github" && (!input.config.githubToken || !input.config.githubRepo)) {
        return c.json({ error: "GitHub channel requires token and repository" }, 400);
      }
      if (input.channel === "gitlab" && (!input.config.gitlabToken || !input.config.gitlabProjectId)) {
        return c.json({ error: "GitLab channel requires token and project ID" }, 400);
      }
    }

    const result = await AlertService.update(userId, ruleId, input);
    return c.json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid input", details: error.issues }, 400);
    }
    if (error.message === "Alert rule not found") {
      return c.json({ error: error.message }, 404);
    }
    if (error.message === "Access denied") {
      return c.json({ error: error.message }, 403);
    }
    logger.error("Failed to update alert rule", { error, ruleId });
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const remove = async (c: AuthContext) => {
  const userId = c.get("userId");
  const ruleId = c.req.param("id");

  try {
    const result = await AlertService.delete(userId, ruleId);
    return c.json(result);
  } catch (error: any) {
    if (error.message === "Alert rule not found") {
      return c.json({ error: error.message }, 404);
    }
    if (error.message === "Access denied") {
      return c.json({ error: error.message }, 403);
    }
    logger.error("Failed to delete alert rule", { error, ruleId });
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const getNotifications = async (c: AuthContext) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");

  if (!projectId) {
    return c.json({ error: "projectId query parameter required" }, 400);
  }

  try {
    const history = await AlertService.getNotifications(projectId as string, userId);
    return c.json(history);
  } catch (error: any) {
    if (error.message === "Project not found" || error.message === "Access denied") {
      return c.json({ error: error.message }, 403);
    }
    logger.error("Failed to get notification history", { error });
    return c.json({ error: "Internal server error" }, 500);
  }
};

