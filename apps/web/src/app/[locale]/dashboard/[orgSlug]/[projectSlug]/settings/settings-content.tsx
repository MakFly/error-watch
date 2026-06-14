"use client";

import React from "react";
import {
  Settings,
  Bell,
  Key,
  Database,
  CreditCard,
  Building2,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  GeneralSection,
  AlertsSection,
  ApiKeysSection,
  BillingSection,
  DataSection,
  OrganizationsSection,
} from "./sections";
import { useTranslations } from "next-intl";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

const VALID_TABS = ["general", "alerts", "api-keys", "billing", "data", "organizations"] as const;
type TabValue = (typeof VALID_TABS)[number];

export function SettingsContent() {
  const t = useTranslations("settings");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tabParam = searchParams.get("tab") as TabValue | null;
  const activeTab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : "general";

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "general") {
      params.delete("tab");
    } else {
      params.set("tab", value);
    }
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  const tabs = [
    { value: "general" as const, label: t("tabs.general"), icon: Settings },
    { value: "alerts" as const, label: t("tabs.alerts"), icon: Bell },
    { value: "api-keys" as const, label: t("tabs.apiKeys"), icon: Key },
    { value: "billing" as const, label: t("tabs.billing"), icon: CreditCard },
    { value: "data" as const, label: t("tabs.data"), icon: Database },
    { value: "organizations" as const, label: t("tabs.organizations"), icon: Building2 },
  ];

  return (
    <div className="px-4 lg:px-6">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="mb-6 h-auto flex-wrap">
          {tabs.map(({ value, label, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="gap-2"
            >
              <Icon className="h-4 w-4" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <GeneralSection />
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <AlertsSection />
        </TabsContent>

        <TabsContent value="api-keys" className="space-y-4">
          <ApiKeysSection />
        </TabsContent>

        <TabsContent value="billing" className="space-y-4">
          <BillingSection />
        </TabsContent>

        <TabsContent value="data" className="space-y-4">
          <DataSection />
        </TabsContent>

        <TabsContent value="organizations" className="space-y-4">
          <OrganizationsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
