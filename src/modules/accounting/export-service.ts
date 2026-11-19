import { isDeepStrictEqual } from "node:util";

import type { StorageAdapter } from "../documents/storage-adapter";
import { readTemplate } from "../workbook/read-template";
import { TemplateReadError, type TemplateDefect, type TemplateProfile } from "../workbook/template-profile";
import { WorkbookWriteError, fillWorkbook, readWrittenRows, usableHeadings, type WriteSheet } from "../workbook/write-workbook";
import { defaultOnboardingRepository, resolveOnboardingActor, type OnboardingActor } from "../tenancy/business-service";
import type { BusinessId } from "../tenancy/types";
import { HeadingError, requireHeadingCapability, resolveDefaultHeadingRepository } from "./heading-service";
import { MONEY_ERROR_CODES, MoneyError, resolveDefaultMoneyRepository, type FinancialYear, type Movement } from "./money-repository";
import type { MoneyDependencies } from "./money-service";
import { getTemplateFile, resolveDefaultTemplateRepository } from "./template-service";
import { summarizeYear, type YearSummary } from "./year-summary";

// Builds the year's filled workbook from the business's template, or says why it cannot.
// Nothing is exported partially: any blocker stops the file. A file that is produced has
// been read back, and its totals per heading and per account equal the stored rows'.

export interface ExportDependencies extends MoneyDependencies {
  storage?: StorageAdapter;
  /** The workbook writer; replaceable so tests can prove the read-back catches a faulty one. */
  fill?: typeof fillWorkbook;
}

export type ExportBlocker =
  | { code: "YEAR_NOT_FOUND" }
  | { code: "NO_TEMPLATE" }
  | { code: "TEMPLATE_UNREADABLE"; reason: string }
  | { code: "UNCODED_MOVEMENTS"; count: number }
  | { code: "UNUSABLE_HEADING"; headingIds: string[] }
  | { code: "ACCOUNT_SHEET_MISSING"; accountId: string; sheetName: string }
  | { code: "ACCOUNT_SHEET_SHARED"; sheetName: string; accountIds: string[] }
  | { code: "SHEET_CAPACITY_EXCEEDED"; sheetName: string; rows: number; capacity: number }
  | { code: "TEMPLATE_NOT_WRITABLE"; reason: string; sheetName?: string; cell?: string };

export interface ExportReport {
  blocked: boolean;
  blockers: ExportBlocker[];
  sheets: Array<{
    sheetName: string;
    accountId: string | null;
    /** The account's movements for this sheet; written only when the export is not blocked. */
    rowsWritten: number;
    capacity: number;
    /** Sample rows found in the template's input cells and removed; null when nothing was written. */
    clearedTemplateRows: number | null;
    consolidated: boolean;
  }>;
  /** Template defects that change what the statements will show. */
  defects: TemplateDefect[];
  /** Transfers on a sheet whose totals no formula reads: the accountant must journal them. */
  unconsolidatedTransferCount: number;
  openingBalancesNeedTrialBalanceEntry: true;
  totals: Pick<YearSummary, "byHeading" | "byAccount">;
}

export const EXPORT_ERROR_CODES = {
  EXPORT_READBACK_MISMATCH: "EXPORT_READBACK_MISMATCH",
} as const;

export class ExportError extends Error {
  readonly name = "ExportError";

  constructor(readonly code: keyof typeof EXPORT_ERROR_CODES) {
    super("The exported workbook did not read back as written.");
  }
}

const RESULT_DEFECTS = new Set<TemplateDefect["code"]>([
  "BROKEN_REFERENCE",
  "TRUNCATED_ANALYSIS_COLUMN",
  "STALE_CLOSING_BALANCE",
  "UNCONSOLIDATED_SHEET",
  "HEADING_TOTAL_NOT_READ",
  "HEADING_TOTAL_READ_TWICE",
  "BLANK_HEADING",
]);

/** The control report alone, for the screen; same checks as the download, no file, no audit. */
export async function getExportReport(businessId: BusinessId, yearId: string, actor: OnboardingActor, dependencies: ExportDependencies = {}): Promise<ExportReport> {
  return (await prepare(businessId, yearId, actor, dependencies)).report;
}

/** The filled workbook with its control report; `bytes` is null when the report is blocked. */
export async function buildYearExport(businessId: BusinessId, yearId: string, actor: OnboardingActor, dependencies: ExportDependencies = {}): Promise<{ report: ExportReport; year: FinancialYear | null; bytes: Buffer | null }> {
  const prepared = await prepare(businessId, yearId, actor, dependencies);
  if (prepared.bytes) {
    const rows = prepared.report.sheets.reduce((n, sheet) => n + sheet.rowsWritten, 0);
    await prepared.tenancy.transaction((transaction) => transaction.appendAuditEvent({
      businessId: prepared.businessId,
      actorId: prepared.actorId,
      type: "workbook_exported",
      entityId: prepared.year!.id,
      metadata: { financialYearId: prepared.year!.id, sheets: prepared.report.sheets.length, rows },
    }));
  }
  return { report: prepared.report, year: prepared.year, bytes: prepared.bytes };
}

async function prepare(businessId: BusinessId, yearId: string, actor: OnboardingActor, dependencies: ExportDependencies) {
  const tenancy = dependencies.tenancyRepository ?? defaultOnboardingRepository;
  const money = dependencies.money ?? resolveDefaultMoneyRepository();
  const headingRepository = dependencies.headings ?? resolveDefaultHeadingRepository();
  const actorId = await resolveOnboardingActor(tenancy, actor);
  if (typeof businessId !== "string" || !businessId.trim()) throw new MoneyError(MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  try {
    await requireHeadingCapability(businessId, actorId, tenancy, "read_finance");
  } catch (error) {
    throw error instanceof HeadingError && error.code in MONEY_ERROR_CODES ? new MoneyError(error.code as MoneyError["code"]) : error;
  }

  const report: ExportReport = {
    blocked: false,
    blockers: [],
    sheets: [],
    defects: [],
    unconsolidatedTransferCount: 0,
    openingBalancesNeedTrialBalanceEntry: true,
    totals: { byHeading: [], byAccount: [] },
  };
  const result = (year: FinancialYear | null, bytes: Buffer | null = null) => {
    report.blocked = report.blockers.length > 0;
    return { report, year, bytes: report.blocked ? null : bytes, tenancy, businessId, actorId };
  };

  const year = typeof yearId === "string" ? await money.findYear(yearId, businessId) : null;
  const file = await getTemplateFile(businessId, actorId, {
    tenancyRepository: tenancy,
    templates: dependencies.templates ?? resolveDefaultTemplateRepository(),
    storage: dependencies.storage,
  });
  if (!year) report.blockers.push({ code: "YEAR_NOT_FOUND" });
  if (!file) report.blockers.push({ code: "NO_TEMPLATE" });
  if (!year || !file) return result(year);

  // The stored profile is not trusted for writing: the file is read again.
  let profile: TemplateProfile;
  try {
    profile = await readTemplate(file.data);
  } catch (error) {
    report.blockers.push({ code: "TEMPLATE_UNREADABLE", reason: error instanceof TemplateReadError ? error.code : "NOT_A_WORKBOOK" });
    return result(year);
  }

  const openings = await money.listOpenings(businessId, year.id);
  const movements = await money.listMovements(businessId, year.id);
  const headings = await headingRepository.listByBusinessId(businessId);
  const withMovements = new Set(movements.map((m) => m.moneyAccountId));
  const accounts = (await money.listAccounts(businessId)).filter((a) => a.isActive || withMovements.has(a.id));
  const summary = summarizeYear({ accounts: accounts.map((a) => ({ id: a.id, openingBalance: openings.get(a.id) ?? "0.00" })), movements });
  report.totals = { byHeading: summary.byHeading, byAccount: summary.byAccount };
  report.defects = profile.defects.filter((d) => RESULT_DEFECTS.has(d.code));

  if (summary.uncodedCount) report.blockers.push({ code: "UNCODED_MOVEMENTS", count: summary.uncodedCount });
  const usable = new Map(usableHeadings(profile).map((h) => [h.position, h]));
  const headingById = new Map(headings.map((h) => [h.id, h]));
  const unusable = [...new Set(movements.map((m) => m.headingId).filter((id): id is string => {
    const heading = id === null ? undefined : headingById.get(id);
    return id !== null && (!heading || heading.blockedReason !== null || !usable.has(heading.position));
  }))];
  if (unusable.length) report.blockers.push({ code: "UNUSABLE_HEADING", headingIds: unusable.sort() });

  const accountOfSheet = new Map<string, string>();
  for (const account of accounts) {
    if (!profile.sheets.some((s) => s.name === account.sheetName)) {
      report.blockers.push({ code: "ACCOUNT_SHEET_MISSING", accountId: account.id, sheetName: account.sheetName });
    } else if (!accountOfSheet.has(account.sheetName)) {
      accountOfSheet.set(account.sheetName, account.id);
    } else if (!report.blockers.some((b) => b.code === "ACCOUNT_SHEET_SHARED" && b.sheetName === account.sheetName)) {
      report.blockers.push({ code: "ACCOUNT_SHEET_SHARED", sheetName: account.sheetName, accountIds: accounts.filter((a) => a.sheetName === account.sheetName).map((a) => a.id) });
    }
  }
  const rowsOf = (accountId: string | null) => (accountId === null ? [] : movements.filter((m) => m.moneyAccountId === accountId));
  for (const sheet of profile.sheets) {
    const accountId = accountOfSheet.get(sheet.name) ?? null;
    const rows = rowsOf(accountId).length;
    const capacity = sheet.safeLastRow - sheet.firstDataRow + 1;
    report.sheets.push({ sheetName: sheet.name, accountId, rowsWritten: rows, capacity, clearedTemplateRows: null, consolidated: sheet.consolidated });
    if (rows > capacity) report.blockers.push({ code: "SHEET_CAPACITY_EXCEEDED", sheetName: sheet.name, rows, capacity });
    if (!sheet.consolidated) report.unconsolidatedTransferCount += rowsOf(accountId).filter((m) => m.transferGroupId !== null).length;
  }
  if (report.blockers.length) return result(year);

  const codeOf = (movement: Movement) => {
    const heading = usable.get(headingById.get(movement.headingId!)!.position)!;
    return { value: heading.templateValue, type: heading.valueType };
  };
  const sheets: WriteSheet[] = profile.sheets.map((sheet) => {
    const accountId = accountOfSheet.get(sheet.name) ?? null;
    return {
      sheetName: sheet.name,
      openingBalance: accountId === null ? null : openings.get(accountId) ?? "0.00",
      rows: rowsOf(accountId).map((m) => ({ date: m.movementDate, narrative: m.narrative, code: codeOf(m), amount: m.amount })),
    };
  });
  let bytes: Buffer;
  try {
    const filled = (dependencies.fill ?? fillWorkbook)(file.data, profile, sheets);
    filled.written.forEach((written, i) => { report.sheets[i].clearedTemplateRows = written.clearedTemplateRows; });
    bytes = filled.bytes;
  } catch (error) {
    if (error instanceof WorkbookWriteError) {
      report.blockers.push({ code: "TEMPLATE_NOT_WRITABLE", reason: error.code, ...(error.detail.sheet && { sheetName: error.detail.sheet }), ...(error.detail.cell && { cell: error.detail.cell }) });
      return result(year);
    }
    if (error instanceof TemplateReadError) {
      report.blockers.push({ code: "TEMPLATE_UNREADABLE", reason: error.code });
      return result(year);
    }
    throw error;
  }

  await readBack(bytes, profile, accountOfSheet, headings, summary);
  return result(year, bytes);
}

/** Recomputes the totals from the written cells alone and requires them, and the file's profile, unchanged. */
async function readBack(bytes: Buffer, profile: TemplateProfile, accountOfSheet: Map<string, string>, headings: Array<{ id: string; position: number }>, expected: YearSummary) {
  const positionOf = new Map(usableHeadings(profile).map((h) => [`${h.valueType}:${h.templateValue}`, h.position]));
  const idOf = new Map(headings.map((h) => [h.position, h.id]));
  let matches = false;
  try {
    const read = readWrittenRows(bytes, profile);
    const accounts: Array<{ id: string; openingBalance: string }> = [];
    const movements: Array<{ moneyAccountId: string; headingId: string | null; amount: string }> = [];
    for (const sheet of read) {
      const accountId = accountOfSheet.get(sheet.sheetName);
      if (accountId === undefined) {
        if (sheet.rows.length) throw new ExportError("EXPORT_READBACK_MISMATCH");
        continue;
      }
      accounts.push({ id: accountId, openingBalance: sheet.openingBalance ?? "0.00" });
      for (const row of sheet.rows) {
        const position = row.code && positionOf.get(`${row.code.type}:${row.code.value}`);
        movements.push({ moneyAccountId: accountId, headingId: position ? idOf.get(position) ?? null : null, amount: row.amount ?? "" });
      }
    }
    matches = isDeepStrictEqual(summarizeYear({ accounts, movements }), expected) && isDeepStrictEqual(await readTemplate(bytes), profile);
  } catch {
    matches = false;
  }
  if (!matches) throw new ExportError("EXPORT_READBACK_MISMATCH");
}
