"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Mail, MessageSquare, AlertTriangle, RefreshCw, MessageCircle, Send, Github, GitBranch, Check } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { useCurrentProject } from "@/contexts/ProjectContext";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

type AlertChannel = "email" | "slack" | "webhook" | "discord" | "telegram" | "github" | "gitlab";
type AlertRuleType = "new_error" | "regression" | "threshold";

const CHANNEL_META: Record<AlertChannel, { name: string; type: AlertRuleType }> = {
  email: { name: "Email Alerts", type: "new_error" },
  slack: { name: "Slack Alerts", type: "new_error" },
  discord: { name: "Discord Alerts", type: "new_error" },
  telegram: { name: "Telegram Alerts", type: "new_error" },
  github: { name: "GitHub Issues", type: "new_error" },
  gitlab: { name: "GitLab Issues", type: "new_error" },
  webhook: { name: "Webhook Alerts", type: "new_error" },
};

const ALERT_LEVELS = ["fatal", "error", "warning", "info", "debug"] as const;

export function AlertsSection() {
  const t = useTranslations("settings.alerts");
  const tCommon = useTranslations("common");

  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailAddress, setEmailAddress] = useState("");
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackWebhook, setSlackWebhook] = useState("");
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [discordWebhook, setDiscordWebhook] = useState("");
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramRuleType, setTelegramRuleType] = useState<AlertRuleType>("new_error");
  const [telegramLevelFilter, setTelegramLevelFilter] = useState<string[]>([]);
  const [telegramThreshold, setTelegramThreshold] = useState("10");
  const [telegramWindowMinutes, setTelegramWindowMinutes] = useState("60");
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [githubToken, setGithubToken] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [gitlabEnabled, setGitlabEnabled] = useState(false);
  const [gitlabToken, setGitlabToken] = useState("");
  const [gitlabProjectId, setGitlabProjectId] = useState("");
  const [gitlabUrl, setGitlabUrl] = useState("https://gitlab.com");
  const [threshold, setThreshold] = useState("10");
  const [savingChannel, setSavingChannel] = useState<string | null>(null);

  const { currentProjectId } = useCurrentProject();
  const { data: alertRules, refetch: refetchAlerts } = trpc.alerts.getRules.useQuery(
    { projectId: currentProjectId! },
    { enabled: !!currentProjectId }
  );

  const createAlertMutation = trpc.alerts.createRule.useMutation();
  const updateAlertMutation = trpc.alerts.updateRule.useMutation();

  const findRule = useCallback(
    (channel: string) =>
      alertRules?.find(
        (r) => r.channel === channel && (channel !== "email" || r.type === "new_error"),
      ),
    [alertRules],
  );

  const saveChannel = useCallback(
    async (
      channel: AlertChannel,
      enabled: boolean,
      config: Record<string, unknown>,
      overrides?: { type?: AlertRuleType; threshold?: number; windowMinutes?: number }
    ) => {
      if (!currentProjectId) return;
      setSavingChannel(channel);
      const rule = findRule(channel);
      try {
        if (rule) {
          await updateAlertMutation.mutateAsync({
            id: rule.id,
            updates: {
              enabled,
              config,
              ...(overrides?.type && { type: overrides.type }),
              ...(overrides?.threshold !== undefined && { threshold: overrides.threshold }),
              ...(overrides?.windowMinutes !== undefined && { windowMinutes: overrides.windowMinutes }),
            },
          });
        } else {
          await createAlertMutation.mutateAsync({
            projectId: currentProjectId,
            name: CHANNEL_META[channel].name,
            type: overrides?.type ?? CHANNEL_META[channel].type,
            channel,
            config,
            ...(overrides?.threshold !== undefined && { threshold: overrides.threshold }),
            ...(overrides?.windowMinutes !== undefined && { windowMinutes: overrides.windowMinutes }),
          });
        }
        await refetchAlerts();
        toast.success(t("toastSaved"));
      } catch {
        toast.error(t("toastFailed"));
      } finally {
        setSavingChannel(null);
      }
    },
    [currentProjectId, findRule, createAlertMutation, updateAlertMutation, refetchAlerts, t],
  );

  useEffect(() => {
    if (alertRules) {
      const emailRule = alertRules.find((r) => r.channel === "email" && r.type === "new_error");
      const slackRule = alertRules.find((r) => r.channel === "slack");
      const discordRule = alertRules.find((r) => r.channel === "discord");
      const telegramRule = alertRules.find((r) => r.channel === "telegram");
      const githubRule = alertRules.find((r) => r.channel === "github");
      const gitlabRule = alertRules.find((r) => r.channel === "gitlab");
      const thresholdRule = alertRules.find((r) => r.type === "threshold");

      if (emailRule) {
        setEmailEnabled(emailRule.enabled);
        setEmailAddress(emailRule.config?.email || "");
      }
      if (slackRule) {
        setSlackEnabled(slackRule.enabled);
        setSlackWebhook(slackRule.config?.slackWebhook || "");
      }
      if (discordRule) {
        setDiscordEnabled(discordRule.enabled);
        setDiscordWebhook(discordRule.config?.discordWebhook || "");
      }
      if (telegramRule) {
        setTelegramEnabled(telegramRule.enabled);
        setTelegramBotToken(telegramRule.config?.telegramBotToken || "");
        setTelegramChatId(telegramRule.config?.telegramChatId || "");
        setTelegramRuleType((telegramRule.type as AlertRuleType) || "new_error");
        setTelegramLevelFilter(telegramRule.config?.levelFilter || []);
        if (telegramRule.threshold) setTelegramThreshold(String(telegramRule.threshold));
        if (telegramRule.windowMinutes) setTelegramWindowMinutes(String(telegramRule.windowMinutes));
      }
      if (githubRule) {
        setGithubEnabled(githubRule.enabled);
        setGithubToken("");
        setGithubRepo(githubRule.config?.githubRepo || "");
      }
      if (gitlabRule) {
        setGitlabEnabled(gitlabRule.enabled);
        setGitlabToken("");
        setGitlabProjectId(gitlabRule.config?.gitlabProjectId || "");
        setGitlabUrl(gitlabRule.config?.gitlabUrl || "https://gitlab.com");
      }
      if (thresholdRule) {
        setThreshold(String(thresholdRule.threshold || 10));
      }
    }
  }, [alertRules]);

  const saveThreshold = async () => {
    if (!currentProjectId) return;
    setSavingChannel("threshold");
    const existingRule = alertRules?.find((r) => r.type === "threshold");
    try {
      if (existingRule) {
        await updateAlertMutation.mutateAsync({
          id: existingRule.id,
          updates: { threshold: Number(threshold) },
        });
      } else {
        await createAlertMutation.mutateAsync({
          projectId: currentProjectId,
          name: "Threshold Alert",
          type: "threshold",
          channel: "email",
          config: {},
          threshold: Number(threshold),
        });
      }
      await refetchAlerts();
      toast.success(t("toastSaved"));
    } catch {
      toast.error(t("toastFailed"));
    } finally {
      setSavingChannel(null);
    }
  };

  const SaveButton = ({ channel, disabled }: { channel: string; disabled?: boolean }) => (
    <div className="flex justify-end pt-2">
      <Button
        size="sm"
        disabled={disabled || savingChannel === channel}
        onClick={() => {
          switch (channel) {
            case "email": return saveChannel("email", emailEnabled, { email: emailAddress });
            case "slack": return saveChannel("slack", slackEnabled, { slackWebhook });
            case "discord": return saveChannel("discord", discordEnabled, { discordWebhook });
            case "telegram": return saveChannel(
              "telegram",
              telegramEnabled,
              {
                telegramBotToken,
                telegramChatId,
                ...(telegramLevelFilter.length > 0 && { levelFilter: telegramLevelFilter }),
              },
              {
                type: telegramRuleType,
                ...(telegramRuleType === "threshold" && {
                  threshold: Number(telegramThreshold),
                  windowMinutes: Number(telegramWindowMinutes),
                }),
              }
            );
            case "github": return saveChannel("github", githubEnabled, githubToken ? { githubToken, githubRepo } : { githubRepo });
            case "gitlab": return saveChannel("gitlab", gitlabEnabled, gitlabToken ? { gitlabToken, gitlabProjectId, gitlabUrl } : { gitlabProjectId, gitlabUrl });
            case "threshold": return saveThreshold();
          }
        }}
      >
        {savingChannel === channel ? (
          <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="mr-2 h-3.5 w-3.5" />
        )}
        {tCommon("save")}
      </Button>
    </div>
  );

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {/* Email */}
        <Card className="bg-gradient-to-t from-primary/5 to-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-5 w-5 text-primary" />
                  {t("emailCardTitle")}
                </CardTitle>
                <CardDescription>{t("emailCardDescription")}</CardDescription>
              </div>
              <Switch checked={emailEnabled} onCheckedChange={setEmailEnabled} />
            </div>
          </CardHeader>
          <CardContent className={cn("space-y-4", !emailEnabled && "opacity-50 pointer-events-none")}>
            <div className="space-y-2">
              <Label htmlFor="email">{t("emailAddressLabel")}</Label>
              <Input
                id="email"
                type="email"
                value={emailAddress}
                onChange={(e) => setEmailAddress(e.target.value)}
                placeholder={t("emailPlaceholder")}
              />
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-muted-foreground">{t("emailDigestNote")}</span>
            </div>
            <SaveButton channel="email" disabled={!emailAddress} />
          </CardContent>
        </Card>

        {/* Slack */}
        <Card className="bg-gradient-to-t from-primary/5 to-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-primary" />
                  {t("slackCardTitle")}
                </CardTitle>
                <CardDescription>{t("slackCardDescription")}</CardDescription>
              </div>
              <Switch checked={slackEnabled} onCheckedChange={setSlackEnabled} />
            </div>
          </CardHeader>
          <CardContent className={cn("space-y-4", !slackEnabled && "opacity-50 pointer-events-none")}>
            <div className="space-y-2">
              <Label htmlFor="slack">{t("slackWebhookLabel")}</Label>
              <Input
                id="slack"
                value={slackWebhook}
                onChange={(e) => setSlackWebhook(e.target.value)}
                placeholder={t("slackWebhookPlaceholder")}
                className="font-mono text-sm"
              />
            </div>
            <SaveButton channel="slack" disabled={!slackWebhook} />
          </CardContent>
        </Card>

        {/* Discord */}
        <Card className="bg-gradient-to-t from-primary/5 to-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="h-5 w-5 text-primary" />
                  {t("discordCardTitle")}
                </CardTitle>
                <CardDescription>{t("discordCardDescription")}</CardDescription>
              </div>
              <Switch checked={discordEnabled} onCheckedChange={setDiscordEnabled} />
            </div>
          </CardHeader>
          <CardContent className={cn("space-y-4", !discordEnabled && "opacity-50 pointer-events-none")}>
            <div className="space-y-2">
              <Label htmlFor="discord-webhook">{t("discordWebhookLabel")}</Label>
              <Input
                id="discord-webhook"
                value={discordWebhook}
                onChange={(e) => setDiscordWebhook(e.target.value)}
                placeholder={t("discordWebhookPlaceholder")}
                className="font-mono text-sm"
              />
            </div>
            <SaveButton channel="discord" disabled={!discordWebhook} />
          </CardContent>
        </Card>

        {/* Telegram */}
        <Card className="bg-gradient-to-t from-primary/5 to-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Send className="h-5 w-5 text-primary" />
                  {t("telegramCardTitle")}
                </CardTitle>
                <CardDescription>{t("telegramCardDescription")}</CardDescription>
              </div>
              <Switch checked={telegramEnabled} onCheckedChange={setTelegramEnabled} />
            </div>
          </CardHeader>
          <CardContent className={cn("space-y-4", !telegramEnabled && "opacity-50 pointer-events-none")}>
            <div className="space-y-2">
              <Label htmlFor="telegram-bot-token">{t("telegramBotTokenLabel")}</Label>
              <Input
                id="telegram-bot-token"
                value={telegramBotToken}
                onChange={(e) => setTelegramBotToken(e.target.value)}
                placeholder={t("telegramBotTokenPlaceholder")}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telegram-chat-id">{t("telegramChatIdLabel")}</Label>
              <Input
                id="telegram-chat-id"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                placeholder={t("telegramChatIdPlaceholder")}
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label>Alert Type</Label>
              <Select value={telegramRuleType} onValueChange={(v) => setTelegramRuleType(v as AlertRuleType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new_error">New Error</SelectItem>
                  <SelectItem value="regression">Regression</SelectItem>
                  <SelectItem value="threshold">Spike (Threshold)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {telegramRuleType === "threshold" && (
              <div className="flex items-center gap-3">
                <div className="space-y-1">
                  <Label htmlFor="tg-threshold">Threshold</Label>
                  <Input
                    id="tg-threshold"
                    type="number"
                    min="1"
                    value={telegramThreshold}
                    onChange={(e) => setTelegramThreshold(e.target.value)}
                    className="w-20"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tg-window">Window (min)</Label>
                  <Input
                    id="tg-window"
                    type="number"
                    min="1"
                    value={telegramWindowMinutes}
                    onChange={(e) => setTelegramWindowMinutes(e.target.value)}
                    className="w-20"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Level Filter</Label>
              <p className="text-xs text-muted-foreground">Only alert for selected levels (leave empty for all)</p>
              <div className="flex flex-wrap gap-3">
                {ALERT_LEVELS.map((level) => (
                  <label key={level} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={telegramLevelFilter.includes(level)}
                      onCheckedChange={(checked) => {
                        setTelegramLevelFilter((prev) =>
                          checked ? [...prev, level] : prev.filter((l) => l !== level)
                        );
                      }}
                    />
                    {level}
                  </label>
                ))}
              </div>
            </div>

            <SaveButton channel="telegram" disabled={!telegramBotToken || !telegramChatId} />
          </CardContent>
        </Card>

        {/* GitHub */}
        <Card className="bg-gradient-to-t from-primary/5 to-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Github className="h-5 w-5 text-primary" />
                  {t("githubCardTitle")}
                </CardTitle>
                <CardDescription>{t("githubCardDescription")}</CardDescription>
              </div>
              <Switch checked={githubEnabled} onCheckedChange={setGithubEnabled} />
            </div>
          </CardHeader>
          <CardContent className={cn("space-y-4", !githubEnabled && "opacity-50 pointer-events-none")}>
            <div className="space-y-2">
              <Label htmlFor="github-token">{t("githubTokenLabel")}</Label>
              <Input
                id="github-token"
                type="password"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                placeholder={
                  alertRules?.find((r) => r.channel === "github")
                    ? "••••••••"
                    : t("githubTokenPlaceholder")
                }
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="github-repo">{t("githubRepoLabel")}</Label>
              <Input
                id="github-repo"
                value={githubRepo}
                onChange={(e) => setGithubRepo(e.target.value)}
                placeholder={t("githubRepoPlaceholder")}
                className="font-mono text-sm"
              />
            </div>
            <SaveButton channel="github" disabled={!githubRepo} />
          </CardContent>
        </Card>

        {/* GitLab */}
        <Card className="bg-gradient-to-t from-primary/5 to-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <GitBranch className="h-5 w-5 text-primary" />
                  {t("gitlabCardTitle")}
                </CardTitle>
                <CardDescription>{t("gitlabCardDescription")}</CardDescription>
              </div>
              <Switch checked={gitlabEnabled} onCheckedChange={setGitlabEnabled} />
            </div>
          </CardHeader>
          <CardContent className={cn("space-y-4", !gitlabEnabled && "opacity-50 pointer-events-none")}>
            <div className="space-y-2">
              <Label htmlFor="gitlab-token">{t("gitlabTokenLabel")}</Label>
              <Input
                id="gitlab-token"
                type="password"
                value={gitlabToken}
                onChange={(e) => setGitlabToken(e.target.value)}
                placeholder={
                  alertRules?.find((r) => r.channel === "gitlab")
                    ? "••••••••"
                    : t("gitlabTokenPlaceholder")
                }
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gitlab-project-id">{t("gitlabProjectIdLabel")}</Label>
              <Input
                id="gitlab-project-id"
                value={gitlabProjectId}
                onChange={(e) => setGitlabProjectId(e.target.value)}
                placeholder={t("gitlabProjectIdPlaceholder")}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gitlab-url">{t("gitlabUrlLabel")}</Label>
              <Input
                id="gitlab-url"
                value={gitlabUrl}
                onChange={(e) => setGitlabUrl(e.target.value)}
                placeholder={t("gitlabUrlPlaceholder")}
                className="font-mono text-sm"
              />
            </div>
            <SaveButton channel="gitlab" disabled={!gitlabProjectId} />
          </CardContent>
        </Card>
      </div>

      {/* Threshold */}
      <Card className="bg-gradient-to-t from-primary/5 to-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-primary" />
            {t("thresholdCardTitle")}
          </CardTitle>
          <CardDescription>{t("thresholdCardDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Input
                type="number"
                min="1"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-24"
              />
              <span className="text-muted-foreground">{t("thresholdEventsPerHour")}</span>
            </div>
            <Button
              size="sm"
              disabled={savingChannel === "threshold"}
              onClick={saveThreshold}
            >
              {savingChannel === "threshold" ? (
                <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-2 h-3.5 w-3.5" />
              )}
              {tCommon("save")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
