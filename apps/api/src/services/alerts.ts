import { eq, and, gt, desc } from "drizzle-orm";
import { db } from "../db/connection";
import { alertRules, notifications, errorGroups, errorEvents, projects } from "../db/schema";
import { sendErrorAlertEmail, sendThresholdAlertEmail, sendCronMissedAlertEmail } from "./email";
import logger from "../logger";
import type { AlertRuleType, AlertChannel, AlertRuleConfig, CreateAlertRuleInput } from "../types/services";

const DASHBOARD_URL = process.env.DASHBOARD_URL || "http://localhost:3001";

export async function createAlertRule(input: CreateAlertRuleInput) {
  const now = new Date();

  const result = await db
    .insert(alertRules)
    .values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      name: input.name,
      type: input.type,
      threshold: input.threshold,
      windowMinutes: input.windowMinutes,
      channel: input.channel,
      config: JSON.stringify(input.config),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  logger.info("Alert rule created", { ruleId: result[0].id, type: input.type });
  return result[0];
}

export async function listAlertRules(projectId: string) {
  return db
    .select()
    .from(alertRules)
    .where(eq(alertRules.projectId, projectId))
    .orderBy(desc(alertRules.createdAt));
}

export async function updateAlertRule(
  ruleId: string,
  updates: Partial<Omit<CreateAlertRuleInput, "projectId">> & { enabled?: boolean }
) {
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.type !== undefined) updateData.type = updates.type;
  if (updates.threshold !== undefined) updateData.threshold = updates.threshold;
  if (updates.windowMinutes !== undefined) updateData.windowMinutes = updates.windowMinutes;
  if (updates.channel !== undefined) updateData.channel = updates.channel;
  if (updates.config !== undefined) updateData.config = JSON.stringify(updates.config);
  if (updates.enabled !== undefined) updateData.enabled = updates.enabled;

  await db
    .update(alertRules)
    .set(updateData)
    .where(eq(alertRules.id, ruleId));

  logger.info("Alert rule updated", { ruleId });
}

export async function deleteAlertRule(ruleId: string) {
  await db.delete(alertRules).where(eq(alertRules.id, ruleId));
  logger.info("Alert rule deleted", { ruleId });
}

// Trigger alerts for a new error event
export async function triggerAlertsForNewError(
  projectId: string,
  fingerprint: string,
  isNewGroup: boolean,
  isRegression: boolean = false
) {
  logger.debug("Checking alerts for error", { projectId, fingerprint, isNewGroup, isRegression });

  // Get enabled rules for this project
  const rules = await db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.projectId, projectId), eq(alertRules.enabled, true)));

  if (rules.length === 0) {
    return;
  }

  // Get error group details
  const group = (await db
    .select()
    .from(errorGroups)
    .where(eq(errorGroups.fingerprint, fingerprint)))[0];

  if (!group) {
    return;
  }

  // Get project name
  const project = (await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId)))[0];

  const projectName = project?.name || "Unknown Project";

  for (const rule of rules) {
    try {
      const config: AlertRuleConfig = rule.config ?? {};

      // Check if rule should trigger
      let shouldTrigger = false;

      // Level filter: skip if the rule's config has a levelFilter and the group's level doesn't match
      const levelFilter = (config as Record<string, unknown>).levelFilter as string[] | undefined;
      if (levelFilter && levelFilter.length > 0 && !levelFilter.includes(group.level)) {
        continue;
      }

      if (rule.type === "new_error" && isNewGroup) {
        shouldTrigger = true;
      } else if (rule.type === "regression" && isRegression) {
        shouldTrigger = true;
      } else if (rule.type === "threshold" && rule.threshold && rule.windowMinutes) {
        const windowStart = new Date(Date.now() - rule.windowMinutes * 60 * 1000);
        const recentEvents = await db
          .select()
          .from(errorEvents)
          .where(
            and(
              eq(errorEvents.projectId, projectId),
              eq(errorEvents.fingerprint, fingerprint),
              gt(errorEvents.createdAt, windowStart)
            )
          );

        if (recentEvents.length >= rule.threshold) {
          const recentNotification = (await db
            .select()
            .from(notifications)
            .where(
              and(
                eq(notifications.ruleId, rule.id),
                eq(notifications.fingerprint, fingerprint),
                gt(notifications.createdAt, windowStart)
              )
            ))[0];

          if (!recentNotification) {
            shouldTrigger = true;
          }
        }
      }

      if (!shouldTrigger) {
        continue;
      }

      // Send notification based on channel
      let result: { success: boolean; error?: string };

      if (rule.channel === "email" && config.email) {
        if (rule.type === "threshold") {
          result = await sendThresholdAlertEmail({
            to: config.email,
            projectName,
            eventCount: group.count,
            threshold: rule.threshold!,
            windowMinutes: rule.windowMinutes!,
            dashboardUrl: DASHBOARD_URL,
          });
        } else {
          // Get latest event for environment info
          const latestEvent = (await db
            .select({ env: errorEvents.env })
            .from(errorEvents)
            .where(eq(errorEvents.fingerprint, fingerprint))
            .orderBy(desc(errorEvents.createdAt))
            .limit(1))[0];

          result = await sendErrorAlertEmail({
            to: config.email,
            projectName,
            errorMessage: group.message,
            errorFile: group.file,
            errorLine: group.line,
            eventCount: group.count,
            fingerprint,
            environment: latestEvent?.env,
            dashboardUrl: DASHBOARD_URL,
          });
        }
      } else if (rule.channel === "webhook" && config.webhookUrl) {
        result = await sendWebhook(config.webhookUrl, {
          type: rule.type,
          projectName,
          error: {
            message: group.message,
            file: group.file,
            line: group.line,
            count: group.count,
            fingerprint,
          },
        });
      } else if (rule.channel === "slack" && config.slackWebhook) {
        result = await sendSlackNotification(config.slackWebhook, {
          projectName,
          errorMessage: group.message,
          errorFile: group.file,
          errorLine: group.line,
          eventCount: group.count,
          fingerprint,
          dashboardUrl: DASHBOARD_URL,
        });
      } else if (rule.channel === "discord" && config.discordWebhook) {
        result = await sendDiscordNotification(config.discordWebhook, {
          projectName,
          errorMessage: group.message,
          errorFile: group.file,
          errorLine: group.line,
          eventCount: group.count,
          fingerprint,
          dashboardUrl: DASHBOARD_URL,
        });
      } else if (rule.channel === "telegram" && config.telegramBotToken && config.telegramChatId) {
        result = await sendTelegramNotification(config.telegramBotToken, config.telegramChatId, {
          alertType: rule.type,
          level: group.level,
          projectName,
          errorMessage: group.message,
          errorFile: group.file,
          errorLine: group.line,
          eventCount: group.count,
          threshold: rule.threshold ?? undefined,
          windowMinutes: rule.windowMinutes ?? undefined,
          fingerprint,
          dashboardUrl: DASHBOARD_URL,
        });
      } else if (rule.channel === "github" && config.githubToken && config.githubRepo) {
        result = await createGitHubIssue(config.githubToken, config.githubRepo, {
          projectName,
          errorMessage: group.message,
          errorFile: group.file,
          errorLine: group.line,
          eventCount: group.count,
          fingerprint,
          dashboardUrl: DASHBOARD_URL,
        });
      } else if (rule.channel === "gitlab" && config.gitlabToken && config.gitlabProjectId) {
        result = await createGitLabIssue(
          config.gitlabToken,
          config.gitlabProjectId,
          config.gitlabUrl || "https://gitlab.com",
          {
            projectName,
            errorMessage: group.message,
            errorFile: group.file,
            errorLine: group.line,
            eventCount: group.count,
            fingerprint,
            dashboardUrl: DASHBOARD_URL,
          }
        );
      } else {
        logger.warn("No valid config for alert channel", { ruleId: rule.id, channel: rule.channel });
        continue;
      }

      // Log notification
      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        projectId,
        fingerprint,
        channel: rule.channel,
        status: result.success ? "sent" : "failed",
        error: result.error,
        sentAt: result.success ? new Date() : null,
        createdAt: new Date(),
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : "Unknown error";
      logger.error("Failed to process alert rule", { ruleId: rule.id, error });

      // Log failed notification
      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        projectId,
        fingerprint,
        channel: rule.channel,
        status: "failed",
        error,
        createdAt: new Date(),
      });
    }
  }
}

// Webhook sender
async function sendWebhook(
  url: string,
  payload: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    logger.info("Webhook sent", { url });
    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown error";
    logger.error("Webhook failed", { url, error });
    return { success: false, error };
  }
}

// Slack notification sender
async function sendSlackNotification(
  webhookUrl: string,
  data: {
    projectName: string;
    errorMessage: string;
    errorFile: string;
    errorLine: number;
    eventCount: number;
    fingerprint: string;
    dashboardUrl: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `New Error in ${data.projectName}`,
              emoji: true,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Error:* \`${data.errorMessage}\`\n*Location:* \`${data.errorFile}:${data.errorLine}\`\n*Events:* ${data.eventCount}`,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "View Details",
                  emoji: true,
                },
                url: `${data.dashboardUrl}/dashboard/issues/${data.fingerprint}`,
                style: "primary",
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    logger.info("Slack notification sent");
    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown error";
    logger.error("Slack notification failed", { error });
    return { success: false, error };
  }
}

// Discord notification sender
async function sendDiscordNotification(
  webhookUrl: string,
  data: {
    projectName: string;
    errorMessage: string;
    errorFile: string;
    errorLine: number;
    eventCount: number;
    fingerprint: string;
    dashboardUrl: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: `New Error in ${data.projectName}`,
          description: `**Error:** \`${data.errorMessage}\`\n**Location:** \`${data.errorFile}:${data.errorLine}\`\n**Events:** ${data.eventCount}`,
          color: 0xff0000,
          fields: [
            { name: "Project", value: data.projectName, inline: true },
            { name: "Events", value: String(data.eventCount), inline: true },
          ],
          url: `${data.dashboardUrl}/dashboard/issues/${data.fingerprint}`,
        }],
      }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }
    logger.info("Discord notification sent");
    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown error";
    logger.error("Discord notification failed", { error });
    return { success: false, error };
  }
}

const ALERT_TYPE_LABELS: Record<string, { icon: string; label: string }> = {
  new_error: { icon: "\u{1F6A8}", label: "New Error" },
  regression: { icon: "\u{1F504}", label: "Regression" },
  threshold: { icon: "\u{1F4C8}", label: "Spike Alert" },
  cron_missed: { icon: "\u{23F0}", label: "Cron Alert" },
};

const LEVEL_ICONS: Record<string, string> = {
  fatal: "\u{1F480}",
  error: "\u{274C}",
  warning: "\u{26A0}\u{FE0F}",
  info: "\u{2139}\u{FE0F}",
  debug: "\u{1F41B}",
};

async function sendTelegramNotification(
  botToken: string,
  chatId: string,
  data: {
    alertType: string;
    level: string;
    projectName: string;
    errorMessage: string;
    errorFile: string;
    errorLine: number;
    eventCount: number;
    threshold?: number;
    windowMinutes?: number;
    fingerprint: string;
    dashboardUrl: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const meta = ALERT_TYPE_LABELS[data.alertType] ?? { icon: "\u{1F514}", label: "Alert" };
    const levelIcon = LEVEL_ICONS[data.level] ?? "";
    const esc = escapeMarkdownV2;

    let text = `${meta.icon} *${esc(`[${meta.label}] ${data.projectName}`)}*\n\n`;
    text += `${levelIcon} *Level:* \`${esc(data.level)}\`\n`;
    text += `*Error:* \`${esc(data.errorMessage)}\`\n`;
    text += `*Location:* \`${esc(data.errorFile)}:${data.errorLine}\`\n`;
    text += `*Events:* ${data.eventCount}\n`;

    if (data.alertType === "threshold" && data.threshold && data.windowMinutes) {
      text += `*Threshold:* ${esc(`${data.threshold}+ events in ${data.windowMinutes}min`)}\n`;
    }

    const linkUrl = `${data.dashboardUrl}/dashboard/issues/${data.fingerprint}`;
    text += `\n[View Details](${esc(linkUrl)})`;

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${body}` };
    }
    logger.info("Telegram notification sent", { alertType: data.alertType });
    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown error";
    logger.error("Telegram notification failed", { error });
    return { success: false, error };
  }
}

function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

// GitHub issue creator
async function createGitHubIssue(
  token: string,
  repo: string,
  data: {
    projectName: string;
    errorMessage: string;
    errorFile: string;
    errorLine: number;
    eventCount: number;
    fingerprint: string;
    dashboardUrl: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const title = `[ErrorWatch] ${data.errorMessage.slice(0, 100)}`;

    // Dedup: check if issue already exists
    const searchResponse = await fetch(
      `https://api.github.com/search/issues?q=${encodeURIComponent(title)}+repo:${repo}+state:open`,
      { headers: { Authorization: `Bearer ${token}`, "User-Agent": "ErrorWatch" } }
    );

    if (searchResponse.ok) {
      const searchResult = await searchResponse.json() as { total_count: number };
      if (searchResult.total_count > 0) {
        logger.info("GitHub issue already exists, skipping", { repo });
        return { success: true };
      }
    }

    const body = `## Error Details\n\n` +
      `- **Project:** ${data.projectName}\n` +
      `- **Message:** \`${data.errorMessage}\`\n` +
      `- **Location:** \`${data.errorFile}:${data.errorLine}\`\n` +
      `- **Events:** ${data.eventCount}\n\n` +
      `[View on ErrorWatch](${data.dashboardUrl}/dashboard/issues/${data.fingerprint})\n\n` +
      `---\n*Created automatically by ErrorWatch*`;

    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "ErrorWatch",
      },
      body: JSON.stringify({
        title,
        body,
        labels: ["bug", "errorwatch"],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }
    logger.info("GitHub issue created", { repo });
    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown error";
    logger.error("GitHub issue creation failed", { error });
    return { success: false, error };
  }
}

// GitLab issue creator
async function createGitLabIssue(
  token: string,
  projectId: string,
  gitlabUrl: string,
  data: {
    projectName: string;
    errorMessage: string;
    errorFile: string;
    errorLine: number;
    eventCount: number;
    fingerprint: string;
    dashboardUrl: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const title = `[ErrorWatch] ${data.errorMessage.slice(0, 100)}`;
    const baseUrl = gitlabUrl || "https://gitlab.com";

    // Dedup: check if issue already exists
    const searchResponse = await fetch(
      `${baseUrl}/api/v4/projects/${projectId}/issues?search=${encodeURIComponent(title)}&state=opened`,
      { headers: { "PRIVATE-TOKEN": token } }
    );

    if (searchResponse.ok) {
      const issues = await searchResponse.json() as unknown[];
      if (Array.isArray(issues) && issues.length > 0) {
        logger.info("GitLab issue already exists, skipping", { projectId });
        return { success: true };
      }
    }

    const description = `## Error Details\n\n` +
      `- **Project:** ${data.projectName}\n` +
      `- **Message:** \`${data.errorMessage}\`\n` +
      `- **Location:** \`${data.errorFile}:${data.errorLine}\`\n` +
      `- **Events:** ${data.eventCount}\n\n` +
      `[View on ErrorWatch](${data.dashboardUrl}/dashboard/issues/${data.fingerprint})\n\n` +
      `---\n*Created automatically by ErrorWatch*`;

    const response = await fetch(`${baseUrl}/api/v4/projects/${projectId}/issues`, {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        description,
        labels: "bug,errorwatch",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }
    logger.info("GitLab issue created", { projectId });
    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown error";
    logger.error("GitLab issue creation failed", { error });
    return { success: false, error };
  }
}

/**
 * Trigger alerts when a cron monitor reports an error or is detected as missed.
 */
export async function triggerAlertsForCronError(
  projectId: string,
  monitorName: string,
  monitorSlug: string,
  status: "error" | "missed"
) {
  logger.debug("Checking cron alerts", { projectId, monitorSlug, status });

  // Get enabled rules for this project with type "cron_missed"
  const rules = await db
    .select()
    .from(alertRules)
    .where(
      and(
        eq(alertRules.projectId, projectId),
        eq(alertRules.enabled, true),
        eq(alertRules.type, "cron_missed")
      )
    );

  if (rules.length === 0) {
    return;
  }

  // Get project name
  const project = (await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId)))[0];

  const projectName = project?.name ?? "Unknown Project";

  for (const rule of rules) {
    try {
      const config: AlertRuleConfig = rule.config ?? {};
      let result: { success: boolean; error?: string };

      if (rule.channel === "email" && config.email) {
        result = await sendCronMissedAlertEmail({
          to: config.email,
          projectName,
          monitorName,
          monitorSlug,
          status,
          dashboardUrl: DASHBOARD_URL,
        });
      } else if (rule.channel === "webhook" && config.webhookUrl) {
        result = await sendWebhook(config.webhookUrl, {
          type: "cron_missed",
          projectName,
          monitor: { name: monitorName, slug: monitorSlug, status },
        });
      } else if (rule.channel === "slack" && config.slackWebhook) {
        result = await sendCronSlackNotification(config.slackWebhook, {
          projectName,
          monitorName,
          monitorSlug,
          status,
          dashboardUrl: DASHBOARD_URL,
        });
      } else if (rule.channel === "discord" && config.discordWebhook) {
        const label = status === "missed" ? "Missed" : "Failed";
        result = await sendDiscordNotification(config.discordWebhook, {
          projectName,
          errorMessage: `Cron Monitor ${label}: ${monitorName} (${monitorSlug})`,
          errorFile: monitorSlug,
          errorLine: 0,
          eventCount: 0,
          fingerprint: "",
          dashboardUrl: DASHBOARD_URL,
        });
      } else if (rule.channel === "telegram" && config.telegramBotToken && config.telegramChatId) {
        const label = status === "missed" ? "Missed" : "Failed";
        result = await sendTelegramNotification(config.telegramBotToken, config.telegramChatId, {
          alertType: "cron_missed",
          level: "error",
          projectName,
          errorMessage: `Cron Monitor ${label}: ${monitorName} (${monitorSlug})`,
          errorFile: monitorSlug,
          errorLine: 0,
          eventCount: 0,
          fingerprint: "",
          dashboardUrl: DASHBOARD_URL,
        });
      } else {
        logger.warn("No valid config for cron alert channel", { ruleId: rule.id, channel: rule.channel });
        continue;
      }

      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        projectId,
        channel: rule.channel,
        status: result.success ? "sent" : "failed",
        error: result.error,
        sentAt: result.success ? new Date() : null,
        createdAt: new Date(),
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : "Unknown error";
      logger.error("Failed to process cron alert rule", { ruleId: rule.id, error });

      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        projectId,
        channel: rule.channel,
        status: "failed",
        error,
        createdAt: new Date(),
      });
    }
  }
}

// Slack notification for cron missed/error alerts
async function sendCronSlackNotification(
  webhookUrl: string,
  data: {
    projectName: string;
    monitorName: string;
    monitorSlug: string;
    status: "error" | "missed";
    dashboardUrl: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const label = data.status === "missed" ? "Missed" : "Failed";
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `Cron Monitor ${label}: ${data.monitorName}`,
              emoji: true,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Project:* ${data.projectName}\n*Monitor:* \`${data.monitorSlug}\`\n*Status:* ${data.status}`,
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    logger.info("Cron Slack notification sent");
    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown error";
    logger.error("Cron Slack notification failed", { error });
    return { success: false, error };
  }
}

// Get notification history
export async function getNotificationHistory(projectId: string, limit = 50) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.projectId, projectId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}
