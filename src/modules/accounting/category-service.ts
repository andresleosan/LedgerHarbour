import { defaultOnboardingRepository, type Category, type OnboardingRepository } from "../tenancy/business-service";
import { BusinessLifecycleError, LIFECYCLE_ERROR_CODES, requireBusinessOperational } from "../tenancy/business-lifecycle-service";
import { AuthorizationError, requireCapability } from "../permissions/authorize";
import { createTenantContext } from "../tenancy/tenant-context";
import type { BusinessId, UserId } from "../tenancy/types";
import { resolveOnboardingActor, type OnboardingActor } from "../tenancy/business-service";

export const CATEGORY_ERROR_CODES = {
  INVALID_CATEGORY: "INVALID_CATEGORY",
  CATEGORY_NAME_CONFLICT: "CATEGORY_NAME_CONFLICT",
  CATEGORY_NOT_FOUND: "CATEGORY_NOT_FOUND",
  BUSINESS_ACCESS_DENIED: "BUSINESS_ACCESS_DENIED",
  INACTIVE_BUSINESS: "INACTIVE_BUSINESS",
  INSUFFICIENT_CAPABILITY: "INSUFFICIENT_CAPABILITY",
  CATEGORY_REPOSITORY_CONFLICT: "CATEGORY_REPOSITORY_CONFLICT",
} as const;

export type CategoryErrorCode = (typeof CATEGORY_ERROR_CODES)[keyof typeof CATEGORY_ERROR_CODES];

const messages: Record<CategoryErrorCode, string> = {
  INVALID_CATEGORY: "The category name is invalid.",
  CATEGORY_NAME_CONFLICT: "A category with that name already exists.",
  CATEGORY_NOT_FOUND: "Category not found.",
  BUSINESS_ACCESS_DENIED: "Business access denied.",
  INACTIVE_BUSINESS: "This business is inactive.",
  INSUFFICIENT_CAPABILITY: "You do not have permission to manage categories.",
  CATEGORY_REPOSITORY_CONFLICT: "The category changed elsewhere.",
};

export class CategoryError extends Error {
  readonly name = "CategoryError";

  constructor(readonly code: CategoryErrorCode) {
    super(messages[code]);
  }
}

export interface CreateCategoryInput {
  businessId: BusinessId;
  name: string;
}

export interface UpdateCategoryInput {
  businessId: BusinessId;
  categoryId: string;
  name?: string;
  isActive?: boolean;
}

export interface CategoryDependencies {
  tenancyRepository?: OnboardingRepository;
}

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function validateName(value: unknown): string {
  const name = normalizeName(value);
  if (!name || name.length > 100) throw new CategoryError(CATEGORY_ERROR_CODES.INVALID_CATEGORY);
  return name;
}

function validateBusinessId(value: unknown): BusinessId {
  if (typeof value !== "string" || !value.trim()) throw new CategoryError(CATEGORY_ERROR_CODES.INVALID_CATEGORY);
  return value as BusinessId;
}

function mapBoundaryError(error: unknown): CategoryError {
  if (error instanceof CategoryError) return error;
  if (error instanceof BusinessLifecycleError && error.code === LIFECYCLE_ERROR_CODES.INACTIVE_BUSINESS) return new CategoryError(CATEGORY_ERROR_CODES.INACTIVE_BUSINESS);
  if (error instanceof BusinessLifecycleError && error.code === LIFECYCLE_ERROR_CODES.BUSINESS_NOT_FOUND) return new CategoryError(CATEGORY_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  if (error instanceof AuthorizationError) {
    return new CategoryError(error.code === "CAPABILITY_REQUIRED" ? CATEGORY_ERROR_CODES.INSUFFICIENT_CAPABILITY : CATEGORY_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  }
  return new CategoryError(CATEGORY_ERROR_CODES.CATEGORY_REPOSITORY_CONFLICT);
}

async function requireCategoryAdmin(businessId: BusinessId, actorId: UserId, repository: OnboardingRepository): Promise<void> {
  try {
    await requireBusinessOperational(repository, businessId);
    const membership = await createTenantContext(repository).getMembership(actorId, businessId);
    requireCapability(membership!, "edit_finance");
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

async function categoryFor(repository: OnboardingRepository, businessId: BusinessId, categoryId: string): Promise<Category> {
  const category = await repository.findCategory(businessId, categoryId);
  if (!category) throw new CategoryError(CATEGORY_ERROR_CODES.CATEGORY_NOT_FOUND);
  return category;
}

async function hasNameConflict(repository: OnboardingRepository, businessId: BusinessId, name: string, ignoredId?: string): Promise<boolean> {
  const normalized = name.toLocaleLowerCase("en-US");
  return (await repository.findCategoryByName(businessId, normalized, ignoredId)) !== null;
}

export async function createCategory(input: CreateCategoryInput, actor: OnboardingActor, dependencies: CategoryDependencies = {}): Promise<Category> {
  const repository = dependencies.tenancyRepository ?? defaultOnboardingRepository;
  const businessId = validateBusinessId(input?.businessId);
  const actorId = await resolveOnboardingActor(repository, actor);
  const name = validateName(input?.name);
  await requireCategoryAdmin(businessId, actorId, repository);

  try {
    return await repository.transaction(async (transaction) => {
       if (await hasNameConflict(transaction, businessId, name)) throw new CategoryError(CATEGORY_ERROR_CODES.CATEGORY_NAME_CONFLICT);
      const category: Category = { id: randomUUID(), businessId, name, isActive: true };
       const saved = await transaction.createCategory(category);
       await transaction.appendAuditEvent({ businessId, actorId, type: "category_created", entityId: saved.id });
       return saved;
    });
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

export async function updateCategory(input: UpdateCategoryInput, actor: OnboardingActor, dependencies: CategoryDependencies = {}): Promise<Category> {
  const repository = dependencies.tenancyRepository ?? defaultOnboardingRepository;
  const businessId = validateBusinessId(input?.businessId);
  const actorId = await resolveOnboardingActor(repository, actor);
  await requireCategoryAdmin(businessId, actorId, repository);
  const name = input.name === undefined ? undefined : validateName(input.name);
  try {
    return await repository.transaction(async (transaction) => {
       if (name && await hasNameConflict(transaction, businessId, name, input.categoryId)) throw new CategoryError(CATEGORY_ERROR_CODES.CATEGORY_NAME_CONFLICT);
       const category = await categoryFor(transaction, businessId, input.categoryId);
      if (name !== undefined) category.name = name;
      if (input.isActive !== undefined) category.isActive = input.isActive;
       const saved = await transaction.updateCategory(category);
       await transaction.appendAuditEvent({ businessId, actorId, type: input.isActive === false ? "category_deactivated" : "category_updated", entityId: saved.id });
       return saved;
    });
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

export async function deactivateCategory(businessId: BusinessId, categoryId: string, actor: OnboardingActor, dependencies: CategoryDependencies = {}): Promise<Category> {
  return updateCategory({ businessId, categoryId, isActive: false }, actor, dependencies);
}

export async function listCategories(businessId: BusinessId, actor: OnboardingActor, dependencies: CategoryDependencies = {}): Promise<Category[]> {
  const repository = dependencies.tenancyRepository ?? defaultOnboardingRepository;
  const actorId = await resolveOnboardingActor(repository, actor);
  try {
    await requireBusinessOperational(repository, businessId);
    const membership = await createTenantContext(repository).getMembership(actorId, businessId);
    requireCapability(membership!, "read_finance");
     return repository.listCategories(businessId);
  } catch (error) {
    throw mapBoundaryError(error);
  }
}
import { randomUUID } from "node:crypto";
