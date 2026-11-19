import { describe, expect, it } from "vitest";

import { createHeadingRepository, importHeadings, listHeadings, setHeadingActive, type TemplateHeadingInput } from "../../../src/modules/accounting/heading-service";
import { parsePounds, sumPence } from "../../../src/modules/accounting/money";
import { MONEY_ERROR_CODES, createMoneyRepository } from "../../../src/modules/accounting/money-repository";
import {
  closeFinancialYear,
  createFinancialYear,
  createMoneyAccount,
  createMovement,
  createMovementsInTransaction,
  createTransfer,
  listMovements,
  setMoneyAccountActive,
  type MoneyDependencies,
} from "../../../src/modules/accounting/money-service";
import {
  STATEMENT_IMPORT_ERROR_CODES,
  codeStatementMovement,
  deleteStatementMovement,
  importStatement,
  listUncodedStatementMovements,
  previewStatement,
} from "../../../src/modules/accounting/statement-import-service";
import { createTemplateRepository } from "../../../src/modules/accounting/template-service";
import { getYearSummary } from "../../../src/modules/accounting/year-summary";
import type { AccountSheet } from "../../../src/modules/workbook/template-profile";
import { createInMemoryOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import type { UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

// Synthetic statements only: invented payees, dates and amounts.
const owner = "statement-owner" as UserId;
const headingInputs: TemplateHeadingInput[] = [
  { position: 1, templateValue: "Sales", valueType: "text", group: "income", order: 1, blockedReason: null },
  { position: 2, templateValue: "Bank charges", valueType: "text", group: "expenses", order: 2, blockedReason: null },
  { position: 3, templateValue: "Transfers", valueType: "text", group: "assets", order: 3, blockedReason: null },
];

async function ledger() {
  const tenancy = createInMemoryOnboardingRepository();
  const business = await createApprovedBusiness(tenancy, "Statement Books", owner);
  const headings = createHeadingRepository();
  const templates = createTemplateRepository();
  const money = createMoneyRepository();
  const dependencies = { tenancyRepository: tenancy, money, headings, templates } satisfies MoneyDependencies;
  await importHeadings(business.id, headingInputs, owner, { tenancyRepository: tenancy, headings });
  const [sales, charges, transfers] = await listHeadings(business.id, owner, { tenancyRepository: tenancy, headings });
  await templates.upsert({
    id: "template-1",
    businessId: business.id,
    privateObjectKey: "key",
    originalFileName: "Accounts.xlsx",
    sizeBytes: 1,
    checksum: "a".repeat(64),
    profile: { sheets: ["Main Bank", "Cash"].map((name) => ({ name }) as AccountSheet), defects: [] },
    uploadedBy: owner,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const year = await createFinancialYear(business.id, { startDate: "2026-04-06", endDate: "2027-04-05" }, owner, dependencies);
  const bank = await createMoneyAccount(business.id, { name: "Main bank", kind: "bank", sheetName: "Main Bank" }, owner, dependencies);
  const cash = await createMoneyAccount(business.id, { name: "Till", kind: "cash", sheetName: "Cash" }, owner, dependencies);
  const live = () => listMovements(business.id, { yearId: year.id }, owner, dependencies);
  const manual = (date: string, amount: string, narrative = "Manual") => createMovement(business.id, { accountId: bank.id, date, amount, narrative, headingId: charges.id }, owner, dependencies);
  const preview = (csv: string, extra: object = {}) => previewStatement(business.id, { accountId: bank.id, csv, ...extra }, owner, dependencies);
  const run = (csv: string, extra: object = {}) => importStatement(business.id, { accountId: bank.id, csv, ...extra }, owner, dependencies);
  const tray = () => listUncodedStatementMovements(business.id, year.id, owner, dependencies);
  return { tenancy, business, dependencies, money, headings, year, bank, cash, sales, charges, transfers, live, manual, preview, run, tray };
}

const statement = (...lines: string[]) => ["Date,Description,Amount", ...lines].join("\n");

describe("statement preview and import", () => {
  it("previews without writing anything and shows the first ten lines with their outcome", async () => {
    const { preview, money, tenancy, business, manual } = await ledger();
    await manual("2026-05-01", "-9.99");
    const lines = Array.from({ length: 12 }, (_, index) => `2026-05-${String(index + 2).padStart(2, "0")},Line ${index},${index + 1}.00`);
    const before = { movements: money.movements.size, audit: (await tenancy.listAuditEvents(business.id)).length };
    const result = await preview(statement("2026-05-03,Card fee,-9.99", ...lines, "2026-05-20,Nothing,0", "2026-05-21,Bad,1.234"));
    expect(result.mapping).toEqual({ date: 0, description: 1, amount: 2 });
    expect(result.headers).toEqual(["Date", "Description", "Amount"]);
    expect(result.rows).toHaveLength(10);
    expect(result.rows[0]).toEqual({ line: 2, date: "2026-05-03", description: "Card fee", amountPence: -999, outcome: "already_recorded" });
    expect(result.rows[1]).toMatchObject({ line: 3, outcome: "new" });
    expect(result.counts).toEqual({ total: 15, toImport: 12, alreadyImported: 0, alreadyRecorded: 1, skipped: { zero: 1, notSterling: 0, notCompleted: 0 } });
    expect(result.errors).toEqual([{ line: 16, reason: "INVALID_AMOUNT" }]);
    expect({ movements: money.movements.size, audit: (await tenancy.listAuditEvents(business.id)).length }).toEqual(before);
  });

  it("imports each new line as an uncoded statement movement in file order and audits counts only", async () => {
    const { run, live, bank, tenancy, business } = await ledger();
    const long = "x".repeat(250);
    const result = await run(statement("2026-05-02,Coffee Co,-3.20", "2026-05-02,Bakery,-0.50", "2026-05-01,Customer pays,120", `2026-05-03,${long},-1`, "2026-05-04,,5"));
    expect(result.counts).toMatchObject({ toImport: 5, alreadyImported: 0, alreadyRecorded: 0 });
    expect(result.imported).toBe(5);
    const rows = await live();
    expect(rows.map((row) => [row.movementDate, row.narrative.slice(0, 20), row.amount, row.origin, row.headingId, row.moneyAccountId])).toEqual([
      ["2026-05-01", "Customer pays", "120.00", "statement", null, bank.id],
      ["2026-05-02", "Coffee Co", "-3.20", "statement", null, bank.id],
      ["2026-05-02", "Bakery", "-0.50", "statement", null, bank.id],
      ["2026-05-03", "x".repeat(20), "-1.00", "statement", null, bank.id],
      ["2026-05-04", "Bank statement line", "5.00", "statement", null, bank.id],
    ]);
    expect(rows[3].narrative).toHaveLength(200);
    for (const row of rows) expect(row.sourceRef).toMatch(/^stmt:[0-9a-f]{64}$/);
    const event = (await tenancy.listAuditEvents(business.id)).at(-1)!;
    expect(event).toMatchObject({ type: "statement_imported", entityId: bank.id, metadata: { imported: 5, alreadyImported: 0, alreadyRecorded: 0, skipped: 0 } });
    expect(JSON.stringify(event.metadata)).not.toMatch(/Coffee|3\.20|120/);
  });

  it("re-importing the same file imports nothing, while identical lines in one file both import", async () => {
    const { run, preview, live, business, dependencies } = await ledger();
    const file = statement("2026-05-01,Parking,-2.00", "2026-05-01,Parking,-2.00", "2026-05-02,Other,-1.00");
    expect((await run(file)).imported).toBe(3);
    expect((await preview(file)).counts).toMatchObject({ toImport: 0, alreadyImported: 3, alreadyRecorded: 0 });
    expect((await run(file)).imported).toBe(0);
    expect(await live()).toHaveLength(3);
    // The same file with one more identical line adds only that one.
    expect((await run(`${file}\n2026-05-01,Parking,-2.00`)).counts).toMatchObject({ toImport: 1, alreadyImported: 3 });
    // A line deleted by mistake is no longer "imported".
    const [first] = await live();
    await deleteStatementMovement(business.id, first.id, owner, dependencies);
    expect((await preview(file)).counts).toMatchObject({ toImport: 1, alreadyImported: 2 });
  });

  it("matches by amount within five days either side, one existing movement per line, closest date first", async () => {
    const { manual, preview, run, live } = await ledger();
    await manual("2026-05-10", "-45.00", "Early");
    await manual("2026-05-12", "-45.00", "Late");
    await manual("2026-06-10", "-45.00", "June");
    await manual("2026-06-10", "-46.00", "Other amount");
    const result = await preview(statement(
      "2026-05-13,A,-45.00", // closest is Late (1 day)
      "2026-05-15,B,-45.00", // Late taken; Early is 5 days away: matches
      "2026-05-15,C,-45.00", // nothing left
      "2026-06-16,D,-45.00", // June is 6 days away: no match
      "2026-06-04,E,-46.00", // 6 days before: no match
      "2026-06-05,F,-46.00", // 5 days before: match
    ));
    expect(result.rows.map((row) => row.outcome)).toEqual(["already_recorded", "already_recorded", "new", "new", "new", "already_recorded"]);
    expect(result.counts).toMatchObject({ toImport: 3, alreadyRecorded: 3 });
    await run(statement("2026-05-13,A,-45.00", "2026-05-15,B,-45.00", "2026-05-15,C,-45.00", "2026-06-16,D,-45.00", "2026-06-04,E,-46.00", "2026-06-05,F,-46.00"));
    expect((await live()).filter((row) => row.origin === "statement").map((row) => row.narrative)).toEqual(["C", "E", "D"]);
  });

  it("breaks a tie on distance by the oldest created movement, deterministically", async () => {
    const { manual, preview } = await ledger();
    await manual("2026-05-12", "-10.00", "After");
    await manual("2026-05-08", "-10.00", "Before");
    const first = await preview(statement("2026-05-10,Tie,-10.00", "2026-05-10,Tie,-10.00", "2026-05-10,Tie,-10.00"));
    expect(first.rows.map((row) => row.outcome)).toEqual(["already_recorded", "already_recorded", "new"]);
    expect(await preview(statement("2026-05-10,Tie,-10.00", "2026-05-10,Tie,-10.00", "2026-05-10,Tie,-10.00"))).toEqual(first);
  });

  it("does not duplicate a transfer leg or a payment created from an invoice", async () => {
    const { business, dependencies, bank, cash, transfers, charges, tenancy, money, headings, run, live } = await ledger();
    await createTransfer(business.id, { fromAccountId: bank.id, toAccountId: cash.id, date: "2026-07-01", amount: "200.00", headingId: transfers.id }, owner, dependencies);
    await money.transaction(() => createMovementsInTransaction({ businessId: business.id, actorId: owner, tenancy, money, headings }, [
      { accountId: bank.id, date: "2026-07-03", narrative: "Supplier INV-1", headingId: charges.id, amount: "-80.00", origin: "invoice", sourceInvoiceId: "invoice-1" },
    ]));
    const result = await run(statement("2026-07-02,To till,-200.00", "2026-07-06,Supplier,-80.00", "2026-07-06,Unrelated,200.00"));
    expect(result.counts).toMatchObject({ toImport: 1, alreadyRecorded: 2 });
    expect((await live()).filter((row) => row.origin === "statement").map((row) => row.narrative)).toEqual(["Unrelated"]);
  });

  it("refuses the whole file when a date is outside the open year or any line has an error", async () => {
    const { preview, run, live, year, business, dependencies } = await ledger();
    const outside = statement("2026-05-01,Fine,1", "2027-04-06,Too late,1");
    expect((await preview(outside)).errors).toEqual([{ line: 3, reason: "OUTSIDE_OPEN_YEAR" }]);
    await expect(run(outside)).rejects.toMatchObject({ code: STATEMENT_IMPORT_ERROR_CODES.STATEMENT_HAS_ERRORS, errors: [{ line: 3, reason: "OUTSIDE_OPEN_YEAR" }] });
    await expect(run(statement("2026-05-03,Fine,1", "2026-05-04,Bad,12.345"))).rejects.toMatchObject({ code: STATEMENT_IMPORT_ERROR_CODES.STATEMENT_HAS_ERRORS });
    expect((await live()).map((row) => row.narrative)).not.toContain("Fine");
    await closeFinancialYear(business.id, year.id, owner, dependencies);
    expect((await preview(statement("2026-05-05,Closed,1"))).errors).toEqual([{ line: 2, reason: "OUTSIDE_OPEN_YEAR" }]);
  });

  it("asks for the columns, the date format and refuses unreadable files with typed codes", async () => {
    const { preview, run } = await ledger();
    const unknown = "When,What,How much\n2026-05-01,Thing,-2";
    expect(await preview(unknown)).toMatchObject({ mapping: null, headers: ["When", "What", "How much"], rows: [] });
    await expect(run(unknown)).rejects.toMatchObject({ code: STATEMENT_IMPORT_ERROR_CODES.COLUMNS_REQUIRED });
    expect((await run(unknown, { mapping: { date: 0, description: 1, amount: 2 } })).imported).toBe(1);
    const ambiguous = statement("05/13/2026,US style,-1");
    expect(await preview(ambiguous)).toMatchObject({ needsDateFormat: true, dateFormat: null });
    await expect(run(ambiguous)).rejects.toMatchObject({ code: STATEMENT_IMPORT_ERROR_CODES.DATE_FORMAT_REQUIRED });
    expect((await run(ambiguous, { dateFormat: "month_first" })).imported).toBe(1);
    await expect(preview("\n")).rejects.toMatchObject({ code: STATEMENT_IMPORT_ERROR_CODES.EMPTY_STATEMENT });
    await expect(preview(statement("2026-05-01,\"open,1"))).rejects.toMatchObject({ code: STATEMENT_IMPORT_ERROR_CODES.MALFORMED_CSV });
    await expect(preview(statement("x".repeat(1024 * 1024)))).rejects.toMatchObject({ code: STATEMENT_IMPORT_ERROR_CODES.TOO_LARGE });
    await expect(preview(unknown, { mapping: { date: 0, description: 0, amount: 2 } })).rejects.toMatchObject({ code: STATEMENT_IMPORT_ERROR_CODES.INVALID_MAPPING });
  });

  it("refuses an inactive or unknown account", async () => {
    const { business, dependencies, bank, preview } = await ledger();
    await expect(previewStatement(business.id, { accountId: "nope", csv: statement("2026-05-01,a,1") }, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND });
    await setMoneyAccountActive(business.id, bank.id, false, owner, dependencies);
    await expect(preview(statement("2026-05-01,a,1"))).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_ACCOUNT_INACTIVE });
  });

  it("keeps exact pence over a few hundred lines", async () => {
    const { run, live } = await ledger();
    const amounts = Array.from({ length: 400 }, (_, index) => (index % 3 === 0 ? 1 : -1) * (index * 7919 % 100_000 + 1));
    const lines = amounts.map((value, index) => `2026-08-${String(index % 28 + 1).padStart(2, "0")},Line ${index},${value < 0 ? "-" : ""}${Math.trunc(Math.abs(value) / 100)}.${String(Math.abs(value) % 100).padStart(2, "0")}`);
    expect((await run(statement(...lines))).imported).toBe(400);
    const stored = (await live()).map((row) => parsePounds(row.amount));
    expect(sumPence(stored)).toBe(sumPence(amounts));
    expect(stored.sort((a, b) => a - b)).toEqual([...amounts].sort((a, b) => a - b));
  });
});

describe("the to-code tray", () => {
  it("lists uncoded statement lines, codes, un-codes and deletes them; the year summary counts the same", async () => {
    const { run, tray, business, dependencies, sales, charges, year, live, manual } = await ledger();
    await manual("2026-04-20", "-1.00", "Not a statement row");
    await run(statement("2026-05-01,Card takings,50", "2026-05-02,Bank fee,-2.50", "2026-05-03,Mistake,9"));
    const rows = await tray();
    expect(rows.map((row) => row.narrative)).toEqual(["Card takings", "Bank fee", "Mistake"]);
    expect((await getYearSummary(business.id, year.id, owner, dependencies)).uncodedCount).toBe(rows.length);

    const coded = await codeStatementMovement(business.id, rows[0].id, sales.id, owner, dependencies);
    expect(coded).toMatchObject({ headingId: sales.id, origin: "statement" });
    expect((await tray()).map((row) => row.narrative)).toEqual(["Bank fee", "Mistake"]);
    await codeStatementMovement(business.id, rows[0].id, null, owner, dependencies);
    expect(await tray()).toHaveLength(3);
    await codeStatementMovement(business.id, rows[1].id, charges.id, owner, dependencies);
    await deleteStatementMovement(business.id, rows[2].id, owner, dependencies);
    expect((await tray()).map((row) => row.narrative)).toEqual(["Card takings"]);
    expect((await getYearSummary(business.id, year.id, owner, dependencies)).uncodedCount).toBe(1);
    expect((await live()).find((row) => row.id === rows[1].id)).toMatchObject({ origin: "statement", headingId: charges.id });
    expect((await live()).some((row) => row.id === rows[2].id)).toBe(false);
  });

  it("refuses non-statement rows, unusable headings and closed years, and audits ids only", async () => {
    const { run, tray, business, dependencies, sales, year, manual, tenancy, headings } = await ledger();
    const handmade = await manual("2026-04-20", "-1.00");
    await run(statement("2026-05-01,Fee,-2.50"));
    const [row] = await tray();
    await expect(codeStatementMovement(business.id, handmade.id, sales.id, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MOVEMENT_ORIGIN_NOT_EDITABLE });
    await expect(deleteStatementMovement(business.id, handmade.id, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MOVEMENT_ORIGIN_NOT_EDITABLE });
    await expect(codeStatementMovement(business.id, row.id, "missing", owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.HEADING_NOT_FOUND });
    await setHeadingActive(business.id, sales.id, false, owner, { tenancyRepository: tenancy, headings });
    await expect(codeStatementMovement(business.id, row.id, sales.id, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.HEADING_NOT_USABLE });
    await expect(codeStatementMovement(business.id, "missing", null, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MOVEMENT_NOT_FOUND });

    await setHeadingActive(business.id, sales.id, true, owner, { tenancyRepository: tenancy, headings });
    await codeStatementMovement(business.id, row.id, sales.id, owner, dependencies);
    const event = (await tenancy.listAuditEvents(business.id)).at(-1)!;
    expect(event).toMatchObject({ type: "statement_movement_coded", entityId: row.id, metadata: { headingId: sales.id, financialYearId: year.id } });
    expect(JSON.stringify(event.metadata)).not.toMatch(/Fee|2\.50/);

    await closeFinancialYear(business.id, year.id, owner, dependencies);
    await expect(codeStatementMovement(business.id, row.id, null, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.FINANCIAL_YEAR_CLOSED });
    await expect(deleteStatementMovement(business.id, row.id, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.FINANCIAL_YEAR_CLOSED });
  });

  it("suggests the heading last used on a movement with the same narrative while it is still usable", async () => {
    const { run, tray, business, dependencies, sales, charges, manual, tenancy, headings, bank } = await ledger();
    await createMovement(business.id, { accountId: bank.id, date: "2026-04-10", amount: "-3.00", narrative: "  coffee co ", headingId: sales.id }, owner, dependencies);
    await manual("2026-04-11", "-3.00", "COFFEE CO");
    await run(statement("2026-05-01,Coffee Co,-4.00", "2026-05-02,Somebody new,-1.00", "2026-05-03,,-1.00", "2026-05-04,,-2.00"));
    const rows = await tray();
    expect(rows.map((row) => [row.narrative, row.suggestedHeadingId])).toEqual([["Coffee Co", charges.id], ["Somebody new", null], ["Bank statement line", null], ["Bank statement line", null]]);
    // Coding one empty-description line does not make the neutral narrative a suggestion.
    await codeStatementMovement(business.id, rows[2].id, sales.id, owner, dependencies);
    expect((await tray()).at(-1)!.suggestedHeadingId).toBeNull();
    await setHeadingActive(business.id, charges.id, false, owner, { tenancyRepository: tenancy, headings });
    expect((await tray())[0].suggestedHeadingId).toBeNull();
    // Nothing is applied until the user saves.
    expect((await tray())[0].headingId).toBeNull();
  });
});
