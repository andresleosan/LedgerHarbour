import { describe, expect, it } from "vitest";

import { createTestDatabase } from "../../../src/db/test-database";
import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import { importHeadings, listHeadings, type TemplateHeadingInput } from "../../../src/modules/accounting/heading-service";
import { MONEY_ERROR_CODES, type FinancialYear, type MoneyAccount, type Movement } from "../../../src/modules/accounting/money-repository";
import {
  createFinancialYear,
  createMoneyAccount,
  createMovement,
  deleteMovement,
  listMoneyAccounts,
  listMovements,
  removeInvoiceMovements,
  replaceInvoiceMovements,
  setOpeningBalance,
  type MovementWriteContext,
} from "../../../src/modules/accounting/money-service";
import { createPostgresHeadingRepository } from "../../../src/modules/accounting/postgres-heading-repository";
import { createPostgresMoneyRepository } from "../../../src/modules/accounting/postgres-money-repository";
import { createPostgresTemplateRepository } from "../../../src/modules/accounting/postgres-template-repository";
import { formatPence, parsePounds, sumPence } from "../../../src/modules/accounting/money";
import type { AccountSheet } from "../../../src/modules/workbook/template-profile";
import { createPostgresOnboardingRepository } from "../../../src/modules/tenancy/postgres-tenancy-repository";
import type { BusinessId, UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

function identity(name: string): AuthIdentity {
  return { providerUserId: `money-${name}`, email: `money-${name}@example.com`, displayName: `Money ${name}`, emailVerified: true };
}

const headingInputs: TemplateHeadingInput[] = [
  { position: 1, templateValue: "Sales", valueType: "text", group: "income", order: 1, blockedReason: null },
  { position: 2, templateValue: "Rent", valueType: "text", group: "expenses", order: 2, blockedReason: null },
];

async function setup() {
  const database = await createTestDatabase();
  const tenancy = createPostgresOnboardingRepository(database.db);
  const headings = createPostgresHeadingRepository(database.db);
  const templates = createPostgresTemplateRepository(database.db);
  const money = createPostgresMoneyRepository(database.db);
  const dependencies = { tenancyRepository: tenancy, headings, templates, money };
  const seed = async (name: string) => {
    const owner = identity(name);
    const business = await createApprovedBusiness(tenancy, `Money Books ${name}`, owner);
    const ownerId = await tenancy.upsertUser(owner);
    await importHeadings(business.id, headingInputs, owner, { tenancyRepository: tenancy, headings });
    const [sales, rent] = await listHeadings(business.id, owner, { tenancyRepository: tenancy, headings });
    await templates.upsert({
      id: `template-${name}`,
      businessId: business.id,
      privateObjectKey: `business/${business.id}/template/one`,
      originalFileName: "Accounts.xlsx",
      sizeBytes: 1,
      checksum: "a".repeat(64),
      profile: { sheets: ["Main Bank", "Cash"].map((sheet) => ({ name: sheet }) as AccountSheet), defects: [] },
      uploadedBy: ownerId,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await database.execute(`
      INSERT INTO documents (id, business_id, uploader_id, private_object_key, original_file_name, original_mime_type, original_size_bytes)
      VALUES ('document-${name}', '${business.id}', '${ownerId}', 'key-${name}', 'invoice.pdf', 'application/pdf', 10);
      INSERT INTO invoices (id, business_id, document_id) VALUES ('invoice-${name}', '${business.id}', 'document-${name}');
    `);
    const year = await createFinancialYear(business.id, { startDate: "2026-04-06", endDate: "2027-04-05" }, owner, dependencies);
    const bank = await createMoneyAccount(business.id, { name: "Main bank", kind: "bank", sheetName: "Main Bank" }, owner, dependencies);
    return { owner, ownerId, business, sales, rent, year, bank, invoiceId: `invoice-${name}` };
  };
  const a = await seed("a");
  const b = await seed("b");
  return { ...database, tenancy, headings, money, dependencies, a, b };
}

function movement(businessId: BusinessId, year: FinancialYear, account: MoneyAccount, createdBy: UserId, overrides: Partial<Movement> = {}): Movement {
  return {
    id: "movement-1",
    businessId,
    financialYearId: year.id,
    moneyAccountId: account.id,
    movementDate: "2026-05-01",
    narrative: "Takings",
    headingId: null,
    amount: "-0.01",
    origin: "statement",
    sourceInvoiceId: null,
    sourceRef: "import-1:1",
    transferGroupId: null,
    deletedAt: null,
    createdBy,
    createdAt: "2026-05-01T09:00:00.000Z",
    updatedAt: "2026-05-01T09:00:00.000Z",
    ...overrides,
  };
}

describe("PostgreSQL money repository", () => {
  it("round-trips years, accounts, openings and movements with exact numeric strings", async () => {
    const { close, money, a } = await setup();
    try {
      await expect(money.findYear(a.year.id, a.business.id)).resolves.toEqual(a.year);
      await expect(money.listAccounts(a.business.id)).resolves.toEqual([a.bank]);
      for (const [index, amount] of ["-0.01", "999999999999.99", "-999999999999.99", "19.99", "0.10"].entries()) {
        const stored = movement(a.business.id, a.year, a.bank, a.ownerId, { id: `movement-${index}`, amount });
        await expect(money.createMovement(stored)).resolves.toEqual(stored);
        await expect(money.findMovement(stored.id, a.business.id)).resolves.toEqual(stored);
      }
      await money.setOpening(a.business.id, a.bank.id, a.year.id, "-0.10");
      await money.setOpening(a.business.id, a.bank.id, a.year.id, "1234567.89");
      expect(await money.listOpenings(a.business.id, a.year.id)).toEqual(new Map([[a.bank.id, "1234567.89"]]));

      const deleted = { ...movement(a.business.id, a.year, a.bank, a.ownerId, { id: "movement-0", amount: "-0.01" }), deletedAt: "2026-05-02T00:00:00.000Z", updatedAt: "2026-05-02T00:00:00.000Z" };
      await expect(money.updateMovement(deleted, a.business.id)).resolves.toEqual(deleted);
      expect((await money.listMovements(a.business.id, a.year.id)).map((item) => item.id)).toEqual(["movement-1", "movement-2", "movement-3", "movement-4"]);
      await expect(money.findMovement("movement-0", a.business.id)).resolves.toMatchObject({ deletedAt: "2026-05-02T00:00:00.000Z" });
    } finally {
      await close();
    }
  }, 30_000);

  it.each([
    ["financial_years", "end_date = start_date", "23514"],
    ["financial_years", "status = 'archived'", "23514"],
    ["money_accounts", "kind = 'card'", "23514"],
    ["money_accounts", "name = ''", "23514"],
    ["money_accounts", "sheet_name = ''", "23514"],
    ["movements", "amount = 0", "23514"],
    ["movements", "amount = 1000000000000", "22003"],
    ["movements", "origin = 'import'", "23514"],
    ["movements", "narrative = ''", "23514"],
    ["movements", "narrative = repeat('x', 201)", "23514"],
    ["movements", "origin = 'manual'", "23514"],
    ["movements", "origin = 'invoice'", "23514"],
    ["movements", "source_invoice_id = 'invoice-a'", "23514"],
  ])("rejects an invalid %s row (%s) with a constraint", async (table, assignment, code) => {
    const { close, execute, money, a } = await setup();
    try {
      await money.createMovement(movement(a.business.id, a.year, a.bank, a.ownerId));
      const where = table === "financial_years" ? `id = '${a.year.id}'` : table === "money_accounts" ? `id = '${a.bank.id}'` : "id = 'movement-1'";
      await expect(execute(`UPDATE ${table} SET ${assignment} WHERE ${where}`)).rejects.toMatchObject({ code });
    } finally {
      await close();
    }
  }, 30_000);

  it("accepts the shapes later tasks need: statement without heading, invoice with its source, transfer group", async () => {
    const { close, money, a } = await setup();
    try {
      await expect(money.createMovement(movement(a.business.id, a.year, a.bank, a.ownerId))).resolves.toMatchObject({ headingId: null, origin: "statement" });
      await expect(money.createMovement(movement(a.business.id, a.year, a.bank, a.ownerId, { id: "movement-2", origin: "invoice", sourceInvoiceId: a.invoiceId, headingId: a.rent.id, sourceRef: null })))
        .resolves.toMatchObject({ sourceInvoiceId: a.invoiceId });
      await expect(money.createMovement(movement(a.business.id, a.year, a.bank, a.ownerId, { id: "movement-3", origin: "manual", headingId: a.sales.id, transferGroupId: "transfer-1", sourceRef: null })))
        .resolves.toMatchObject({ transferGroupId: "transfer-1" });
    } finally {
      await close();
    }
  }, 30_000);

  it("enforces one open year, unique start dates and active-only account uniqueness", async () => {
    const { close, execute, money, a } = await setup();
    try {
      const year = (overrides: Partial<FinancialYear>): FinancialYear => ({ ...a.year, id: "year-2", startDate: "2027-04-06", endDate: "2028-04-05", ...overrides });
      await expect(money.createYear(year({}))).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_REPOSITORY_CONFLICT });
      await expect(money.createYear(year({ status: "closed", startDate: a.year.startDate }))).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_REPOSITORY_CONFLICT });
      await expect(money.createYear(year({ status: "closed" }))).resolves.toMatchObject({ status: "closed" });

      const account = (overrides: Partial<MoneyAccount>): MoneyAccount => ({ ...a.bank, id: "account-2", name: "Other", sheetName: "Cash", ...overrides });
      await expect(money.createAccount(account({ name: "MAIN BANK" }))).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_REPOSITORY_CONFLICT });
      await expect(money.createAccount(account({ sheetName: "Main Bank" }))).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_REPOSITORY_CONFLICT });
      await expect(money.createAccount(account({ name: "Main bank", sheetName: "Main Bank", isActive: false }))).resolves.toMatchObject({ isActive: false });
      await expect(execute(`UPDATE money_accounts SET is_active = true WHERE id = 'account-2'`)).rejects.toMatchObject({ code: "23505" });
    } finally {
      await close();
    }
  }, 30_000);

  it("keeps every reference of a movement and an opening inside one business", async () => {
    const { close, money, a, b } = await setup();
    try {
      const crossed = (overrides: Partial<Movement>) => movement(b.business.id, b.year, b.bank, b.ownerId, { origin: "manual", headingId: b.rent.id, sourceRef: null, ...overrides });
      await expect(money.createMovement(crossed({}))).resolves.toMatchObject({ businessId: b.business.id });
      for (const [index, overrides] of [
        { moneyAccountId: a.bank.id },
        { financialYearId: a.year.id },
        { headingId: a.rent.id },
        { origin: "invoice", sourceInvoiceId: a.invoiceId },
        { createdBy: a.ownerId },
      ].entries()) {
        await expect(money.createMovement(crossed({ id: `crossed-${index}`, ...overrides } as Partial<Movement>))).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_REPOSITORY_CONFLICT });
      }
      await expect(money.setOpening(b.business.id, a.bank.id, b.year.id, "1.00")).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_REPOSITORY_CONFLICT });
      await expect(money.setOpening(b.business.id, b.bank.id, a.year.id, "1.00")).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_REPOSITORY_CONFLICT });

      await expect(money.findMovement("movement-1", a.business.id)).resolves.toBeNull();
      await expect(money.findYear(b.year.id, a.business.id)).resolves.toBeNull();
      await expect(money.findAccount(b.bank.id, a.business.id)).resolves.toBeNull();
      await expect(money.updateMovement(crossed({ narrative: "Hijacked" }), a.business.id)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MOVEMENT_NOT_FOUND });
      await expect(money.updateAccount({ ...b.bank, name: "Hijacked" }, a.business.id)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND });
      await expect(money.updateYear({ ...b.year, status: "closed" }, a.business.id)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND });
      await expect(money.listMovements(a.business.id, b.year.id)).resolves.toEqual([]);
      expect(await money.listOpenings(a.business.id, b.year.id)).toEqual(new Map());
    } finally {
      await close();
    }
  }, 30_000);
});

describe("PostgreSQL money services", () => {
  it("lists same-day movements in creation order and sums exact pence", async () => {
    const { close, dependencies, a } = await setup();
    try {
      const created = [];
      for (const [index, amount] of ["0.10", "0.20", "-0.30", "19.99", "-19.98"].entries()) {
        created.push(await createMovement(a.business.id, { accountId: a.bank.id, date: "2026-07-01", narrative: `z${9 - index}`, headingId: a.sales.id, amount }, a.owner, dependencies));
      }
      const earlier = await createMovement(a.business.id, { accountId: a.bank.id, date: "2026-06-30", narrative: "earlier", headingId: a.rent.id, amount: "-1.00" }, a.owner, dependencies);
      const listed = await listMovements(a.business.id, { yearId: a.year.id, accountId: a.bank.id }, a.owner, dependencies);
      expect(listed.map((item) => item.id)).toEqual([earlier.id, ...created.map((item) => item.id)]);
      expect(formatPence(sumPence(listed.map((item) => parsePounds(item.amount))))).toBe("-0.99");

      await setOpeningBalance(a.business.id, a.bank.id, a.year.id, "-250.75", a.owner, dependencies);
      await expect(listMoneyAccounts(a.business.id, { yearId: a.year.id }, a.owner, dependencies)).resolves.toMatchObject([{ id: a.bank.id, openingBalance: "-250.75" }]);

      await deleteMovement(a.business.id, earlier.id, a.owner, dependencies);
      expect((await listMovements(a.business.id, { yearId: a.year.id }, a.owner, dependencies)).map((item) => item.id)).not.toContain(earlier.id);
    } finally {
      await close();
    }
  }, 30_000);

  it("writes an audit row with ids only and rolls the movement back when the audit fails", async () => {
    const { db, close, tenancy, dependencies, money, a } = await setup();
    try {
      const created = await createMovement(a.business.id, { accountId: a.bank.id, date: "2026-07-01", narrative: "Secret narrative", headingId: a.sales.id, amount: "123.45" }, a.owner, dependencies);
      const audit = await db.execute<{ action: string; entity_id: string; metadata: unknown }>(`SELECT action, entity_id, metadata FROM audit_events WHERE action = 'movement_created'`);
      expect(audit.rows).toEqual([{ action: "movement_created", entity_id: created.id, metadata: { financialYearId: a.year.id, moneyAccountId: a.bank.id } }]);

      tenancy.transaction = async () => { throw new Error("audit failed"); };
      await expect(createMovement(a.business.id, { accountId: a.bank.id, date: "2026-07-02", narrative: "Lost", headingId: a.sales.id, amount: "1.00" }, a.owner, dependencies))
        .rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_REPOSITORY_CONFLICT });
      expect((await money.listMovements(a.business.id, a.year.id)).map((item) => item.id)).toEqual([created.id]);
    } finally {
      await close();
    }
  }, 30_000);

  it("replaces and removes an invoice's movements in one transaction", async () => {
    const { close, tenancy, headings, money, a } = await setup();
    try {
      const write: MovementWriteContext = { businessId: a.business.id, actorId: a.ownerId, tenancy, money, headings };
      const part = (amount: string) => ({ accountId: a.bank.id, date: "2026-05-03", narrative: "Acme 42", headingId: a.rent.id, amount });
      await money.transaction(() => replaceInvoiceMovements(write, a.invoiceId, [part("-60.00"), part("-40.00")]));
      await money.transaction(() => replaceInvoiceMovements(write, a.invoiceId, [part("-99.99")]));
      expect((await money.listInvoiceMovements(a.business.id, a.invoiceId)).map((item) => item.amount)).toEqual(["-99.99"]);

      await expect(money.transaction(() => replaceInvoiceMovements(write, a.invoiceId, [part("-1.00"), part("-2.00"), { ...part("-3.00"), date: "2028-01-01" }])))
        .rejects.toMatchObject({ code: MONEY_ERROR_CODES.MOVEMENT_OUTSIDE_OPEN_YEAR });
      expect((await money.listInvoiceMovements(a.business.id, a.invoiceId)).map((item) => item.amount)).toEqual(["-99.99"]);

      await expect(money.transaction(() => replaceInvoiceMovements(write, "invoice-b", [part("-5.00")]))).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_REPOSITORY_CONFLICT });
      await expect(money.transaction(() => removeInvoiceMovements(write, a.invoiceId))).resolves.toBe(1);
      await expect(money.listInvoiceMovements(a.business.id, a.invoiceId)).resolves.toEqual([]);
    } finally {
      await close();
    }
  }, 30_000);
});
