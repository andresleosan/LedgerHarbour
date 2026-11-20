import { createHash } from "node:crypto";

import { defaultOnboardingRepository, resolveOnboardingActor, type OnboardingActor } from "../tenancy/business-service";
import type { BusinessId } from "../tenancy/types";
import { HeadingError, requireHeadingCapability, resolveDefaultHeadingRepository } from "./heading-service";
import { formatPence, parsePounds } from "./money";
import { MONEY_ERROR_CODES, MoneyError, resolveDefaultMoneyRepository, type Movement } from "./money-repository";
import { createMovementsInTransaction, type MoneyDependencies, type MovementWriteContext } from "./money-service";
import {
  STATEMENT_CSV_ERROR_CODES,
  StatementCsvError,
  parseStatementCsv,
  type DateFormat,
  type ParsedStatement,
  type StatementLineReason,
  type StatementMapping,
  type StatementRow,
} from "./statement-csv";

export const STATEMENT_IMPORT_ERROR_CODES = {
  ...STATEMENT_CSV_ERROR_CODES,
  COLUMNS_REQUIRED: "COLUMNS_REQUIRED",
  DATE_FORMAT_REQUIRED: "DATE_FORMAT_REQUIRED",
  STATEMENT_HAS_ERRORS: "STATEMENT_HAS_ERRORS",
} as const;
export type StatementImportErrorCode = (typeof STATEMENT_IMPORT_ERROR_CODES)[keyof typeof STATEMENT_IMPORT_ERROR_CODES];
export type StatementLineError = { line: number; reason: StatementLineReason | "OUTSIDE_OPEN_YEAR" };

export class StatementImportError extends Error {
  readonly name = "StatementImportError";

  constructor(readonly code: StatementImportErrorCode, readonly errors: StatementLineError[] = []) {
    super(code === "STATEMENT_HAS_ERRORS" ? "Nothing was imported: some lines of the statement cannot be read." : `The statement cannot be imported (${code}).`);
  }
}

export const STATEMENT_DEFAULT_NARRATIVE = "Bank statement line";
const MATCH_WINDOW_DAYS = 5;
const PREVIEW_ROWS = 10;
const DAY = 86_400_000;

export interface StatementImportInput {
  accountId: string;
  csv: string;
  mapping?: StatementMapping;
  dateFormat?: DateFormat;
}

export type StatementOutcome = "new" | "already_imported" | "already_recorded";

export interface StatementCounts {
  total: number;
  toImport: number;
  alreadyImported: number;
  alreadyRecorded: number;
  skipped: ParsedStatement["skipped"];
}

export interface StatementPreview {
  headers: string[];
  mapping: StatementMapping | null;
  dateFormat: DateFormat | null;
  needsDateFormat: boolean;
  rows: Array<StatementRow & { outcome: StatementOutcome }>;
  counts: StatementCounts;
  errors: StatementLineError[];
}

export interface StatementImportResult {
  imported: number;
  counts: StatementCounts;
}

export interface TrayMovement extends Movement {
  /** The heading last used on another movement with the same narrative, if still usable; applied only on save. */
  suggestedHeadingId: string | null;
}

function mapError(error: unknown): Error {
  if (error instanceof MoneyError || error instanceof StatementImportError) return error;
  if (error instanceof StatementCsvError) return new StatementImportError(error.code);
  if (error instanceof HeadingError && error.code in MONEY_ERROR_CODES) return new MoneyError(error.code as MoneyError["code"]);
  return new MoneyError(MONEY_ERROR_CODES.MONEY_REPOSITORY_CONFLICT);
}

async function authorize(businessId: unknown, actor: OnboardingActor, dependencies: MoneyDependencies, capability: "read_finance" | "edit_finance") {
  const tenancy = dependencies.tenancyRepository ?? defaultOnboardingRepository;
  const actorId = await resolveOnboardingActor(tenancy, actor);
  if (typeof businessId !== "string" || !businessId.trim()) throw new MoneyError(MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  try {
    await requireHeadingCapability(businessId as BusinessId, actorId, tenancy, capability);
  } catch (error) {
    throw mapError(error);
  }
  return {
    businessId: businessId as BusinessId,
    actorId,
    tenancy,
    money: dependencies.money ?? resolveDefaultMoneyRepository(),
    headings: dependencies.headings ?? resolveDefaultHeadingRepository(),
  } satisfies MovementWriteContext;
}

async function guard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapError(error);
  }
}

async function appendAudit(context: MovementWriteContext, event: { type: string; entityId: string; metadata: Record<string, unknown> }) {
  await context.tenancy.transaction((transaction) => transaction.appendAuditEvent({ businessId: context.businessId, actorId: context.actorId, ...event }));
}

async function allMovements(context: MovementWriteContext, accountId?: string): Promise<Movement[]> {
  const movements: Movement[] = [];
  for (const year of await context.money.listYears(context.businessId)) movements.push(...(await context.money.listMovements(context.businessId, year.id, accountId)));
  return movements;
}

const normaliseDescription = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
const days = (left: string, right: string) => Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / DAY;

const parse = (input: StatementImportInput) => parseStatementCsv(input?.csv, { mapping: input?.mapping, dateFormat: input?.dateFormat });

/** Decides, line by line, what an import of the parsed file would do. Writes nothing. */
async function analyse(context: MovementWriteContext, input: StatementImportInput, parsed: ParsedStatement) {
  const account = typeof input?.accountId === "string" ? await context.money.findAccount(input.accountId, context.businessId) : null;
  if (!account) throw new MoneyError(MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND);
  if (!account.isActive) throw new MoneyError(MONEY_ERROR_CODES.MONEY_ACCOUNT_INACTIVE);

  const years = await context.money.listYears(context.businessId);
  const errors: StatementLineError[] = [...parsed.errors];
  const inOpenYear = parsed.rows.filter((row) => {
    const open = years.some((year) => year.status === "open" && year.startDate <= row.date && row.date <= year.endDate);
    if (!open) errors.push({ line: row.line, reason: "OUTSIDE_OPEN_YEAR" });
    return open;
  });
  errors.sort((left, right) => left.line - right.line);

  const existing = await allMovements(context, account.id);
  const imported = new Set(existing.filter((movement) => movement.origin === "statement").map((movement) => movement.sourceRef));
  const candidates = existing.filter((movement) => movement.origin !== "statement").map((movement, order) => ({ movement, order, pence: parsePounds(movement.amount) }));
  const taken = new Set<string>();
  const occurrences = new Map<string, number>();
  const rows = inOpenYear.map((row) => {
    const description = normaliseDescription(row.description);
    const key = JSON.stringify([row.date, row.amountPence, description]);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    const sourceRef = `stmt:${createHash("sha256").update([account.id, row.date, row.amountPence, description, occurrence].join("|")).digest("hex")}`;
    if (imported.has(sourceRef)) return { ...row, sourceRef, outcome: "already_imported" as StatementOutcome };
    // Closest date wins; on a tie, the oldest created movement.
    let best: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      if (candidate.pence !== row.amountPence || taken.has(candidate.movement.id) || days(candidate.movement.movementDate, row.date) > MATCH_WINDOW_DAYS) continue;
      const distance = days(candidate.movement.movementDate, row.date);
      const bestDistance = best ? days(best.movement.movementDate, row.date) : Infinity;
      if (!best || distance < bestDistance || (distance === bestDistance && (candidate.movement.createdAt < best.movement.createdAt || (candidate.movement.createdAt === best.movement.createdAt && candidate.order < best.order)))) best = candidate;
    }
    if (best) taken.add(best.movement.id);
    return { ...row, sourceRef, outcome: (best ? "already_recorded" : "new") as StatementOutcome };
  });

  const count = (outcome: StatementOutcome) => rows.filter((row) => row.outcome === outcome).length;
  const { zero, notSterling, notCompleted } = parsed.skipped;
  const counts: StatementCounts = {
    total: parsed.rows.length + parsed.errors.length + zero + notSterling + notCompleted,
    toImport: count("new"),
    alreadyImported: count("already_imported"),
    alreadyRecorded: count("already_recorded"),
    skipped: parsed.skipped,
  };
  return { account, rows, errors, counts };
}

export async function previewStatement(businessId: BusinessId, input: StatementImportInput, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<StatementPreview> {
  const context = await authorize(businessId, actor, dependencies, "edit_finance");
  return guard(async () => {
    const parsed = parse(input);
    const { rows, errors, counts } = await analyse(context, input, parsed);
    return {
      headers: parsed.headers,
      mapping: parsed.mapping,
      dateFormat: parsed.dateFormat,
      needsDateFormat: parsed.needsDateFormat,
      rows: rows.slice(0, PREVIEW_ROWS).map(({ line, date, description, amountPence, outcome }) => ({ line, date, description, amountPence, outcome })),
      counts,
      errors,
    };
  });
}

/** Imports every new line as an uncoded statement movement, all or nothing. */
export async function importStatement(businessId: BusinessId, input: StatementImportInput, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<StatementImportResult> {
  const context = await authorize(businessId, actor, dependencies, "edit_finance");
  return guard(async () => {
    const parsed = parse(input);
    if (!parsed.mapping) throw new StatementImportError(STATEMENT_IMPORT_ERROR_CODES.COLUMNS_REQUIRED);
    if (parsed.needsDateFormat) throw new StatementImportError(STATEMENT_IMPORT_ERROR_CODES.DATE_FORMAT_REQUIRED);
    return context.money.transaction(async () => {
      const { account, rows, errors, counts } = await analyse(context, input, parsed);
      if (errors.length > 0) throw new StatementImportError(STATEMENT_IMPORT_ERROR_CODES.STATEMENT_HAS_ERRORS, errors);
      const fresh = rows.filter((row) => row.outcome === "new");
      await createMovementsInTransaction(context, fresh.map((row) => ({
        accountId: account.id,
        date: row.date,
        narrative: row.description.replace(/\s+/g, " ").trim().slice(0, 200).trim() || STATEMENT_DEFAULT_NARRATIVE,
        headingId: null,
        amount: formatPence(row.amountPence),
        origin: "statement",
        sourceRef: row.sourceRef,
      })));
      const { zero, notSterling, notCompleted } = counts.skipped;
      await appendAudit(context, {
        type: "statement_imported",
        entityId: account.id,
        metadata: { imported: fresh.length, alreadyImported: counts.alreadyImported, alreadyRecorded: counts.alreadyRecorded, skipped: zero + notSterling + notCompleted },
      });
      return { imported: fresh.length, counts };
    });
  });
}

// ---------------------------------------------------------------- the "to code" tray

/** The open year's statement lines still waiting for a code, with a suggested heading each. */
export async function listUncodedStatementMovements(businessId: BusinessId, yearId: string, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<TrayMovement[]> {
  const context = await authorize(businessId, actor, dependencies, "read_finance");
  return guard(async () => {
    const year = typeof yearId === "string" ? await context.money.findYear(yearId, context.businessId) : null;
    if (!year) throw new MoneyError(MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND);
    const waiting = (await context.money.listMovements(context.businessId, year.id)).filter((movement) => movement.origin === "statement" && movement.headingId === null);
    if (waiting.length === 0) return [];
    const neutral = STATEMENT_DEFAULT_NARRATIVE.toLowerCase();
    const latest = new Map<string, Movement>();
    for (const movement of await allMovements(context)) {
      const key = movement.narrative.trim().toLowerCase();
      if (movement.headingId === null || key === neutral) continue;
      const current = latest.get(key);
      if (!current || movement.updatedAt > current.updatedAt || (movement.updatedAt === current.updatedAt && movement.createdAt >= current.createdAt)) latest.set(key, movement);
    }
    const usable = new Map<string, boolean>();
    const suggestion = async (narrative: string) => {
      const headingId = latest.get(narrative.trim().toLowerCase())?.headingId ?? null;
      if (headingId === null) return null;
      if (!usable.has(headingId)) {
        const heading = await context.headings.findById(headingId, context.businessId);
        usable.set(headingId, Boolean(heading?.isActive && heading.blockedReason === null));
      }
      return usable.get(headingId) ? headingId : null;
    };
    const rows: TrayMovement[] = [];
    for (const movement of waiting) rows.push({ ...movement, suggestedHeadingId: await suggestion(movement.narrative) });
    return rows;
  });
}

async function changeStatementMovement(businessId: BusinessId, movementId: string, actor: OnboardingActor, dependencies: MoneyDependencies, change: (context: MovementWriteContext, movement: Movement) => Promise<{ movement: Movement; auditType: string }>): Promise<Movement> {
  const context = await authorize(businessId, actor, dependencies, "edit_finance");
  return guard(() => context.money.transaction(async () => {
    const current = typeof movementId === "string" ? await context.money.findMovement(movementId, context.businessId) : null;
    if (!current || current.deletedAt !== null) throw new MoneyError(MONEY_ERROR_CODES.MOVEMENT_NOT_FOUND);
    if (current.origin !== "statement") throw new MoneyError(MONEY_ERROR_CODES.MOVEMENT_ORIGIN_NOT_EDITABLE);
    if ((await context.money.findYear(current.financialYearId, context.businessId))?.status !== "open") throw new MoneyError(MONEY_ERROR_CODES.FINANCIAL_YEAR_CLOSED);
    const { movement, auditType } = await change(context, current);
    const saved = await context.money.updateMovement({ ...movement, updatedAt: new Date().toISOString() }, context.businessId);
    await appendAudit(context, { type: auditType, entityId: saved.id, metadata: { headingId: saved.headingId, financialYearId: saved.financialYearId, moneyAccountId: saved.moneyAccountId } });
    return saved;
  }));
}

/** Sets (or, with null, clears) the code of a statement line. It stays a statement line either way. */
export async function codeStatementMovement(businessId: BusinessId, movementId: string, headingId: string | null, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<Movement> {
  return changeStatementMovement(businessId, movementId, actor, dependencies, async (context, movement) => {
    if (headingId !== null) {
      const heading = typeof headingId === "string" && headingId ? await context.headings.findById(headingId, context.businessId) : null;
      if (!heading) throw new MoneyError(MONEY_ERROR_CODES.HEADING_NOT_FOUND);
      if (!heading.isActive || heading.blockedReason !== null) throw new MoneyError(MONEY_ERROR_CODES.HEADING_NOT_USABLE);
    }
    return { movement: { ...movement, headingId }, auditType: "statement_movement_coded" };
  });
}

/** Soft-deletes a statement line imported by mistake. */
export async function deleteStatementMovement(businessId: BusinessId, movementId: string, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<Movement> {
  return changeStatementMovement(businessId, movementId, actor, dependencies, async (_context, movement) => ({ movement: { ...movement, deletedAt: new Date().toISOString() }, auditType: "statement_movement_deleted" }));
}
