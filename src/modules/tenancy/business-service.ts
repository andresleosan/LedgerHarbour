import { defaultCategorySeeds } from "../../db/seed/default-categories";
import type { AuthIdentity } from "../auth/auth-provider";
import { createJoinRequestService } from "./join-request-service";
import type { TenantRepository } from "./tenant-context";
import { createTenantContext } from "./tenant-context";
import type { BusinessId, BusinessStatus, Membership, UserId } from "./types";

export const ONBOARDING_ERROR_CODES = {
  INVALID_BUSINESS_NAME: "INVALID_BUSINESS_NAME",
  INVALID_SEARCH_QUERY: "INVALID_SEARCH_QUERY",
  INVALID_REQUEST_ROLE: "INVALID_REQUEST_ROLE",
  INVALID_BUSINESS_TRANSITION: "INVALID_BUSINESS_TRANSITION",
  INVALID_TRANSITION: "INVALID_JOIN_REQUEST_TRANSITION",
  INACTIVE_BUSINESS: "INACTIVE_BUSINESS",
  MISSING_BUSINESS: "BUSINESS_NOT_FOUND",
  DUPLICATE_MEMBERSHIP: "MEMBERSHIP_ALREADY_EXISTS",
  PENDING_REQUEST_CONFLICT: "PENDING_JOIN_REQUEST_EXISTS",
  INSUFFICIENT_CAPABILITY: "INSUFFICIENT_CAPABILITY",
  HIDDEN_REQUEST: "JOIN_REQUEST_NOT_FOUND",
  REPOSITORY_CONFLICT: "REPOSITORY_CONFLICT",
} as const;

export type OnboardingErrorCode = (typeof ONBOARDING_ERROR_CODES)[keyof typeof ONBOARDING_ERROR_CODES];

const businessTransitions: Record<BusinessStatus, readonly BusinessStatus[]> = {
  pending: ["active", "rejected"],
  active: ["suspended"],
  suspended: ["active"],
  rejected: [],
};

export function validateBusinessStatusTransition(current: BusinessStatus, next: BusinessStatus): void {
  if (!businessTransitions[current].includes(next)) {
    throw new OnboardingError(ONBOARDING_ERROR_CODES.INVALID_BUSINESS_TRANSITION);
  }
}

const publicMessages: Record<OnboardingErrorCode, string> = {
  INVALID_BUSINESS_NAME: "Business name is required.",
  INVALID_SEARCH_QUERY: "Enter a business name to search.",
  INVALID_REQUEST_ROLE: "This membership role is not available.",
  INVALID_BUSINESS_TRANSITION: "This business state transition is not available.",
  INVALID_JOIN_REQUEST_TRANSITION: "This join request cannot change state.",
  INACTIVE_BUSINESS: "This business is not available for joining.",
  BUSINESS_NOT_FOUND: "Business not found.",
  MEMBERSHIP_ALREADY_EXISTS: "You already have membership in this business.",
  PENDING_JOIN_REQUEST_EXISTS: "A join request is already pending.",
  INSUFFICIENT_CAPABILITY: "You do not have permission to review join requests.",
  JOIN_REQUEST_NOT_FOUND: "Join request not found.",
  REPOSITORY_CONFLICT: "The requested change conflicts with current membership state.",
};

export class OnboardingError extends Error {
  readonly name = "OnboardingError";

  constructor(readonly code: OnboardingErrorCode) {
    super(publicMessages[code]);
  }
}

export type BaseCurrencyKind = "standard";

export interface Business {
  id: BusinessId;
  name: string;
  normalizedName: string;
  status: BusinessStatus;
  /** @deprecated Use status. Kept while existing clients migrate. */
  isActive: boolean;
  activatedAt: string | null;
  serviceExpiresAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  baseCurrencyKind: BaseCurrencyKind;
  baseCurrencyCode: "GBP";
  baseCurrencyId: null;
  createdBy: UserId;
}

export interface Category {
  id: string;
  businessId: BusinessId;
  name: string;
  isActive: boolean;
}

export interface AuditEvent {
  id: string;
  businessId: BusinessId;
  actorId: UserId;
  type: string;
  entityId: string;
  createdAt: string;
}

export interface BusinessSearchResult {
  id: BusinessId;
  name: string;
  isActive: true;
}

export interface CreateBusinessInput {
  name: string;
}

export type BusinessCreateInput = Omit<Business, "id" | "status" | "isActive" | "activatedAt" | "serviceExpiresAt" | "suspendedAt" | "suspensionReason">;

const lifecycleCreationFields = ["status", "isActive", "activatedAt", "serviceExpiresAt", "suspendedAt", "suspensionReason"] as const;

export function assertPendingBusinessCreationInput(input: unknown): asserts input is BusinessCreateInput {
  if (!input || typeof input !== "object" || lifecycleCreationFields.some((field) => Object.prototype.hasOwnProperty.call(input, field))) {
    throw new OnboardingError(ONBOARDING_ERROR_CODES.INVALID_BUSINESS_TRANSITION);
  }
}

export interface BusinessLifecycleUpdate {
  status: BusinessStatus;
  activatedAt?: string | null;
  serviceExpiresAt?: string | null;
  suspendedAt?: string | null;
  suspensionReason?: string | null;
}

export type OnboardingActor = UserId | AuthIdentity;

export interface JoinRequest {
  id: string;
  businessId: BusinessId;
  requesterId: UserId;
  requestedRole: "administrator";
  status: "pending" | "approved" | "rejected";
  reviewerId: UserId | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface JoinRequestStatusDto {
  status: JoinRequest["status"];
}

export interface CreateJoinRequestInput {
  businessId: BusinessId;
  requestedRole: "administrator";
}

export interface ReviewJoinRequestInput {
  businessId: BusinessId;
  joinRequestId: string;
  decision: "approved" | "rejected";
}

export interface OnboardingRepository extends TenantRepository {
  readonly transactionCount: number;
  transaction<T>(operation: (repository: OnboardingRepository) => Promise<T>): Promise<T>;
  upsertUser(identity: AuthIdentity): Promise<UserId>;
  createBusiness(input: BusinessCreateInput): Promise<Business>;
  provisionDefaultCategories(businessId: BusinessId): Promise<void>;
  createMembership(membership: Membership): Promise<Membership>;
  updateMembership(membership: Membership): Promise<Membership>;
  deleteMembership(membershipId: string): Promise<void>;
  listMemberships(businessId: BusinessId): Promise<Membership[]>;
  listBusinessesForUser(userId: UserId): Promise<Array<{ business: Business; membership: Membership }>>;
  appendAuditEvent(event: Omit<AuditEvent, "id" | "createdAt">): Promise<AuditEvent>;
  listAuditEvents(businessId: BusinessId): Promise<AuditEvent[]>;
  updateBusinessStatus(businessId: BusinessId, isActive: boolean): Promise<Business>;
  updateBusinessLifecycle(businessId: BusinessId, input: BusinessLifecycleUpdate): Promise<Business>;
  listBusinesses(): Promise<Business[]>;
  listCategories(businessId: BusinessId): Promise<Category[]>;
  findCategory(businessId: BusinessId, categoryId: string): Promise<Category | null>;
  findCategoryByName(businessId: BusinessId, normalizedName: string, ignoredId?: string): Promise<Category | null>;
  createCategory(category: Category): Promise<Category>;
  updateCategory(category: Category): Promise<Category>;
  findBusiness(businessId: BusinessId): Promise<Business | null>;
  searchBusinesses(normalizedQuery: string): Promise<BusinessSearchResult[]>;
  createJoinRequest(input: Omit<JoinRequest, "id" | "createdAt" | "reviewerId" | "reviewedAt">): Promise<JoinRequest>;
  findJoinRequest(joinRequestId: string): Promise<JoinRequest | null>;
  listJoinRequests(businessId: BusinessId): Promise<JoinRequest[]>;
  listUserJoinRequests(businessId: BusinessId, requesterId: UserId): Promise<JoinRequest[]>;
  updateJoinRequest(input: JoinRequest): Promise<JoinRequest>;
}

const idFor = <T extends string>(value: string) => value as T;

export function normalizeBusinessName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function requireActorId(actorId: UserId): void {
  if (typeof actorId !== "string" || !actorId.trim()) {
    throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
  }
}

export interface MemoryOnboardingRepository extends OnboardingRepository {
  readonly businesses: Map<BusinessId, Business>;
  readonly memberships: Membership[];
  readonly categories: Category[];
  readonly joinRequests: JoinRequest[];
  readonly auditEvents: AuditEvent[];
}

class InMemoryOnboardingRepository implements MemoryOnboardingRepository {
  readonly businesses = new Map<BusinessId, Business>();
  readonly memberships: Membership[] = [];
  readonly categories: Category[] = [];
  readonly joinRequests: JoinRequest[] = [];
  readonly auditEvents: AuditEvent[] = [];
  private nextBusinessId = 1;
  private nextCategoryId = 1;
  private nextJoinRequestId = 1;
  private nextAuditId = 1;
  private nextUserId = 1;
  private transactions = 0;
  private transactionTail: Promise<void> = Promise.resolve();
  private readonly userIdsByProvider = new Map<string, UserId>();

  get transactionCount(): number {
    return this.transactions;
  }

  async upsertUser(identity: AuthIdentity): Promise<UserId> {
    const existing = this.userIdsByProvider.get(identity.providerUserId);
    if (existing) return existing;
    const localId = idFor<UserId>(`user-${this.nextUserId++}`);
    this.userIdsByProvider.set(identity.providerUserId, localId);
    return localId;
  }

  async transaction<T>(operation: (repository: OnboardingRepository) => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.transactions += 1;
    const snapshot = {
      businesses: new Map([...this.businesses].map(([id, business]) => [id, { ...business }])),
      memberships: this.memberships.map((membership) => ({ ...membership })),
      categories: this.categories.map((category) => ({ ...category })),
      joinRequests: this.joinRequests.map((request) => ({ ...request })),
      auditEvents: this.auditEvents.map((event) => ({ ...event })),
      nextBusinessId: this.nextBusinessId,
      nextCategoryId: this.nextCategoryId,
      nextJoinRequestId: this.nextJoinRequestId,
      nextAuditId: this.nextAuditId,
      nextUserId: this.nextUserId,
      userIdsByProvider: new Map(this.userIdsByProvider),
    };

    try {
      return await operation(this);
    } catch (error) {
      this.businesses.clear();
      snapshot.businesses.forEach((business, id) => this.businesses.set(id, business));
      this.memberships.splice(0, this.memberships.length, ...snapshot.memberships);
      this.categories.splice(0, this.categories.length, ...snapshot.categories);
      this.joinRequests.splice(0, this.joinRequests.length, ...snapshot.joinRequests);
      this.auditEvents.splice(0, this.auditEvents.length, ...snapshot.auditEvents);
      this.nextBusinessId = snapshot.nextBusinessId;
      this.nextCategoryId = snapshot.nextCategoryId;
      this.nextJoinRequestId = snapshot.nextJoinRequestId;
      this.nextAuditId = snapshot.nextAuditId;
      this.nextUserId = snapshot.nextUserId;
      this.userIdsByProvider.clear();
      snapshot.userIdsByProvider.forEach((id, provider) => this.userIdsByProvider.set(provider, id));
      throw error;
    } finally {
      release();
    }
  }

  async findMembership(userId: UserId, businessId: BusinessId): Promise<Membership | null> {
    return this.memberships.find(
      (membership) => membership.userId === userId && membership.businessId === businessId,
    ) ?? null;
  }

  async findBusinessStatus(businessId: BusinessId): Promise<BusinessStatus | null> {
    const business = this.businesses.get(businessId);
    if (!business) return null;
    return business.status === "active" && business.isActive ? "active" : business.status === "active" ? "suspended" : business.status;
  }

  async createBusiness(input: BusinessCreateInput): Promise<Business> {
    assertPendingBusinessCreationInput(input);
    const business = {
      ...input,
      status: "pending" as const,
      isActive: false,
      activatedAt: null,
      serviceExpiresAt: null,
      suspendedAt: null,
      suspensionReason: null,
      id: idFor<BusinessId>(`business-${this.nextBusinessId++}`),
    };
    this.businesses.set(business.id, business);
    return business;
  }

  async provisionDefaultCategories(businessId: BusinessId): Promise<void> {
    this.categories.push(
      ...defaultCategorySeeds.map((seed) => ({
        id: `category-${this.nextCategoryId++}`,
        businessId,
        name: seed.name,
        isActive: true,
      })),
    );
  }

  async createMembership(membership: Membership): Promise<Membership> {
    if (typeof membership.membershipId !== "string" || !membership.membershipId.trim()) {
      throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
    }
    if (this.memberships.some((candidate) => candidate.userId === membership.userId && candidate.businessId === membership.businessId)) {
      throw new OnboardingError(ONBOARDING_ERROR_CODES.DUPLICATE_MEMBERSHIP);
    }
    const stored = { ...membership };
    this.memberships.push(stored);
    return { ...stored };
  }

  async updateMembership(membership: Membership): Promise<Membership> {
    const index = this.memberships.findIndex((candidate) =>
      candidate.membershipId === membership.membershipId,
    );
    if (index < 0) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
    this.memberships[index] = { ...membership };
    return { ...this.memberships[index] };
  }

  async deleteMembership(membershipId: string): Promise<void> {
    const index = this.memberships.findIndex((membership) => membership.membershipId === membershipId);
    if (index < 0) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
    this.memberships.splice(index, 1);
  }

  async listMemberships(businessId: BusinessId): Promise<Membership[]> {
    return this.memberships.filter((membership) => membership.businessId === businessId).map((membership) => ({ ...membership }));
  }

  async listBusinessesForUser(userId: UserId): Promise<Array<{ business: Business; membership: Membership }>> {
    return this.memberships
      .filter((membership) => membership.userId === userId && membership.isActive)
      .flatMap((membership) => {
        const business = this.businesses.get(membership.businessId);
        return business ? [{ business: { ...business, isActive: business.status === "active" && business.isActive }, membership: { ...membership } }] : [];
      });
  }

  async appendAuditEvent(input: Omit<AuditEvent, "id" | "createdAt">): Promise<AuditEvent> {
    const event = { ...input, id: `audit-${this.nextAuditId++}`, createdAt: new Date().toISOString() };
    this.auditEvents.push(event);
    return event;
  }

  async listAuditEvents(businessId: BusinessId): Promise<AuditEvent[]> {
    return this.auditEvents.filter((event) => event.businessId === businessId).map((event) => ({ ...event }));
  }

  async updateBusinessStatus(businessId: BusinessId, isActive: boolean): Promise<Business> {
    return this.updateBusinessLifecycle(businessId, {
      status: isActive ? "active" : "suspended",
      suspendedAt: isActive ? null : new Date().toISOString(),
      suspensionReason: isActive ? null : "Business deactivated",
    });
  }

  async updateBusinessLifecycle(businessId: BusinessId, input: BusinessLifecycleUpdate): Promise<Business> {
    const business = this.businesses.get(businessId);
    if (!business) throw new OnboardingError(ONBOARDING_ERROR_CODES.MISSING_BUSINESS);
    validateBusinessStatusTransition(business.status, input.status);
    if (input.status === "active" && !this.memberships.some((membership) => membership.businessId === businessId && membership.role === "owner_admin" && membership.isActive)) {
      throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
    }
    const updated = { ...business, ...input, isActive: input.status === "active" };
    this.businesses.set(businessId, updated);
    return { ...updated };
  }

  async listBusinesses(): Promise<Business[]> {
    return [...this.businesses.values()].map((business) => ({ ...business }));
  }

  async listCategories(businessId: BusinessId): Promise<Category[]> {
    return this.categories.filter((category) => category.businessId === businessId).map((category) => ({ ...category }));
  }

  async findCategory(businessId: BusinessId, categoryId: string): Promise<Category | null> {
    const category = this.categories.find((candidate) => candidate.businessId === businessId && candidate.id === categoryId);
    return category ? { ...category } : null;
  }

  async findCategoryByName(businessId: BusinessId, normalizedName: string, ignoredId?: string): Promise<Category | null> {
    const category = this.categories.find((candidate) => candidate.businessId === businessId && candidate.id !== ignoredId && candidate.name.trim().toLocaleLowerCase("en-US") === normalizedName);
    return category ? { ...category } : null;
  }

  async createCategory(category: Category): Promise<Category> {
    if (this.categories.some((candidate) => candidate.businessId === category.businessId && candidate.name === category.name)) {
      throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
    }
    this.categories.push({ ...category });
    return { ...category };
  }

  async updateCategory(category: Category): Promise<Category> {
    const index = this.categories.findIndex((candidate) => candidate.id === category.id && candidate.businessId === category.businessId);
    if (index < 0) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
    this.categories[index] = { ...category };
    return { ...category };
  }

  async findBusiness(businessId: BusinessId): Promise<Business | null> {
    const business = this.businesses.get(businessId);
    return business ? { ...business } : null;
  }

  async searchBusinesses(normalizedQuery: string): Promise<BusinessSearchResult[]> {
    return [...this.businesses.values()]
      .filter((business) => business.status === "active" && business.isActive && business.normalizedName.includes(normalizedQuery))
      .map(({ id, name }) => ({ id, name, isActive: true as const }));
  }

  async createJoinRequest(
    input: Omit<JoinRequest, "id" | "createdAt" | "reviewerId" | "reviewedAt">,
  ): Promise<JoinRequest> {
    if (this.joinRequests.some(
      (request) => request.businessId === input.businessId && request.requesterId === input.requesterId && request.status === "pending",
    )) {
      throw new OnboardingError(ONBOARDING_ERROR_CODES.PENDING_REQUEST_CONFLICT);
    }
    const request: JoinRequest = {
      ...input,
      id: `join-request-${this.nextJoinRequestId++}`,
      reviewerId: null,
      reviewedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.joinRequests.push(request);
    return request;
  }

  async findJoinRequest(joinRequestId: string): Promise<JoinRequest | null> {
    return this.joinRequests.find((request) => request.id === joinRequestId) ?? null;
  }

  async listJoinRequests(businessId: BusinessId): Promise<JoinRequest[]> {
    return this.joinRequests.filter((request) => request.businessId === businessId && request.status === "pending");
  }

  async listUserJoinRequests(businessId: BusinessId, requesterId: UserId): Promise<JoinRequest[]> {
    return this.joinRequests.filter(
      (request) => request.businessId === businessId && request.requesterId === requesterId,
    );
  }

  async updateJoinRequest(input: JoinRequest): Promise<JoinRequest> {
    const index = this.joinRequests.findIndex((request) => request.id === input.id);
    if (index === -1) {
      throw new OnboardingError(ONBOARDING_ERROR_CODES.HIDDEN_REQUEST);
    }
    if (this.joinRequests[index].businessId !== input.businessId) {
      throw new OnboardingError(ONBOARDING_ERROR_CODES.HIDDEN_REQUEST);
    }
    if (this.joinRequests[index].status !== "pending") {
      throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
    }
    this.joinRequests[index] = { ...input };
    return this.joinRequests[index];
  }
}

export function createInMemoryOnboardingRepository(): MemoryOnboardingRepository {
  return new InMemoryOnboardingRepository();
}

export async function resolveOnboardingActor(
  repository: OnboardingRepository,
  actor: OnboardingActor,
): Promise<UserId> {
  if (typeof actor === "string") {
    requireActorId(actor);
    return actor;
  }
  if (
    !actor ||
    typeof actor.providerUserId !== "string" ||
    !actor.providerUserId.trim() ||
    typeof actor.email !== "string" ||
    !actor.email.trim() ||
    typeof actor.displayName !== "string" ||
    !actor.displayName.trim() ||
    typeof actor.emailVerified !== "boolean"
  ) {
    throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
  }
  return repository.upsertUser(actor);
}

const DEFAULT_REPOSITORY_KEY = Symbol.for("ledgerharbour.task5.inMemoryOnboardingRepository");
type GlobalState = typeof globalThis & { [key: symbol]: unknown };

function isOnboardingRepository(value: unknown): value is MemoryOnboardingRepository {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<MemoryOnboardingRepository>;
  return (
    typeof candidate.transaction === "function" &&
    typeof candidate.findMembership === "function" &&
    typeof candidate.findBusinessStatus === "function" &&
    typeof candidate.createBusiness === "function" &&
    typeof candidate.searchBusinesses === "function" &&
    typeof candidate.createJoinRequest === "function" &&
    candidate.businesses instanceof Map &&
    Array.isArray(candidate.memberships) &&
    Array.isArray(candidate.categories) &&
    Array.isArray(candidate.joinRequests) &&
    Array.isArray(candidate.auditEvents)
  );
}

function createDefaultOnboardingRepository(): MemoryOnboardingRepository {
  const shareAcrossBundles = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  if (!shareAcrossBundles) {
    return createInMemoryOnboardingRepository();
  }

  const globalState = globalThis as GlobalState;
  const existing = globalState[DEFAULT_REPOSITORY_KEY];
  if (isOnboardingRepository(existing)) {
    return existing;
  }

  const repository = createInMemoryOnboardingRepository();
  Object.defineProperty(globalState, DEFAULT_REPOSITORY_KEY, {
    configurable: false,
    enumerable: false,
    value: repository,
    writable: false,
  });
  return repository;
}

export const defaultOnboardingRepository = createDefaultOnboardingRepository();

export async function createBusiness(
  input: CreateBusinessInput,
  actor: OnboardingActor,
  repository: OnboardingRepository = defaultOnboardingRepository,
): Promise<Business> {
  return createBusinessRequest(input, actor, repository);
}

export async function createBusinessRequest(
  input: CreateBusinessInput,
  actor: OnboardingActor,
  repository: OnboardingRepository = defaultOnboardingRepository,
): Promise<Business> {
  return createBusinessWithStatus(input, actor, repository);
}

async function createBusinessWithStatus(
  input: CreateBusinessInput,
  actor: OnboardingActor,
  repository: OnboardingRepository,
): Promise<Business> {
  if (typeof actor === "string") requireActorId(actor);
  const name = typeof input?.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  const normalizedName = normalizeBusinessName(name);
  if (!normalizedName) {
    throw new OnboardingError(ONBOARDING_ERROR_CODES.INVALID_BUSINESS_NAME);
  }

  return repository.transaction(async (transaction) => {
    const actorId = await resolveOnboardingActor(transaction, actor);
    const business = await transaction.createBusiness({
      name,
      normalizedName,
      baseCurrencyKind: "standard",
      baseCurrencyCode: "GBP",
      baseCurrencyId: null,
      createdBy: actorId,
    });
    await transaction.provisionDefaultCategories(business.id);
    return business;
  });
}

export async function searchBusinesses(
  query: string,
  actor: OnboardingActor,
  repository: OnboardingRepository = defaultOnboardingRepository,
): Promise<BusinessSearchResult[]> {
  await resolveOnboardingActor(repository, actor);
  const normalizedQuery = normalizeBusinessName(typeof query === "string" ? query : "");
  if (!normalizedQuery) {
    throw new OnboardingError(ONBOARDING_ERROR_CODES.INVALID_SEARCH_QUERY);
  }
  return repository.searchBusinesses(normalizedQuery);
}

export function createOnboardingServices(repository: OnboardingRepository = defaultOnboardingRepository) {
  const joinRequestService = createJoinRequestService(repository);
  return {
    createBusiness: (input: CreateBusinessInput, actor: OnboardingActor) => createBusiness(input, actor, repository),
    createBusinessRequest: (input: CreateBusinessInput, actor: OnboardingActor) => createBusinessRequest(input, actor, repository),
    searchBusinesses: (query: string, actor: OnboardingActor) => searchBusinesses(query, actor, repository),
    ...joinRequestService,
  };
}

export type OnboardingServices = ReturnType<typeof createOnboardingServices>;

export { createTenantContext };
