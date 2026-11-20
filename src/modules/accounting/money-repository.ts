import type { BusinessId, UserId } from "../tenancy/types";

export const FINANCIAL_YEAR_STATUSES = ["open", "closed"] as const;
export type FinancialYearStatus = (typeof FINANCIAL_YEAR_STATUSES)[number];
export const MONEY_ACCOUNT_KINDS = ["bank", "cash"] as const;
export type MoneyAccountKind = (typeof MONEY_ACCOUNT_KINDS)[number];
export const MOVEMENT_ORIGINS = ["invoice", "manual", "statement"] as const;
export type MovementOrigin = (typeof MOVEMENT_ORIGINS)[number];

/** Dates are ISO calendar dates ("2026-04-06"); amounts are decimal strings ("-12.30"). */
export interface FinancialYear {
  id: string;
  businessId: BusinessId;
  startDate: string;
  endDate: string;
  status: FinancialYearStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MoneyAccount {
  id: string;
  businessId: BusinessId;
  name: string;
  kind: MoneyAccountKind;
  sheetName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Movement {
  id: string;
  businessId: BusinessId;
  financialYearId: string;
  moneyAccountId: string;
  movementDate: string;
  narrative: string;
  headingId: string | null;
  amount: string;
  origin: MovementOrigin;
  sourceInvoiceId: string | null;
  sourceRef: string | null;
  transferGroupId: string | null;
  deletedAt: string | null;
  createdBy: UserId;
  createdAt: string;
  updatedAt: string;
}

export const MONEY_ERROR_CODES = {
  INVALID_FINANCIAL_YEAR: "INVALID_FINANCIAL_YEAR",
  FINANCIAL_YEAR_NOT_FOUND: "FINANCIAL_YEAR_NOT_FOUND",
  FINANCIAL_YEAR_OVERLAP: "FINANCIAL_YEAR_OVERLAP",
  FINANCIAL_YEAR_ALREADY_OPEN: "FINANCIAL_YEAR_ALREADY_OPEN",
  FINANCIAL_YEAR_HAS_MOVEMENTS: "FINANCIAL_YEAR_HAS_MOVEMENTS",
  FINANCIAL_YEAR_CLOSED: "FINANCIAL_YEAR_CLOSED",
  INVALID_MONEY_ACCOUNT: "INVALID_MONEY_ACCOUNT",
  MONEY_ACCOUNT_NOT_FOUND: "MONEY_ACCOUNT_NOT_FOUND",
  MONEY_ACCOUNT_INACTIVE: "MONEY_ACCOUNT_INACTIVE",
  MONEY_ACCOUNT_NAME_TAKEN: "MONEY_ACCOUNT_NAME_TAKEN",
  TEMPLATE_REQUIRED: "TEMPLATE_REQUIRED",
  UNKNOWN_TEMPLATE_SHEET: "UNKNOWN_TEMPLATE_SHEET",
  SHEET_ALREADY_USED: "SHEET_ALREADY_USED",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  INVALID_MOVEMENT: "INVALID_MOVEMENT",
  MOVEMENT_NOT_FOUND: "MOVEMENT_NOT_FOUND",
  MOVEMENT_OUTSIDE_OPEN_YEAR: "MOVEMENT_OUTSIDE_OPEN_YEAR",
  MOVEMENT_ORIGIN_NOT_EDITABLE: "MOVEMENT_ORIGIN_NOT_EDITABLE",
  HEADING_NOT_FOUND: "HEADING_NOT_FOUND",
  HEADING_NOT_USABLE: "HEADING_NOT_USABLE",
  BUSINESS_ACCESS_DENIED: "BUSINESS_ACCESS_DENIED",
  INACTIVE_BUSINESS: "INACTIVE_BUSINESS",
  INSUFFICIENT_CAPABILITY: "INSUFFICIENT_CAPABILITY",
  MONEY_REPOSITORY_CONFLICT: "MONEY_REPOSITORY_CONFLICT",
} as const;

export type MoneyErrorCode = (typeof MONEY_ERROR_CODES)[keyof typeof MONEY_ERROR_CODES];

const messages: Record<MoneyErrorCode, string> = {
  INVALID_FINANCIAL_YEAR: "The financial year dates are invalid.",
  FINANCIAL_YEAR_NOT_FOUND: "Financial year not found.",
  FINANCIAL_YEAR_OVERLAP: "The financial year overlaps another year.",
  FINANCIAL_YEAR_ALREADY_OPEN: "Another financial year is already open.",
  FINANCIAL_YEAR_HAS_MOVEMENTS: "The financial year already has movements.",
  FINANCIAL_YEAR_CLOSED: "The financial year is closed.",
  INVALID_MONEY_ACCOUNT: "The money account details are invalid.",
  MONEY_ACCOUNT_NOT_FOUND: "Money account not found.",
  MONEY_ACCOUNT_INACTIVE: "The money account is inactive.",
  MONEY_ACCOUNT_NAME_TAKEN: "Another active money account has this name.",
  TEMPLATE_REQUIRED: "Import the accounts template first.",
  UNKNOWN_TEMPLATE_SHEET: "The sheet is not an account sheet of the template.",
  SHEET_ALREADY_USED: "Another active money account uses this sheet.",
  INVALID_AMOUNT: "The amount must be pounds with at most two decimals.",
  INVALID_MOVEMENT: "The movement details are invalid.",
  MOVEMENT_NOT_FOUND: "Movement not found.",
  MOVEMENT_OUTSIDE_OPEN_YEAR: "The date is outside the open financial year.",
  MOVEMENT_ORIGIN_NOT_EDITABLE: "This movement is managed by its source and cannot be changed here.",
  HEADING_NOT_FOUND: "Heading not found.",
  HEADING_NOT_USABLE: "This heading is inactive or blocked.",
  BUSINESS_ACCESS_DENIED: "Business access denied.",
  INACTIVE_BUSINESS: "This business is inactive.",
  INSUFFICIENT_CAPABILITY: "You do not have permission to manage money accounts.",
  MONEY_REPOSITORY_CONFLICT: "The accounts changed elsewhere.",
};

export class MoneyError extends Error {
  readonly name = "MoneyError";

  constructor(readonly code: MoneyErrorCode) {
    super(messages[code]);
  }
}

export interface MoneyRepository {
  transaction<T>(operation: () => Promise<T>): Promise<T>;
  /** Inside a transaction: holds the business's years until it ends, so year checks and writes cannot interleave. */
  lockYears(businessId: BusinessId): Promise<void>;
  createYear(year: FinancialYear): Promise<FinancialYear>;
  updateYear(year: FinancialYear, businessId: BusinessId): Promise<FinancialYear>;
  findYear(id: string, businessId: BusinessId): Promise<FinancialYear | null>;
  /** Ordered by start date. */
  listYears(businessId: BusinessId): Promise<FinancialYear[]>;
  createAccount(account: MoneyAccount): Promise<MoneyAccount>;
  updateAccount(account: MoneyAccount, businessId: BusinessId): Promise<MoneyAccount>;
  findAccount(id: string, businessId: BusinessId): Promise<MoneyAccount | null>;
  /** Ordered by name, then id. */
  listAccounts(businessId: BusinessId): Promise<MoneyAccount[]>;
  setOpening(businessId: BusinessId, accountId: string, yearId: string, amount: string): Promise<void>;
  /** Opening balances of the year by account id; a missing account means 0.00. */
  listOpenings(businessId: BusinessId, yearId: string): Promise<Map<string, string>>;
  createMovement(movement: Movement): Promise<Movement>;
  updateMovement(movement: Movement, businessId: BusinessId): Promise<Movement>;
  /** Live or soft-deleted. */
  findMovement(id: string, businessId: BusinessId): Promise<Movement | null>;
  /** Live movements by date, then creation order. */
  listMovements(businessId: BusinessId, yearId: string, accountId?: string): Promise<Movement[]>;
  /** Live movements of one invoice, in creation order. */
  listInvoiceMovements(businessId: BusinessId, invoiceId: string): Promise<Movement[]>;
}

export interface InMemoryMoneyRepository extends MoneyRepository {
  readonly years: Map<string, FinancialYear>;
  readonly accounts: Map<string, MoneyAccount>;
  readonly openings: Map<string, string>;
  readonly movements: Map<string, Movement>;
}

const conflict = () => new MoneyError(MONEY_ERROR_CODES.MONEY_REPOSITORY_CONFLICT);
const openingKey = (businessId: string, accountId: string, yearId: string) => JSON.stringify([businessId, accountId, yearId]);

class MemoryMoneyRepository implements InMemoryMoneyRepository {
  readonly years = new Map<string, FinancialYear>();
  readonly accounts = new Map<string, MoneyAccount>();
  readonly openings = new Map<string, string>();
  readonly movements = new Map<string, Movement>();
  /** Insertion order of movements: the memory twin of the `created_seq` identity column. */
  private readonly sequence = new Map<string, number>();
  private tail: Promise<void> = Promise.resolve();

  async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise((resolve) => { release = resolve; });
    await previous;
    const snapshot = structuredClone({ years: this.years, accounts: this.accounts, openings: this.openings, movements: this.movements, sequence: this.sequence });
    try {
      return await operation();
    } catch (error) {
      for (const key of ["years", "accounts", "openings", "movements", "sequence"] as const) {
        const target = this[key] as Map<string, unknown>;
        target.clear();
        snapshot[key].forEach((value, id) => target.set(id, value));
      }
      throw error;
    } finally {
      release();
    }
  }

  /** Nothing to take: transactions of the memory twin already run one at a time. */
  async lockYears(): Promise<void> {}

  private assertYearConstraints(year: FinancialYear): void {
    if (year.endDate <= year.startDate) throw conflict();
    for (const stored of this.years.values()) {
      if (stored.id === year.id || stored.businessId !== year.businessId) continue;
      if (stored.startDate === year.startDate || (stored.status === "open" && year.status === "open")) throw conflict();
    }
  }

  async createYear(year: FinancialYear): Promise<FinancialYear> {
    if (this.years.has(year.id)) throw conflict();
    this.assertYearConstraints(year);
    this.years.set(year.id, { ...year });
    return { ...year };
  }

  async updateYear(year: FinancialYear, businessId: BusinessId): Promise<FinancialYear> {
    if (year.businessId !== businessId || this.years.get(year.id)?.businessId !== businessId) throw new MoneyError(MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND);
    this.assertYearConstraints(year);
    this.years.set(year.id, { ...year });
    return { ...year };
  }

  async findYear(id: string, businessId: BusinessId): Promise<FinancialYear | null> {
    const year = this.years.get(id);
    return year?.businessId === businessId ? { ...year } : null;
  }

  async listYears(businessId: BusinessId): Promise<FinancialYear[]> {
    return [...this.years.values()].filter((year) => year.businessId === businessId).sort((left, right) => left.startDate.localeCompare(right.startDate)).map((year) => ({ ...year }));
  }

  private assertAccountConstraints(account: MoneyAccount): void {
    if (!account.isActive) return;
    for (const stored of this.accounts.values()) {
      if (stored.id === account.id || stored.businessId !== account.businessId || !stored.isActive) continue;
      if (stored.name.toLowerCase() === account.name.toLowerCase() || stored.sheetName === account.sheetName) throw conflict();
    }
  }

  async createAccount(account: MoneyAccount): Promise<MoneyAccount> {
    if (this.accounts.has(account.id)) throw conflict();
    this.assertAccountConstraints(account);
    this.accounts.set(account.id, { ...account });
    return { ...account };
  }

  async updateAccount(account: MoneyAccount, businessId: BusinessId): Promise<MoneyAccount> {
    if (account.businessId !== businessId || this.accounts.get(account.id)?.businessId !== businessId) throw new MoneyError(MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND);
    this.assertAccountConstraints(account);
    this.accounts.set(account.id, { ...account });
    return { ...account };
  }

  async findAccount(id: string, businessId: BusinessId): Promise<MoneyAccount | null> {
    const account = this.accounts.get(id);
    return account?.businessId === businessId ? { ...account } : null;
  }

  async listAccounts(businessId: BusinessId): Promise<MoneyAccount[]> {
    return [...this.accounts.values()]
      .filter((account) => account.businessId === businessId)
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .map((account) => ({ ...account }));
  }

  async setOpening(businessId: BusinessId, accountId: string, yearId: string, amount: string): Promise<void> {
    if (this.accounts.get(accountId)?.businessId !== businessId || this.years.get(yearId)?.businessId !== businessId) throw conflict();
    this.openings.set(openingKey(businessId, accountId, yearId), amount);
  }

  async listOpenings(businessId: BusinessId, yearId: string): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const [key, amount] of this.openings) {
      const [business, account, year] = JSON.parse(key) as string[];
      if (business === businessId && year === yearId) result.set(account, amount);
    }
    return result;
  }

  private assertMovementReferences(movement: Movement): void {
    const sameTenant = (stored: { businessId: string } | undefined) => stored?.businessId === movement.businessId;
    if (!sameTenant(this.years.get(movement.financialYearId)) || !sameTenant(this.accounts.get(movement.moneyAccountId))) throw conflict();
    if (movement.amount === "0.00" || (movement.headingId === null && movement.origin !== "statement") || (movement.origin === "invoice") !== (movement.sourceInvoiceId !== null)) throw conflict();
  }

  async createMovement(movement: Movement): Promise<Movement> {
    if (this.movements.has(movement.id)) throw conflict();
    this.assertMovementReferences(movement);
    this.movements.set(movement.id, { ...movement });
    this.sequence.set(movement.id, this.sequence.size + 1);
    return { ...movement };
  }

  async updateMovement(movement: Movement, businessId: BusinessId): Promise<Movement> {
    if (movement.businessId !== businessId || this.movements.get(movement.id)?.businessId !== businessId) throw new MoneyError(MONEY_ERROR_CODES.MOVEMENT_NOT_FOUND);
    this.assertMovementReferences(movement);
    this.movements.set(movement.id, { ...movement });
    return { ...movement };
  }

  async findMovement(id: string, businessId: BusinessId): Promise<Movement | null> {
    const movement = this.movements.get(id);
    return movement?.businessId === businessId ? { ...movement } : null;
  }

  private live(filter: (movement: Movement) => boolean): Movement[] {
    return [...this.movements.values()]
      .filter((movement) => movement.deletedAt === null && filter(movement))
      .sort((left, right) => left.movementDate.localeCompare(right.movementDate) || this.sequence.get(left.id)! - this.sequence.get(right.id)!)
      .map((movement) => ({ ...movement }));
  }

  async listMovements(businessId: BusinessId, yearId: string, accountId?: string): Promise<Movement[]> {
    return this.live((movement) => movement.businessId === businessId && movement.financialYearId === yearId && (accountId === undefined || movement.moneyAccountId === accountId));
  }

  async listInvoiceMovements(businessId: BusinessId, invoiceId: string): Promise<Movement[]> {
    return this.live((movement) => movement.businessId === businessId && movement.sourceInvoiceId === invoiceId)
      .sort((left, right) => this.sequence.get(left.id)! - this.sequence.get(right.id)!);
  }
}

export function createMoneyRepository(): InMemoryMoneyRepository {
  return new MemoryMoneyRepository();
}

const MONEY_REPOSITORY_KEY = Symbol.for("ledgerharbour.lh015.moneyRepository");
type GlobalState = typeof globalThis & { [key: symbol]: unknown };

export function resolveDefaultMoneyRepository(): MoneyRepository {
  const state = globalThis as GlobalState;
  const existing = state[MONEY_REPOSITORY_KEY] as MoneyRepository | undefined;
  if (existing && typeof existing.findYear === "function" && typeof existing.listMovements === "function") return existing;
  const repository = createMoneyRepository();
  Object.defineProperty(state, MONEY_REPOSITORY_KEY, { configurable: false, enumerable: false, writable: false, value: repository });
  return repository;
}
