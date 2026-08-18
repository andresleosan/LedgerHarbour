import { requireCapability } from "../permissions/authorize";
import type { OnboardingActor, OnboardingRepository } from "../tenancy/business-service";
import { resolveOnboardingActor } from "../tenancy/business-service";
import { createTenantContext } from "../tenancy/tenant-context";
import type { BusinessId, UserId } from "../tenancy/types";
import type { PlatformMember, PlatformRepository } from "../platform/platform-repository";
import { PlatformError, PLATFORM_ERROR_CODES, requirePlatformMember } from "../platform/platform-service";
import {
  createInMemoryProjectRepository,
  ProjectRepositoryConflictError,
  type InMemoryProjectRepository,
  type NewProject,
  type ProjectReferenceResolvers,
  type ProjectRepository,
} from "./project-repository";
import {
  ProjectStatus,
  type EffectiveProjectAccess,
  type Project,
  type ProjectDto,
  type ProjectLifecycleUpdate,
  type ProjectMembership,
  type ProjectMembershipRole,
} from "./types";

export { createInMemoryProjectRepository, createPostgresProjectRepository } from "./project-repository";
export type { InMemoryProjectRepository, ProjectRepository } from "./project-repository";
export * from "./types";

export const PROJECT_ERROR_CODES = {
  INVALID_PROJECT_NAME: "INVALID_PROJECT_NAME",
  INVALID_MEMBER: "INVALID_MEMBER",
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  BUSINESS_NOT_FOUND: "BUSINESS_NOT_FOUND",
  BUSINESS_ACCESS_DENIED: "BUSINESS_ACCESS_DENIED",
  PLATFORM_ACCESS_DENIED: "PLATFORM_ACCESS_DENIED",
  INVALID_TRANSITION: "INVALID_PROJECT_TRANSITION",
  REASON_REQUIRED: "PROJECT_REASON_REQUIRED",
  REPOSITORY_CONFLICT: "PROJECT_REPOSITORY_CONFLICT",
  BUSINESS_INACTIVE: "BUSINESS_INACTIVE",
  PROJECT_ACCESS_DENIED: "PROJECT_ACCESS_DENIED",
} as const;

export type ProjectErrorCode = (typeof PROJECT_ERROR_CODES)[keyof typeof PROJECT_ERROR_CODES];

const messages: Record<ProjectErrorCode, string> = {
  INVALID_PROJECT_NAME: "Project name is required.",
  INVALID_MEMBER: "The project member is not valid.",
  PROJECT_NOT_FOUND: "Project not found.",
  BUSINESS_NOT_FOUND: "Business not found.",
  BUSINESS_ACCESS_DENIED: "Business access denied.",
  PLATFORM_ACCESS_DENIED: "Platform administration access denied.",
  INVALID_PROJECT_TRANSITION: "This project state transition is not available.",
  PROJECT_REASON_REQUIRED: "A reason is required for this action.",
  PROJECT_REPOSITORY_CONFLICT: "The project state changed elsewhere.",
  BUSINESS_INACTIVE: "This business is not active.",
  PROJECT_ACCESS_DENIED: "Project membership operations require an active project.",
};

export class ProjectError extends Error {
  readonly name = "ProjectError";

  constructor(readonly code: ProjectErrorCode) {
    super(messages[code]);
  }
}

export interface CreateProjectInput {
  name: string;
}

export interface ProjectReasonInput {
  reason: string;
}

export interface AddProjectMemberInput {
  userId: UserId;
  role: ProjectMembershipRole;
}

export interface ProjectServiceDependencies {
  tenancyRepository: OnboardingRepository;
  projectRepository: ProjectRepository;
  platformRepository: PlatformRepository;
}

export interface ProjectService {
  createProjectRequest(businessId: BusinessId, actor: OnboardingActor, input: CreateProjectInput): Promise<ProjectDto>;
  listProjectsForBusiness(businessId: BusinessId, actor: OnboardingActor): Promise<ProjectDto[]>;
  listProjects(actor: OnboardingActor, status?: (typeof ProjectStatus)[number]): Promise<ProjectDto[]>;
  addProjectMember(businessId: BusinessId, projectId: string, actor: OnboardingActor, input: AddProjectMemberInput): Promise<ProjectMembership>;
  listProjectMembers(businessId: BusinessId, projectId: string, actor: OnboardingActor): Promise<ProjectMembership[]>;
  approveProject(projectId: string, actor: OnboardingActor, input: ProjectReasonInput): Promise<ProjectDto>;
  rejectProject(projectId: string, actor: OnboardingActor, input: ProjectReasonInput): Promise<ProjectDto>;
  suspendProject(projectId: string, actor: OnboardingActor, input: ProjectReasonInput): Promise<ProjectDto>;
  reactivateProject(projectId: string, actor: OnboardingActor, input: ProjectReasonInput): Promise<ProjectDto>;
  getEffectiveProjectAccess(projectId: string, actor: OnboardingActor): Promise<EffectiveProjectAccess>;
}

function normalizeProjectName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizedName(value: string): string {
  return normalizeProjectName(value).toLocaleLowerCase("en-US");
}

function requireReason(reason: string | undefined): string {
  if (typeof reason !== "string" || !reason.trim()) throw new ProjectError(PROJECT_ERROR_CODES.REASON_REQUIRED);
  return reason.trim();
}

function toProjectDto(project: Project): ProjectDto {
  return {
    id: project.id,
    businessId: project.businessId,
    name: project.name,
    status: project.status,
    isActive: project.isActive,
    requesterId: project.createdBy,
    reviewedAt: project.reviewedAt,
    activatedAt: project.activatedAt,
    rejectedAt: project.rejectedAt,
    suspendedAt: project.suspendedAt,
    statusReason: project.statusReason,
    createdAt: project.createdAt,
  };
}

function mapRepositoryError(error: unknown): never {
  if (error instanceof ProjectError) throw error;
  if (error instanceof ProjectRepositoryConflictError) throw new ProjectError(PROJECT_ERROR_CODES.REPOSITORY_CONFLICT);
  throw error;
}

async function requireBusinessProjectManager(
  tenancy: OnboardingRepository,
  businessId: BusinessId,
  actor: OnboardingActor,
): Promise<UserId> {
  const actorId = await resolveOnboardingActor(tenancy, actor);
  try {
    const membership = await createTenantContext(tenancy).requireBusinessAccess(actorId, businessId);
    requireCapability(membership, "manage_projects");
  } catch {
    throw new ProjectError(PROJECT_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  }
  return actorId;
}

function statusReasonForBusiness(status: string | null): EffectiveProjectAccess["reason"] | null {
  if (status === null) return "business_not_found";
  if (status === "pending") return "business_pending";
  if (status === "rejected") return "business_rejected";
  if (status === "suspended" || status === "inactive") return "business_suspended";
  return null;
}

async function requireActiveProjectForMembershipOperations(
  tenancy: OnboardingRepository,
  projects: ProjectRepository,
  businessId: BusinessId,
  projectId: string,
): Promise<Project> {
  await projects.lockProject(projectId);
  const project = await projects.findProject(projectId);
  if (!project || project.businessId !== businessId) throw new ProjectError(PROJECT_ERROR_CODES.PROJECT_NOT_FOUND);
  const businessStatus = await tenancy.findBusinessStatus(businessId);
  if (businessStatus !== "active") throw new ProjectError(PROJECT_ERROR_CODES.BUSINESS_INACTIVE);
  if (project.status !== "active" || !project.isActive) throw new ProjectError(PROJECT_ERROR_CODES.PROJECT_ACCESS_DENIED);
  return project;
}

function transitionUpdate(status: (typeof ProjectStatus)[number], reason: string | null): ProjectLifecycleUpdate {
  const now = new Date().toISOString();
  return {
    status,
    isActive: status === "active",
    reviewedBy: undefined,
    reviewedAt: now,
    activatedAt: status === "active" ? now : null,
    rejectedAt: status === "rejected" ? now : null,
    suspendedAt: status === "suspended" ? now : null,
    statusReason: reason,
  };
}

export function createProjectService(dependencies: ProjectServiceDependencies): ProjectService {
  const { tenancyRepository: tenancy, projectRepository: projects, platformRepository: platform } = dependencies;
  configureProjectReferences(projects, tenancy);

  async function platformMember(actor: OnboardingActor): Promise<PlatformMember> {
    try {
      return await requirePlatformMember(actor, tenancy, platform);
    } catch (error) {
      if (error instanceof PlatformError && error.code === PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED) {
        throw new ProjectError(PROJECT_ERROR_CODES.PLATFORM_ACCESS_DENIED);
      }
      throw error;
    }
  }

  async function runPlatformTransition(
    projectId: string,
    actor: OnboardingActor,
    expectedStatus: (typeof ProjectStatus)[number],
    action: string,
    update: ProjectLifecycleUpdate,
    reason: string | null,
  ): Promise<ProjectDto> {
    const member = await platformMember(actor);
    const execute = async (transactionProjects: ProjectRepository, transactionPlatform: PlatformRepository) => {
      const current = await transactionProjects.findProject(projectId);
      if (!current) throw new ProjectError(PROJECT_ERROR_CODES.PROJECT_NOT_FOUND);
      if (current.status !== expectedStatus) throw new ProjectError(PROJECT_ERROR_CODES.INVALID_TRANSITION);
      try {
        const updated = await transactionProjects.updateProjectLifecycle(projectId, { ...update, reviewedBy: member.id }, expectedStatus);
        await transactionPlatform.appendAuditEvent({
          actorId: member.id,
          action,
          targetType: "project",
          targetId: projectId,
          beforeStatus: current.status,
          afterStatus: updated.status,
          reason,
        });
        return toProjectDto(updated);
      } catch (error) {
        return mapRepositoryError(error);
      }
    };

    if (platform.transaction) {
      return platform.transaction((transactionPlatform) => projects.transaction((transactionProjects) =>
        execute(transactionProjects, transactionPlatform)));
    }
    return projects.transaction((transactionProjects) => execute(transactionProjects, platform));
  }

  return {
    async createProjectRequest(businessId, actor, input) {
      const actorId = await requireBusinessProjectManager(tenancy, businessId, actor);
      const name = normalizeProjectName(typeof input?.name === "string" ? input.name : "");
      const normalized = normalizedName(name);
      if (!normalized || normalized.length > 160) throw new ProjectError(PROJECT_ERROR_CODES.INVALID_PROJECT_NAME);
      try {
        const project = await projects.transaction(async (transactionProjects) => {
          const project = await transactionProjects.createProject({
            businessId,
            name,
            normalizedName: normalized,
            status: "pending",
            isActive: false,
            createdBy: actorId,
          } as NewProject);
          await transactionProjects.createProjectMembership({
            projectId: project.id,
            userId: actorId,
            role: "owner",
            isActive: true,
            status: "active",
          });
          return toProjectDto(project);
        });
        await tenancy.appendAuditEvent({ businessId, actorId, type: "project_created", entityId: project.id });
        return project;
      } catch (error) {
        return mapRepositoryError(error);
      }
    },

    async listProjectsForBusiness(businessId, actor) {
      await requireBusinessProjectManager(tenancy, businessId, actor);
      return (await projects.listProjectsForBusiness(businessId)).map(toProjectDto);
    },

    async listProjects(actor, status) {
      await platformMember(actor);
      const result = await projects.listProjects();
      return result.filter((project) => !status || project.status === status).map(toProjectDto);
    },

    async addProjectMember(businessId, projectId, actor, input) {
      if (await tenancy.findBusinessStatus(businessId) !== "active") throw new ProjectError(PROJECT_ERROR_CODES.BUSINESS_INACTIVE);
      await requireBusinessProjectManager(tenancy, businessId, actor);
      if (!input || typeof input.userId !== "string" || !input.userId.trim() || input.role !== "member") {
        throw new ProjectError(PROJECT_ERROR_CODES.INVALID_MEMBER);
      }
      try {
        return await tenancy.transaction(async (transactionTenancy) => projects.transaction(async (transactionProjects) => {
          await requireActiveProjectForMembershipOperations(transactionTenancy, transactionProjects, businessId, projectId);
          if (transactionTenancy.findUserById && !(await transactionTenancy.findUserById(input.userId))) {
            throw new ProjectError(PROJECT_ERROR_CODES.INVALID_MEMBER);
          }
          return transactionProjects.createProjectMembership({
            projectId,
            userId: input.userId,
            role: "member",
            isActive: true,
            status: "active",
          });
        }));
      } catch (error) {
        return mapRepositoryError(error);
      }
    },

    async listProjectMembers(businessId, projectId, actor) {
      if (await tenancy.findBusinessStatus(businessId) !== "active") throw new ProjectError(PROJECT_ERROR_CODES.BUSINESS_INACTIVE);
      await requireBusinessProjectManager(tenancy, businessId, actor);
      return tenancy.transaction(async (transactionTenancy) => projects.transaction(async (transactionProjects) => {
        await requireActiveProjectForMembershipOperations(transactionTenancy, transactionProjects, businessId, projectId);
        return transactionProjects.listProjectMemberships(projectId);
      }));
    },

    approveProject(projectId, actor, input) {
      const reason = requireReason(input.reason);
      return runPlatformTransition(projectId, actor, "pending", "project_approved", transitionUpdate("active", null), reason);
    },

    rejectProject(projectId, actor, input) {
      const reason = requireReason(input.reason);
      return runPlatformTransition(projectId, actor, "pending", "project_rejected", transitionUpdate("rejected", reason), reason);
    },

    suspendProject(projectId, actor, input) {
      const reason = requireReason(input.reason);
      return runPlatformTransition(projectId, actor, "active", "project_suspended", transitionUpdate("suspended", reason), reason);
    },

    reactivateProject(projectId, actor, input) {
      const reason = requireReason(input.reason);
      return runPlatformTransition(projectId, actor, "suspended", "project_reactivated", transitionUpdate("active", reason), reason);
    },

    async getEffectiveProjectAccess(projectId, actor) {
      return tenancy.transaction(async (transactionTenancy) => projects.transaction(async (transactionProjects) => {
        const project = await transactionProjects.findProject(projectId);
        if (!project) return { allowed: false, project: null, membership: null, reason: "project_not_found" };
        const businessStatus = await transactionTenancy.findBusinessStatus(project.businessId);
        const businessDenial = statusReasonForBusiness(businessStatus);
        if (businessDenial) return { allowed: false, project: null, membership: null, reason: businessDenial };
        if (project.status === "pending") return { allowed: false, project: null, membership: null, reason: "project_pending" };
        if (project.status === "rejected") return { allowed: false, project: null, membership: null, reason: "project_rejected" };
        if (project.status !== "active" || !project.isActive) return { allowed: false, project: null, membership: null, reason: "project_suspended" };
        const userId = await resolveOnboardingActor(transactionTenancy, actor);
        const membership = await transactionProjects.findProjectMembership(project.id, userId);
        if (!membership) return { allowed: false, project: null, membership: null, reason: "membership_required" };
        if (membership.status !== "active" || !membership.isActive) return { allowed: false, project: null, membership: null, reason: "membership_inactive" };
        return { allowed: true, project, membership, reason: null };
      }));
    },
  };
}

const DEFAULT_PROJECT_REPOSITORY_KEY = Symbol.for("ledgerharbour.task5.inMemoryProjectRepository");
type GlobalProjectState = typeof globalThis & { [key: symbol]: unknown };

function isProjectRepository(value: unknown): value is InMemoryProjectRepository {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<InMemoryProjectRepository>;
  return typeof candidate.transaction === "function" && Array.isArray(candidate.projects) && Array.isArray(candidate.memberships);
}

function configureProjectReferences(repository: ProjectRepository, tenancy: OnboardingRepository): void {
  if (!isProjectRepository(repository)) return;
  const references: ProjectReferenceResolvers = {
    businessExists: async (businessId) => Boolean(await tenancy.findBusiness(businessId)),
    userExists: async (userId) => Boolean(
      await tenancy.findUserById?.(userId)
      ?? (await tenancy.listBusinessesForUser(userId)).length > 0,
    ),
  };
  repository.configureReferences(references);
}

function createDefaultProjectRepository(): InMemoryProjectRepository {
  if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") return createInMemoryProjectRepository();
  const globalState = globalThis as GlobalProjectState;
  const existing = globalState[DEFAULT_PROJECT_REPOSITORY_KEY];
  if (isProjectRepository(existing)) return existing;
  const repository = createInMemoryProjectRepository();
  Object.defineProperty(globalState, DEFAULT_PROJECT_REPOSITORY_KEY, {
    configurable: false,
    enumerable: false,
    value: repository,
    writable: false,
  });
  return repository;
}

export const defaultProjectRepository = createDefaultProjectRepository();
