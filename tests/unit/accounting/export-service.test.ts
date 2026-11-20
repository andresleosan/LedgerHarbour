import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { EXPORT_ERROR_CODES, buildYearExport, getExportReport, type ExportDependencies } from "../../../src/modules/accounting/export-service";
import { createHeadingRepository, listHeadings, setHeadingActive, type AccountHeading } from "../../../src/modules/accounting/heading-service";
import { createMoneyRepository, type Movement } from "../../../src/modules/accounting/money-repository";
import { createFinancialYear, createMoneyAccount, createMovement, setMoneyAccountActive, setOpeningBalance } from "../../../src/modules/accounting/money-service";
import { createTemplateRepository, importTemplate } from "../../../src/modules/accounting/template-service";
import { getYearSummary, summarizeYear } from "../../../src/modules/accounting/year-summary";
import type { StorageAdapter } from "../../../src/modules/documents/storage-adapter";
import { createInMemoryOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import type { UserId } from "../../../src/modules/tenancy/types";
import { readTemplate } from "../../../src/modules/workbook/read-template";
import { fillWorkbook, readWrittenRows } from "../../../src/modules/workbook/write-workbook";
import { SYNTHETIC_SHEETS, buildSyntheticTemplate, type SyntheticTemplateOptions } from "../../fixtures/workbook/synthetic-template";
import { unzip, zip } from "../../fixtures/workbook/zip";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const owner = "export-owner" as UserId;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function memoryStorage() {
  const objects = new Map<string, Uint8Array>();
  const storage: StorageAdapter = {
    async put({ objectKey, data }) { objects.set(objectKey, data); return { objectKey, sizeBytes: data.byteLength }; },
    async get(objectKey) { const data = objects.get(objectKey)!; return new ReadableStream({ start(controller) { controller.enqueue(data); controller.close(); } }); },
    async delete(objectKey) { objects.delete(objectKey); },
  };
  return { objects, storage };
}

async function fixture(options: SyntheticTemplateOptions = { sampleRows: 2 }, upload = true) {
  const tenancy = createInMemoryOnboardingRepository();
  const business = await createApprovedBusiness(tenancy, "Export Books", owner);
  const { objects, storage } = memoryStorage();
  const money = createMoneyRepository();
  const headingRepository = createHeadingRepository();
  const dependencies = { tenancyRepository: tenancy, headings: headingRepository, templates: createTemplateRepository(), money, storage } satisfies ExportDependencies;
  const template = await buildSyntheticTemplate(options);
  if (upload) await importTemplate(business.id, { name: "Accounts.xlsx", mimeType: XLSX, data: new Uint8Array(template) }, owner, dependencies);
  const year = await createFinancialYear(business.id, { startDate: "2026-04-06", endDate: "2027-04-05" }, owner, dependencies);
  const headings = upload ? await listHeadings(business.id, owner, dependencies) : [];
  const heading = (value: string) => headings.find((h) => h.templateValue === value)!;
  if (upload) await setHeadingActive(business.id, heading("17").id, true, owner, dependencies);
  const replaceTemplate = (bytes: Uint8Array) => { for (const key of objects.keys()) objects.set(key, bytes); };
  /** Stored as a later task would store it, without the public API's checks. */
  const insert = (fields: Partial<Movement> & { moneyAccountId: string; amount: string }) => money.createMovement({
    id: randomUUID(), businessId: business.id, financialYearId: year.id, movementDate: "2026-06-01", narrative: "Inserted", headingId: heading("Sales").id,
    origin: "statement", sourceInvoiceId: null, sourceRef: null, transferGroupId: null, deletedAt: null, createdBy: owner,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...fields,
  });
  return { tenancy, business, money, headingRepository, dependencies, template, year, heading, replaceTemplate, insert };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function accounts(f: Fixture) {
  const bank = await createMoneyAccount(f.business.id, { name: "Main bank", kind: "bank", sheetName: SYNTHETIC_SHEETS.main }, owner, f.dependencies);
  const cash = await createMoneyAccount(f.business.id, { name: "Till", kind: "cash", sheetName: SYNTHETIC_SHEETS.cash }, owner, f.dependencies);
  return { bank, cash };
}

const move = (f: Fixture, accountId: string, date: string, narrative: string, value: string, amount: string) =>
  createMovement(f.business.id, { accountId, date, narrative, headingId: f.heading(value).id, amount }, owner, f.dependencies);

describe("year export", () => {
  it("writes each account's movements in date order with its opening balance and reports the result", async () => {
    const f = await fixture();
    const { bank, cash } = await accounts(f);
    await setOpeningBalance(f.business.id, bank.id, f.year.id, "1520.45", owner, f.dependencies);
    // Entered out of date order; a split statement line; a refund on an expense heading.
    await move(f, bank.id, "2026-05-02", "Landlord rent", "Premises", "-800.00");
    await move(f, bank.id, "2026-04-10", "Card takings", "Sales", "312.40");
    await move(f, bank.id, "2026-05-02", "Supplier 123 split", "Stock bought", "-40.00");
    await move(f, bank.id, "2026-05-02", "Supplier 123 split", "Freight in", "-5.55");
    await move(f, bank.id, "2026-06-15", "Rent refund", "Premises", "60.00");
    await move(f, bank.id, "2026-07-01", "Interest", "Sundry income ", "0.03");
    await move(f, cash.id, "2026-04-20", "Till float", "Owner capital", "50.00");
    await move(f, cash.id, "2026-04-21", "Placeholder cost", "17", "-2.20");
    await f.insert({ moneyAccountId: cash.id, movementDate: "2026-04-22", narrative: "To bank", headingId: f.heading("Owner drawings").id, amount: "-10.00", transferGroupId: "t1" });

    const { report, bytes, year } = await buildYearExport(f.business.id, f.year.id, owner, f.dependencies);

    expect(year?.id).toBe(f.year.id);
    expect(report).toMatchObject({ blocked: false, blockers: [], unconsolidatedTransferCount: 1, openingBalancesNeedTrialBalanceEntry: true });
    expect(report.sheets).toEqual([
      { sheetName: SYNTHETIC_SHEETS.main, accountId: bank.id, rowsWritten: 6, capacity: 30, clearedTemplateRows: 2, consolidated: true },
      { sheetName: SYNTHETIC_SHEETS.deposit, accountId: null, rowsWritten: 0, capacity: 20, clearedTemplateRows: 2, consolidated: true },
      { sheetName: SYNTHETIC_SHEETS.cash, accountId: cash.id, rowsWritten: 3, capacity: 20, clearedTemplateRows: 2, consolidated: false },
    ]);
    expect(report.defects.map((d) => d.code).sort()).toEqual(["BLANK_HEADING", "UNCONSOLIDATED_SHEET"]);
    expect(report.totals).toEqual((({ byHeading, byAccount }) => ({ byHeading, byAccount }))(await getYearSummary(f.business.id, f.year.id, owner, f.dependencies)));
    expect(report.totals.byAccount.find((a) => a.accountId === bank.id)).toEqual({ accountId: bank.id, openingPence: 152045, movementsPence: -47312, closingPence: 104733, count: 6 });

    const profile = await readTemplate(f.template);
    const [main, deposit, till] = readWrittenRows(bytes!, profile);
    expect(main).toEqual({
      sheetName: SYNTHETIC_SHEETS.main,
      openingBalance: "1520.45",
      rows: [
        { date: "2026-04-10", narrative: "Card takings", code: { value: "Sales", type: "text" }, amount: "312.40" },
        { date: "2026-05-02", narrative: "Landlord rent", code: { value: "Premises", type: "text" }, amount: "-800.00" },
        { date: "2026-05-02", narrative: "Supplier 123 split", code: { value: "Stock bought", type: "text" }, amount: "-40.00" },
        { date: "2026-05-02", narrative: "Supplier 123 split", code: { value: "Freight in", type: "text" }, amount: "-5.55" },
        { date: "2026-06-15", narrative: "Rent refund", code: { value: "Premises", type: "text" }, amount: "60.00" },
        { date: "2026-07-01", narrative: "Interest", code: { value: "Sundry income ", type: "text" }, amount: "0.03" },
      ],
    });
    // No account on the deposit sheet: sample rows gone, its opening cell as the template had it.
    expect(deposit).toEqual({ sheetName: SYNTHETIC_SHEETS.deposit, openingBalance: "1000.00", rows: [] });
    expect(till.openingBalance).toBe("0.00");
    expect(till.rows.map((r) => [r.code, r.amount])).toEqual([[{ value: "Owner capital", type: "text" }, "50.00"], [{ value: "17", type: "number" }, "-2.20"], [{ value: "Owner drawings", type: "text" }, "-10.00"]]);

    const audit = (await f.tenancy.listAuditEvents(f.business.id)).filter((e) => e.type === "workbook_exported");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityId: f.year.id, metadata: { financialYearId: f.year.id, sheets: 3, rows: 9 } });
    expect(JSON.stringify(audit[0].metadata)).not.toMatch(/takings|rent|Sales/i);
  });

  it("gives the same report without a file or an audit event", async () => {
    const f = await fixture();
    const { bank } = await accounts(f);
    await move(f, bank.id, "2026-05-02", "Rent", "Premises", "-800.00");
    const report = await getExportReport(f.business.id, f.year.id, owner, f.dependencies);
    expect(report).toEqual((await buildYearExport(f.business.id, f.year.id, owner, f.dependencies)).report);
    expect((await f.tenancy.listAuditEvents(f.business.id)).filter((e) => e.type === "workbook_exported")).toHaveLength(1);
  });

  it("leaves out an inactive account with no movements in the summary as in the export", async () => {
    const f = await fixture();
    const { bank } = await accounts(f);
    const closed = await createMoneyAccount(f.business.id, { name: "Closed bank", kind: "bank", sheetName: SYNTHETIC_SHEETS.deposit }, owner, f.dependencies);
    await move(f, bank.id, "2026-05-02", "Rent", "Premises", "-800.00");
    // An account closed during the year still carries its movements; one never used drops out.
    await f.insert({ moneyAccountId: closed.id, amount: "-1.00" });
    await setMoneyAccountActive(f.business.id, closed.id, false, owner, f.dependencies);
    const dormant = await createMoneyAccount(f.business.id, { name: "Dormant bank", kind: "bank", sheetName: SYNTHETIC_SHEETS.deposit }, owner, f.dependencies);
    await setMoneyAccountActive(f.business.id, dormant.id, false, owner, f.dependencies);

    const summary = await getYearSummary(f.business.id, f.year.id, owner, f.dependencies);
    const report = await getExportReport(f.business.id, f.year.id, owner, f.dependencies);
    expect(summary.byAccount.map((row) => row.accountId)).not.toContain(dormant.id);
    expect(summary.byAccount.map((row) => row.accountId)).toContain(closed.id);
    expect(summary.byAccount).toEqual(report.totals.byAccount);
  });

  it("matches the stored totals to the penny for hundreds of movements", async () => {
    const f = await fixture({ dataRows: 200, sampleRows: 3 });
    const { bank, cash } = await accounts(f);
    const deposit = await createMoneyAccount(f.business.id, { name: "Deposit", kind: "bank", sheetName: SYNTHETIC_SHEETS.deposit }, owner, f.dependencies);
    const values = ["Sales", "Sundry income ", "Premises", "Staff costs", "Phone", "17", "Owner drawings", "Tools"];
    const expected = new Map<string, number>();
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let i = 0; i < 540; i++) {
      const pence = (next() % 2_000_001) - 1_000_000 || 1;
      const value = values[next() % values.length];
      const account = [bank, cash, deposit][i % 3];
      const amount = `${pence < 0 ? "-" : ""}${Math.trunc(Math.abs(pence) / 100)}.${String(Math.abs(pence) % 100).padStart(2, "0")}`;
      await f.insert({ moneyAccountId: account.id, movementDate: `2026-${String(4 + (i % 9)).padStart(2, "0")}-${String(10 + (i % 18)).padStart(2, "0")}`, narrative: `Line ${i}`, headingId: f.heading(value).id, amount });
      expected.set(value, (expected.get(value) ?? 0) + pence);
    }
    const { report, bytes } = await buildYearExport(f.business.id, f.year.id, owner, f.dependencies);
    expect(report.blocked).toBe(false);
    expect(report.sheets.map((s) => s.rowsWritten)).toEqual([180, 180, 180]);
    for (const [value, pence] of expected) expect(report.totals.byHeading.find((h) => h.headingId === f.heading(value).id)?.pence, value).toBe(pence);

    const written = new Map<string, number>();
    for (const sheet of readWrittenRows(bytes!, await readTemplate(f.template))) {
      for (const row of sheet.rows) {
        const [pounds, pence] = row.amount!.replace("-", "").split(".").map(Number);
        written.set(row.code!.value, (written.get(row.code!.value) ?? 0) + (row.amount!.startsWith("-") ? -1 : 1) * (pounds * 100 + pence));
      }
    }
    expect(written).toEqual(expected);
  });

  it("catches a writer whose file does not read back as the stored rows", async () => {
    const f = await fixture();
    const { bank } = await accounts(f);
    await move(f, bank.id, "2026-05-02", "Rent", "Premises", "-800.00");
    await move(f, bank.id, "2026-05-03", "Takings", "Sales", "100.00");
    const faulty: typeof fillWorkbook[] = [
      (bytes, profile, sheets) => fillWorkbook(bytes, profile, sheets.map((s) => ({ ...s, rows: s.rows.map((r, i) => (i === 1 ? { ...r, amount: "100.01" } : r)) }))),
      (bytes, profile, sheets) => fillWorkbook(bytes, profile, sheets.map((s) => ({ ...s, rows: s.rows.map((r) => ({ ...r, code: { value: "Phone", type: "text" } })) }))),
      (bytes, profile, sheets) => fillWorkbook(bytes, profile, sheets.map((s) => ({ ...s, rows: s.rows.slice(1) }))),
      (bytes, profile, sheets) => fillWorkbook(bytes, profile, sheets.map((s) => ({ ...s, openingBalance: s.openingBalance && "0.01" }))),
      (bytes, profile, sheets) => {
        const result = fillWorkbook(bytes, profile, sheets);
        const edited = zip(unzip(result.bytes).map((e) => (e.name === "xl/worksheets/sheet4.xml" ? { ...e, data: Buffer.from(e.data.toString().replace("<f>", "<f>#REF!+")) } : e)));
        return { ...result, bytes: edited };
      },
    ];
    for (const fill of faulty) {
      await expect(buildYearExport(f.business.id, f.year.id, owner, { ...f.dependencies, fill })).rejects.toMatchObject({ code: EXPORT_ERROR_CODES.EXPORT_READBACK_MISMATCH });
    }
    expect((await f.tenancy.listAuditEvents(f.business.id)).filter((e) => e.type === "workbook_exported")).toHaveLength(0);
  });
});

describe("year export blockers", () => {
  const blocked = async (f: Fixture, yearId = f.year.id) => {
    const { report, bytes } = await buildYearExport(f.business.id, yearId, owner, f.dependencies);
    expect(bytes).toBeNull();
    expect(report.blocked).toBe(true);
    return report.blockers;
  };

  it("blocks without a year or a template", async () => {
    const f = await fixture(undefined, false);
    expect(await blocked(f, "no-such-year")).toEqual([{ code: "YEAR_NOT_FOUND" }, { code: "NO_TEMPLATE" }]);
    expect(await blocked(f)).toEqual([{ code: "NO_TEMPLATE" }]);
  });

  it("blocks on uncoded movements and on headings the template no longer allows", async () => {
    const f = await fixture();
    const { bank } = await accounts(f);
    await f.insert({ moneyAccountId: bank.id, headingId: null, amount: "1.00" });
    await f.insert({ moneyAccountId: bank.id, headingId: null, amount: "2.00" });
    const doNotUse = f.heading("Motor - do not use");
    await f.insert({ moneyAccountId: bank.id, headingId: doNotUse.id, amount: "3.00" });
    const missing = f.heading("Phone");
    await f.headingRepository.update({ ...missing, isActive: false, blockedReason: "missing_from_template" }, f.business.id);
    await f.insert({ moneyAccountId: bank.id, headingId: missing.id, amount: "4.00" });
    expect(await blocked(f)).toEqual([{ code: "UNCODED_MOVEMENTS", count: 2 }, { code: "UNUSABLE_HEADING", headingIds: [doNotUse.id, missing.id].sort() }]);
  });

  it("blocks on a heading absent from the template as read now", async () => {
    const f = await fixture();
    const { bank } = await accounts(f);
    await move(f, bank.id, "2026-05-02", "Takings", "Sales", "1.00");
    const moved: AccountHeading = f.heading("Sales");
    await f.headingRepository.update({ ...moved, position: 99 }, f.business.id);
    expect(await blocked(f)).toEqual([{ code: "UNUSABLE_HEADING", headingIds: [moved.id] }]);
  });

  it("blocks on an account without a sheet and on a sheet over its capacity", async () => {
    const f = await fixture();
    const { bank } = await accounts(f);
    const old = await f.money.createAccount({ id: "old-account", businessId: f.business.id, name: "Old", kind: "bank", sheetName: "Old Sheet", isActive: true, createdAt: "", updatedAt: "" });
    for (let i = 0; i < 31; i++) await f.insert({ moneyAccountId: bank.id, amount: "1.00" });
    expect(await blocked(f)).toEqual([
      { code: "ACCOUNT_SHEET_MISSING", accountId: old.id, sheetName: "Old Sheet" },
      { code: "SHEET_CAPACITY_EXCEEDED", sheetName: SYNTHETIC_SHEETS.main, rows: 31, capacity: 30 },
    ]);
  });

  it("blocks on two accounts with movements on one sheet", async () => {
    const f = await fixture();
    const { bank } = await accounts(f);
    await f.insert({ moneyAccountId: bank.id, amount: "1.00" });
    await f.money.updateAccount({ ...bank, isActive: false }, f.business.id);
    const second = await createMoneyAccount(f.business.id, { name: "New bank", kind: "bank", sheetName: SYNTHETIC_SHEETS.main }, owner, f.dependencies);
    expect(await blocked(f)).toEqual([{ code: "ACCOUNT_SHEET_SHARED", sheetName: SYNTHETIC_SHEETS.main, accountIds: [bank.id, second.id] }]);
  });

  it("blocks on a template it cannot read or must not write", async () => {
    const f = await fixture();
    const { bank } = await accounts(f);
    await move(f, bank.id, "2026-05-02", "Takings", "Sales", "1.00");
    const formula = zip(unzip(f.template).map((e) => (e.name === "xl/worksheets/sheet1.xml" ? { ...e, data: Buffer.from(e.data.toString().replace(/<c r="B20" s="2"\/>/, '<c r="B20" s="2"><f>TODAY()</f></c>')) } : e)));
    f.replaceTemplate(formula);
    expect(await blocked(f)).toEqual([{ code: "TEMPLATE_NOT_WRITABLE", reason: "INPUT_CELL_HAS_FORMULA", sheetName: SYNTHETIC_SHEETS.main, cell: "B20" }]);
    f.replaceTemplate(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]));
    expect(await blocked(f)).toEqual([{ code: "TEMPLATE_UNREADABLE", reason: "NOT_A_WORKBOOK" }]);
    expect((await f.tenancy.listAuditEvents(f.business.id)).filter((e) => e.type === "workbook_exported")).toHaveLength(0);
  });
});

describe("summarizeYear", () => {
  it("totals per heading and per account in pence, counting uncoded movements apart", () => {
    expect(summarizeYear({
      accounts: [{ id: "b", openingBalance: "10.10" }, { id: "a", openingBalance: "-0.01" }],
      movements: [
        { moneyAccountId: "a", headingId: "h2", amount: "0.10" },
        { moneyAccountId: "a", headingId: "h1", amount: "0.20" },
        { moneyAccountId: "b", headingId: "h2", amount: "-0.30" },
        { moneyAccountId: "c", headingId: null, amount: "5.00" },
      ],
    })).toEqual({
      byHeading: [{ headingId: "h1", pence: 20, count: 1 }, { headingId: "h2", pence: -20, count: 2 }],
      byAccount: [
        { accountId: "a", openingPence: -1, movementsPence: 30, closingPence: 29, count: 2 },
        { accountId: "b", openingPence: 1010, movementsPence: -30, closingPence: 980, count: 1 },
        { accountId: "c", openingPence: 0, movementsPence: 500, closingPence: 500, count: 1 },
      ],
      uncodedCount: 1,
    });
  });
});
