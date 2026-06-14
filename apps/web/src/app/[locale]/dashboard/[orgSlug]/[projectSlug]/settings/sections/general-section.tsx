"use client";

import React, { useState, useEffect } from "react";
import {
  Settings,
  Key,
  Copy,
  Check,
  RefreshCw,
  User,
  Shield,
  Monitor,
  Smartphone,
  LogOut,
  AlertTriangle,
  Trash2,
  Building2,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useCurrentProject } from "@/contexts/ProjectContext";
import { useCurrentOrganization } from "@/contexts/OrganizationContext";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { getMonitoringApiUrl } from "@/lib/config";

export function GeneralSection() {
  const t = useTranslations("settings.general");
  const tCommon = useTranslations("common");

  const router = useRouter();

  // Project state
  const [projectName, setProjectName] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [dsn, setDsn] = useState(() => getMonitoringApiUrl());
  const [timezone, setTimezone] = useState("UTC");
  const [copied, setCopied] = useState(false);
  const [deleteProjectDialogOpen, setDeleteProjectDialogOpen] = useState(false);

  // Organization state
  const [deleteOrgDialogOpen, setDeleteOrgDialogOpen] = useState(false);
  const [deleteOrgConfirmText, setDeleteOrgConfirmText] = useState("");

  // Profile state
  const [name, setName] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [revokeSessionId, setRevokeSessionId] = useState<string | null>(null);
  const [revokeAllDialogOpen, setRevokeAllDialogOpen] = useState(false);

  // Project queries
  const { currentProjectId, refetchProjects } = useCurrentProject();
  const { currentOrgSlug, currentOrgId, currentOrganization, refetch: refetchOrgs } = useCurrentOrganization();
  const { data: projects } = trpc.projects.getAll.useQuery();
  const { data: projectSettings, refetch: refetchSettings } = trpc.projectSettings.get.useQuery(
    { projectId: currentProjectId! },
    { enabled: !!currentProjectId }
  );

  // Profile queries
  const { data: profile, isLoading: profileLoading, refetch: refetchProfile } = trpc.user.getProfile.useQuery();
  const { data: sessions, isLoading: sessionsLoading, refetch: refetchSessions } = trpc.user.getSessions.useQuery();
  const { data: passwordInfo } = trpc.user.canChangePassword.useQuery();

  // Mutations
  const updateProjectMutation = trpc.projects.update.useMutation({ onSuccess: () => refetchProjects() });
  const updateSettingsMutation = trpc.projectSettings.update.useMutation({ onSuccess: () => refetchSettings() });
  const deleteProjectMutation = trpc.projects.delete.useMutation({
    onSuccess: () => {
      toast.success(t("toastProjectDeleted"));
      refetchProjects();
      router.push(`/dashboard/${currentOrgSlug}`);
    },
    onError: (error) => {
      toast.error(error.message || t("toastProjectDeleteFailed"));
    },
  });
  const updateProfileMutation = trpc.user.updateProfile.useMutation({
    onSuccess: () => refetchProfile(),
  });
  const revokeSessionMutation = trpc.user.revokeSession.useMutation({
    onSuccess: () => {
      refetchSessions();
      setRevokeSessionId(null);
      toast.success(t("toastSessionRevoked"));
    },
  });
  const revokeAllSessionsMutation = trpc.user.revokeAllSessions.useMutation({
    onSuccess: (result) => {
      refetchSessions();
      setRevokeAllDialogOpen(false);
      toast.success(t("toastSessionsRevoked", { count: result.count }));
    },
  });
  const deleteOrgMutation = trpc.organizations.delete.useMutation({
    onSuccess: () => {
      toast.success(t("toastOrgDeleted"));
      refetchOrgs();
      router.push("/dashboard");
    },
    onError: (error) => {
      toast.error(error.message || t("toastOrgDeleteFailed"));
    },
  });

  const currentProject = projects?.find((p) => p.id === currentProjectId);

  // Sync project data
  useEffect(() => {
    if (currentProject) {
      setProjectName(currentProject.name);
      setEnvironment(currentProject.environment || "production");
    }
  }, [currentProject]);

  useEffect(() => {
    if (projectSettings) setTimezone(projectSettings.timezone);
  }, [projectSettings]);

  useEffect(() => {
    if (!currentProjectId) return;
    setDsn(getMonitoringApiUrl());
  }, [currentProjectId]);

  // Sync profile data
  useEffect(() => {
    if (profile) setName(profile.name || "");
  }, [profile]);

  const copyDsn = () => {
    navigator.clipboard.writeText(dsn);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success(t("toastDsnCopied"));
  };

  const saveProjectSettings = async () => {
    if (!currentProjectId || !currentProject) return;
    setSavingProject(true);
    try {
      const promises: Promise<unknown>[] = [];

      const projectUpdates: { id: string; name?: string; environment?: "production" | "staging" | "development" } = { id: currentProjectId };
      if (projectName !== currentProject.name) {
        projectUpdates.name = projectName;
      }
      if (environment !== (currentProject.environment || "production")) {
        projectUpdates.environment = environment as "production" | "staging" | "development";
      }
      if (projectUpdates.name || projectUpdates.environment) {
        promises.push(updateProjectMutation.mutateAsync(projectUpdates));
      }
      promises.push(updateSettingsMutation.mutateAsync({ projectId: currentProjectId, timezone }));

      await Promise.all(promises);
      toast.success(t("toastSettingsSaved"));
    } catch {
      toast.error(t("toastSettingsFailed"));
    } finally {
      setSavingProject(false);
    }
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await updateProfileMutation.mutateAsync({ name: name.trim() || undefined });
      toast.success(t("toastSettingsSaved"));
    } catch {
      toast.error(t("toastSettingsFailed"));
    } finally {
      setSavingProfile(false);
    }
  };

  const getDeviceIcon = (userAgent: string | null) => {
    if (!userAgent) return Monitor;
    const ua = userAgent.toLowerCase();
    if (ua.includes("mobile") || ua.includes("android") || ua.includes("iphone")) {
      return Smartphone;
    }
    return Monitor;
  };

  const timezones = [
    { value: "UTC", label: "UTC" },
    { value: "Europe/Paris", label: "Europe/Paris" },
    { value: "Europe/London", label: "Europe/London" },
    { value: "America/New_York", label: "America/New_York" },
    { value: "America/Los_Angeles", label: "America/Los_Angeles" },
    { value: "Asia/Tokyo", label: "Asia/Tokyo" },
  ];

  const isLoading = !projects || !projectSettings || profileLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="bg-gradient-to-t from-primary/5 to-card">
              <CardHeader><Skeleton className="h-6 w-40" /></CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Section 1: Project & Profile */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Project Configuration */}
        <Card className="bg-gradient-to-t from-primary/5 to-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              {t("projectCardTitle")}
            </CardTitle>
            <CardDescription>{t("projectCardDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="projectName">{t("projectNameLabel")}</Label>
              <Input
                id="projectName"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder={t("projectNamePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("environmentLabel")}</Label>
              <Select value={environment} onValueChange={setEnvironment}>
                <SelectTrigger>
                  <SelectValue placeholder={t("environmentLabel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">{t("environmentProduction")}</SelectItem>
                  <SelectItem value="staging">{t("environmentStaging")}</SelectItem>
                  <SelectItem value="development">{t("environmentDevelopment")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("timezoneLabel")}</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue placeholder={t("timezonePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {timezones.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={saveProjectSettings} disabled={savingProject} size="sm">
                {savingProject && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                {t("saveChanges")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Profile */}
        <Card className="bg-gradient-to-t from-primary/5 to-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              {t("profileCardTitle")}
            </CardTitle>
            <CardDescription>{t("profileCardDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t("emailLabel")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="email"
                  value={profile?.email || ""}
                  disabled
                  className="bg-muted/50"
                />
                {profile?.emailVerified && (
                  <Badge variant="default" className="shrink-0">
                    <Check className="mr-1 h-3 w-3" />
                    {t("verified")}
                  </Badge>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">{t("nameLabel")}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
              />
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={saveProfile} disabled={savingProfile} size="sm">
                {savingProfile && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                {t("saveChanges")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section 2: Integration & Security */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* DSN Configuration */}
        <Card className="bg-gradient-to-t from-primary/5 to-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              {t("dsnCardTitle")}
            </CardTitle>
            <CardDescription>{t("dsnCardDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dsn">{t("dsnUrlLabel")}</Label>
              <div className="flex gap-2">
                <Input
                  id="dsn"
                  value={dsn}
                  onChange={(e) => setDsn(e.target.value)}
                  placeholder={t("dsnUrlPlaceholder")}
                  className="font-mono text-sm"
                />
                <Button variant="outline" size="icon" onClick={copyDsn}>
                  {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-lg bg-muted/50 p-3 font-mono text-xs">
                <p className="mb-1 text-muted-foreground">{t("dsnSymfonyComment")}</p>
                <p>error_watch:</p>
                <p className="pl-2">{`  endpoint: '${dsn}'`}</p>
                <p className="pl-2">{`  api_key: '${t("dsnApiKeyPlaceholder")}'`}</p>
                <p className="pl-2">{`  logging:`}</p>
                <p className="pl-4">{`    enabled: true`}</p>
                <p className="pl-4">{`    level: debug`}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 font-mono text-xs">
                <p className="mb-1 text-muted-foreground">{t("dsnLaravelComment")}</p>
                <p>ERRORWATCH_ENABLED=true</p>
                <p>{`ERRORWATCH_ENDPOINT=${dsn}`}</p>
                <p>{`ERRORWATCH_API_KEY=${t("dsnApiKeyPlaceholder")}`}</p>
                <p>ERRORWATCH_LOGGING_ENABLED=true</p>
                <p>ERRORWATCH_LOG_LEVEL=debug</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Security */}
        <Card className="bg-gradient-to-t from-primary/5 to-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              {t("securityCardTitle")}
            </CardTitle>
            <CardDescription>{t("securityCardDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {passwordInfo?.hasPassword ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{t("passwordLabel")}</span>
                  </div>
                  <Badge variant="secondary">{t("passwordSet")}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("passwordEnabled")}
                </p>
              </div>
            ) : (
              <div className="rounded-lg bg-amber-500/10 p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-amber-500">{t("oauthOnly")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("oauthDescription")}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active Sessions */}
      <Card className="bg-gradient-to-t from-primary/5 to-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Monitor className="h-5 w-5 text-primary" />
                {t("sessionsCardTitle")}
              </CardTitle>
              <CardDescription>{t("sessionsCardDescription")}</CardDescription>
            </div>
            {sessions && sessions.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRevokeAllDialogOpen(true)}
                disabled={revokeAllSessionsMutation.isPending}
              >
                {revokeAllSessionsMutation.isPending ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="mr-2 h-4 w-4" />
                )}
                {t("revokeAll")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {sessionsLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : sessions && sessions.length > 0 ? (
            <div className="space-y-2">
              {sessions.map((session) => {
                const DeviceIcon = getDeviceIcon(session.userAgent);
                const isExpired = new Date(session.expiresAt) < new Date();

                return (
                  <div
                    key={session.id}
                    className="flex items-center justify-between rounded-lg border bg-card p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                        <DeviceIcon className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{session.ipAddress || t("unknownIp")}</p>
                          {isExpired && <Badge variant="destructive" className="text-xs">{t("expired")}</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(session.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setRevokeSessionId(session.id)}
                    >
                      <LogOut className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("noActiveSessions")}</p>
          )}
        </CardContent>
      </Card>

      {/* Section 4: Danger Zone */}
      <Card className="border-destructive/50 dark:border-destructive/30 overflow-hidden">
        <div className="h-1 w-full bg-destructive" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {t("dangerZoneTitle")}
          </CardTitle>
          <CardDescription>{t("dangerZoneDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Delete Project */}
            <div className="flex items-center justify-between rounded-lg border border-destructive/30 dark:border-destructive/20 bg-destructive/5 dark:bg-destructive/10 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">{t("deleteProjectTitle")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("deleteProjectDescription", { name: currentProject?.name || "" })}
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteProjectDialogOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {tCommon("delete")}
              </Button>
            </div>

            {/* Delete Organization */}
            <div className="flex items-center justify-between rounded-lg border border-destructive/30 dark:border-destructive/20 bg-destructive/5 dark:bg-destructive/10 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">{t("deleteOrgTitle")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("deleteOrgDescription", { name: currentOrganization?.name || "" })}
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setDeleteOrgConfirmText("");
                  setDeleteOrgDialogOpen(true);
                }}
              >
                <Building2 className="mr-2 h-4 w-4" />
                {tCommon("delete")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Revoke Session Dialog */}
      <AlertDialog open={!!revokeSessionId} onOpenChange={(open) => !open && setRevokeSessionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("revokeSessionTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("revokeSessionDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeSessionId && revokeSessionMutation.mutate({ sessionId: revokeSessionId })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("revoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke All Sessions Dialog */}
      <AlertDialog open={revokeAllDialogOpen} onOpenChange={setRevokeAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("revokeAllTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("revokeAllDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeAllSessionsMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("revokeAll")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Project Dialog */}
      <AlertDialog open={deleteProjectDialogOpen} onOpenChange={setDeleteProjectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteProjectDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteProjectDialogDescription", { name: currentProject?.name || "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => currentProjectId && deleteProjectMutation.mutate({ id: currentProjectId })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteProjectMutation.isPending}
            >
              {deleteProjectMutation.isPending ? t("deleting") : t("deleteProjectConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Organization Dialog */}
      <AlertDialog open={deleteOrgDialogOpen} onOpenChange={(open) => {
        setDeleteOrgDialogOpen(open);
        if (!open) setDeleteOrgConfirmText("");
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">{t("deleteOrgDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteOrgDialogDescription", { name: currentOrganization?.name || "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 space-y-4">
            <div className="rounded-lg bg-destructive/10 p-3 text-sm space-y-2">
              <p className="font-medium text-destructive">{t("deleteOrgWillDelete")}</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>{t("deleteOrgProjects", { count: projects?.length || 0, plural: (projects?.length || 0) !== 1 ? "s" : "" })}</li>
                <li>{t("deleteOrgEvents")}</li>
                <li>{t("deleteOrgReplays")}</li>
                <li>{t("deleteOrgSettings")}</li>
                <li>{t("deleteOrgMembers")}</li>
              </ul>
              <p className="font-medium text-destructive pt-2">{t("deleteOrgCannotUndo")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-org-name" className="text-sm text-muted-foreground">
                {t("deleteOrgTypeToConfirm", { name: currentOrganization?.name || "" })}
              </Label>
              <Input
                id="confirm-org-name"
                value={deleteOrgConfirmText}
                onChange={(e) => setDeleteOrgConfirmText(e.target.value)}
                placeholder={currentOrganization?.name || ""}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => currentOrgId && deleteOrgMutation.mutate({ id: currentOrgId })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteOrgMutation.isPending || deleteOrgConfirmText !== currentOrganization?.name}
            >
              {deleteOrgMutation.isPending ? t("deleting") : t("deleteOrgConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
