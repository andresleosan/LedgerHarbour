import { describe, expect, it } from "vitest";

import { createHeadingRepository, importHeadings, listHeadings, setHeadingActive, type TemplateHeadingInput } from "../../../src/modules/accounting/heading-service";
import { formatPence, parsePounds, sumPence } from "../../../src/modules/accounting/money";
import { MONEY_ERROR_CODES, createMoneyRepository } from "../../../src/modules/accounting/money-repository";
import {
  closeFinancialYear,
  createFinancialYear,
  createMoneyAccount,
  createMovement,
  createMovementsInTransaction,
  deleteMovement,
  listFinancialYears,
  listMoneyAccounts,
  listMovements,
  removeInvoiceMovements,
  renameMoneyAccount,
  reopenFinancialYear,
  replaceInvoiceMovements,
  setMoneyAccountActive,
  setOpeningBalance,
  updateFinancialYearDates,
  updateMovement,
  type MoneyDependencies,
  type MovementWriteContext,
} from "../../../src/modules/accounting/money-service";
import { createTemplateRepository } from "../../../src/modules/accounting/template-service";
import type { AccountSheet } from "../../../src/modules/workbook/template-profile";
import { createInMemoryOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import type { UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const owner = "money-owner" as UserId;
const headingInputs: TemplateHeadingInput[] = [
  { position: 1, templateValue: "Sales", valueType: "text", group: "income", order: 1, blockedReason: null },
  { position: 2, templateValue: "Rent", valueType: "text", group: "expenses", order: 2, blockedReason: null },
  { position: 3, templateValue: "Unused", valueType: "text", group: "expenses", order: 3, blockedReason: "marked_do_not_use" },
];

async function context(options: { template?: boolean } = {}) {
  const tenancy = createInMemoryOnboardingRepository();
  const business = await createApprovedBusiness(tenancy, "Money Books", owner);
  const headings = createHeadingRepository();
  const templates = createTemplateRepository();
  const money = createMoneyRepository();
  const dependencies = { tenancyRepository: tenancy, money, headings, templates } satisfies MoneyDependencies;
  await importHeadings(business.id, headingInputs, owner, { tenancyRepository: tenancy, headings });
  const [sales, rent, blocked] = await listHeadings(business.id, owner, { tenancyRepository: tenancy, headings });
  if (options.template !== false) {
    await templates.upsert({
      id: "template-1",
      businessId: business.id,
      privateObjectKey: "key",
      originalFileName: "Accounts.xlsx",
      sizeBytes: 1,
      checksum: "a".repeat(64),
      profile: { sheets: ["Main Bank", "Deposit", "Cash"].map((name) => ({ name }) as AccountSheet), defects: [] },
      uploadedBy: owner,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }
  return { tenancy, business, dependencies, money, headings, sales, rent, blocked };
}

async function ledger() {
  const fixture = await context();
  const year = await createFinancialYear(fixture.business.id, { startDate: "2026-04-06", endDate: "2027-04-05" }, owner, fixture.dependencies);
  const bank = await createMoneyAccount(fixture.business.id, { name: "Main bank", kind: "bank", sheetName: "Main Bank" }, owner, fixture.dependencies);
  const manual = (overrides: Record<string, unknown> = {}) => ({ accountId: bank.id, date: "2026-05-01", narrative: "Shop takings", headingId: fixture.sales.id, amount: "10.00", ...overrides });
  return { ...fixture, year, bank, manual };
}

const codes = MONEY_ERROR_CODES;

describe("financial years", () => {
  it("creates an open year, lists it, and audits it", async () => {
    const { business, dependencies, tenancy } = await context();
    const year = await createFinancialYear(business.id, { startDate: "2026-01-01", endDate: "2026-12-31" }, owner, dependencies);
    expect(year).toMatchObject({ businessId: business.id, startDate: "2026-01-01", endDate: "2026-12-31", status: "open" });
    await expect(listFinancialYears(business.id, owner, dependencies)).resolves.toEqual([year]);
    expect((await tenancy.listAuditEvents(business.id)).at(-1)).toMatchObject({ type: "financial_year_created", entityId: year.id });
  });

  it.each([
    ["end before start", "2026-12-31", "2026-01-01"],
    ["end equal to start", "2026-01-01", "2026-01-01"],
    ["impossible date", "2026-02-30", "2026-12-31"],
    ["not ISO", "01/01/2026", "2026-12-31"],
    ["a timestamp", "2026-01-01T00:00:00Z", "2026-12-31"],
  ])("rejects %s", async (_label, startDate, endDate) => {
    const { business, dependencies } = await context();
    await expect(createFinancialYear(business.id, { startDate, endDate }, owner, dependencies)).rejects.toMatchObject({ code: codes.INVALID_FINANCIAL_YEAR });
  });

  it("rejects a second open year and an overlapping year", async () => {
    const { business, dependencies } = await context();
    const first = await createFinancialYear(business.id, { startDate: "2026-01-01", endDate: "2026-12-31" }, owner, dependencies);
    await expect(createFinancialYear(business.id, { startDate: "2027-01-01", endDate: "2027-12-31" }, owner, dependencies)).rejects.toMatchObject({ code: codes.FINANCIAL_YEAR_ALREADY_OPEN });
    await closeFinancialYear(business.id, first.id, owner, dependencies);
    await expect(createFinancialYear(business.id, { startDate: "2026-12-31", endDate: "2027-12-30" }, owner, dependencies)).rejects.toMatchObject({ code: codes.FINANCIAL_YEAR_OVERLAP });
    await expect(createFinancialYear(business.id, { startDate: "2027-01-01", endDate: "2027-12-31" }, owner, dependencies)).resolves.toMatchObject({ status: "open" });
  });

  it("closes, rejects reopening while another year is open, and reopens with audit", async () => {
    const { business, dependencies, tenancy } = await context();
    const first = await createFinancialYear(business.id, { startDate: "2026-01-01", endDate: "2026-12-31" }, owner, dependencies);
    await expect(closeFinancialYear(business.id, first.id, owner, dependencies)).resolves.toMatchObject({ status: "closed" });
    const second = await createFinancialYear(business.id, { startDate: "2027-01-01", endDate: "2027-12-31" }, owner, dependencies);
    await expect(reopenFinancialYear(business.id, first.id, owner, dependencies)).rejects.toMatchObject({ code: codes.FINANCIAL_YEAR_ALREADY_OPEN });
    await closeFinancialYear(business.id, second.id, owner, dependencies);
    await expect(reopenFinancialYear(business.id, first.id, owner, dependencies)).resolves.toMatchObject({ status: "open" });
    expect((await tenancy.listAuditEvents(business.id)).map((event) => event.type).filter((type) => type.startsWith("financial_year_"))).toEqual([
      "financial_year_created", "financial_year_closed", "financial_year_created", "financial_year_closed", "financial_year_reopened",
    ]);
  });

  it("edits dates only while the year has no live movements", async () => {
    const { business, dependencies, year, manual } = await ledger();
    const created = await createMovement(business.id, manual(), owner, dependencies);
    await expect(updateFinancialYearDates(business.id, year.id, { endDate: "2027-03-31" }, owner, dependencies)).rejects.toMatchObject({ code: codes.FINANCIAL_YEAR_HAS_MOVEMENTS });
    await deleteMovement(business.id, created.id, owner, dependencies);
    await expect(updateFinancialYearDates(business.id, year.id, { endDate: "2027-03-31" }, owner, dependencies)).resolves.toMatchObject({ startDate: "2026-04-06", endDate: "2027-03-31" });
    await expect(updateFinancialYearDates(business.id, year.id, { startDate: "2027-04-01" }, owner, dependencies)).rejects.toMatchObject({ code: codes.INVALID_FINANCIAL_YEAR });
    await expect(updateFinancialYearDates(business.id, "missing", { startDate: "2026-01-01" }, owner, dependencies)).rejects.toMatchObject({ code: codes.FINANCIAL_YEAR_NOT_FOUND });
  });
});

describe("financial year locking", () => {
  it("locks the business's years before every overlap check, inside the transaction", async () => {
    const fixture = await context();
    const calls: string[] = [];
    const money = new Proxy(fixture.money, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          calls.push(String(property));
          return (value as (...input: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const dependencies = { ...fixture.dependencies, money };
    const first = await createFinancialYear(fixture.business.id, { startDate: "2026-01-01", endDate: "2026-12-31" }, owner, dependencies);
    expect(calls).toEqual(["transaction", "lockYears", "listYears", "createYear"]);
    calls.length = 0;
    await updateFinancialYearDates(fixture.business.id, first.id, { endDate: "2026-12-30" }, owner, dependencies);
    expect(calls).toEqual(["transaction", "lockYears", "findYear", "listMovements", "listYears", "updateYear"]);
    await closeFinancialYear(fixture.business.id, first.id, owner, dependencies);
    calls.length = 0;
    await reopenFinancialYear(fixture.business.id, first.id, owner, dependencies);
    expect(calls).toEqual(["transaction", "lockYears", "findYear", "listYears", "updateYear"]);
  });
});

describe("money accounts", () => {
  it("requires a template and one of its sheets", async () => {
    const without = await context({ template: false });
    await expect(createMoneyAccount(without.business.id, { name: "Bank", kind: "bank", sheetName: "Main Bank" }, owner, without.dependencies)).rejects.toMatchObject({ code: codes.TEMPLATE_REQUIRED });
    const { business, dependencies } = await context();
    await expect(createMoneyAccount(business.id, { name: "Bank", kind: "bank", sheetName: "main bank" }, owner, dependencies)).rejects.toMatchObject({ code: codes.UNKNOWN_TEMPLATE_SHEET });
    await expect(createMoneyAccount(business.id, { name: " Bank ", kind: "bank", sheetName: "Main Bank" }, owner, dependencies)).resolves.toMatchObject({ name: "Bank", kind: "bank", sheetName: "Main Bank", isActive: true });
  });

  it.each([
    { name: "", kind: "bank", sheetName: "Cash" },
    { name: "x".repeat(101), kind: "bank", sheetName: "Cash" },
    { name: "Till", kind: "card", sheetName: "Cash" },
    { name: "Till", kind: "cash", sheetName: "" },
  ])("rejects invalid account details %#", async (input) => {
    const { business, dependencies } = await context();
    await expect(createMoneyAccount(business.id, input as never, owner, dependencies)).rejects.toMatchObject({ code: codes.INVALID_MONEY_ACCOUNT });
  });

  it("keeps names and sheets unique among active accounts", async () => {
    const { business, dependencies, tenancy } = await context();
    const bank = await createMoneyAccount(business.id, { name: "Bank", kind: "bank", sheetName: "Main Bank" }, owner, dependencies);
    await expect(createMoneyAccount(business.id, { name: "BANK", kind: "bank", sheetName: "Deposit" }, owner, dependencies)).rejects.toMatchObject({ code: codes.MONEY_ACCOUNT_NAME_TAKEN });
    await expect(createMoneyAccount(business.id, { name: "Other", kind: "bank", sheetName: "Main Bank" }, owner, dependencies)).rejects.toMatchObject({ code: codes.SHEET_ALREADY_USED });
    await setMoneyAccountActive(business.id, bank.id, false, owner, dependencies);
    const replacement = await createMoneyAccount(business.id, { name: "Bank", kind: "bank", sheetName: "Main Bank" }, owner, dependencies);
    await expect(setMoneyAccountActive(business.id, bank.id, true, owner, dependencies)).rejects.toMatchObject({ code: codes.MONEY_ACCOUNT_NAME_TAKEN });
    await expect(renameMoneyAccount(business.id, replacement.id, "Current account", owner, dependencies)).resolves.toMatchObject({ name: "Current account" });
    await expect(setMoneyAccountActive(business.id, bank.id, true, owner, dependencies)).rejects.toMatchObject({ code: codes.SHEET_ALREADY_USED });
    expect((await tenancy.listAuditEvents(business.id)).map((event) => event.type).filter((type) => type.startsWith("money_account_"))).toEqual([
      "money_account_created", "money_account_deactivated", "money_account_created", "money_account_renamed",
    ]);
  });

  it("lists opening balances per year, defaulting to 0.00, negative allowed, open year only", async () => {
    const { business, dependencies, year, bank } = await ledger();
    const till = await createMoneyAccount(business.id, { name: "Till", kind: "cash", sheetName: "Cash" }, owner, dependencies);
    await expect(setOpeningBalance(business.id, bank.id, year.id, "-1250.5", owner, dependencies)).resolves.toMatchObject({ id: bank.id, openingBalance: "-1250.50" });
    expect((await listMoneyAccounts(business.id, { yearId: year.id }, owner, dependencies)).map((account) => [account.name, account.openingBalance])).toEqual([["Main bank", "-1250.50"], ["Till", "0.00"]]);
    expect((await listMoneyAccounts(business.id, {}, owner, dependencies)).every((account) => account.openingBalance === null)).toBe(true);
    await expect(setOpeningBalance(business.id, till.id, year.id, "0", owner, dependencies)).resolves.toMatchObject({ openingBalance: "0.00" });
    await expect(setOpeningBalance(business.id, till.id, year.id, "1.005", owner, dependencies)).rejects.toMatchObject({ code: codes.INVALID_AMOUNT });
    await closeFinancialYear(business.id, year.id, owner, dependencies);
    await expect(setOpeningBalance(business.id, till.id, year.id, "5.00", owner, dependencies)).rejects.toMatchObject({ code: codes.FINANCIAL_YEAR_CLOSED });
    await expect(listMoneyAccounts(business.id, { yearId: "missing" }, owner, dependencies)).rejects.toMatchObject({ code: codes.FINANCIAL_YEAR_NOT_FOUND });
  });
});

describe("movements", () => {
  it("stores a manual movement with exact signed pounds and audits ids only", async () => {
    const { business, dependencies, tenancy, year, bank, manual, rent } = await ledger();
    const movement = await createMovement(business.id, manual({ narrative: "  Rent May  ", headingId: rent.id, amount: "-850.1" }), owner, dependencies);
    expect(movement).toMatchObject({ businessId: business.id, financialYearId: year.id, moneyAccountId: bank.id, movementDate: "2026-05-01", narrative: "Rent May", headingId: rent.id, amount: "-850.10", origin: "manual", sourceInvoiceId: null, deletedAt: null, createdBy: owner });
    const event = (await tenancy.listAuditEvents(business.id)).at(-1);
    expect(event).toMatchObject({ type: "movement_created", entityId: movement.id, metadata: { financialYearId: year.id, moneyAccountId: bank.id } });
    expect(JSON.stringify(event)).not.toMatch(/Rent May|850/);
  });

  it.each([
    ["the day before the year", "2026-04-05"],
    ["the day after the year", "2027-04-06"],
  ])("rejects a date on %s", async (_label, date) => {
    const { business, dependencies, manual } = await ledger();
    await expect(createMovement(business.id, manual({ date }), owner, dependencies)).rejects.toMatchObject({ code: codes.MOVEMENT_OUTSIDE_OPEN_YEAR });
  });

  it("accepts both ends of the year and rejects dates of a closed year", async () => {
    const { business, dependencies, manual, year } = await ledger();
    await expect(createMovement(business.id, manual({ date: "2026-04-06" }), owner, dependencies)).resolves.toBeDefined();
    await expect(createMovement(business.id, manual({ date: "2027-04-05" }), owner, dependencies)).resolves.toBeDefined();
    await closeFinancialYear(business.id, year.id, owner, dependencies);
    await expect(createMovement(business.id, manual({ date: "2026-06-01" }), owner, dependencies)).rejects.toMatchObject({ code: codes.MOVEMENT_OUTSIDE_OPEN_YEAR });
  });

  it.each([
    ["a zero amount", { amount: "0.00" }, codes.INVALID_AMOUNT],
    ["three decimals", { amount: "1.005" }, codes.INVALID_AMOUNT],
    ["a number amount", { amount: 10 }, codes.INVALID_AMOUNT],
    ["an empty narrative", { narrative: "   " }, codes.INVALID_MOVEMENT],
    ["a long narrative", { narrative: "x".repeat(201) }, codes.INVALID_MOVEMENT],
    ["no heading", { headingId: null }, codes.INVALID_MOVEMENT],
    ["an unknown heading", { headingId: "missing" }, codes.HEADING_NOT_FOUND],
    ["an unknown account", { accountId: "missing" }, codes.MONEY_ACCOUNT_NOT_FOUND],
    ["an invalid date", { date: "2026-13-01" }, codes.INVALID_MOVEMENT],
    ["an invoice origin", { origin: "invoice" }, codes.MOVEMENT_ORIGIN_NOT_EDITABLE],
    ["a statement origin", { origin: "statement" }, codes.MOVEMENT_ORIGIN_NOT_EDITABLE],
  ])("rejects %s", async (_label, overrides, code) => {
    const { business, dependencies, manual, money } = await ledger();
    await expect(createMovement(business.id, manual(overrides) as never, owner, dependencies)).rejects.toMatchObject({ code });
    expect(money.movements.size).toBe(0);
  });

  it("accepts a narrative of exactly 200 characters", async () => {
    const { business, dependencies, manual } = await ledger();
    await expect(createMovement(business.id, manual({ narrative: "x".repeat(200) }), owner, dependencies)).resolves.toMatchObject({ narrative: "x".repeat(200) });
  });

  it("rejects an inactive or blocked heading and an inactive account", async () => {
    const { business, dependencies, manual, tenancy, headings, rent, blocked, bank } = await ledger();
    await expect(createMovement(business.id, manual({ headingId: blocked.id }), owner, dependencies)).rejects.toMatchObject({ code: codes.HEADING_NOT_USABLE });
    await setHeadingActive(business.id, rent.id, false, owner, { tenancyRepository: tenancy, headings });
    await expect(createMovement(business.id, manual({ headingId: rent.id }), owner, dependencies)).rejects.toMatchObject({ code: codes.HEADING_NOT_USABLE });
    await setMoneyAccountActive(business.id, bank.id, false, owner, dependencies);
    await expect(createMovement(business.id, manual(), owner, dependencies)).rejects.toMatchObject({ code: codes.MONEY_ACCOUNT_INACTIVE });
  });

  it("lists live movements by date, then creation order, filtered by account", async () => {
    const { business, dependencies, year, bank, manual } = await ledger();
    const till = await createMoneyAccount(business.id, { name: "Till", kind: "cash", sheetName: "Cash" }, owner, dependencies);
    const later = await createMovement(business.id, manual({ date: "2026-06-01", narrative: "later" }), owner, dependencies);
    const sameDay = [];
    for (const narrative of ["z first", "a second", "m third"]) sameDay.push(await createMovement(business.id, manual({ narrative }), owner, dependencies));
    const cash = await createMovement(business.id, manual({ accountId: till.id, narrative: "cash" }), owner, dependencies);
    const deleted = await createMovement(business.id, manual({ narrative: "deleted" }), owner, dependencies);
    await deleteMovement(business.id, deleted.id, owner, dependencies);

    expect((await listMovements(business.id, { yearId: year.id, accountId: bank.id }, owner, dependencies)).map((item) => item.id)).toEqual([...sameDay.map((item) => item.id), later.id]);
    expect((await listMovements(business.id, { yearId: year.id }, owner, dependencies)).map((item) => item.narrative)).toEqual(["z first", "a second", "m third", "cash", "later"]);
    expect(cash.moneyAccountId).toBe(till.id);
    await expect(listMovements(business.id, { yearId: "missing" }, owner, dependencies)).rejects.toMatchObject({ code: codes.FINANCIAL_YEAR_NOT_FOUND });
    await expect(listMovements(business.id, { yearId: year.id, accountId: "missing" }, owner, dependencies)).rejects.toMatchObject({ code: codes.MONEY_ACCOUNT_NOT_FOUND });
  });

  it("sums many movements to the exact pence total", async () => {
    const { business, dependencies, year, manual } = await ledger();
    const amounts = Array.from({ length: 150 }, (_, index) => (index % 3 === 0 ? "-0.10" : index % 3 === 1 ? "0.20" : "19.99"));
    for (const amount of amounts) await createMovement(business.id, manual({ amount }), owner, dependencies);
    const stored = await listMovements(business.id, { yearId: year.id }, owner, dependencies);
    expect(formatPence(sumPence(stored.map((item) => parsePounds(item.amount))))).toBe("1004.50");
  });

  it("updates and soft-deletes a manual movement with audit, and keeps closed years read-only", async () => {
    const { business, dependencies, tenancy, year, manual, rent, money } = await ledger();
    const movement = await createMovement(business.id, manual(), owner, dependencies);
    const updated = await updateMovement(business.id, movement.id, { narrative: "Corrected", amount: "-12.3", headingId: rent.id }, owner, dependencies);
    expect(updated).toMatchObject({ id: movement.id, narrative: "Corrected", amount: "-12.30", headingId: rent.id, createdAt: movement.createdAt });
    await expect(updateMovement(business.id, movement.id, { date: "2027-05-01" }, owner, dependencies)).rejects.toMatchObject({ code: codes.MOVEMENT_OUTSIDE_OPEN_YEAR });
    await expect(updateMovement(business.id, movement.id, {}, owner, dependencies)).rejects.toMatchObject({ code: codes.INVALID_MOVEMENT });

    await closeFinancialYear(business.id, year.id, owner, dependencies);
    await expect(updateMovement(business.id, movement.id, { narrative: "Late" }, owner, dependencies)).rejects.toMatchObject({ code: codes.FINANCIAL_YEAR_CLOSED });
    await expect(deleteMovement(business.id, movement.id, owner, dependencies)).rejects.toMatchObject({ code: codes.FINANCIAL_YEAR_CLOSED });
    await reopenFinancialYear(business.id, year.id, owner, dependencies);

    const deleted = await deleteMovement(business.id, movement.id, owner, dependencies);
    expect(deleted.deletedAt).toEqual(expect.any(String));
    expect(money.movements.get(movement.id)).toMatchObject({ narrative: "Corrected", deletedAt: deleted.deletedAt });
    await expect(deleteMovement(business.id, movement.id, owner, dependencies)).rejects.toMatchObject({ code: codes.MOVEMENT_NOT_FOUND });
    await expect(updateMovement(business.id, movement.id, { narrative: "Ghost" }, owner, dependencies)).rejects.toMatchObject({ code: codes.MOVEMENT_NOT_FOUND });
    expect((await tenancy.listAuditEvents(business.id)).map((event) => event.type).filter((type) => type.startsWith("movement_"))).toEqual(["movement_created", "movement_updated", "movement_deleted"]);
  });

  it("takes only the documented fields of a manual movement, so a direct call cannot forge a link", async () => {
    const { business, dependencies, tenancy, manual, money } = await ledger();
    const forged = { transferGroupId: "forged-transfer", sourceRef: "statement:forged", sourceInvoiceId: "forged-invoice" };

    const created = await createMovement(business.id, manual(forged) as Parameters<typeof createMovement>[1], owner, dependencies);
    expect(money.movements.get(created.id)).toMatchObject({ origin: "manual", transferGroupId: null, sourceRef: null, sourceInvoiceId: null });

    const updated = await updateMovement(business.id, created.id, { narrative: "Corrected", ...forged } as Parameters<typeof updateMovement>[2], owner, dependencies);
    expect(updated).toMatchObject({ narrative: "Corrected", transferGroupId: null, sourceRef: null, sourceInvoiceId: null });
    const auditCount = (await tenancy.listAuditEvents(business.id)).length;
    await expect(updateMovement(business.id, created.id, forged as Parameters<typeof updateMovement>[2], owner, dependencies)).rejects.toMatchObject({ code: codes.INVALID_MOVEMENT });
    expect(money.movements.get(created.id)).toEqual(updated);
    expect(await tenancy.listAuditEvents(business.id)).toHaveLength(auditCount);
  });

  it("rolls the movement back when the audit write fails", async () => {
    const { business, dependencies, tenancy, manual, money } = await ledger();
    tenancy.appendAuditEvent = async () => { throw new Error("audit failed"); };
    await expect(createMovement(business.id, manual(), owner, dependencies)).rejects.toMatchObject({ code: codes.MONEY_REPOSITORY_CONFLICT });
    expect(money.movements.size).toBe(0);
  });
});

describe("internal movement writers", () => {
  async function internal() {
    const fixture = await ledger();
    const write: MovementWriteContext = { businessId: fixture.business.id, actorId: owner, tenancy: fixture.tenancy, money: fixture.money, headings: fixture.headings };
    return { ...fixture, write };
  }

  it("accepts statement rows without a heading and refuses any other origin without one", async () => {
    const { write, money, bank } = await internal();
    const [line] = await money.transaction(() => createMovementsInTransaction(write, [{ accountId: bank.id, date: "2026-05-02", narrative: "CARD 1234", headingId: null, amount: "-4.99", origin: "statement", sourceRef: "import-1:7" }]));
    expect(line).toMatchObject({ origin: "statement", headingId: null, sourceRef: "import-1:7", amount: "-4.99" });
    await expect(createMovementsInTransaction(write, [{ accountId: bank.id, date: "2026-05-02", narrative: "x", headingId: null, amount: "1.00", origin: "manual" }])).rejects.toMatchObject({ code: codes.INVALID_MOVEMENT });
    await expect(createMovementsInTransaction(write, [{ accountId: bank.id, date: "2026-05-02", narrative: "x", headingId: null, amount: "1.00", origin: "invoice", sourceInvoiceId: "invoice-1" }])).rejects.toMatchObject({ code: codes.INVALID_MOVEMENT });
  });

  it("requires a source invoice exactly for invoice rows", async () => {
    const { write, bank, rent } = await internal();
    const row = { accountId: bank.id, date: "2026-05-02", narrative: "Acme 42", headingId: rent.id, amount: "-10.00" };
    await expect(createMovementsInTransaction(write, [{ ...row, origin: "invoice" }])).rejects.toMatchObject({ code: codes.INVALID_MOVEMENT });
    await expect(createMovementsInTransaction(write, [{ ...row, origin: "manual", sourceInvoiceId: "invoice-1" }])).rejects.toMatchObject({ code: codes.INVALID_MOVEMENT });
    await expect(createMovementsInTransaction(write, [{ ...row, origin: "manual", transferGroupId: "transfer-1" }])).resolves.toMatchObject([{ transferGroupId: "transfer-1" }]);
  });

  it("replaces and removes an invoice's movements atomically without duplicates", async () => {
    const { business, dependencies, write, money, year, bank, rent, sales } = await internal();
    const part = (amount: string, headingId = rent.id) => ({ accountId: bank.id, date: "2026-05-03", narrative: "Acme 42", headingId, amount });
    await money.transaction(() => replaceInvoiceMovements(write, "invoice-1", [part("-60.00"), part("-40.00", sales.id)]));
    await money.transaction(() => replaceInvoiceMovements(write, "invoice-1", [part("-99.99")]));
    let live = await listMovements(business.id, { yearId: year.id }, owner, dependencies);
    expect(live.map((item) => [item.origin, item.sourceInvoiceId, item.amount])).toEqual([["invoice", "invoice-1", "-99.99"]]);

    await expect(money.transaction(() => replaceInvoiceMovements(write, "invoice-1", [part("-1.00"), part("0.00")]))).rejects.toMatchObject({ code: codes.INVALID_AMOUNT });
    live = await listMovements(business.id, { yearId: year.id }, owner, dependencies);
    expect(live.map((item) => item.amount)).toEqual(["-99.99"]);

    await expect(updateMovement(business.id, live[0].id, { narrative: "Hand edit" }, owner, dependencies)).rejects.toMatchObject({ code: codes.MOVEMENT_ORIGIN_NOT_EDITABLE });
    await expect(deleteMovement(business.id, live[0].id, owner, dependencies)).rejects.toMatchObject({ code: codes.MOVEMENT_ORIGIN_NOT_EDITABLE });

    await expect(money.transaction(() => removeInvoiceMovements(write, "invoice-1"))).resolves.toBe(1);
    await expect(listMovements(business.id, { yearId: year.id }, owner, dependencies)).resolves.toEqual([]);
    expect([...money.movements.values()].filter((item) => item.sourceInvoiceId === "invoice-1")).toHaveLength(3);
  });
});
