import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../../src/modules/auth/auth-provider";
import { getCurrentIdentity } from "../../src/modules/auth/session";
import type { Capability } from "../../src/modules/permissions/capabilities";
import { createHeadingRepository, importHeadings, listHeadings, resolveDefaultHeadingRepository, type HeadingRepository, type TemplateHeadingInput } from "../../src/modules/accounting/heading-service";
import { MONEY_ERROR_CODES, createMoneyRepository, resolveDefaultMoneyRepository } from "../../src/modules/accounting/money-repository";
import {
  closeFinancialYear,
  createFinancialYear,
  createMoneyAccount,
  createMovement,
  deleteMovement,
  listFinancialYears,
  listMoneyAccounts,
  listMovements,
  renameMoneyAccount,
  reopenFinancialYear,
  setMoneyAccountActive,
  setOpeningBalance,
  updateFinancialYearDates,
  updateMovement,
  type MoneyDependencies,
} from "../../src/modules/accounting/money-service";
import { createTemplateRepository, resolveDefaultTemplateRepository, type TemplateRepository } from "../../src/modules/accounting/template-service";
import type { AccountSheet } from "../../src/modules/workbook/template-profile";
import { createInMemoryOnboardingRepository, defaultOnboardingRepository, type OnboardingActor, type OnboardingRepository } from "../../src/modules/tenancy/business-service";
import { resetPersistenceContextForTests } from "../../src/modules/persistence/repository-factory";
import type { BusinessId, Membership, UserId } from "../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../helpers/business-fixtures";

const denied = new Set<Capability>();
const checked: Capability[] = [];

vi.mock("../../src/modules/permissions/authorize", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/modules/permissions/authorize")>();
  return {
    ...original,
    requireCapability: (membership: Membership, capability: Capability) => {
      checked.push(capability);
      if (denied.has(capability)) throw new original.AuthorizationError("CAPABILITY_REQUIRED", "Capability required");
      return original.requireCapability(membership, capability);
    },
  };
});
vi.mock("../../src/modules/auth/session", () => ({ getCurrentIdentity: vi.fn() }));

import { GET as listYearsRoute, POST as createYearRoute } from "../../src/app/api/businesses/[businessId]/financial-years/route";
import { PATCH as patchYearRoute } from "../../src/app/api/businesses/[businessId]/financial-years/[yearId]/route";
import { GET as listAccountsRoute, POST as createAccountRoute } from "../../src/app/api/businesses/[businessId]/money-accounts/route";
import { PATCH as patchAccountRoute } from "../../src/app/api/businesses/[businessId]/money-accounts/[accountId]/route";
import { GET as listMovementsRoute, POST as createMovementRoute } from "../../src/app/api/businesses/[businessId]/movements/route";
import { DELETE as deleteMovementRoute, PATCH as patchMovementRoute } from "../../src/app/api/businesses/[businessId]/movements/[movementId]/route";
import { GET as listCategoriesRoute } from "../../src/app/api/businesses/[businessId]/categories/route";

const user = (value: string) => value as UserId;
const headingInputs: TemplateHeadingInput[] = [
  { position: 1, templateValue: "Sales", valueType: "text", group: "income", order: 1, blockedReason: null },
  { position: 2, templateValue: "Rent", valueType: "text", group: "expenses", order: 2, blockedReason: null },
];

function member(userId: string, businessId: Membership["businessId"], role: Membership["role"], status: Membership["status"] = "active"): Membership {
  return { membershipId: `membership-${userId}`, userId: user(userId), businessId, role, isActive: status === "active", status };
}

async function seedBusiness(tenancy: OnboardingRepository, headings: HeadingRepository, templates: TemplateRepository, name: string, owner: OnboardingActor) {
  const business = await createApprovedBusiness(tenancy, name, owner);
  await importHeadings(business.id, headingInputs, owner, { tenancyRepository: tenancy, headings });
  const [heading] = await listHeadings(business.id, owner, { tenancyRepository: tenancy, headings });
  await templates.upsert({
    id: `template-${business.id}`,
    businessId: business.id,
    privateObjectKey: "key",
    originalFileName: "Accounts.xlsx",
    sizeBytes: 1,
    checksum: "a".repeat(64),
    profile: { sheets: ["Main Bank", "Cash", "Deposit"].map((sheet) => ({ name: sheet }) as AccountSheet), defects: [] },
    uploadedBy: user("seed"),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  return { business, heading };
}

async function seedLedger(businessId: BusinessId, owner: OnboardingActor, dependencies: MoneyDependencies, headingId: string) {
  const year = await createFinancialYear(businessId, { startDate: "2026-04-06", endDate: "2027-04-05" }, owner, dependencies);
  const account = await createMoneyAccount(businessId, { name: "Main bank", kind: "bank", sheetName: "Main Bank" }, owner, dependencies);
  const movement = await createMovement(businessId, { accountId: account.id, date: "2026-05-01", narrative: "Takings", headingId, amount: "10.00" }, owner, dependencies);
  return { year, account, movement };
}

async function serviceFixture() {
  const tenancy = createInMemoryOnboardingRepository();
  const headings = createHeadingRepository();
  const templates = createTemplateRepository();
  const dependencies = { tenancyRepository: tenancy, headings, templates, money: createMoneyRepository() } satisfies MoneyDependencies;
  const a = await seedBusiness(tenancy, headings, templates, "Money Harbour A", user("owner-a"));
  const b = await seedBusiness(tenancy, headings, templates, "Money Harbour B", user("owner-b"));
  tenancy.memberships.push(
    member("general-a", a.business.id, "general_admin"),
    member("administrator-a", a.business.id, "administrator"),
    member("pending-a", a.business.id, "administrator", "pending"),
  );
  const ledgerA = await seedLedger(a.business.id, user("owner-a"), dependencies, a.heading.id);
  const ledgerB = await seedLedger(b.business.id, user("owner-b"), dependencies, b.heading.id);
  return { dependencies, a: { ...a, ...ledgerA }, b: { ...b, ...ledgerB } };
}

type Side = Awaited<ReturnType<typeof serviceFixture>>["a"];

function reads(side: Side, actor: OnboardingActor, dependencies: MoneyDependencies) {
  const id = side.business.id;
  return [
    () => listFinancialYears(id, actor, dependencies),
    () => listMoneyAccounts(id, { yearId: side.year.id }, actor, dependencies),
    () => listMovements(id, { yearId: side.year.id }, actor, dependencies),
  ];
}

function writes(side: Side, actor: OnboardingActor, dependencies: MoneyDependencies, businessId: BusinessId = side.business.id) {
  return [
    () => createFinancialYear(businessId, { startDate: "2030-01-01", endDate: "2030-12-31" }, actor, dependencies),
    () => updateFinancialYearDates(businessId, side.year.id, { endDate: "2027-03-31" }, actor, dependencies),
    () => closeFinancialYear(businessId, side.year.id, actor, dependencies),
    () => reopenFinancialYear(businessId, side.year.id, actor, dependencies),
    () => createMoneyAccount(businessId, { name: "Till", kind: "cash", sheetName: "Cash" }, actor, dependencies),
    () => renameMoneyAccount(businessId, side.account.id, "Renamed", actor, dependencies),
    () => setMoneyAccountActive(businessId, side.account.id, false, actor, dependencies),
    () => setOpeningBalance(businessId, side.account.id, side.year.id, "5.00", actor, dependencies),
    () => createMovement(businessId, { accountId: side.account.id, date: "2026-05-02", narrative: "Crossed", headingId: side.heading.id, amount: "1.00" }, actor, dependencies),
    () => updateMovement(businessId, side.movement.id, { narrative: "Crossed" }, actor, dependencies),
    () => deleteMovement(businessId, side.movement.id, actor, dependencies),
  ];
}

beforeEach(() => {
  denied.clear();
  checked.splice(0);
});

describe("money permission matrix", () => {
  it.each(["owner-a", "general-a", "administrator-a"])("lets active member %s read and write its own business", async (actor) => {
    const { dependencies, a } = await serviceFixture();
    for (const operation of reads(a, user(actor), dependencies)) await expect(operation()).resolves.toBeDefined();
    await expect(createMovement(a.business.id, { accountId: a.account.id, date: "2026-05-02", narrative: `By ${actor}`, headingId: a.heading.id, amount: "-2.50" }, user(actor), dependencies)).resolves.toMatchObject({ amount: "-2.50", createdBy: actor });
    await expect(setOpeningBalance(a.business.id, a.account.id, a.year.id, "-100.00", user(actor), dependencies)).resolves.toMatchObject({ openingBalance: "-100.00" });
    await expect(createMoneyAccount(a.business.id, { name: "Till", kind: "cash", sheetName: "Cash" }, user(actor), dependencies)).resolves.toMatchObject({ kind: "cash" });
  });

  it("requires read_finance to list and edit_finance to write", async () => {
    const { dependencies, a } = await serviceFixture();
    for (const operation of reads(a, user("owner-a"), dependencies)) {
      checked.splice(0);
      await operation();
      expect(checked).toEqual(["read_finance"]);
    }
    for (const operation of writes(a, user("owner-a"), dependencies)) {
      checked.splice(0);
      await operation().catch(() => undefined);
      expect(checked[0]).toBe("edit_finance");
    }

    const { dependencies: fresh, a: freshA } = await serviceFixture();
    denied.add("edit_finance");
    for (const operation of reads(freshA, user("owner-a"), fresh)) await expect(operation()).resolves.toBeDefined();
    for (const operation of writes(freshA, user("owner-a"), fresh)) await expect(operation()).rejects.toMatchObject({ code: MONEY_ERROR_CODES.INSUFFICIENT_CAPABILITY });
    denied.clear();
    denied.add("read_finance");
    for (const operation of reads(freshA, user("owner-a"), fresh)) await expect(operation()).rejects.toMatchObject({ code: MONEY_ERROR_CODES.INSUFFICIENT_CAPABILITY });
    denied.clear();
    await expect(listMovements(freshA.business.id, { yearId: freshA.year.id }, user("owner-a"), fresh)).resolves.toEqual([freshA.movement]);
  });

  it.each(["outsider", "pending-a"])("denies %s access to the business money", async (actor) => {
    const { dependencies, a } = await serviceFixture();
    for (const operation of [...reads(a, user(actor), dependencies), ...writes(a, user(actor), dependencies)]) {
      await expect(operation()).rejects.toMatchObject({ code: MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    }
  });

  it("isolates business A members from business B years, accounts, headings and movements", async () => {
    const { dependencies, a, b } = await serviceFixture();
    for (const operation of [...reads(b, user("owner-a"), dependencies), ...writes(b, user("owner-a"), dependencies)]) {
      await expect(operation()).rejects.toMatchObject({ code: MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    }
    const [, ...smuggled] = writes(b, user("owner-a"), dependencies, a.business.id);
    const notFound = { year: MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND, account: MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND, movement: MONEY_ERROR_CODES.MOVEMENT_NOT_FOUND };
    // Business A's own path with business B's ids; creating an account carries no foreign id and is skipped.
    const expected = [notFound.year, notFound.year, notFound.year, null, notFound.account, notFound.account, notFound.account, notFound.account, notFound.movement, notFound.movement];
    for (const [index, operation] of smuggled.entries()) {
      if (expected[index]) await expect(operation()).rejects.toMatchObject({ code: expected[index] });
    }
    await expect(createMovement(a.business.id, { accountId: a.account.id, date: "2026-05-02", narrative: "B heading", headingId: b.heading.id, amount: "1.00" }, user("owner-a"), dependencies))
      .rejects.toMatchObject({ code: MONEY_ERROR_CODES.HEADING_NOT_FOUND });
    await expect(listMovements(a.business.id, { yearId: b.year.id }, user("owner-a"), dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND });
    await expect(listMovements(a.business.id, { yearId: a.year.id, accountId: b.account.id }, user("owner-a"), dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND });

    await expect(listMovements(b.business.id, { yearId: b.year.id }, user("owner-b"), dependencies)).resolves.toEqual([b.movement]);
    await expect(listMoneyAccounts(b.business.id, { yearId: b.year.id }, user("owner-b"), dependencies)).resolves.toMatchObject([{ id: b.account.id, name: "Main bank", isActive: true, openingBalance: "0.00" }]);
    await expect(listFinancialYears(b.business.id, user("owner-b"), dependencies)).resolves.toEqual([b.year]);
  });
});

describe("money API isolation", () => {
  const mockedIdentity = vi.mocked(getCurrentIdentity);
  const identity = (name: string): AuthIdentity => ({ provider: "firebase", providerUserId: `lh015-${name}`, email: `lh015-${name}@example.com`, displayName: name, emailVerified: true });
  const ownerA = identity("owner-a");
  const ownerB = identity("owner-b");
  const outsider = identity("outsider");
  const params = <T extends object>(value: T) => ({ params: Promise.resolve(value) });
  const json = (method: string, body: unknown) => new Request("http://localhost/api", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const get = (query = "") => new Request(`http://localhost/api${query}`);

  async function routeFixture() {
    delete process.env.PERSISTENCE_MODE;
    await resetPersistenceContextForTests();
    const stamp = `${Date.now()}-${Math.random()}`;
    const dependencies = { tenancyRepository: defaultOnboardingRepository, headings: resolveDefaultHeadingRepository(), templates: resolveDefaultTemplateRepository(), money: resolveDefaultMoneyRepository() };
    const a = await seedBusiness(defaultOnboardingRepository, dependencies.headings, dependencies.templates, `Route Money A ${stamp}`, ownerA);
    const b = await seedBusiness(defaultOnboardingRepository, dependencies.headings, dependencies.templates, `Route Money B ${stamp}`, ownerB);
    return { a: { ...a, ...(await seedLedger(a.business.id, ownerA, dependencies, a.heading.id)) }, b: { ...b, ...(await seedLedger(b.business.id, ownerB, dependencies, b.heading.id)) } };
  }

  it("serves and writes a member's own years, accounts and movements with decimal-string amounts", async () => {
    const { a } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    const businessId = a.business.id;

    const years = await listYearsRoute(get(), params({ businessId }));
    expect(years.status).toBe(200);
    expect((await years.json()).map((year: { id: string }) => year.id)).toEqual([a.year.id]);

    const account = await createAccountRoute(json("POST", { name: "Till", kind: "cash", sheetName: "Cash" }), params({ businessId }));
    expect(account.status).toBe(201);
    const till = await account.json();
    const opening = await patchAccountRoute(json("PATCH", { openingBalance: { yearId: a.year.id, amount: "-0.01" } }), params({ businessId, accountId: till.id }));
    expect(await opening.json()).toMatchObject({ id: till.id, openingBalance: "-0.01" });
    const accounts = await listAccountsRoute(get(`?yearId=${a.year.id}`), params({ businessId }));
    expect((await accounts.json()).map((item: { name: string; openingBalance: string }) => [item.name, item.openingBalance])).toEqual([["Main bank", "0.00"], ["Till", "-0.01"]]);

    const created = await createMovementRoute(json("POST", { accountId: till.id, date: "2026-06-01", narrative: "Float", headingId: a.heading.id, amount: "0.1" }), params({ businessId }));
    expect(created.status).toBe(201);
    const movement = await created.json();
    expect(movement).toMatchObject({ amount: "0.10", origin: "manual" });
    const patched = await patchMovementRoute(json("PATCH", { amount: "-0.20" }), params({ businessId, movementId: movement.id }));
    expect(await patched.json()).toMatchObject({ id: movement.id, amount: "-0.20" });
    const listed = await listMovementsRoute(get(`?yearId=${a.year.id}&accountId=${till.id}`), params({ businessId }));
    expect((await listed.json()).map((item: { amount: string }) => item.amount)).toEqual(["-0.20"]);
    expect((await deleteMovementRoute(get(), params({ businessId, movementId: movement.id }))).status).toBe(200);

    const outside = await createMovementRoute(json("POST", { accountId: till.id, date: "2027-06-01", narrative: "Late", headingId: a.heading.id, amount: "1.00" }), params({ businessId }));
    expect({ status: outside.status, body: await outside.json() }).toMatchObject({ status: 409, body: { error: { code: "MOVEMENT_OUTSIDE_OPEN_YEAR" } } });
    const closed = await patchYearRoute(json("PATCH", { status: "closed" }), params({ businessId, yearId: a.year.id }));
    expect(await closed.json()).toMatchObject({ id: a.year.id, status: "closed" });
    const readOnly = await patchMovementRoute(json("PATCH", { narrative: "Late edit" }), params({ businessId, movementId: a.movement.id }));
    expect({ status: readOnly.status, body: await readOnly.json() }).toMatchObject({ status: 409, body: { error: { code: "FINANCIAL_YEAR_CLOSED" } } });
  });

  it("rejects cross-business reads, writes and smuggled ids through the handlers", async () => {
    const { a, b } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    const crossed = [
      await listYearsRoute(get(), params({ businessId: b.business.id })),
      await createYearRoute(json("POST", { startDate: "2030-01-01", endDate: "2030-12-31" }), params({ businessId: b.business.id })),
      await patchYearRoute(json("PATCH", { status: "closed" }), params({ businessId: b.business.id, yearId: b.year.id })),
      await listAccountsRoute(get(), params({ businessId: b.business.id })),
      await createAccountRoute(json("POST", { name: "Till", kind: "cash", sheetName: "Cash" }), params({ businessId: b.business.id })),
      await patchAccountRoute(json("PATCH", { isActive: false }), params({ businessId: b.business.id, accountId: b.account.id })),
      await listMovementsRoute(get(`?yearId=${b.year.id}`), params({ businessId: b.business.id })),
      await createMovementRoute(json("POST", { accountId: b.account.id, date: "2026-05-02", narrative: "x", headingId: b.heading.id, amount: "1.00" }), params({ businessId: b.business.id })),
      await patchMovementRoute(json("PATCH", { narrative: "x" }), params({ businessId: b.business.id, movementId: b.movement.id })),
      await deleteMovementRoute(get(), params({ businessId: b.business.id, movementId: b.movement.id })),
    ];
    for (const response of crossed) {
      expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 404, body: { error: { code: "BUSINESS_ACCESS_DENIED" } } });
    }

    const smuggled = [
      [await patchYearRoute(json("PATCH", { status: "closed" }), params({ businessId: a.business.id, yearId: b.year.id })), "FINANCIAL_YEAR_NOT_FOUND"],
      [await patchAccountRoute(json("PATCH", { isActive: false }), params({ businessId: a.business.id, accountId: b.account.id })), "MONEY_ACCOUNT_NOT_FOUND"],
      [await listMovementsRoute(get(`?yearId=${b.year.id}`), params({ businessId: a.business.id })), "FINANCIAL_YEAR_NOT_FOUND"],
      [await createMovementRoute(json("POST", { accountId: b.account.id, date: "2026-05-02", narrative: "x", headingId: a.heading.id, amount: "1.00" }), params({ businessId: a.business.id })), "MONEY_ACCOUNT_NOT_FOUND"],
      [await createMovementRoute(json("POST", { accountId: a.account.id, date: "2026-05-02", narrative: "x", headingId: b.heading.id, amount: "1.00" }), params({ businessId: a.business.id })), "HEADING_NOT_FOUND"],
      [await patchMovementRoute(json("PATCH", { narrative: "x" }), params({ businessId: a.business.id, movementId: b.movement.id })), "MOVEMENT_NOT_FOUND"],
      [await deleteMovementRoute(get(), params({ businessId: a.business.id, movementId: b.movement.id })), "MOVEMENT_NOT_FOUND"],
    ] as const;
    for (const [response, code] of smuggled) {
      expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 404, body: { error: { code } } });
    }

    mockedIdentity.mockResolvedValue(ownerB);
    const untouched = await listMovementsRoute(get(`?yearId=${b.year.id}`), params({ businessId: b.business.id }));
    expect(await untouched.json()).toEqual([b.movement]);
  });

  it("gives a non-member the same response as the other finance routes", async () => {
    const { a } = await routeFixture();
    mockedIdentity.mockResolvedValue(outsider);
    const categories = await listCategoriesRoute(get(), params({ businessId: a.business.id }));
    const expected = { status: categories.status, body: await categories.json() };
    expect(expected).toEqual({ status: 404, body: { error: { code: "BUSINESS_ACCESS_DENIED", message: "Business access denied." } } });
    for (const response of [
      await listYearsRoute(get(), params({ businessId: a.business.id })),
      await listAccountsRoute(get(), params({ businessId: a.business.id })),
      await listMovementsRoute(get(`?yearId=${a.year.id}`), params({ businessId: a.business.id })),
      await createMovementRoute(json("POST", { accountId: a.account.id, date: "2026-05-02", narrative: "x", headingId: a.heading.id, amount: "1.00" }), params({ businessId: a.business.id })),
      await deleteMovementRoute(get(), params({ businessId: a.business.id, movementId: a.movement.id })),
    ]) expect({ status: response.status, body: await response.json() }).toEqual(expected);
  });

  it("requires sign-in and a strict body", async () => {
    const { a } = await routeFixture();
    const businessId = a.business.id;
    mockedIdentity.mockResolvedValue(null);
    for (const response of [
      await listYearsRoute(get(), params({ businessId })),
      await listAccountsRoute(get(), params({ businessId })),
      await listMovementsRoute(get(`?yearId=${a.year.id}`), params({ businessId })),
      await createMovementRoute(json("POST", {}), params({ businessId })),
      await deleteMovementRoute(get(), params({ businessId, movementId: a.movement.id })),
    ]) expect(response.status).toBe(401);

    mockedIdentity.mockResolvedValue(ownerA);
    const movement = { accountId: a.account.id, date: "2026-05-02", narrative: "x", headingId: a.heading.id, amount: "1.00" };
    for (const response of [
      await createYearRoute(json("POST", { startDate: "2030-01-01" }), params({ businessId })),
      await patchYearRoute(json("PATCH", {}), params({ businessId, yearId: a.year.id })),
      await patchYearRoute(json("PATCH", { status: "archived" }), params({ businessId, yearId: a.year.id })),
      await createAccountRoute(json("POST", { name: "Till", kind: "cash", sheetName: "Cash", isActive: false }), params({ businessId })),
      await patchAccountRoute(json("PATCH", { openingBalance: { yearId: a.year.id, amount: 5 } }), params({ businessId, accountId: a.account.id })),
      await patchAccountRoute(json("PATCH", { sheetName: "Cash" }), params({ businessId, accountId: a.account.id })),
      await listMovementsRoute(get(), params({ businessId })),
      await createMovementRoute(json("POST", { ...movement, amount: 1 }), params({ businessId })),
      await createMovementRoute(json("POST", { ...movement, createdBy: "someone" }), params({ businessId })),
      await createMovementRoute(new Request("http://localhost/api", { method: "POST", body: "{" }), params({ businessId })),
      await patchMovementRoute(json("PATCH", { origin: "invoice" }), params({ businessId, movementId: a.movement.id })),
    ]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_MONEY_REQUEST" } });
    }
    const exponent = await createMovementRoute(json("POST", { ...movement, amount: "1e3" }), params({ businessId }));
    expect({ status: exponent.status, body: await exponent.json() }).toMatchObject({ status: 400, body: { error: { code: "INVALID_AMOUNT" } } });
    const invoice = await createMovementRoute(json("POST", { ...movement, origin: "invoice" }), params({ businessId }));
    expect({ status: invoice.status, body: await invoice.json() }).toMatchObject({ status: 409, body: { error: { code: "MOVEMENT_ORIGIN_NOT_EDITABLE" } } });
  });
});
