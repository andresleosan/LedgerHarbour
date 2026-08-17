import { describe, expect, it } from "vitest";

import {
  createInMemoryProjectRepository,
  ProjectRepositoryConflictError,
  type NewProject,
} from "../../../src/modules/projects/project-repository";
import type { BusinessId, UserId } from "../../../src/modules/tenancy/types";

const businessId = "business-1" as BusinessId;
const otherBusinessId = "business-2" as BusinessId;
const ownerId = "user-1" as UserId;
const memberId = "user-2" as UserId;

function projectInput(overrides: Partial<NewProject> = {}): NewProject {
  return {
    businessId,
    name: "Project",
    normalizedName: "project",
    status: "pending",
    isActive: false,
    createdBy: ownerId,
    ...overrides,
  };
}

function configuredRepository() {
  const repository = createInMemoryProjectRepository();
  repository.configureReferences({
    businessExists: async (id) => id === businessId || id === otherBusinessId,
    userExists: async (id) => id === ownerId || id === memberId,
  });
  return repository;
}

describe("in-memory project repository referential integrity", () => {
  it("rejects projects whose business or creator does not exist", async () => {
    const repository = configuredRepository();

    await expect(repository.createProject(projectInput({ businessId: "missing-business" as BusinessId }))).rejects.toBeInstanceOf(ProjectRepositoryConflictError);
    await expect(repository.createProject(projectInput({ createdBy: "missing-user" as UserId }))).rejects.toBeInstanceOf(ProjectRepositoryConflictError);
  });

  it("rejects memberships for unknown projects or users", async () => {
    const repository = configuredRepository();
    const project = await repository.createProject(projectInput());

    await expect(repository.createProjectMembership({
      projectId: "missing-project",
      userId: memberId,
      role: "member",
      isActive: true,
      status: "active",
    })).rejects.toBeInstanceOf(ProjectRepositoryConflictError);
    await expect(repository.createProjectMembership({
      projectId: project.id,
      userId: "missing-user" as UserId,
      role: "member",
      isActive: true,
      status: "active",
    })).rejects.toBeInstanceOf(ProjectRepositoryConflictError);
  });

  it("rejects duplicate memberships for the same project and user", async () => {
    const repository = configuredRepository();
    const project = await repository.createProject(projectInput());
    const membership = { projectId: project.id, userId: memberId, role: "member" as const, isActive: true, status: "active" as const };

    await repository.createProjectMembership(membership);
    await expect(repository.createProjectMembership(membership)).rejects.toBeInstanceOf(ProjectRepositoryConflictError);
  });
});
