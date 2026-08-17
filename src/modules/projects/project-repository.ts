import { and, asc, eq } from "drizzle-orm";

import type { Database } from "../../db/client";
import { databaseForOperation, transactionWithDatabase } from "../../db/transaction-scope";
import { projectMemberships, projects } from "../../db/schema";
import type { BusinessId, UserId } from "../tenancy/types";
import type {
  Project,
  ProjectLifecycleUpdate,
  ProjectMembership,
  ProjectMembershipRole,
  ProjectMembershipStatus,
  ProjectStatus,
} from "./types";

export type NewProject = Omit<Project, "id" | "createdAt" | "updatedAt" | "reviewedBy" | "reviewedAt" | "activatedAt" | "rejectedAt" | "suspendedAt" | "statusReason"> & {
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  activatedAt?: string | null;
  rejectedAt?: string | null;
  suspendedAt?: string | null;
  statusReason?: string | null;
};

export type NewProjectMembership = Omit<ProjectMembership, "membershipId">;

export type ProjectReferenceResolvers = {
  businessExists: (businessId: BusinessId) => Promise<boolean>;
  userExists: (userId: UserId) => Promise<boolean>;
};

export class ProjectRepositoryConflictError extends Error {
  readonly name = "ProjectRepositoryConflictError";
}

export interface ProjectRepository {
  transaction<T>(operation: (repository: ProjectRepository) => Promise<T>): Promise<T>;
  createProject(input: NewProject): Promise<Project>;
  findProject(projectId: string): Promise<Project | null>;
  listProjects(): Promise<Project[]>;
  listProjectsForBusiness(businessId: BusinessId): Promise<Project[]>;
  updateProjectLifecycle(projectId: string, input: ProjectLifecycleUpdate, expectedStatus?: ProjectStatus): Promise<Project>;
  createProjectMembership(input: NewProjectMembership): Promise<ProjectMembership>;
  findProjectMembership(projectId: string, userId: UserId): Promise<ProjectMembership | null>;
  listProjectMemberships(projectId: string): Promise<ProjectMembership[]>;
}

export interface InMemoryProjectRepository extends ProjectRepository {
  readonly projects: Project[];
  readonly memberships: ProjectMembership[];
  readonly transactionCount: number;
  configureReferences(references: ProjectReferenceResolvers): void;
}

function cloneProject(project: Project): Project {
  return { ...project };
}

function cloneMembership(membership: ProjectMembership): ProjectMembership {
  return { ...membership };
}

function assertMembershipState(membership: Pick<ProjectMembership, "status" | "isActive">): void {
  if ((membership.status === "active") !== membership.isActive) {
    throw new ProjectRepositoryConflictError("Project membership status and activity are inconsistent");
  }
}

class MemoryProjectRepository implements InMemoryProjectRepository {
  readonly projects: Project[] = [];
  readonly memberships: ProjectMembership[] = [];
  private nextProjectId = 1;
  private nextMembershipId = 1;
  private transactions = 0;
  private transactionTail: Promise<void> = Promise.resolve();
  private references: ProjectReferenceResolvers | null = null;

  get transactionCount(): number {
    return this.transactions;
  }

  configureReferences(references: ProjectReferenceResolvers): void {
    this.references = references;
  }

  async transaction<T>(operation: (repository: ProjectRepository) => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    this.transactions += 1;
    const projectsSnapshot = this.projects.map(cloneProject);
    const membershipsSnapshot = this.memberships.map(cloneMembership);
    const counters = { project: this.nextProjectId, membership: this.nextMembershipId };
    try {
      return await operation(this);
    } catch (error) {
      this.projects.splice(0, this.projects.length, ...projectsSnapshot);
      this.memberships.splice(0, this.memberships.length, ...membershipsSnapshot);
      this.nextProjectId = counters.project;
      this.nextMembershipId = counters.membership;
      throw error;
    } finally {
      release();
    }
  }

  async createProject(input: NewProject): Promise<Project> {
    if (!input.businessId || !input.createdBy || !input.name.trim() || input.status !== "pending" || input.isActive) {
      throw new ProjectRepositoryConflictError("Invalid project creation state");
    }
    if (!this.references || !(await this.references.businessExists(input.businessId)) || !(await this.references.userExists(input.createdBy))) {
      throw new ProjectRepositoryConflictError("Project references an unknown business or user");
    }
    if (this.projects.some((project) => project.businessId === input.businessId && project.normalizedName === input.normalizedName)) {
      throw new ProjectRepositoryConflictError("Project name already exists");
    }
    const now = new Date().toISOString();
    const project: Project = {
      ...input,
      id: `project-${this.nextProjectId++}`,
      reviewedBy: input.reviewedBy ?? null,
      reviewedAt: input.reviewedAt ?? null,
      activatedAt: input.activatedAt ?? null,
      rejectedAt: input.rejectedAt ?? null,
      suspendedAt: input.suspendedAt ?? null,
      statusReason: input.statusReason ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.projects.push(project);
    return cloneProject(project);
  }

  async findProject(projectId: string): Promise<Project | null> {
    const project = this.projects.find((candidate) => candidate.id === projectId);
    return project ? cloneProject(project) : null;
  }

  async listProjects(): Promise<Project[]> {
    return this.projects.map(cloneProject);
  }

  async listProjectsForBusiness(businessId: BusinessId): Promise<Project[]> {
    return this.projects.filter((project) => project.businessId === businessId).map(cloneProject);
  }

  async updateProjectLifecycle(projectId: string, input: ProjectLifecycleUpdate, expectedStatus?: ProjectStatus): Promise<Project> {
    const index = this.projects.findIndex((project) => project.id === projectId);
    if (index < 0) throw new ProjectRepositoryConflictError("Project not found");
    const current = this.projects[index];
    if (expectedStatus && current.status !== expectedStatus) throw new ProjectRepositoryConflictError("Project state changed elsewhere");
    if ((input.status === "active") !== input.isActive) throw new ProjectRepositoryConflictError("Invalid project activity state");
    const updated = { ...current, ...input, updatedAt: new Date().toISOString() };
    this.projects[index] = updated;
    return cloneProject(updated);
  }

  async createProjectMembership(input: NewProjectMembership): Promise<ProjectMembership> {
    assertMembershipState(input);
    const project = this.projects.find((candidate) => candidate.id === input.projectId);
    if (!project || !this.references || !(await this.references.businessExists(project.businessId)) || !(await this.references.userExists(input.userId))) {
      throw new ProjectRepositoryConflictError("Project membership references an unknown project, business, or user");
    }
    if (this.memberships.some((membership) => membership.projectId === input.projectId && membership.userId === input.userId)) {
      throw new ProjectRepositoryConflictError("Project membership already exists");
    }
    const membership: ProjectMembership = { ...input, membershipId: `project-membership-${this.nextMembershipId++}` };
    this.memberships.push(membership);
    return cloneMembership(membership);
  }

  async findProjectMembership(projectId: string, userId: UserId): Promise<ProjectMembership | null> {
    const membership = this.memberships.find((candidate) => candidate.projectId === projectId && candidate.userId === userId);
    return membership ? cloneMembership(membership) : null;
  }

  async listProjectMemberships(projectId: string): Promise<ProjectMembership[]> {
    return this.memberships.filter((membership) => membership.projectId === projectId).map(cloneMembership);
  }
}

export function createInMemoryProjectRepository(): InMemoryProjectRepository {
  return new MemoryProjectRepository();
}

function id<T extends string>(value: string): T {
  return value as T;
}

function mapProject(row: typeof projects.$inferSelect): Project {
  return {
    id: row.id,
    businessId: id<BusinessId>(row.businessId),
    name: row.name,
    normalizedName: row.normalizedName,
    status: row.status as ProjectStatus,
    isActive: row.isActive,
    createdBy: id<UserId>(row.createdBy),
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
    statusReason: row.statusReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapMembership(row: typeof projectMemberships.$inferSelect): ProjectMembership {
  return {
    membershipId: row.id,
    projectId: row.projectId,
    userId: id<UserId>(row.userId),
    role: row.role as ProjectMembershipRole,
    isActive: row.isActive,
    status: row.status as ProjectMembershipStatus,
  };
}

export function createPostgresProjectRepository(db: Database): ProjectRepository {
  const repository: ProjectRepository = {
    transaction<T>(operation: (repository: ProjectRepository) => Promise<T>) {
      return transactionWithDatabase(db, () => operation(createPostgresProjectRepository(databaseForOperation(db))));
    },

    async createProject(input) {
      try {
        const [row] = await databaseForOperation(db).insert(projects).values({
          businessId: input.businessId,
          name: input.name,
          normalizedName: input.normalizedName,
          status: input.status,
          isActive: input.isActive,
          createdBy: input.createdBy,
          reviewedBy: input.reviewedBy,
          reviewedAt: input.reviewedAt ? new Date(input.reviewedAt) : null,
          activatedAt: input.activatedAt ? new Date(input.activatedAt) : null,
          rejectedAt: input.rejectedAt ? new Date(input.rejectedAt) : null,
          suspendedAt: input.suspendedAt ? new Date(input.suspendedAt) : null,
          statusReason: input.statusReason,
        }).returning();
        if (!row) throw new ProjectRepositoryConflictError("Project was not created");
        return mapProject(row);
      } catch (error) {
        if (error instanceof ProjectRepositoryConflictError) throw error;
        throw new ProjectRepositoryConflictError("Project could not be created");
      }
    },

    async findProject(projectId) {
      const [row] = await databaseForOperation(db).select().from(projects).where(eq(projects.id, projectId)).limit(1);
      return row ? mapProject(row) : null;
    },

    async listProjects() {
      const rows = await databaseForOperation(db).select().from(projects).orderBy(asc(projects.createdAt), asc(projects.id));
      return rows.map(mapProject);
    },

    async listProjectsForBusiness(businessId) {
      const rows = await databaseForOperation(db).select().from(projects)
        .where(eq(projects.businessId, businessId))
        .orderBy(asc(projects.createdAt), asc(projects.id));
      return rows.map(mapProject);
    },

    async updateProjectLifecycle(projectId, input, expectedStatus) {
      try {
        const [row] = await databaseForOperation(db).update(projects).set({
          status: input.status,
          isActive: input.isActive,
          reviewedBy: input.reviewedBy === undefined ? undefined : input.reviewedBy,
          reviewedAt: input.reviewedAt === undefined ? undefined : input.reviewedAt ? new Date(input.reviewedAt) : null,
          activatedAt: input.activatedAt === undefined ? undefined : input.activatedAt ? new Date(input.activatedAt) : null,
          rejectedAt: input.rejectedAt === undefined ? undefined : input.rejectedAt ? new Date(input.rejectedAt) : null,
          suspendedAt: input.suspendedAt === undefined ? undefined : input.suspendedAt ? new Date(input.suspendedAt) : null,
          statusReason: input.statusReason === undefined ? undefined : input.statusReason,
          updatedAt: new Date(),
        }).where(and(eq(projects.id, projectId), ...(expectedStatus ? [eq(projects.status, expectedStatus)] : []))).returning();
        if (!row) throw new ProjectRepositoryConflictError("Project state changed elsewhere");
        return mapProject(row);
      } catch (error) {
        if (error instanceof ProjectRepositoryConflictError) throw error;
        throw new ProjectRepositoryConflictError("Project could not be updated");
      }
    },

    async createProjectMembership(input) {
      try {
        assertMembershipState(input);
        const [row] = await databaseForOperation(db).insert(projectMemberships).values({
          projectId: input.projectId,
          userId: input.userId,
          role: input.role,
          isActive: input.isActive,
          status: input.status,
        }).returning();
        if (!row) throw new ProjectRepositoryConflictError("Project membership was not created");
        return mapMembership(row);
      } catch (error) {
        if (error instanceof ProjectRepositoryConflictError) throw error;
        throw new ProjectRepositoryConflictError("Project membership could not be created");
      }
    },

    async findProjectMembership(projectId, userId) {
      const [row] = await databaseForOperation(db).select().from(projectMemberships).where(and(
        eq(projectMemberships.projectId, projectId),
        eq(projectMemberships.userId, userId),
      )).limit(1);
      return row ? mapMembership(row) : null;
    },

    async listProjectMemberships(projectId) {
      const rows = await databaseForOperation(db).select().from(projectMemberships)
        .where(eq(projectMemberships.projectId, projectId))
        .orderBy(asc(projectMemberships.createdAt), asc(projectMemberships.id));
      return rows.map(mapMembership);
    },
  };
  return repository;
}
