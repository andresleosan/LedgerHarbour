import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../../src/modules/auth/auth-provider";
import { getCurrentIdentity } from "../../src/modules/auth/session";
import type { Capability } from "../../src/modules/permissions/capabilities";
import type { Membership, UserId } from "../../src/modules/tenancy/types";

const denied = new Set<Capability>();

vi.mock("../../src/modules/permissions/authorize", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/modules/permissions/authorize")>();
  return {
    ...original,
    requireCapability: (membership: Membership, capability: Capability) => {
      if (denied.has(capability)) throw new original.AuthorizationError("CAPABILITY_REQUIRED", "Capability required");
      return original.requireCapability(membership, capability);
    },
  };
});
vi.mock("../../src/modules/auth/session", () => ({ getCurrentIdentity: vi.fn() }));

import { GET as summaryRoute } from "../../src/app/api/businesses/[businessId]/financial-years/[yearId]/summary/route";
import { GET as listAccountsRoute } from "../../src/app/api/businesses/[businessId]/money-accounts/route";
import { GET as listMovementsRoute } from "../../src/app/api/businesses/[businessId]/movements/route";
import { importHeadings, listHeadings, resolveDefaultHeadingRepository, type TemplateHeadingInput } from "../../src/modules/accounting/heading-service";
import { resolveDefaultMoneyRepository } from "../../src/modules/accounting/money-repository";
import { createFinancialYear, createMoneyAccount, createMovement, createTransfer, setOpeningBalance, type MoneyDependencies } from "../../src/modules/accounting/money-service";
import { resolveDefaultTemplateRepository } from "../../src/modules/accounting/template-service";
import { summarizeYear } from "../../src/modules/accounting/year-summary";
import { resetPersistenceContextForTests } from "../../src/modules/persistence/repository-factory";
import { defaultOnboardingRepository, type OnboardingActor } from "../../src/modules/tenancy/business-service";
import type { AccountSheet } from "../../src/modules/workbook/template-profile";
import { createApprovedBusiness } from "../helpers/business-fixtures";

const user = (value: string) => value as UserId;
const headingInputs: TemplateHeadingInput[] = [
  { position: 1, templateValue: "Sales", valueType: "text", group: "income", order: 1, blockedReason: null },
  { position: 2, templateValue: "Rent", valueType: "text", group: "expenses", order: 2, blockedReason: null },
];
const identity = (name: string): AuthIdentity => ({ provider: "firebase", providerUserId: `lh025-${name}`, email: `lh025-${name}@example.com`, displayName: name, emailVerified: true });
const ownerA = identity("owner-a");
const ownerB = identity("owner-b");
const params = <T extends object>(value: T) => ({ params: Promise.resolve(value) });
const get = (query = "") => new Request(`http://localhost/api${query}`);

async function seed(dependencies: Required<Pick<MoneyDependencies, "tenancyRepository" | "headings" | "templates" | "money">>, name: string, owner: OnboardingActor) {
  const business = await createApprovedBusiness(defaultOnboardingRepository, name, owner);
  await importHeadings(business.id, headingInputs, owner, dependencies);
  const [sales, rent] = await listHeadings(business.id, owner, dependencies);
  await dependencies.templates.upsert({
    id: `template-${business.id}`, businessId: business.id, privateObjectKey: "key", originalFileName: "Accounts.xlsx", sizeBytes: 1, checksum: "a".repeat(64),
    profile: { sheets: ["Main Bank", "Cash"].map((sheet) => ({ name: sheet }) as AccountSheet), defects: [] },
    uploadedBy: user("seed"), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const year = await createFinancialYear(business.id, { startDate: "2026-04-06", endDate: "2027-04-05" }, owner, dependencies);
  const bank = await createMoneyAccount(business.id, { name: "Main bank", kind: "bank", sheetName: "Main Bank" }, owner, dependencies);
  const cash = await createMoneyAccount(business.id, { name: "Till", kind: "cash", sheetName: "Cash" }, owner, dependencies);
  await setOpeningBalance(business.id, bank.id, year.id, "1234.56", owner, dependencies);
  await createMovement(business.id, { accountId: bank.id, date: "2026-05-01", narrative: `${name} takings`, headingId: sales.id, amount: "100.10" }, owner, dependencies);
  await createMovement(business.id, { accountId: bank.id, date: "2026-05-02", narrative: "Rent", headingId: rent.id, amount: "-650.00" }, owner, dependencies);
  await createMovement(business.id, { accountId: bank.id, date: "2026-05-03", narrative: "Rent refund", headingId: rent.id, amount: "0.01" }, owner, dependencies);
  await createTransfer(business.id, { fromAccountId: bank.id, toAccountId: cash.id, date: "2026-05-04", amount: "40.00", headingId: sales.id }, owner, dependencies);
  return { business, year, bank, cash };
}

async function routeFixture() {
  delete process.env.PERSISTENCE_MODE;
  await resetPersistenceContextForTests();
  const stamp = `${Date.now()}-${Math.random()}`;
  const dependencies = { tenancyRepository: defaultOnboardingRepository, headings: resolveDefaultHeadingRepository(), templates: resolveDefaultTemplateRepository(), money: resolveDefaultMoneyRepository() };
  return { a: await seed(dependencies, `Summary A ${stamp}`, ownerA), b: await seed(dependencies, `Summary B ${stamp}`, ownerB) };
}

beforeEach(() => denied.clear());

describe("year summary API", () => {
  const mockedIdentity = vi.mocked(getCurrentIdentity);

  it("serves a member the totals summarizeYear gives over the same rows, never cached", async () => {
    const { a } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    const ids = { businessId: a.business.id, yearId: a.year.id };
    const response = await summaryRoute(get(), params(ids));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    const accounts = await (await listAccountsRoute(get(`?yearId=${a.year.id}`), params({ businessId: a.business.id }))).json() as Array<{ id: string; openingBalance: string }>;
    const movements = await (await listMovementsRoute(get(`?yearId=${a.year.id}`), params({ businessId: a.business.id }))).json();
    const expected = summarizeYear({ accounts: accounts.map((account) => ({ id: account.id, openingBalance: account.openingBalance })), movements });
    expect(await response.json()).toEqual(expected);
    expect(expected.byAccount.find((row) => row.accountId === a.bank.id)).toMatchObject({ openingPence: 123456, movementsPence: -58989, closingPence: 64467 });
  });

  it("gives a member of A asking for B the same refusal as the movements route, and leaks nothing through a foreign year", async () => {
    const { a, b } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    const movements = await listMovementsRoute(get(`?yearId=${b.year.id}`), params({ businessId: b.business.id }));
    const refusal = { status: movements.status, body: await movements.json() };
    expect(refusal).toEqual({ status: 404, body: { error: { code: "BUSINESS_ACCESS_DENIED", message: "Business access denied." } } });
    const crossed = await summaryRoute(get(), params({ businessId: b.business.id, yearId: b.year.id }));
    expect({ status: crossed.status, body: await crossed.json() }).toEqual(refusal);

    const smuggled = await summaryRoute(get(), params({ businessId: a.business.id, yearId: b.year.id }));
    const text = await smuggled.text();
    expect(smuggled.status).toBe(404);
    expect(JSON.parse(text)).toEqual({ error: { code: "FINANCIAL_YEAR_NOT_FOUND", message: expect.any(String) } });
    for (const leak of [b.bank.id, b.cash.id, "123456", "Summary B"]) expect(text).not.toContain(leak);
  });

  it("refuses a member without read_finance, an outsider and an anonymous caller", async () => {
    const { a } = await routeFixture();
    const ids = { businessId: a.business.id, yearId: a.year.id };
    mockedIdentity.mockResolvedValue(ownerA);
    denied.add("read_finance");
    const forbidden = await summaryRoute(get(), params(ids));
    expect({ status: forbidden.status, body: await forbidden.json() }).toMatchObject({ status: 403, body: { error: { code: "INSUFFICIENT_CAPABILITY" } } });
    denied.clear();
    mockedIdentity.mockResolvedValue(identity("outsider"));
    expect((await summaryRoute(get(), params(ids))).status).toBe(404);
    mockedIdentity.mockResolvedValue(null);
    expect((await summaryRoute(get(), params(ids))).status).toBe(401);
  });
});
