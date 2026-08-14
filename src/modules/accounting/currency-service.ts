import { standardCurrencySeeds } from "../../db/seed/default-categories";
import { defaultOnboardingRepository, type OnboardingRepository } from "../tenancy/business-service";
import { BusinessLifecycleError, LIFECYCLE_ERROR_CODES, requireBusinessOperational } from "../tenancy/business-lifecycle-service";
import { AuthorizationError, requireCapability } from "../permissions/authorize";
import { createTenantContext } from "../tenancy/tenant-context";
import type { BusinessId, UserId } from "../tenancy/types";
import { resolveOnboardingActor, type OnboardingActor } from "../tenancy/business-service";
import type { InvoiceRepository } from "../invoices/invoice-service";

export const CURRENCY_ERROR_CODES = {
  INVALID_CURRENCY: "INVALID_CURRENCY",
  CURRENCY_NAME_CONFLICT: "CURRENCY_NAME_CONFLICT",
  CURRENCY_NOT_FOUND: "CURRENCY_NOT_FOUND",
  CURRENCY_REFERENCED: "CURRENCY_REFERENCED",
  BUSINESS_ACCESS_DENIED: "BUSINESS_ACCESS_DENIED",
  INACTIVE_BUSINESS: "INACTIVE_BUSINESS",
  INSUFFICIENT_CAPABILITY: "INSUFFICIENT_CAPABILITY",
  CURRENCY_REPOSITORY_CONFLICT: "CURRENCY_REPOSITORY_CONFLICT",
} as const;

export type CurrencyErrorCode = (typeof CURRENCY_ERROR_CODES)[keyof typeof CURRENCY_ERROR_CODES];

const messages: Record<CurrencyErrorCode, string> = {
  INVALID_CURRENCY: "The currency details are invalid.",
  CURRENCY_NAME_CONFLICT: "A currency with those details already exists.",
  CURRENCY_NOT_FOUND: "Currency not found.",
  CURRENCY_REFERENCED: "This currency is referenced by an invoice.",
  BUSINESS_ACCESS_DENIED: "Business access denied.",
  INACTIVE_BUSINESS: "This business is inactive.",
  INSUFFICIENT_CAPABILITY: "You do not have permission to manage currencies.",
  CURRENCY_REPOSITORY_CONFLICT: "The currency changed elsewhere.",
};

export class CurrencyError extends Error {
  readonly name = "CurrencyError";

  constructor(readonly code: CurrencyErrorCode) {
    super(messages[code]);
  }
}

export interface BusinessCurrency {
  id: string;
  businessId: BusinessId;
  name: string;
  symbol: string;
  isoCode: string | null;
  decimalCount: number;
  isStandard: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SetCurrencyInput {
  businessId: BusinessId;
  name: string;
  symbol: string;
  decimalCount: number;
  isoCode?: string | null;
  isStandard?: boolean;
}

export interface CurrencyRepository {
  transaction<T>(operation: () => Promise<T>): Promise<T>;
  create(currency: BusinessCurrency): Promise<BusinessCurrency>;
  update(currency: BusinessCurrency, businessId: BusinessId): Promise<BusinessCurrency>;
  findById(id: string, businessId: BusinessId): Promise<BusinessCurrency | null>;
  listByBusinessId(businessId: BusinessId): Promise<BusinessCurrency[]>;
  delete(id: string, businessId: BusinessId): Promise<void>;
}

export interface InMemoryCurrencyRepository extends CurrencyRepository {
  readonly currencies: Map<string, BusinessCurrency>;
}

class MemoryCurrencyRepository implements InMemoryCurrencyRepository {
  readonly currencies = new Map<string, BusinessCurrency>();
  private tail: Promise<void> = Promise.resolve();

  async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise((resolve) => { release = resolve; });
    await previous;
    const snapshot = new Map([...this.currencies].map(([id, currency]) => [id, { ...currency }]));
    try {
      return await operation();
    } catch (error) {
      this.currencies.clear();
      snapshot.forEach((currency, id) => this.currencies.set(id, currency));
      throw error;
    } finally {
      release();
    }
  }

  async create(currency: BusinessCurrency): Promise<BusinessCurrency> {
    if (this.currencies.has(currency.id)) throw new CurrencyError(CURRENCY_ERROR_CODES.CURRENCY_REPOSITORY_CONFLICT);
    this.currencies.set(currency.id, { ...currency });
    return { ...currency };
  }

  async update(currency: BusinessCurrency, businessId: BusinessId): Promise<BusinessCurrency> {
    if (currency.businessId !== businessId || this.currencies.get(currency.id)?.businessId !== businessId) throw new CurrencyError(CURRENCY_ERROR_CODES.CURRENCY_NOT_FOUND);
    this.currencies.set(currency.id, { ...currency });
    return { ...currency };
  }

  async findById(id: string, businessId: BusinessId): Promise<BusinessCurrency | null> {
    const currency = this.currencies.get(id);
    return currency?.businessId === businessId ? { ...currency } : null;
  }

  async listByBusinessId(businessId: BusinessId): Promise<BusinessCurrency[]> {
    return [...this.currencies.values()].filter((currency) => currency.businessId === businessId).map((currency) => ({ ...currency }));
  }

  async delete(id: string, businessId: BusinessId): Promise<void> {
    if (this.currencies.get(id)?.businessId === businessId) this.currencies.delete(id);
  }
}

export function createCurrencyRepository(): InMemoryCurrencyRepository {
  return new MemoryCurrencyRepository();
}

const CURRENCY_REPOSITORY_KEY = Symbol.for("ledgerharbour.task9.currencyRepository");
type GlobalState = typeof globalThis & { [key: symbol]: unknown };

export function resolveDefaultCurrencyRepository(): CurrencyRepository {
  const state = globalThis as GlobalState;
  const existing = state[CURRENCY_REPOSITORY_KEY] as CurrencyRepository | undefined;
  if (existing && typeof existing.findById === "function" && typeof existing.listByBusinessId === "function" && typeof existing.delete === "function") return existing;
  const repository = createCurrencyRepository();
  Object.defineProperty(state, CURRENCY_REPOSITORY_KEY, { configurable: false, enumerable: false, writable: false, value: repository });
  return repository;
}

export interface CurrencyDependencies {
  tenancyRepository?: OnboardingRepository;
  currencies?: CurrencyRepository;
  invoices?: InvoiceRepository;
}

function mapBoundaryError(error: unknown): CurrencyError {
  if (error instanceof CurrencyError) return error;
  if (error instanceof BusinessLifecycleError && error.code === LIFECYCLE_ERROR_CODES.INACTIVE_BUSINESS) return new CurrencyError(CURRENCY_ERROR_CODES.INACTIVE_BUSINESS);
  if (error instanceof BusinessLifecycleError) return new CurrencyError(CURRENCY_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  if (error instanceof AuthorizationError) return new CurrencyError(error.code === "CAPABILITY_REQUIRED" ? CURRENCY_ERROR_CODES.INSUFFICIENT_CAPABILITY : CURRENCY_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  return new CurrencyError(CURRENCY_ERROR_CODES.CURRENCY_REPOSITORY_CONFLICT);
}

async function requireCurrencyAdmin(businessId: BusinessId, actorId: UserId, repository: OnboardingRepository): Promise<void> {
  try {
    await requireBusinessOperational(repository, businessId);
    const membership = await createTenantContext(repository).getMembership(actorId, businessId);
    requireCapability(membership!, "edit_finance");
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

function normalizeCurrency(input: SetCurrencyInput): Omit<BusinessCurrency, "id" | "businessId" | "createdAt" | "updatedAt"> {
  if (input?.isStandard === true) throw new CurrencyError(CURRENCY_ERROR_CODES.INVALID_CURRENCY);
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const symbol = typeof input?.symbol === "string" ? input.symbol.trim() : "";
  const isoCode = input?.isoCode == null ? null : typeof input.isoCode === "string" ? input.isoCode.trim().toUpperCase() : "";
  if (!name || name.length > 100 || !symbol || symbol.length > 20 || (isoCode !== null && (!/^[A-Z]{3}$/.test(isoCode) || isoCode.length > 3)) || !Number.isInteger(input?.decimalCount) || input.decimalCount < 0 || input.decimalCount > 6) {
    throw new CurrencyError(CURRENCY_ERROR_CODES.INVALID_CURRENCY);
  }
  return { name, symbol, isoCode, decimalCount: input.decimalCount, isStandard: false, isActive: true };
}

function validateBusinessId(value: unknown): BusinessId {
  if (typeof value !== "string" || !value.trim()) throw new CurrencyError(CURRENCY_ERROR_CODES.INVALID_CURRENCY);
  return value as BusinessId;
}

async function conflict(repository: CurrencyRepository, businessId: BusinessId, value: ReturnType<typeof normalizeCurrency>): Promise<boolean> {
  return (await repository.listByBusinessId(businessId)).some((currency) => (value.isoCode && currency.isoCode === value.isoCode) || currency.name.toLocaleLowerCase("en-US") === value.name.toLocaleLowerCase("en-US"));
}

export async function setCurrency(input: SetCurrencyInput, actor: OnboardingActor, dependencies: CurrencyDependencies = {}): Promise<BusinessCurrency> {
  const tenancy = dependencies.tenancyRepository ?? defaultOnboardingRepository;
   const repository = dependencies.currencies ?? resolveDefaultCurrencyRepository();
  const actorId = await resolveOnboardingActor(tenancy, actor);
  const businessId = validateBusinessId(input?.businessId);
  const value = normalizeCurrency(input);
  await requireCurrencyAdmin(businessId, actorId, tenancy);
  const now = new Date().toISOString();
  try {
    return await repository.transaction(async () => {
       if (await conflict(repository, businessId, value)) throw new CurrencyError(CURRENCY_ERROR_CODES.CURRENCY_NAME_CONFLICT);
      return repository.create({ ...value, id: randomUUID(), businessId, createdAt: now, updatedAt: now });
    });
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

export async function listCurrencies(businessId: BusinessId, actor: OnboardingActor, dependencies: CurrencyDependencies = {}): Promise<BusinessCurrency[]> {
  const tenancy = dependencies.tenancyRepository ?? defaultOnboardingRepository;
   const repository = dependencies.currencies ?? resolveDefaultCurrencyRepository();
  const actorId = await resolveOnboardingActor(tenancy, actor);
  try {
    await requireBusinessOperational(tenancy, businessId);
    const membership = await createTenantContext(tenancy).getMembership(actorId, businessId);
    requireCapability(membership!, "read_finance");
    return await repository.transaction(async () => {
       const existing = await repository.listByBusinessId(businessId);
      for (const seed of standardCurrencySeeds) {
        if (!existing.some((currency) => currency.isoCode === seed.isoCode)) {
          await repository.create({ ...seed, id: `currency-${businessId}-${seed.isoCode}`, businessId, isoCode: seed.isoCode, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        }
      }
       return repository.listByBusinessId(businessId);
    });
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

export async function deactivateCurrency(businessId: BusinessId, currencyId: string, actor: OnboardingActor, dependencies: CurrencyDependencies = {}): Promise<BusinessCurrency> {
  const tenancy = dependencies.tenancyRepository ?? defaultOnboardingRepository;
   const repository = dependencies.currencies ?? resolveDefaultCurrencyRepository();
  const actorId = await resolveOnboardingActor(tenancy, actor);
  await requireCurrencyAdmin(businessId, actorId, tenancy);
  const currency = await repository.findById(currencyId, businessId);
  if (!currency || currency.businessId !== businessId) throw new CurrencyError(CURRENCY_ERROR_CODES.CURRENCY_NOT_FOUND);
  try {
    return await repository.update({ ...currency, isActive: false, updatedAt: new Date().toISOString() }, businessId);
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

async function isCurrencyReferenced(currency: BusinessCurrency, invoices: InvoiceRepository | undefined): Promise<boolean> {
  if (!invoices) return false;
  for (const reference of [currency.id, currency.isoCode, currency.name]) {
    if (reference && await invoices.hasCurrencyReference(currency.businessId, reference)) return true;
  }
  return false;
}

export async function removeCurrency(businessId: BusinessId, currencyId: string, actorId: UserId, dependencies: CurrencyDependencies = {}): Promise<void> {
  const tenancy = dependencies.tenancyRepository ?? defaultOnboardingRepository;
   const repository = dependencies.currencies ?? resolveDefaultCurrencyRepository();
  await requireCurrencyAdmin(businessId, actorId, tenancy);
  const currency = await repository.findById(currencyId, businessId);
  if (!currency || currency.businessId !== businessId) throw new CurrencyError(CURRENCY_ERROR_CODES.CURRENCY_NOT_FOUND);
   if (await isCurrencyReferenced(currency, dependencies.invoices)) throw new CurrencyError(CURRENCY_ERROR_CODES.CURRENCY_REFERENCED);
    await repository.delete(currencyId, businessId);
}
import { randomUUID } from "node:crypto";
