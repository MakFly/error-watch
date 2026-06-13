"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bug,
  Gauge,
  Settings,
  HelpCircle,
  LayoutDashboard,
  Wrench,
  Terminal,
  MoreHorizontal,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { OrganizationSwitcher } from "@/components/OrganizationSwitcher";
import { ProjectSelector } from "@/components/ProjectSelector";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useCurrentOrganization } from "@/contexts/OrganizationContext";
import { useCurrentProject } from "@/contexts/ProjectContext";
import { trpc } from "@/lib/trpc/client";
import { useSSEStatus } from "@/components/sse-provider";

export function ErrorWatchSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const t = useTranslations("navigation");
  const { currentOrgSlug } = useCurrentOrganization();
  const { currentProjectSlug } = useCurrentProject();
  const { data: session, isLoading: sessionLoading } = trpc.auth.getSession.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const pathname = usePathname();
  const sseStatus = useSSEStatus();

  const baseUrl = currentOrgSlug && currentProjectSlug
    ? `/dashboard/${currentOrgSlug}/${currentProjectSlug}`
    : null;

  // Build navigation, Flare/Sentry-style: a short PRIMARY group (the 3 product
  // pillars + dashboard) and a collapsed "More" group for everything secondary.
  //   Primary = Dashboard, Errors, Performance, Logs
  //   More    = Replays, Stats, Crons, Infrastructure (collapsed by default)
  const { navPrimary, navMore } = React.useMemo(() => {
    if (!currentOrgSlug) {
      return {
        navPrimary: [
          {
            title: t("dashboard"),
            url: "/dashboard",
            icon: LayoutDashboard,
            isActive: pathname === "/dashboard",
          },
        ],
        navMore: [],
      };
    }

    // If no project selected, point to org-level (will show empty state)
    if (!baseUrl) {
      const orgUrl = `/dashboard/${currentOrgSlug}`;
      return {
        navPrimary: [
          {
            title: t("dashboard"),
            url: orgUrl,
            icon: LayoutDashboard,
            isActive: pathname === orgUrl,
          },
        ],
        navMore: [],
      };
    }

    const moreActive =
      pathname.startsWith(`${baseUrl}/replays`) ||
      pathname.startsWith(`${baseUrl}/stats`) ||
      pathname.startsWith(`${baseUrl}/crons`) ||
      pathname.startsWith(`${baseUrl}/infrastructure`);

    return {
      navPrimary: [
        {
          title: t("dashboard"),
          url: baseUrl,
          icon: LayoutDashboard,
          isActive: pathname === baseUrl,
        },
        {
          title: t("errors"),
          url: `${baseUrl}/issues`,
          icon: Bug,
          isActive: pathname.startsWith(`${baseUrl}/issues`),
        },
        {
          title: t("performance"),
          url: `${baseUrl}/performance`,
          icon: Gauge,
          isActive: pathname.startsWith(`${baseUrl}/performance`),
          children: [
            { title: t("overview"), url: `${baseUrl}/performance`, isActive: pathname === `${baseUrl}/performance` },
            { title: t("requests"), url: `${baseUrl}/performance/requests`, isActive: pathname.startsWith(`${baseUrl}/performance/requests`) },
            { title: t("cache"), url: `${baseUrl}/performance/cache`, isActive: pathname === `${baseUrl}/performance/cache` },
            { title: t("http"), url: `${baseUrl}/performance/http`, isActive: pathname === `${baseUrl}/performance/http` },
            { title: t("queues"), url: `${baseUrl}/performance/queues`, isActive: pathname === `${baseUrl}/performance/queues` },
          ],
        },
        {
          title: t("logs"),
          url: `${baseUrl}/logs`,
          icon: Terminal,
          isActive: pathname.startsWith(`${baseUrl}/logs`),
        },
      ],
      navMore: [
        {
          title: t("more"),
          url: `${baseUrl}/stats`,
          icon: MoreHorizontal,
          isActive: moreActive,
          children: [
            { title: t("replays"), url: `${baseUrl}/replays`, isActive: pathname.startsWith(`${baseUrl}/replays`) },
            { title: t("stats"), url: `${baseUrl}/stats`, isActive: pathname.startsWith(`${baseUrl}/stats`) },
            { title: t("crons"), url: `${baseUrl}/crons`, isActive: pathname.startsWith(`${baseUrl}/crons`) },
            { title: t("infrastructure"), url: `${baseUrl}/infrastructure`, isActive: pathname.startsWith(`${baseUrl}/infrastructure`) },
          ],
        },
      ],
    };
  }, [currentOrgSlug, baseUrl, pathname, t]);

  const isDev = process.env.NODE_ENV !== "production";

  const navSecondary = React.useMemo(() => {
    // Settings and Help require project context
    if (!baseUrl) {
      return [];
    }
    const items = [
      {
        title: t("settings"),
        url: `${baseUrl}/settings`,
        icon: Settings,
      },
      {
        title: t("help"),
        url: `${baseUrl}/help`,
        icon: HelpCircle,
      },
    ];

    if (isDev) {
      items.push({
        title: t("admin"),
        url: `${baseUrl}/admin`,
        icon: Wrench,
      });
    }

    return items;
  }, [baseUrl, isDev, t]);

  const user = React.useMemo(
    () => ({
      name: session?.user?.name ?? null,
      email: session?.user?.email ?? "",
      image: session?.user?.image ?? null,
    }),
    [session]
  );

  const loading = sessionLoading || !session?.user;

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5 hover:bg-transparent active:bg-transparent"
            >
              <Link href="/dashboard">
                <img src="/brand/errorwatch-logo-192.png" alt="" className="h-7 w-7 shrink-0" />
                <div className="flex flex-col">
                  <span className="text-sm font-bold tracking-tight">
                    ErrorWatch
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t("monitoring")}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Organization & Project Selectors */}
        <div className="space-y-1 px-2 py-2">
          <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("organization")}
          </p>
          <OrganizationSwitcher />
        </div>

        <div className="space-y-1 px-2 pb-2">
          <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("project")}
          </p>
          <ProjectSelector />
        </div>

        <SidebarSeparator />

        <NavMain items={navPrimary} />
        <NavMain items={navMore} label={t("groups.more")} />

        <NavSecondary items={navSecondary} label={t("groups.project")} className="mt-auto" />
      </SidebarContent>

      <SidebarFooter>
        {/* Language Switcher */}
        <div className="px-2 pb-1">
          <LocaleSwitcher />
        </div>

        {/* Live Status */}
        <div className="px-2 pb-2">
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
            sseStatus === "connected"
              ? "bg-emerald-500/10"
              : sseStatus === "connecting"
                ? "bg-amber-500/10"
                : "bg-muted/50"
          }`}>
            <span className="relative flex h-2 w-2">
              {sseStatus === "connected" && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${
                sseStatus === "connected"
                  ? "bg-emerald-500"
                  : sseStatus === "connecting"
                    ? "bg-amber-500"
                    : "bg-muted-foreground"
              }`} />
            </span>
            <span className={`text-xs font-medium ${
              sseStatus === "connected"
                ? "text-emerald-400"
                : sseStatus === "connecting"
                  ? "text-amber-400"
                  : "text-muted-foreground"
            }`}>
              {sseStatus === "connected"
                ? t("live")
                : sseStatus === "connecting"
                  ? t("reconnecting")
                  : t("offline")}
            </span>
          </div>
        </div>

        <NavUser user={user} loading={loading} />
      </SidebarFooter>
    </Sidebar>
  );
}
