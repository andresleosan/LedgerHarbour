import type { AuthIdentity } from "../auth/auth-provider";
import { resolveOnboardingActor, type OnboardingActor, type OnboardingRepository } from "../tenancy/business-service";
import { createPlatformService, PlatformError, PLATFORM_ERROR_CODES, requirePlatformMember, type PlatformAdminMemberDto, type PlatformAdministratorDto, type PlatformBusinessDto } from "./platform-service";
import type { PlatformAuditEvent, PlatformRepository } from "./platform-repository";
import { createProjectService } from "../projects/project-service";
import type { ProjectDto, ProjectStatus } from "../projects/types";

export interface PlatformSummaryDto {
  counts: {
    businesses: number;
    pendingBusinesses: number;
    projects: number;
    pendingProjects: number;
    administrators: number;
    pendingAdministrators: number;
    platformAdministrators: number;
  };
  businesses: PlatformBusinessDto[];
  projects: ProjectDto[];
  administrators: PlatformAdministratorDto[];
  platformAdministrators: PlatformAdminMemberDto[];
}

export interface PlatformSummaryDependencies {
  tenancyRepository: OnboardingRepository;
  platformRepository: PlatformRepository;
  projectRepository: Parameters<typeof createProjectService>[0]["projectRepository"];
}

export async function getPlatformSummary(
  actor: OnboardingActor,
  dependencies: PlatformSummaryDependencies,
): Promise<PlatformSummaryDto> {
  const platform = createPlatformService(dependencies);
  const projects = createProjectService(dependencies);
  try {
    await requirePlatformMember(actor, dependencies.tenancyRepository, dependencies.platformRepository);
  } catch (error) {
    // Next may render the protected layout and page concurrently during the first Firebase claim.
    if (!(error instanceof PlatformError) || error.code !== PLATFORM_ERROR_CODES.REPOSITORY_CONFLICT || typeof actor === "string") throw error;
    const userId = await resolveOnboardingActor(dependencies.tenancyRepository, actor);
    const linked = await dependencies.platformRepository.findActiveMemberByUserId(userId);
    if (!linked) throw error;
  }
  const [businesses, projectRows, administrators, platformAdministrators] = await Promise.all([
    platform.listBusinesses(actor),
    projects.listProjects(actor),
    platform.listAdministrators(actor),
    platform.listPlatformAdministrators(actor),
  ]);

  return {
    counts: {
      businesses: businesses.length,
      pendingBusinesses: businesses.filter((business) => business.status === "pending").length,
      projects: projectRows.length,
      pendingProjects: projectRows.filter((project) => project.status === "pending").length,
        administrators: administrators.length,
        pendingAdministrators: administrators.filter((administrator) => administrator.status === "pending").length,
        platformAdministrators: platformAdministrators.length,
    },
    businesses,
    projects: projectRows,
    administrators,
    platformAdministrators,
  };
}

export async function listPlatformAuditEvents(
  actor: AuthIdentity,
  platformRepository: PlatformRepository,
  tenancyRepository: OnboardingRepository,
): Promise<PlatformAuditEvent[]> {
  await requirePlatformMember(actor, tenancyRepository, platformRepository);
  return platformRepository.listAllAuditEvents();
}

export type PlatformStatus = ProjectStatus | "business";
