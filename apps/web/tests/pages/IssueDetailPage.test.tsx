import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const mockUseGroupIssueDetail = vi.fn();
const mockUseGroup = vi.fn();
const mockUseGroupEvents = vi.fn();
const mockUseGroupTimeline = vi.fn();
const mockUseGroupReleases = vi.fn();
const mockUseGroupActivity = vi.fn();
const mockUseMembersByOrganization = vi.fn();
const mockUseUpdateGroupStatus = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ fingerprint: "fp-123" }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/contexts/OrganizationContext", () => ({
  useCurrentOrganization: () => ({ currentOrgSlug: "acme", currentOrgId: "org-1" }),
}));

vi.mock("@/contexts/ProjectContext", () => ({
  useCurrentProject: () => ({ currentProjectSlug: "sample", currentProjectId: "project-1" }),
}));

vi.mock("@/components/issue-detail/IssueDetailView", () => ({
  IssueDetailView: (props: {
    group: { fingerprint: string };
    events: unknown[];
    timeline: unknown[];
    activity: unknown[];
    releaseDist?: { releases: unknown[] } | null;
  }) =>
    React.createElement("div", {
      "data-testid": "issue-detail-view",
      "data-group": props.group.fingerprint,
      "data-events": String(props.events.length),
      "data-timeline": String(props.timeline.length),
      "data-activity": String(props.activity.length),
      "data-releases": String(props.releaseDist?.releases?.length || 0),
    }),
}));

vi.mock("@/lib/trpc/hooks", () => ({
  useGroup: (...args: unknown[]) => mockUseGroup(...args),
  useGroupEvents: (...args: unknown[]) => mockUseGroupEvents(...args),
  useGroupTimeline: (...args: unknown[]) => mockUseGroupTimeline(...args),
  useGroupReleases: (...args: unknown[]) => mockUseGroupReleases(...args),
  useGroupActivity: (...args: unknown[]) => mockUseGroupActivity(...args),
  useGroupIssueDetail: (...args: unknown[]) => mockUseGroupIssueDetail(...args),
  useMembersByOrganization: (...args: unknown[]) => mockUseMembersByOrganization(...args),
  useUpdateGroupStatus: () => mockUseUpdateGroupStatus(),
}));

import IssueDetailPage from "@/app/[locale]/dashboard/[orgSlug]/[projectSlug]/issues/[fingerprint]/page";

describe("IssueDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseGroupIssueDetail.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        group: {
          fingerprint: "fp-123",
          projectId: "project-1",
          message: "Cannot divide by zero",
          file: "src/index.ts",
          line: 42,
          statusCode: 500,
          level: "error",
          count: 12,
          firstSeen: new Date("2026-01-01T10:00:00Z"),
          lastSeen: new Date("2026-01-02T10:00:00Z"),
          assignedTo: null,
          assignedAt: null,
          usersAffected: 3,
          priority: "medium",
          snoozedUntil: null,
          snoozedBy: null,
          status: "unresolved",
          resolvedAt: null,
          resolvedBy: null,
        },
        events: {
          events: [
            {
              id: "evt-1",
              fingerprint: "fp-123",
              projectId: "project-1",
              stack: "",
              url: null,
              env: "production",
              statusCode: 500,
              level: "error",
              breadcrumbs: null,
              sessionId: null,
              release: "1.0.0",
              createdAt: new Date("2026-01-02T10:00:00Z"),
            },
          ],
          pagination: {
            page: 1,
            total: 1,
            totalPages: 1,
          },
        },
        timeline: [{ date: "2026-01-02", count: 4 }],
        activity: [
          {
            id: "act-1",
            fingerprint: "fp-123",
            type: "status",
            fromValue: {},
            toValue: {},
            metadata: {},
            createdAt: new Date("2026-01-02T10:00:00Z"),
            actor: null,
          },
        ],
        releases: {
          releases: [{ version: "1.0.0", count: 2, percentage: 100 }],
          firstSeenIn: "2026-01-01",
        },
      },
    });

    mockUseMembersByOrganization.mockReturnValue({
      data: [
        {
          userId: "org-member-1",
          user: { name: "Alice", email: "alice@example.com", image: null },
        },
      ],
    });

    mockUseUpdateGroupStatus.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
  });

  test("uses a single aggregated issue-detail query on refresh", () => {
    render(<IssueDetailPage />);

    const detailNode = screen.getByTestId("issue-detail-view");
    expect(detailNode).toBeInTheDocument();
    expect(mockUseGroupIssueDetail).toHaveBeenCalledWith("fp-123", 1, 50);
    expect(mockUseGroup).not.toHaveBeenCalled();
    expect(mockUseGroupEvents).not.toHaveBeenCalled();
    expect(mockUseGroupTimeline).not.toHaveBeenCalled();
    expect(mockUseGroupReleases).not.toHaveBeenCalled();
    expect(mockUseGroupActivity).not.toHaveBeenCalled();
    expect(detailNode.getAttribute("data-events")).toBe("1");
    expect(detailNode.getAttribute("data-timeline")).toBe("1");
    expect(detailNode.getAttribute("data-activity")).toBe("1");
    expect(detailNode.getAttribute("data-releases")).toBe("1");
  });
});
