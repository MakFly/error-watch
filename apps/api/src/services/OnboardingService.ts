import { OrganizationRepository } from "../repositories/OrganizationRepository";
import { ProjectRepository } from "../repositories/ProjectRepository";
import { MemberRepository } from "../repositories/MemberRepository";
import { ApiKeyService } from "./ApiKeyService";
import { getSdkInstructions, type Platform } from "../utils/sdk-instructions";
import { canCreateOrganization } from "./subscriptions";
import logger from "../logger";
import { seedDefaultStackTraceRules } from "./grouping/seedStackTraceRules";

export const OnboardingService = {
  getStatus: async (userId: string) => {
    const userOrgs = await OrganizationRepository.findByUserId(userId);
    const hasOrganization = userOrgs.length > 0;

    let hasProject = false;
    if (hasOrganization) {
      const userProjects = await ProjectRepository.findByUserId(userId);
      hasProject = userProjects.length > 0;
    }

    // Only require onboarding if user has no organization
    // If user has org but no project, NoProjectDashboard handles that case
    return {
      needsOnboarding: !hasOrganization,
      hasOrganization,
      hasProject,
    };
  },

  setup: async (
    userId: string,
    data: {
      organizationName: string;
      projectName: string;
      environment?: string;
      platform: Platform;
    }
  ) => {
    const subscriptionCheck = await canCreateOrganization(userId);
    if (!subscriptionCheck.allowed) {
      throw new Error(`Subscription limit reached: ${subscriptionCheck.reason}`);
    }

    // Validate project name is different from organization name
    if (data.organizationName.toLowerCase() === data.projectName.toLowerCase()) {
      throw new Error("Project name cannot be the same as organization name");
    }

    const now = new Date();
    const orgId = crypto.randomUUID();
    const projectId = crypto.randomUUID();

    const orgSlug =
      data.organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || `org-${orgId.slice(0, 8)}`;

    const projectSlug =
      data.projectName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || `project-${projectId.slice(0, 8)}`;

    const org = await OrganizationRepository.create({
      id: orgId,
      name: data.organizationName,
      slug: orgSlug,
      createdAt: now,
    });

    await OrganizationRepository.createMembership({
      id: crypto.randomUUID(),
      organizationId: orgId,
      userId,
      role: "owner",
      createdAt: now,
    });

    const project = await ProjectRepository.create({
      id: projectId,
      organizationId: orgId,
      name: data.projectName,
      slug: projectSlug,
      environment: data.environment || "production",
      platform: data.platform,
      createdAt: now,
    });

    await seedDefaultStackTraceRules(projectId).catch((err) => {
      logger.warn("Failed to seed stack trace rules", { projectId, err });
    });

    const apiKey = await ApiKeyService.create(projectId, "Default API Key", userId);

    // Generate SDK instructions for the selected platform
    const endpoint = process.env.PUBLIC_API_URL || "https://api.errorwatch.io";
    const sdkInstructions = getSdkInstructions(data.platform, apiKey.key, endpoint);

    logger.info("Workspace created via onboarding", {
      userId,
      organizationId: orgId,
      projectId,
      platform: data.platform,
      apiKeyId: apiKey.id,
    });

    return {
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
      },
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        environment: project.environment,
        platform: project.platform,
      },
      apiKey: {
        id: apiKey.id,
        key: apiKey.key,
        name: apiKey.name,
      },
      sdkInstructions,
    };
  },
};
