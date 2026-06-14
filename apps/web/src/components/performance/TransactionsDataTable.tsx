"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LayersIcon, ListIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Transaction, SlowestTransaction } from "@/server/api/types/performance";
import {
  createTransactionsColumns,
  createGroupedTransactionsColumns,
  groupTransactions,
  type GroupedTransaction,
} from "./transactions-data-table-columns";
import { formatMs } from "@/lib/format-duration";

interface TransactionsDataTableProps {
  transactions: Transaction[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  baseUrl: string;
  isLoading?: boolean;
}

export function TransactionsDataTable({
  transactions,
  pagination,
  baseUrl,
  isLoading = false,
}: TransactionsDataTableProps) {
  const router = useRouter();
  const [viewMode, setViewMode] = React.useState<"grouped" | "individual">("grouped");
  const groupedTransactions = React.useMemo(() => groupTransactions(transactions), [transactions]);
  const hasDuplicates = groupedTransactions.some((g) => g.count > 1);

  const individualColumns = React.useMemo(() => createTransactionsColumns(), []);
  const groupedColumns = React.useMemo(() => createGroupedTransactionsColumns(), []);

  const handleRowClick = React.useCallback(
    (row: Transaction | GroupedTransaction) => {
      const transactionId = "transactions" in row ? row.transactions[0].id : row.id;
      router.push(`${baseUrl}/performance/requests/${transactionId}?type=transaction`);
    },
    [router, baseUrl]
  );

  const Toolbar = (
    <div className="flex items-center gap-2">
      {hasDuplicates && (
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          <Button
            variant={viewMode === "grouped" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("grouped")}
            className="h-7 gap-1 px-2"
          >
            <LayersIcon className="h-3 w-3" />
            <span className="hidden sm:inline">Grouped</span>
          </Button>
          <Button
            variant={viewMode === "individual" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("individual")}
            className="h-7 gap-1 px-2"
          >
            <ListIcon className="h-3 w-3" />
            <span className="hidden sm:inline">Individual</span>
          </Button>
        </div>
      )}
      {pagination && (
        <span className="text-xs text-muted-foreground">
          {pagination.total} total
        </span>
      )}
    </div>
  );

  if (viewMode === "grouped" && hasDuplicates) {
    return (
      <DataTable
        data={groupedTransactions}
        columns={groupedColumns}
        isLoading={isLoading}
        searchPlaceholder="Search transactions..."
        showSearch={true}
        showColumnToggle={true}
        enableRowSelection={false}
        pageSize={15}
        getRowId={(row) => `${row.name}-${row.op}`}
        toolbar={Toolbar}
        onRowClick={handleRowClick}
      />
    );
  }

  return (
    <DataTable
      data={transactions}
      columns={individualColumns}
      isLoading={isLoading}
      searchPlaceholder="Search transactions..."
      showSearch={true}
      showColumnToggle={true}
      enableRowSelection={false}
      pageSize={15}
      toolbar={Toolbar}
      onRowClick={handleRowClick}
    />
  );
}

interface SlowestTableProps {
  transactions: SlowestTransaction[];
  isLoading?: boolean;
}

export function SlowestTable({ transactions, isLoading = false }: SlowestTableProps) {
  const t = useTranslations("performance");

  if (transactions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("slowestTransactions.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <p className="text-sm text-muted-foreground">{t("slowestTransactions.noData")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("slowestTransactions.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {transactions.map((t, i) => (
            <div
              key={`${t.name}-${t.op}`}
              className="flex items-center justify-between rounded-lg border bg-muted/30 p-3"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive/10 text-xs font-medium text-destructive">
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{t.op}</span>
                    {" "}• {t.count} events
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-medium text-destructive">
                  {formatMs(t.avgDuration)}
                </p>
                <p className="text-xs text-muted-foreground">
                  max {formatMs(t.maxDuration)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
