import { randomUUID } from "node:crypto";
import { defaultOnboardingRepository, type OnboardingRepository } from "../tenancy/business-service";
import { BusinessLifecycleError, LIFECYCLE_ERROR_CODES, requireBusinessOperational } from "../tenancy/business-lifecycle-service";
import { AuthorizationError, requireCapability } from "../permissions/authorize";
import type { Capability } from "../permissions/capabilities";
import { createTenantContext } from "../tenancy/tenant-context";
import type { BusinessId, UserId } from "../tenancy/types";
import { resolveOnboardingActor, type OnboardingActor } from "../tenancy/business-service";

export const HEADING_GROUPS = ["income", "cost_of_sales", "expenses", "assets", "liabilities", "equity"] as const;
export type HeadingGroup = (typeof HEADING_GROUPS)[number];
export const HEADING_VALUE_TYPES = ["text", "number"] as const;
export type HeadingValueType = (typeof HEADING_VALUE_TYPES)[number];
export const TEMPLATE_BLOCKED_REASONS = ["blank_heading", "marked_do_not_use", "total_not_read", "total_read_twice", "truncated_formula"] as const;
export type TemplateBlockedReason = (typeof TEMPLATE_BLOCKED_REASONS)[number];
export type HeadingBlockedReason = TemplateBlockedReason | "missing_from_template";

/** Heading as produced by the template reader; accepted structurally. */
export interface TemplateHeadingInput {
  position: number;
  templateValue: string;
  valueType: HeadingValueType;
  group: HeadingGroup;
  order: number;
  blockedReason: TemplateBlockedReason | null;
}

export interface AccountHeading {
  id: string;
  businessId: BusinessId;
  position: number;
  templateValue: string;
  valueType: HeadingValueType;
  group: HeadingGroup;
  sortOrder: number;
  displayName: string;
  isActive: boolean;
  blockedReason: HeadingBlockedReason | null;
  createdAt: string;
  updatedAt: string;
}

export interface HeadingImportResult {
  inserted: number;
  updated: number;
  missing: number;
  headings: AccountHeading[];
}

export const HEADING_ERROR_CODES = {
  INVALID_HEADING: "INVALID_HEADING",
  INVALID_HEADING_IMPORT: "INVALID_HEADING_IMPORT",
  HEADING_NOT_FOUND: "HEADING_NOT_FOUND",
  HEADING_BLOCKED: "HEADING_BLOCKED",
  BUSINESS_ACCESS_DENIED: "BUSINESS_ACCESS_DENIED",
  INACTIVE_BUSINESS: "INACTIVE_BUSINESS",
  INSUFFICIENT_CAPABILITY: "INSUFFICIENT_CAPABILITY",
  HEADING_REPOSITORY_CONFLICT: "HEADING_REPOSITORY_CONFLICT",
} as const;

export type HeadingErrorCode = (typeof HEADING_ERROR_CODES)[keyof typeof HEADING_ERROR_CODES];

const messages: Record<HeadingErrorCode, string> = {
  INVALID_HEADING: "The heading details are invalid.",
  INVALID_HEADING_IMPORT: "The template headings are invalid.",
  HEADING_NOT_FOUND: "Heading not found.",
  HEADING_BLOCKED: "This heading is blocked by the template and cannot be used.",
  BUSINESS_ACCESS_DENIED: "Business access denied.",
  INACTIVE_BUSINESS: "This business is inactive.",
  INSUFFICIENT_CAPABILITY: "You do not have permission to manage headings.",
  HEADING_REPOSITORY_CONFLICT: "The heading changed elsewhere.",
};

export class HeadingError extends Error {
  readonly name = "HeadingError";

  constructor(readonly code: HeadingErrorCode) {
    super(messages[code]);
  }
}

export interface HeadingRepository {
  transaction<T>(operation: () => Promise<T>): Promise<T>;
  create(heading: AccountHeading): Promise<AccountHeading>;
  update(heading: AccountHeading, businessId: BusinessId): Promise<AccountHeading>;
  findById(id: string, businessId: BusinessId): Promise<AccountHeading | null>;
  /** Ordered by sort order, then position. */
  listByBusinessId(businessId: BusinessId): Promise<AccountHeading[]>;
}

export interface InMemoryHeadingRepository extends HeadingRepository {
  readonly headings: Map<string, AccountHeading>;
}

export function compareHeadings(left: AccountHeading, right: AccountHeading): number {
  return left.sortOrder - right.sortOrder || left.position - right.position;
}

class MemoryHeadingRepository implements InMemoryHeadingRepository {
  readonly headings = new Map<string, AccountHeading>();
  private tail: Promise<void> = Promise.resolve();

  async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise((resolve) => { release = resolve; });
    await previous;
    const snapshot = new Map([...this.headings].map(([id, heading]) => [id, { ...heading }]));
    try {
      return await operation();
    } catch (error) {
      this.headings.clear();
      snapshot.forEach((heading, id) => this.headings.set(id, heading));
      throw error;
    } finally {
      release();
    }
  }

  async create(heading: AccountHeading): Promise<AccountHeading> {
    const duplicate = [...this.headings.values()].some((stored) => stored.id === heading.id || (stored.businessId === heading.businessId && stored.position === heading.position));
    if (duplicate) throw new HeadingError(HEADING_ERROR_CODES.HEADING_REPOSITORY_CONFLICT);
    this.headings.set(heading.id, { ...heading });
    return { ...heading };
  }

  async update(heading: AccountHeading, businessId: BusinessId): Promise<AccountHeading> {
    if (heading.businessId !== businessId || this.headings.get(heading.id)?.businessId !== businessId) throw new HeadingError(HEADING_ERROR_CODES.HEADING_NOT_FOUND);
    this.headings.set(heading.id, { ...heading });
    return { ...heading };
  }

  async findById(id: string, businessId: BusinessId): Promise<AccountHeading | null> {
    const heading = this.headings.get(id);
    return heading?.businessId === businessId ? { ...heading } : null;
  }

  async listByBusinessId(businessId: BusinessId): Promise<AccountHeading[]> {
    return [...this.headings.values()].filter((heading) => heading.businessId === businessId).sort(compareHeadings).map((heading) => ({ ...heading }));
  }
}

export function createHeadingRepository(): InMemoryHeadingRepository {
  return new MemoryHeadingRepository();
}

const HEADING_REPOSITORY_KEY = Symbol.for("ledgerharbour.lh014.headingRepository");
type GlobalState = typeof globalThis & { [key: symbol]: unknown };

export function resolveDefaultHeadingRepository(): HeadingRepository {
  const state = globalThis as GlobalState;
  const existing = state[HEADING_REPOSITORY_KEY] as HeadingRepository | undefined;
  if (existing && typeof existing.findById === "function" && typeof existing.listByBusinessId === "function") return existing;
  const repository = createHeadingRepository();
  Object.defineProperty(state, HEADING_REPOSITORY_KEY, { configurable: false, enumerable: false, writable: false, value: repository });
  return repository;
}

export interface HeadingDependencies {
  tenancyRepository?: OnboardingRepository;
  headings?: HeadingRepository;
}

function mapBoundaryError(error: unknown): HeadingError {
  if (error instanceof HeadingError) return error;
  if (error instanceof BusinessLifecycleError && error.code === LIFECYCLE_ERROR_CODES.INACTIVE_BUSINESS) return new HeadingError(HEADING_ERROR_CODES.INACTIVE_BUSINESS);
  if (error instanceof BusinessLifecycleError) return new HeadingError(HEADING_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  if (error instanceof AuthorizationError) return new HeadingError(error.code === "CAPABILITY_REQUIRED" ? HEADING_ERROR_CODES.INSUFFICIENT_CAPABILITY : HEADING_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  return new HeadingError(HEADING_ERROR_CODES.HEADING_REPOSITORY_CONFLICT);
}

export async function requireHeadingCapability(businessId: BusinessId, actorId: UserId, repository: OnboardingRepository, capability: Capability): Promise<void> {
  try {
    await requireBusinessOperational(repository, businessId);
    const membership = await createTenantContext(repository).getMembership(actorId, businessId);
    requireCapability(membership!, capability);
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

function validateBusinessId(value: unknown): BusinessId {
  if (typeof value !== "string" || !value.trim()) throw new HeadingError(HEADING_ERROR_CODES.INVALID_HEADING);
  return value as BusinessId;
}

function defaultDisplayName(templateValue: string, position: number): string {
  return templateValue.trim().slice(0, 100) || `Heading ${position}`;
}

function isPlaceholder(input: TemplateHeadingInput): boolean {
  return input.valueType === "number" || /^\d{0,3}[a-z]?$/i.test(input.templateValue.trim());
}

export function validateHeadingImport(headings: unknown): TemplateHeadingInput[] {
  if (!Array.isArray(headings) || headings.length === 0) throw new HeadingError(HEADING_ERROR_CODES.INVALID_HEADING_IMPORT);
  const positions = new Set<number>();
  for (const heading of headings as TemplateHeadingInput[]) {
    const valid = typeof heading === "object" && heading !== null
      && Number.isInteger(heading.position) && heading.position > 0 && !positions.has(heading.position)
      && typeof heading.templateValue === "string"
      && HEADING_VALUE_TYPES.includes(heading.valueType)
      && HEADING_GROUPS.includes(heading.group)
      && Number.isInteger(heading.order)
      && (heading.blockedReason === null || TEMPLATE_BLOCKED_REASONS.includes(heading.blockedReason));
    if (!valid) throw new HeadingError(HEADING_ERROR_CODES.INVALID_HEADING_IMPORT);
    positions.add(heading.position);
  }
  return headings as TemplateHeadingInput[];
}

function validateDisplayName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 100) throw new HeadingError(HEADING_ERROR_CODES.INVALID_HEADING);
  return name;
}

function resolveDependencies(dependencies: HeadingDependencies) {
  return {
    tenancy: dependencies.tenancyRepository ?? defaultOnboardingRepository,
    headings: dependencies.headings ?? resolveDefaultHeadingRepository(),
  };
}

export async function listHeadings(businessId: BusinessId, actor: OnboardingActor, dependencies: HeadingDependencies = {}): Promise<AccountHeading[]> {
  const { tenancy, headings } = resolveDependencies(dependencies);
  const actorId = await resolveOnboardingActor(tenancy, actor);
  await requireHeadingCapability(validateBusinessId(businessId), actorId, tenancy, "read_finance");
  try {
    return await headings.listByBusinessId(businessId);
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

/**
 * Applies the template import rules (upsert by position, missing positions deactivated).
 * Callers run it inside a heading repository transaction and write their own audit event.
 */
export async function applyHeadingImport(headings: HeadingRepository, businessId: BusinessId, incoming: TemplateHeadingInput[], now: string): Promise<{ inserted: number; updated: number; missing: number }> {
  const stored = new Map((await headings.listByBusinessId(businessId)).map((heading) => [heading.position, heading]));
  let inserted = 0;
  let updated = 0;
  let missing = 0;
  for (const item of incoming) {
    const existing = stored.get(item.position);
    stored.delete(item.position);
    const fields = { templateValue: item.templateValue, valueType: item.valueType, group: item.group, sortOrder: item.order, blockedReason: item.blockedReason, updatedAt: now };
    if (!existing) {
      await headings.create({
        ...fields,
        id: randomUUID(),
        businessId,
        position: item.position,
        displayName: defaultDisplayName(item.templateValue, item.position),
        isActive: item.blockedReason === null && !isPlaceholder(item),
        createdAt: now,
      });
      inserted += 1;
      continue;
    }
    const customised = existing.displayName !== defaultDisplayName(existing.templateValue, existing.position);
    await headings.update({
      ...existing,
      ...fields,
      displayName: customised ? existing.displayName : defaultDisplayName(item.templateValue, item.position),
      isActive: item.blockedReason === null && existing.isActive,
    }, businessId);
    updated += 1;
  }
  for (const absent of stored.values()) {
    await headings.update({ ...absent, isActive: false, blockedReason: "missing_from_template", updatedAt: now }, businessId);
    missing += 1;
  }
  return { inserted, updated, missing };
}

export async function importHeadings(businessId: BusinessId, input: TemplateHeadingInput[], actor: OnboardingActor, dependencies: HeadingDependencies = {}): Promise<HeadingImportResult> {
  const { tenancy, headings } = resolveDependencies(dependencies);
  const actorId = await resolveOnboardingActor(tenancy, actor);
  validateBusinessId(businessId);
  const incoming = validateHeadingImport(input);
  await requireHeadingCapability(businessId, actorId, tenancy, "edit_finance");
  const now = new Date().toISOString();
  try {
    return await headings.transaction(async () => {
      const { inserted, updated, missing } = await applyHeadingImport(headings, businessId, incoming, now);
      await tenancy.transaction((transaction) => transaction.appendAuditEvent({ businessId, actorId, type: "account_heading_imported", entityId: businessId, metadata: { inserted, updated, missing } }));
      return { inserted, updated, missing, headings: await headings.listByBusinessId(businessId) };
    });
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

async function changeHeading(
  businessId: BusinessId,
  headingId: string,
  actor: OnboardingActor,
  dependencies: HeadingDependencies,
  change: (heading: AccountHeading) => { heading: AccountHeading; auditType: string },
): Promise<AccountHeading> {
  const { tenancy, headings } = resolveDependencies(dependencies);
  const actorId = await resolveOnboardingActor(tenancy, actor);
  await requireHeadingCapability(validateBusinessId(businessId), actorId, tenancy, "edit_finance");
  try {
    return await headings.transaction(async () => {
      const current = typeof headingId === "string" ? await headings.findById(headingId, businessId) : null;
      if (!current) throw new HeadingError(HEADING_ERROR_CODES.HEADING_NOT_FOUND);
      const { heading, auditType } = change(current);
      const saved = await headings.update({ ...heading, updatedAt: new Date().toISOString() }, businessId);
      await tenancy.transaction((transaction) => transaction.appendAuditEvent({ businessId, actorId, type: auditType, entityId: saved.id }));
      return saved;
    });
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

export async function renameHeading(businessId: BusinessId, headingId: string, displayName: string, actor: OnboardingActor, dependencies: HeadingDependencies = {}): Promise<AccountHeading> {
  const name = validateDisplayName(displayName);
  return changeHeading(businessId, headingId, actor, dependencies, (heading) => ({ heading: { ...heading, displayName: name }, auditType: "account_heading_renamed" }));
}

export async function setHeadingActive(businessId: BusinessId, headingId: string, isActive: boolean, actor: OnboardingActor, dependencies: HeadingDependencies = {}): Promise<AccountHeading> {
  if (typeof isActive !== "boolean") throw new HeadingError(HEADING_ERROR_CODES.INVALID_HEADING);
  return changeHeading(businessId, headingId, actor, dependencies, (heading) => {
    if (isActive && heading.blockedReason !== null) throw new HeadingError(HEADING_ERROR_CODES.HEADING_BLOCKED);
    return { heading: { ...heading, isActive }, auditType: isActive ? "account_heading_activated" : "account_heading_deactivated" };
  });
}
