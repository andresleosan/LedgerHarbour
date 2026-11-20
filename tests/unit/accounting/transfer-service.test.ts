import { describe, expect, it } from "vitest";

import { createHeadingRepository, importHeadings, listHeadings, setHeadingActive, type TemplateHeadingInput } from "../../../src/modules/accounting/heading-service";
import { parsePounds, sumPence } from "../../../src/modules/accounting/money";
import { MONEY_ERROR_CODES, createMoneyRepository, type Movement } from "../../../src/modules/accounting/money-repository";
import {
  closeFinancialYear,
  createFinancialYear,
  createMoneyAccount,
  createMovement,
  createTransfer,
  deleteMovement,
  deleteTransfer,
  listMovements,
  reopenFinancialYear,
  setMoneyAccountActive,
  suggestTransferHeading,
  updateMovement,
  updateTransfer,
  type MoneyDependencies,
} from "../../../src/modules/accounting/money-service";
import { createTemplateRepository } from "../../../src/modules/accounting/template-service";
import type { AccountSheet } from "../../../src/modules/workbook/template-profile";
import { createInMemoryOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import type { UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const owner = "transfer-owner" as UserId;
const codes = MONEY_ERROR_CODES;
const headingInputs: TemplateHeadingInput[] = [
  { position: 1, templateValue: "Sales", valueType: "text", group: "income", order: 1, blockedReason: null },
  { position: 2, templateValue: "Bank charges", valueType: "text", group: "expenses", order: 2, blockedReason: null },
  { position: 3, templateValue: "Transfers", valueType: "text", group: "assets", order: 3, blockedReason: null },
  { position: 4, templateValue: "Contra", valueType: "text", group: "assets", order: 4, blockedReason: null },
];

async function ledger() {
  const tenancy = createInMemoryOnboardingRepository();
  const business = await createApprovedBusiness(tenancy, "Transfer Books", owner);
  const headings = createHeadingRepository();
  const templates = createTemplateRepository();
  const money = createMoneyRepository();
  const dependencies = { tenancyRepository: tenancy, money, headings, templates } satisfies MoneyDependencies;
  await importHeadings(business.id, headingInputs, owner, { tenancyRepository: tenancy, headings });
  const [sales, charges, transfers, contra] = await listHeadings(business.id, owner, { tenancyRepository: tenancy, headings });
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
  const year = await createFinancialYear(business.id, { startDate: "2026-04-06", endDate: "2027-04-05" }, owner, dependencies);
  const bank = await createMoneyAccount(business.id, { name: "Main bank", kind: "bank", sheetName: "Main Bank" }, owner, dependencies);
  const cash = await createMoneyAccount(business.id, { name: "Till", kind: "cash", sheetName: "Cash" }, owner, dependencies);
  const transfer = (overrides: Record<string, unknown> = {}) => ({ fromAccountId: bank.id, toAccountId: cash.id, date: "2026-05-01", amount: "120.50", headingId: transfers.id, ...overrides });
  const live = () => listMovements(business.id, { yearId: year.id }, owner, dependencies);
  return { tenancy, business, dependencies, money, headings, year, bank, cash, sales, charges, transfers, contra, transfer, live };
}

const auditTypes = async (fixture: Awaited<ReturnType<typeof ledger>>) => (await fixture.tenancy.listAuditEvents(fixture.business.id)).map((event) => event.type);

describe("transfers between own accounts", () => {
  it("creates two opposite manual legs sharing a group, heading, date and default narrative, and audits ids only", async () => {
    const fixture = await ledger();
    const { business, dependencies, bank, cash, transfers, transfer, live, tenancy } = fixture;
    const created = await createTransfer(business.id, transfer(), owner, dependencies);
    expect(created.transferGroupId).toEqual(expect.any(String));
    expect(created.from).toMatchObject({ moneyAccountId: bank.id, amount: "-120.50", headingId: transfers.id, movementDate: "2026-05-01", narrative: "Transfer", origin: "manual", transferGroupId: created.transferGroupId });
    expect(created.to).toMatchObject({ moneyAccountId: cash.id, amount: "120.50", headingId: transfers.id, movementDate: "2026-05-01", narrative: "Transfer", origin: "manual", transferGroupId: created.transferGroupId });
    expect((await live()).map((item) => item.id)).toEqual([created.from.id, created.to.id]);

    const events = await tenancy.listAuditEvents(business.id);
    expect(events.map((event) => event.type).slice(-3)).toEqual(["movement_created", "movement_created", "transfer_created"]);
    expect(events.at(-1)).toMatchObject({ entityId: created.transferGroupId, metadata: { movementIds: [created.from.id, created.to.id] } });
    expect(JSON.stringify(events)).not.toMatch(/120\.50|Transfer"/);
  });

  it("keeps a typed narrative and normalises the amount", async () => {
    const { business, dependencies, transfer } = await ledger();
    const created = await createTransfer(business.id, transfer({ amount: "7.5", narrative: "  Float for the till  " }), owner, dependencies);
    expect([created.from.amount, created.to.amount, created.to.narrative]).toEqual(["-7.50", "7.50", "Float for the till"]);
  });

  it.each([
    ["the same account on both sides", (f: Fixture) => ({ toAccountId: f.bank.id }), codes.INVALID_MOVEMENT],
    ["a negative amount", () => ({ amount: "-5.00" }), codes.INVALID_AMOUNT],
    ["a zero amount", () => ({ amount: "0.00" }), codes.INVALID_AMOUNT],
    ["three decimals", () => ({ amount: "1.005" }), codes.INVALID_AMOUNT],
    ["a number amount", () => ({ amount: 5 }), codes.INVALID_AMOUNT],
    ["no heading", () => ({ headingId: undefined }), codes.INVALID_MOVEMENT],
    ["an unknown heading", () => ({ headingId: "missing" }), codes.HEADING_NOT_FOUND],
    ["an unknown from account", () => ({ fromAccountId: "missing" }), codes.MONEY_ACCOUNT_NOT_FOUND],
    ["an unknown to account", () => ({ toAccountId: "missing" }), codes.MONEY_ACCOUNT_NOT_FOUND],
    ["a date outside the open year", () => ({ date: "2027-04-06" }), codes.MOVEMENT_OUTSIDE_OPEN_YEAR],
    ["a long narrative", () => ({ narrative: "x".repeat(201) }), codes.INVALID_MOVEMENT],
  ])("rejects %s and writes nothing", async (_label, overrides: (fixture: Fixture) => Record<string, unknown>, code) => {
    const fixture = await ledger();
    await expect(createTransfer(fixture.business.id, fixture.transfer(overrides(fixture)) as never, owner, fixture.dependencies)).rejects.toMatchObject({ code });
    expect(fixture.money.movements.size).toBe(0);
  });

  it("rejects an inactive account or an unusable heading, leaving no half transfer", async () => {
    const { business, dependencies, tenancy, headings, cash, transfers, transfer, money } = await ledger();
    await setMoneyAccountActive(business.id, cash.id, false, owner, dependencies);
    await expect(createTransfer(business.id, transfer(), owner, dependencies)).rejects.toMatchObject({ code: codes.MONEY_ACCOUNT_INACTIVE });
    expect(money.movements.size).toBe(0);
    await setMoneyAccountActive(business.id, cash.id, true, owner, dependencies);
    await setHeadingActive(business.id, transfers.id, false, owner, { tenancyRepository: tenancy, headings });
    await expect(createTransfer(business.id, transfer(), owner, dependencies)).rejects.toMatchObject({ code: codes.HEADING_NOT_USABLE });
    expect(money.movements.size).toBe(0);
  });

  it("updates both legs atomically and audits it", async () => {
    const fixture = await ledger();
    const { business, dependencies, bank, cash, contra, transfer, live } = fixture;
    const created = await createTransfer(business.id, transfer(), owner, dependencies);
    const updated = await updateTransfer(business.id, created.transferGroupId, { amount: "99.99", headingId: contra.id, date: "2026-06-02", narrative: "Moved" }, owner, dependencies);
    expect(updated.from).toMatchObject({ id: created.from.id, moneyAccountId: bank.id, amount: "-99.99", headingId: contra.id, movementDate: "2026-06-02", narrative: "Moved" });
    expect(updated.to).toMatchObject({ id: created.to.id, moneyAccountId: cash.id, amount: "99.99", headingId: contra.id, movementDate: "2026-06-02", narrative: "Moved" });

    const swapped = await updateTransfer(business.id, created.transferGroupId, { fromAccountId: cash.id, toAccountId: bank.id }, owner, dependencies);
    expect([swapped.from.moneyAccountId, swapped.from.amount, swapped.to.moneyAccountId, swapped.to.amount]).toEqual([cash.id, "-99.99", bank.id, "99.99"]);
    expect((await live()).map((item) => item.amount).sort()).toEqual(["-99.99", "99.99"]);

    await expect(updateTransfer(business.id, created.transferGroupId, { amount: "0.00" }, owner, dependencies)).rejects.toMatchObject({ code: codes.INVALID_AMOUNT });
    await expect(updateTransfer(business.id, created.transferGroupId, { toAccountId: cash.id }, owner, dependencies)).rejects.toMatchObject({ code: codes.INVALID_MOVEMENT });
    await expect(updateTransfer(business.id, created.transferGroupId, { date: "2027-05-01" }, owner, dependencies)).rejects.toMatchObject({ code: codes.MOVEMENT_OUTSIDE_OPEN_YEAR });
    await expect(updateTransfer(business.id, created.transferGroupId, {}, owner, dependencies)).rejects.toMatchObject({ code: codes.INVALID_MOVEMENT });
    await expect(updateTransfer(business.id, created.transferGroupId, { transferGroupId: "forged" } as Parameters<typeof updateTransfer>[2], owner, dependencies)).rejects.toMatchObject({ code: codes.INVALID_MOVEMENT });
    await expect(updateTransfer(business.id, "missing", { amount: "1.00" }, owner, dependencies)).rejects.toMatchObject({ code: codes.MOVEMENT_NOT_FOUND });
    expect((await live()).map((item) => [item.moneyAccountId, item.amount, item.movementDate])).toEqual([[cash.id, "-99.99", "2026-06-02"], [bank.id, "99.99", "2026-06-02"]]);
    expect((await auditTypes(fixture)).filter((type) => type.startsWith("transfer_") || type === "movement_updated")).toEqual([
      "transfer_created", "movement_updated", "movement_updated", "transfer_updated", "movement_updated", "movement_updated", "transfer_updated",
    ]);
  });

  it("soft-deletes both legs, audits it, and keeps closed years read-only", async () => {
    const fixture = await ledger();
    const { business, dependencies, year, transfer, live, money } = fixture;
    const created = await createTransfer(business.id, transfer(), owner, dependencies);
    await closeFinancialYear(business.id, year.id, owner, dependencies);
    await expect(updateTransfer(business.id, created.transferGroupId, { narrative: "Late" }, owner, dependencies)).rejects.toMatchObject({ code: codes.FINANCIAL_YEAR_CLOSED });
    await expect(deleteTransfer(business.id, created.transferGroupId, owner, dependencies)).rejects.toMatchObject({ code: codes.FINANCIAL_YEAR_CLOSED });
    await reopenFinancialYear(business.id, year.id, owner, dependencies);

    const deleted = await deleteTransfer(business.id, created.transferGroupId, owner, dependencies);
    expect([deleted.from.deletedAt, deleted.to.deletedAt]).toEqual([expect.any(String), expect.any(String)]);
    await expect(live()).resolves.toEqual([]);
    expect(money.movements.size).toBe(2);
    await expect(deleteTransfer(business.id, created.transferGroupId, owner, dependencies)).rejects.toMatchObject({ code: codes.MOVEMENT_NOT_FOUND });
    expect((await auditTypes(fixture)).slice(-3)).toEqual(["movement_deleted", "movement_deleted", "transfer_deleted"]);
  });

  it("rolls the whole transfer back when the audit write fails", async () => {
    const { business, dependencies, tenancy, transfer, money } = await ledger();
    const created = await createTransfer(business.id, transfer(), owner, dependencies);
    tenancy.appendAuditEvent = async () => { throw new Error("audit failed"); };
    await expect(createTransfer(business.id, transfer(), owner, dependencies)).rejects.toMatchObject({ code: codes.MONEY_REPOSITORY_CONFLICT });
    await expect(updateTransfer(business.id, created.transferGroupId, { amount: "1.00" }, owner, dependencies)).rejects.toMatchObject({ code: codes.MONEY_REPOSITORY_CONFLICT });
    await expect(deleteTransfer(business.id, created.transferGroupId, owner, dependencies)).rejects.toMatchObject({ code: codes.MONEY_REPOSITORY_CONFLICT });
    expect([...money.movements.values()].map((item) => [item.amount, item.deletedAt])).toEqual([["-120.50", null], ["120.50", null]]);
  });
});

describe("a transfer leg on its own", () => {
  it("cannot be edited or deleted through the single-movement functions, while ordinary manual movements still can", async () => {
    const { business, dependencies, bank, sales, transfer, live } = await ledger();
    const created = await createTransfer(business.id, transfer(), owner, dependencies);
    for (const leg of [created.from, created.to]) {
      await expect(updateMovement(business.id, leg.id, { amount: "1.00" }, owner, dependencies)).rejects.toMatchObject({ code: codes.MOVEMENT_ORIGIN_NOT_EDITABLE });
      await expect(deleteMovement(business.id, leg.id, owner, dependencies)).rejects.toMatchObject({ code: codes.MOVEMENT_ORIGIN_NOT_EDITABLE });
    }
    const single = await createMovement(business.id, { accountId: bank.id, date: "2026-05-02", narrative: "Takings", headingId: sales.id, amount: "10.00" }, owner, dependencies);
    await expect(updateMovement(business.id, single.id, { amount: "11.00" }, owner, dependencies)).resolves.toMatchObject({ amount: "11.00" });
    await expect(deleteMovement(business.id, single.id, owner, dependencies)).resolves.toMatchObject({ id: single.id });
    expect((await live()).map((item) => item.amount)).toEqual(["-120.50", "120.50"]);
  });
});

describe("the suggested transfer heading", () => {
  it("is null before the first transfer, then the heading of the most recent live usable transfer", async () => {
    const { business, dependencies, tenancy, headings, transfers, contra, transfer } = await ledger();
    await expect(suggestTransferHeading(business.id, owner, dependencies)).resolves.toEqual({ headingId: null });
    const first = await createTransfer(business.id, transfer(), owner, dependencies);
    await expect(suggestTransferHeading(business.id, owner, dependencies)).resolves.toEqual({ headingId: transfers.id });
    // Created later (a distinct millisecond) but dated earlier: creation order decides, not the date.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createTransfer(business.id, transfer({ headingId: contra.id, date: "2026-04-10" }), owner, dependencies);
    await expect(suggestTransferHeading(business.id, owner, dependencies)).resolves.toEqual({ headingId: contra.id });
    await deleteTransfer(business.id, second.transferGroupId, owner, dependencies);
    await expect(suggestTransferHeading(business.id, owner, dependencies)).resolves.toEqual({ headingId: transfers.id });
    await setHeadingActive(business.id, transfers.id, false, owner, { tenancyRepository: tenancy, headings });
    await expect(suggestTransferHeading(business.id, owner, dependencies)).resolves.toEqual({ headingId: null });
    expect(first.transferGroupId).not.toBe(second.transferGroupId);
  });
});

type Fixture = Awaited<ReturnType<typeof ledger>>;

describe("a transfer does not change the result", () => {
  const byHeading = (rows: Movement[]) => {
    const totals = new Map<string, number>();
    for (const row of rows) totals.set(row.headingId!, (totals.get(row.headingId!) ?? 0) + parsePounds(row.amount));
    return [...totals].filter(([, pence]) => pence !== 0).sort(([left], [right]) => left.localeCompare(right));
  };
  const total = (rows: Movement[]) => sumPence(rows.map((row) => parsePounds(row.amount)));

  it("keeps every heading's total and the total over all accounts after any sequence of transfer writes", async () => {
    const fixture = await ledger();
    const { business, dependencies, bank, cash, sales, charges, transfers, contra, transfer, live } = fixture;
    const deposit = await createMoneyAccount(business.id, { name: "Deposit", kind: "bank", sheetName: "Deposit" }, owner, dependencies);
    await createMovement(business.id, { accountId: bank.id, date: "2026-05-01", narrative: "Takings", headingId: sales.id, amount: "500.00" }, owner, dependencies);
    await createMovement(business.id, { accountId: cash.id, date: "2026-05-02", narrative: "Fee", headingId: charges.id, amount: "-3.75" }, owner, dependencies);
    const baseline = await live();
    const expectedHeadings = byHeading(baseline);
    const expectedTotal = total(baseline);

    // Deterministic pseudo-random walk over create / update / delete.
    let seed = 7;
    const next = (limit: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % limit; };
    const accounts = [bank.id, cash.id, deposit.id];
    const headingIds = [transfers.id, contra.id];
    const groups: string[] = [];
    for (let step = 0; step < 40; step += 1) {
      const operation = groups.length === 0 ? 0 : next(3);
      const from = accounts[next(3)];
      const to = accounts.filter((account) => account !== from)[next(2)];
      const amount = `${1 + next(900)}.${String(next(100)).padStart(2, "0")}`;
      if (operation === 0) {
        groups.push((await createTransfer(business.id, transfer({ fromAccountId: from, toAccountId: to, amount, headingId: headingIds[next(2)] }), owner, dependencies)).transferGroupId);
      } else if (operation === 1) {
        await updateTransfer(business.id, groups[next(groups.length)], { fromAccountId: from, toAccountId: to, amount, headingId: headingIds[next(2)] }, owner, dependencies);
      } else {
        await deleteTransfer(business.id, groups.splice(next(groups.length), 1)[0], owner, dependencies);
      }
      const rows = await live();
      expect(byHeading(rows)).toEqual(expectedHeadings);
      expect(total(rows)).toBe(expectedTotal);
      expect(rows.filter((row) => row.transferGroupId !== null)).toHaveLength(groups.length * 2);
    }
  });
});
