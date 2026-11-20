import { randomUUID } from "node:crypto";

import { defaultOnboardingRepository, resolveOnboardingActor, type OnboardingActor, type OnboardingRepository } from "../tenancy/business-service";
import type { BusinessId, UserId } from "../tenancy/types";
import { HeadingError, requireHeadingCapability, resolveDefaultHeadingRepository, type HeadingRepository } from "./heading-service";
import { formatPence, parsePounds } from "./money";
import {
  MONEY_ACCOUNT_KINDS,
  MONEY_ERROR_CODES,
  MOVEMENT_ORIGINS,
  MoneyError,
  resolveDefaultMoneyRepository,
  type FinancialYear,
  type MoneyAccount,
  type MoneyAccountKind,
  type MoneyRepository,
  type Movement,
  type MovementOrigin,
} from "./money-repository";
import { TemplateError, getTemplate, resolveDefaultTemplateRepository, type TemplateRepository } from "./template-service";

export interface MoneyDependencies {
  tenancyRepository?: OnboardingRepository;
  money?: MoneyRepository;
  headings?: HeadingRepository;
  templates?: TemplateRepository;
}

export interface MoneyAccountWithOpening extends MoneyAccount {
  /** Opening balance of the requested year; null when no year was asked for. */
  openingBalance: string | null;
}

export interface ManualMovementInput {
  accountId: string;
  date: string;
  narrative: string;
  headingId: string;
  amount: string;
  origin?: MovementOrigin;
}

export type MovementChanges = Partial<Omit<ManualMovementInput, "origin">>;

/** A row written by a later task (invoice approval, statement import, transfers). */
export interface InternalMovementInput {
  accountId: string;
  date: string;
  narrative: string;
  headingId: string | null;
  amount: string;
  origin: MovementOrigin;
  sourceInvoiceId?: string | null;
  sourceRef?: string | null;
  transferGroupId?: string | null;
}

/** Repositories already scoped to the caller's transaction, plus the authorized actor. */
export interface MovementWriteContext {
  businessId: BusinessId;
  actorId: UserId;
  tenancy: OnboardingRepository;
  money: MoneyRepository;
  headings: HeadingRepository;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function mapBoundaryError(error: unknown): MoneyError {
  if (error instanceof MoneyError) return error;
  if ((error instanceof HeadingError || error instanceof TemplateError) && error.code in MONEY_ERROR_CODES) return new MoneyError(error.code as MoneyError["code"]);
  return new MoneyError(MONEY_ERROR_CODES.MONEY_REPOSITORY_CONFLICT);
}

function resolveDependencies(dependencies: MoneyDependencies) {
  return {
    tenancy: dependencies.tenancyRepository ?? defaultOnboardingRepository,
    money: dependencies.money ?? resolveDefaultMoneyRepository(),
    headings: dependencies.headings ?? resolveDefaultHeadingRepository(),
    templates: dependencies.templates ?? resolveDefaultTemplateRepository(),
  };
}

async function authorize(businessId: unknown, actor: OnboardingActor, dependencies: MoneyDependencies, capability: "read_finance" | "edit_finance") {
  const resolved = resolveDependencies(dependencies);
  const actorId = await resolveOnboardingActor(resolved.tenancy, actor);
  if (typeof businessId !== "string" || !businessId.trim()) throw new MoneyError(MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  try {
    await requireHeadingCapability(businessId as BusinessId, actorId, resolved.tenancy, capability);
  } catch (error) {
    throw mapBoundaryError(error);
  }
  return { ...resolved, businessId: businessId as BusinessId, actorId };
}

/** Runs a write in one money transaction, appending the audit event inside it. */
async function write<T>(
  context: Awaited<ReturnType<typeof authorize>>,
  operation: () => Promise<{ result: T; audit: { type: string; entityId: string; metadata?: Record<string, unknown> }[] }>,
): Promise<T> {
  try {
    return await context.money.transaction(async () => {
      const { result, audit } = await operation();
      for (const event of audit) await appendAudit(context, event);
      return result;
    });
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

async function appendAudit(context: { tenancy: OnboardingRepository; businessId: BusinessId; actorId: UserId }, event: { type: string; entityId: string; metadata?: Record<string, unknown> }) {
  await context.tenancy.transaction((transaction) => transaction.appendAuditEvent({ businessId: context.businessId, actorId: context.actorId, ...event }));
}

async function read<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

function isoDate(value: unknown, code: MoneyError["code"]): string {
  const match = typeof value === "string" ? ISO_DATE.exec(value) : null;
  if (!match) throw new MoneyError(code);
  const [year, month, day] = match.slice(1).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new MoneyError(code);
  return value as string;
}

function amount(value: unknown, allowZero: boolean): string {
  let pence: number;
  try {
    pence = parsePounds(value as string);
  } catch {
    throw new MoneyError(MONEY_ERROR_CODES.INVALID_AMOUNT);
  }
  if (!allowZero && pence === 0) throw new MoneyError(MONEY_ERROR_CODES.INVALID_AMOUNT);
  return formatPence(pence);
}

function text(value: unknown, max: number, code: MoneyError["code"]): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.length > max) throw new MoneyError(code);
  return trimmed;
}

function id(value: unknown, code: MoneyError["code"]): string {
  if (typeof value !== "string" || !value) throw new MoneyError(code);
  return value;
}

const overlaps = (left: { startDate: string; endDate: string }, right: { startDate: string; endDate: string }) => left.startDate <= right.endDate && right.startDate <= left.endDate;

// ---------------------------------------------------------------- financial years

export async function listFinancialYears(businessId: BusinessId, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<FinancialYear[]> {
  const context = await authorize(businessId, actor, dependencies, "read_finance");
  return read(() => context.money.listYears(context.businessId));
}

function validateYearDates(startDate: unknown, endDate: unknown) {
  const start = isoDate(startDate, MONEY_ERROR_CODES.INVALID_FINANCIAL_YEAR);
  const end = isoDate(endDate, MONEY_ERROR_CODES.INVALID_FINANCIAL_YEAR);
  if (end <= start) throw new MoneyError(MONEY_ERROR_CODES.INVALID_FINANCIAL_YEAR);
  return { startDate: start, endDate: end };
}

async function assertNoOverlap(money: MoneyRepository, year: FinancialYear) {
  const others = (await money.listYears(year.businessId)).filter((stored) => stored.id !== year.id);
  if (others.some((stored) => overlaps(stored, year))) throw new MoneyError(MONEY_ERROR_CODES.FINANCIAL_YEAR_OVERLAP);
  if (year.status === "open" && others.some((stored) => stored.status === "open")) throw new MoneyError(MONEY_ERROR_CODES.FINANCIAL_YEAR_ALREADY_OPEN);
}

export async function createFinancialYear(businessId: BusinessId, input: { startDate: string; endDate: string }, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<FinancialYear> {
  const context = await authorize(businessId, actor, dependencies, "edit_finance");
  const dates = validateYearDates(input?.startDate, input?.endDate);
  const now = new Date().toISOString();
  const year: FinancialYear = { id: randomUUID(), businessId: context.businessId, ...dates, status: "open", createdAt: now, updatedAt: now };
  return write(context, async () => {
    await assertNoOverlap(context.money, year);
    const saved = await context.money.createYear(year);
    return { result: saved, audit: [{ type: "financial_year_created", entityId: saved.id }] };
  });
}

async function changeYear(
  businessId: BusinessId,
  yearId: string,
  actor: OnboardingActor,
  dependencies: MoneyDependencies,
  change: (year: FinancialYear, money: MoneyRepository) => Promise<{ year: FinancialYear; auditType: string } | null>,
): Promise<FinancialYear> {
  const context = await authorize(businessId, actor, dependencies, "edit_finance");
  return write(context, async () => {
    const current = typeof yearId === "string" ? await context.money.findYear(yearId, context.businessId) : null;
    if (!current) throw new MoneyError(MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND);
    const changed = await change(current, context.money);
    if (!changed) return { result: current, audit: [] };
    const saved = await context.money.updateYear({ ...changed.year, updatedAt: new Date().toISOString() }, context.businessId);
    return { result: saved, audit: [{ type: changed.auditType, entityId: saved.id }] };
  });
}

export async function updateFinancialYearDates(businessId: BusinessId, yearId: string, input: { startDate?: string; endDate?: string }, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<FinancialYear> {
  if (input?.startDate === undefined && input?.endDate === undefined) throw new MoneyError(MONEY_ERROR_CODES.INVALID_FINANCIAL_YEAR);
  return changeYear(businessId, yearId, actor, dependencies, async (year, money) => {
    const next = { ...year, ...validateYearDates(input.startDate ?? year.startDate, input.endDate ?? year.endDate) };
    if ((await money.listMovements(year.businessId, year.id)).length > 0) throw new MoneyError(MONEY_ERROR_CODES.FINANCIAL_YEAR_HAS_MOVEMENTS);
    await assertNoOverlap(money, next);
    return { year: next, auditType: "financial_year_dates_updated" };
  });
}

export async function closeFinancialYear(businessId: BusinessId, yearId: string, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<FinancialYear> {
  return changeYear(businessId, yearId, actor, dependencies, async (year) => year.status === "closed" ? null : { year: { ...year, status: "closed" }, auditType: "financial_year_closed" });
}

export async function reopenFinancialYear(businessId: BusinessId, yearId: string, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<FinancialYear> {
  return changeYear(businessId, yearId, actor, dependencies, async (year, money) => {
    if (year.status === "open") return null;
    const next: FinancialYear = { ...year, status: "open" };
    await assertNoOverlap(money, next);
    return { year: next, auditType: "financial_year_reopened" };
  });
}

// ---------------------------------------------------------------- money accounts

export async function listMoneyAccounts(businessId: BusinessId, options: { yearId?: string }, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<MoneyAccountWithOpening[]> {
  const context = await authorize(businessId, actor, dependencies, "read_finance");
  return read(async () => {
    const accounts = await context.money.listAccounts(context.businessId);
    if (options?.yearId === undefined) return accounts.map((account) => ({ ...account, openingBalance: null }));
    if (!(await context.money.findYear(id(options.yearId, MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND), context.businessId))) throw new MoneyError(MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND);
    const openings = await context.money.listOpenings(context.businessId, options.yearId);
    return accounts.map((account) => ({ ...account, openingBalance: openings.get(account.id) ?? "0.00" }));
  });
}

async function assertAccountFree(money: MoneyRepository, account: MoneyAccount) {
  if (!account.isActive) return;
  const others = (await money.listAccounts(account.businessId)).filter((stored) => stored.isActive && stored.id !== account.id);
  if (others.some((stored) => stored.name.toLowerCase() === account.name.toLowerCase())) throw new MoneyError(MONEY_ERROR_CODES.MONEY_ACCOUNT_NAME_TAKEN);
  if (others.some((stored) => stored.sheetName === account.sheetName)) throw new MoneyError(MONEY_ERROR_CODES.SHEET_ALREADY_USED);
}

export async function createMoneyAccount(businessId: BusinessId, input: { name: string; kind: MoneyAccountKind; sheetName: string }, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<MoneyAccount> {
  const context = await authorize(businessId, actor, dependencies, "edit_finance");
  const name = text(input?.name, 100, MONEY_ERROR_CODES.INVALID_MONEY_ACCOUNT);
  if (!MONEY_ACCOUNT_KINDS.includes(input.kind)) throw new MoneyError(MONEY_ERROR_CODES.INVALID_MONEY_ACCOUNT);
  const sheetName = input.sheetName;
  if (typeof sheetName !== "string" || !sheetName || sheetName.length > 100) throw new MoneyError(MONEY_ERROR_CODES.INVALID_MONEY_ACCOUNT);
  const template = await read(() => getTemplate(context.businessId, context.actorId, { tenancyRepository: context.tenancy, templates: context.templates }));
  if (!template) throw new MoneyError(MONEY_ERROR_CODES.TEMPLATE_REQUIRED);
  if (!template.sheets.some((sheet) => sheet.name === sheetName)) throw new MoneyError(MONEY_ERROR_CODES.UNKNOWN_TEMPLATE_SHEET);
  const now = new Date().toISOString();
  const account: MoneyAccount = { id: randomUUID(), businessId: context.businessId, name, kind: input.kind, sheetName, isActive: true, createdAt: now, updatedAt: now };
  return write(context, async () => {
    await assertAccountFree(context.money, account);
    const saved = await context.money.createAccount(account);
    return { result: saved, audit: [{ type: "money_account_created", entityId: saved.id }] };
  });
}

async function changeAccount(businessId: BusinessId, accountId: string, actor: OnboardingActor, dependencies: MoneyDependencies, change: (account: MoneyAccount) => { account: MoneyAccount; auditType: string }): Promise<MoneyAccount> {
  const context = await authorize(businessId, actor, dependencies, "edit_finance");
  return write(context, async () => {
    const current = typeof accountId === "string" ? await context.money.findAccount(accountId, context.businessId) : null;
    if (!current) throw new MoneyError(MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND);
    const { account, auditType } = change(current);
    await assertAccountFree(context.money, account);
    const saved = await context.money.updateAccount({ ...account, updatedAt: new Date().toISOString() }, context.businessId);
    return { result: saved, audit: [{ type: auditType, entityId: saved.id }] };
  });
}

export async function renameMoneyAccount(businessId: BusinessId, accountId: string, name: string, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<MoneyAccount> {
  const trimmed = text(name, 100, MONEY_ERROR_CODES.INVALID_MONEY_ACCOUNT);
  return changeAccount(businessId, accountId, actor, dependencies, (account) => ({ account: { ...account, name: trimmed }, auditType: "money_account_renamed" }));
}

export async function setMoneyAccountActive(businessId: BusinessId, accountId: string, isActive: boolean, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<MoneyAccount> {
  if (typeof isActive !== "boolean") throw new MoneyError(MONEY_ERROR_CODES.INVALID_MONEY_ACCOUNT);
  return changeAccount(businessId, accountId, actor, dependencies, (account) => ({ account: { ...account, isActive }, auditType: isActive ? "money_account_activated" : "money_account_deactivated" }));
}

export async function setOpeningBalance(businessId: BusinessId, accountId: string, yearId: string, value: string, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<MoneyAccountWithOpening> {
  const context = await authorize(businessId, actor, dependencies, "edit_finance");
  const openingBalance = amount(value, true);
  return write(context, async () => {
    const account = typeof accountId === "string" ? await context.money.findAccount(accountId, context.businessId) : null;
    if (!account) throw new MoneyError(MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND);
    const year = typeof yearId === "string" ? await context.money.findYear(yearId, context.businessId) : null;
    if (!year) throw new MoneyError(MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND);
    if (year.status !== "open") throw new MoneyError(MONEY_ERROR_CODES.FINANCIAL_YEAR_CLOSED);
    await context.money.setOpening(context.businessId, account.id, year.id, openingBalance);
    return { result: { ...account, openingBalance }, audit: [{ type: "money_account_opening_balance_set", entityId: account.id, metadata: { financialYearId: year.id } }] };
  });
}

// ---------------------------------------------------------------- movements

export async function listMovements(businessId: BusinessId, options: { yearId: string; accountId?: string }, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<Movement[]> {
  const context = await authorize(businessId, actor, dependencies, "read_finance");
  return read(async () => {
    const year = typeof options?.yearId === "string" ? await context.money.findYear(options.yearId, context.businessId) : null;
    if (!year) throw new MoneyError(MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND);
    if (options.accountId !== undefined && !(typeof options.accountId === "string" && await context.money.findAccount(options.accountId, context.businessId))) {
      throw new MoneyError(MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND);
    }
    return context.money.listMovements(context.businessId, year.id, options.accountId);
  });
}

/** Validates one row against the business's years, accounts and headings; returns the stored fields. */
async function resolveRow(context: MovementWriteContext, row: InternalMovementInput) {
  if (!MOVEMENT_ORIGINS.includes(row?.origin)) throw new MoneyError(MONEY_ERROR_CODES.INVALID_MOVEMENT);
  const narrative = text(row.narrative, 200, MONEY_ERROR_CODES.INVALID_MOVEMENT);
  const value = amount(row.amount, false);
  const date = isoDate(row.date, MONEY_ERROR_CODES.INVALID_MOVEMENT);
  const sourceInvoiceId = row.sourceInvoiceId ?? null;
  if ((row.origin === "invoice") !== (sourceInvoiceId !== null)) throw new MoneyError(MONEY_ERROR_CODES.INVALID_MOVEMENT);
  for (const optional of [sourceInvoiceId, row.sourceRef ?? null, row.transferGroupId ?? null]) {
    if (optional !== null && (typeof optional !== "string" || !optional || optional.length > 200)) throw new MoneyError(MONEY_ERROR_CODES.INVALID_MOVEMENT);
  }

  const year = (await context.money.listYears(context.businessId)).find((stored) => stored.startDate <= date && date <= stored.endDate);
  if (!year || year.status !== "open") throw new MoneyError(MONEY_ERROR_CODES.MOVEMENT_OUTSIDE_OPEN_YEAR);
  const account = typeof row.accountId === "string" ? await context.money.findAccount(row.accountId, context.businessId) : null;
  if (!account) throw new MoneyError(MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND);
  if (!account.isActive) throw new MoneyError(MONEY_ERROR_CODES.MONEY_ACCOUNT_INACTIVE);
  if (row.headingId === null || row.headingId === undefined) {
    if (row.origin !== "statement") throw new MoneyError(MONEY_ERROR_CODES.INVALID_MOVEMENT);
  } else {
    const heading = typeof row.headingId === "string" ? await context.headings.findById(row.headingId, context.businessId) : null;
    if (!heading) throw new MoneyError(MONEY_ERROR_CODES.HEADING_NOT_FOUND);
    if (!heading.isActive || heading.blockedReason !== null) throw new MoneyError(MONEY_ERROR_CODES.HEADING_NOT_USABLE);
  }
  return {
    financialYearId: year.id,
    moneyAccountId: account.id,
    movementDate: date,
    narrative,
    headingId: row.headingId ?? null,
    amount: value,
    origin: row.origin,
    sourceInvoiceId,
    sourceRef: row.sourceRef ?? null,
    transferGroupId: row.transferGroupId ?? null,
  };
}

const movementAudit = (type: string, movement: Movement) => ({ type, entityId: movement.id, metadata: { financialYearId: movement.financialYearId, moneyAccountId: movement.moneyAccountId } });

/**
 * Internal: inserts rows of any origin with the same validations as the public API.
 * The caller has authorized `edit_finance` and runs this inside `money.transaction`.
 */
export async function createMovementsInTransaction(context: MovementWriteContext, rows: InternalMovementInput[]): Promise<Movement[]> {
  if (!Array.isArray(rows)) throw new MoneyError(MONEY_ERROR_CODES.INVALID_MOVEMENT);
  const created: Movement[] = [];
  for (const row of rows) {
    const now = new Date().toISOString();
    const movement = await context.money.createMovement({ ...(await resolveRow(context, row)), id: randomUUID(), businessId: context.businessId, deletedAt: null, createdBy: context.actorId, createdAt: now, updatedAt: now });
    await appendAudit(context, movementAudit("movement_created", movement));
    created.push(movement);
  }
  return created;
}

async function softDelete(context: MovementWriteContext, movement: Movement): Promise<Movement> {
  const now = new Date().toISOString();
  const deleted = await context.money.updateMovement({ ...movement, deletedAt: now, updatedAt: now }, context.businessId);
  await appendAudit(context, movementAudit("movement_deleted", deleted));
  return deleted;
}

async function assertYearOpen(context: MovementWriteContext, movement: Movement) {
  const year = await context.money.findYear(movement.financialYearId, context.businessId);
  if (year?.status !== "open") throw new MoneyError(MONEY_ERROR_CODES.FINANCIAL_YEAR_CLOSED);
}

/** Internal: soft-deletes the invoice's live movements. Same caller contract as `createMovementsInTransaction`. */
export async function removeInvoiceMovements(context: MovementWriteContext, invoiceId: string): Promise<number> {
  const current = await context.money.listInvoiceMovements(context.businessId, id(invoiceId, MONEY_ERROR_CODES.INVALID_MOVEMENT));
  for (const movement of current) {
    await assertYearOpen(context, movement);
    await softDelete(context, movement);
  }
  return current.length;
}

/** Internal: replaces the invoice's live movements with `rows` (origin forced to invoice). */
export async function replaceInvoiceMovements(context: MovementWriteContext, invoiceId: string, rows: Omit<InternalMovementInput, "origin" | "sourceInvoiceId">[]): Promise<Movement[]> {
  await removeInvoiceMovements(context, invoiceId);
  if (!Array.isArray(rows)) throw new MoneyError(MONEY_ERROR_CODES.INVALID_MOVEMENT);
  return createMovementsInTransaction(context, rows.map((row) => ({ ...row, origin: "invoice", sourceInvoiceId: invoiceId })));
}

async function findManualMovement(context: MovementWriteContext, movementId: string): Promise<Movement> {
  const movement = typeof movementId === "string" ? await context.money.findMovement(movementId, context.businessId) : null;
  if (!movement || movement.deletedAt !== null) throw new MoneyError(MONEY_ERROR_CODES.MOVEMENT_NOT_FOUND);
  if (movement.origin !== "manual") throw new MoneyError(MONEY_ERROR_CODES.MOVEMENT_ORIGIN_NOT_EDITABLE);
  if (movement.transferGroupId !== null) throw new MoneyError(MONEY_ERROR_CODES.MOVEMENT_ORIGIN_NOT_EDITABLE);
  await assertYearOpen(context, movement);
  return movement;
}

export async function createMovement(businessId: BusinessId, input: ManualMovementInput, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<Movement> {
  const context = await authorize(businessId, actor, dependencies, "edit_finance");
  if ((input?.origin ?? "manual") !== "manual") throw new MoneyError(MONEY_ERROR_CODES.MOVEMENT_ORIGIN_NOT_EDITABLE);
  // Only the documented fields: a transfer group, statement reference or invoice link is never taken from a caller.
  const { accountId, date, narrative, headingId, amount: value } = input ?? ({} as ManualMovementInput);
  try {
    return await context.money.transaction(async () => (await createMovementsInTransaction(context, [{ accountId, date, narrative, headingId, amount: value, origin: "manual" }]))[0]);
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

export async function updateMovement(businessId: BusinessId, movementId: string, changes: MovementChanges, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<Movement> {
  const context = await authorize(businessId, actor, dependencies, "edit_finance");
  const editable = ["accountId", "date", "narrative", "headingId", "amount"];
  if (typeof changes !== "object" || changes === null || !Object.keys(changes).some((key) => editable.includes(key))) throw new MoneyError(MONEY_ERROR_CODES.INVALID_MOVEMENT);
  try {
    return await context.money.transaction(async () => {
      const current = await findManualMovement(context, movementId);
      const fields = await resolveRow(context, {
        accountId: changes.accountId ?? current.moneyAccountId,
        date: changes.date ?? current.movementDate,
        narrative: changes.narrative ?? current.narrative,
        headingId: changes.headingId ?? current.headingId,
        amount: changes.amount ?? current.amount,
        origin: "manual",
      });
      const saved = await context.money.updateMovement({ ...current, ...fields, updatedAt: new Date().toISOString() }, context.businessId);
      await appendAudit(context, movementAudit("movement_updated", saved));
      return saved;
    });
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

export async function deleteMovement(businessId: BusinessId, movementId: string, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<Movement> {
  const context = await authorize(businessId, actor, dependencies, "edit_finance");
  try {
    return await context.money.transaction(async () => softDelete(context, await findManualMovement(context, movementId)));
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

// ---------------------------------------------------------------- transfers (LH-022)

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  date: string;
  /** Positive pounds; the from-account gets it negative, the to-account positive. */
  amount: string;
  headingId: string;
  narrative?: string;
}

export type TransferChanges = Partial<TransferInput>;

export interface Transfer {
  transferGroupId: string;
  from: Movement;
  to: Movement;
}

const DEFAULT_TRANSFER_NARRATIVE = "Transfer";

/** The two legs of a transfer, both with the same date, heading and narrative. */
function transferRows(input: TransferInput, transferGroupId: string): [InternalMovementInput, InternalMovementInput] {
  let pence: number;
  try {
    pence = parsePounds(input.amount);
  } catch {
    throw new MoneyError(MONEY_ERROR_CODES.INVALID_AMOUNT);
  }
  if (pence <= 0) throw new MoneyError(MONEY_ERROR_CODES.INVALID_AMOUNT);
  if (typeof input.headingId !== "string" || input.fromAccountId === input.toAccountId) throw new MoneyError(MONEY_ERROR_CODES.INVALID_MOVEMENT);
  if (input.narrative !== undefined && typeof input.narrative !== "string") throw new MoneyError(MONEY_ERROR_CODES.INVALID_MOVEMENT);
  const narrative = input.narrative?.trim() || DEFAULT_TRANSFER_NARRATIVE;
  const leg = (accountId: string, value: number): InternalMovementInput => ({ accountId, date: input.date, narrative, headingId: input.headingId, amount: formatPence(value), origin: "manual", transferGroupId });
  return [leg(input.fromAccountId, -pence), leg(input.toAccountId, pence)];
}

const transferAudit = (type: string, transfer: Transfer) => ({ type, entityId: transfer.transferGroupId, metadata: { movementIds: [transfer.from.id, transfer.to.id] } });

async function liveTransferLegs(context: MovementWriteContext): Promise<Movement[]> {
  const legs: Movement[] = [];
  for (const year of await context.money.listYears(context.businessId)) {
    legs.push(...(await context.money.listMovements(context.businessId, year.id)).filter((movement) => movement.transferGroupId !== null && movement.origin === "manual"));
  }
  return legs;
}

async function findTransfer(context: MovementWriteContext, transferGroupId: string): Promise<Transfer> {
  const legs = typeof transferGroupId === "string" && transferGroupId ? (await liveTransferLegs(context)).filter((movement) => movement.transferGroupId === transferGroupId) : [];
  const from = legs.find((movement) => movement.amount.startsWith("-"));
  const to = legs.find((movement) => !movement.amount.startsWith("-"));
  if (legs.length !== 2 || !from || !to) throw new MoneyError(MONEY_ERROR_CODES.MOVEMENT_NOT_FOUND);
  await assertYearOpen(context, from);
  await assertYearOpen(context, to);
  return { transferGroupId, from, to };
}

async function transferWrite(businessId: BusinessId, actor: OnboardingActor, dependencies: MoneyDependencies, operation: (context: MovementWriteContext) => Promise<{ transfer: Transfer; auditType: string }>): Promise<Transfer> {
  const context = await authorize(businessId, actor, dependencies, "edit_finance");
  try {
    return await context.money.transaction(async () => {
      const { transfer, auditType } = await operation(context);
      await appendAudit(context, transferAudit(auditType, transfer));
      return transfer;
    });
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

export async function createTransfer(businessId: BusinessId, input: TransferInput, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<Transfer> {
  return transferWrite(businessId, actor, dependencies, async (context) => {
    const transferGroupId = randomUUID();
    const [from, to] = await createMovementsInTransaction(context, transferRows(input ?? ({} as TransferInput), transferGroupId));
    return { transfer: { transferGroupId, from, to }, auditType: "transfer_created" };
  });
}

export async function updateTransfer(businessId: BusinessId, transferGroupId: string, changes: TransferChanges, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<Transfer> {
  if (typeof changes !== "object" || changes === null || Object.keys(changes).length === 0) throw new MoneyError(MONEY_ERROR_CODES.INVALID_MOVEMENT);
  return transferWrite(businessId, actor, dependencies, async (context) => {
    const current = await findTransfer(context, transferGroupId);
    const rows = transferRows({
      fromAccountId: changes.fromAccountId ?? current.from.moneyAccountId,
      toAccountId: changes.toAccountId ?? current.to.moneyAccountId,
      date: changes.date ?? current.from.movementDate,
      amount: changes.amount ?? current.to.amount,
      headingId: changes.headingId ?? current.from.headingId ?? "",
      narrative: changes.narrative ?? current.from.narrative,
    }, current.transferGroupId);
    const saved: Movement[] = [];
    for (const [leg, row] of [[current.from, rows[0]], [current.to, rows[1]]] as const) {
      const fields = await resolveRow(context, row);
      const movement = await context.money.updateMovement({ ...leg, ...fields, updatedAt: new Date().toISOString() }, context.businessId);
      await appendAudit(context, movementAudit("movement_updated", movement));
      saved.push(movement);
    }
    return { transfer: { transferGroupId: current.transferGroupId, from: saved[0], to: saved[1] }, auditType: "transfer_updated" };
  });
}

export async function deleteTransfer(businessId: BusinessId, transferGroupId: string, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<Transfer> {
  return transferWrite(businessId, actor, dependencies, async (context) => {
    const current = await findTransfer(context, transferGroupId);
    const from = await softDelete(context, current.from);
    const to = await softDelete(context, current.to);
    return { transfer: { transferGroupId: current.transferGroupId, from, to }, auditType: "transfer_deleted" };
  });
}

/** The heading of the most recently created live transfer while it is still usable; null otherwise. */
export async function suggestTransferHeading(businessId: BusinessId, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<{ headingId: string | null }> {
  const context = await authorize(businessId, actor, dependencies, "read_finance");
  return read(async () => {
    let latest: Movement | null = null;
    for (const leg of await liveTransferLegs(context)) if (!latest || leg.createdAt >= latest.createdAt) latest = leg;
    const heading = latest?.headingId ? await context.headings.findById(latest.headingId, context.businessId) : null;
    return { headingId: heading && heading.isActive && heading.blockedReason === null ? heading.id : null };
  });
}
