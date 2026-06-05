import { ProjectRepository } from "../repositories/ProjectRepository";
import { OrganizationRepository } from "../repositories/OrganizationRepository";
import { canCreateProject } from "./subscriptions";
import { type Platform } from "../utils/sdk-instructions";
import logger from "../logger";
import { seedDefaultStackTraceRules } from "./grouping/seedStackTraceRules";

export const ProjectService = {
  getAll: async (userId: string) => {
    return await ProjectRepository.findByUserId(userId);
  },

  canCreate: async (userId: string) => {
    return await canCreateProject(userId);
  },

  create: async (userId: string, data: { name: string; organizationId: string; environment?: string; platform: Platform }) => {
    const subscriptionCheck = await canCreateProject(userId);
    if (!subscriptionCheck.allowed) {
      logger.info("Project creation blocked by subscription", { userId, ...subscriptionCheck });
      throw new Error(`Subscription limit reached: ${subscriptionCheck.reason}`);
    }

    const member = await OrganizationRepository.findOwnerByOrgId(data.organizationId, userId);
    if (!member) {
      throw new Error("Not a member of this organization");
    }

    // Validate project name is different from organization name
    const organization = await OrganizationRepository.findById(data.organizationId);
    if (organization && organization.name.toLowerCase() === data.name.toLowerCase()) {
      throw new Error("Project name cannot be the same as organization name");
    }

    // Generate unique slug: org-prefix + project-name + random suffix
    const baseSlug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const uniqueSuffix = crypto.randomUUID().slice(0, 8);
    const slug = `${baseSlug}-${uniqueSuffix}`;

    const project = await ProjectRepository.create({
      id: crypto.randomUUID(),
      organizationId: data.organizationId,
      name: data.name,
      slug,
      environment: data.environment || "production",
      platform: data.platform,
      createdAt: new Date(),
    });

    await seedDefaultStackTraceRules(project.id).catch((err) => {
      logger.warn("Failed to seed stack trace rules", { projectId: project.id, err });
    });

    logger.info("Project created", { projectId: project.id, userId, platform: data.platform });
    return project;
  },

  update: async (userId: string, id: string, data: { name?: string; environment?: string }) => {
    const project = await ProjectRepository.findByIdWithOrg(id);
    if (!project) {
      throw new Error("Project not found");
    }

    const hasAccess = await ProjectRepository.verifyUserAccess(id, userId);
    if (!hasAccess) {
      throw new Error("Unauthorized");
    }

    const updates: Record<string, unknown> = {};
    if (data.name) {
      updates.name = data.name;
      const baseSlug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const uniqueSuffix = crypto.randomUUID().slice(0, 8);
      updates.slug = `${baseSlug}-${uniqueSuffix}`;
    }
    if (data.environment) {
      updates.environment = data.environment;
    }

    if (Object.keys(updates).length === 0) {
      throw new Error("No updates provided");
    }

    await ProjectRepository.update(id, updates);
    const updated = await ProjectRepository.findById(id);

    logger.info("Project updated", { projectId: id, userId, updates: Object.keys(updates) });
    return updated;
  },

  delete: async (userId: string, id: string) => {
    const project = await ProjectRepository.findByIdWithOrg(id);
    if (!project) {
      throw new Error("Project not found");
    }

    const hasAccess = await ProjectRepository.verifyUserAccess(id, userId);
    if (!hasAccess) {
      throw new Error("Unauthorized");
    }

    await ProjectRepository.delete(id);
    return { success: true };
  },
};
