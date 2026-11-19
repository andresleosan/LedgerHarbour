import { describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../../src/modules/auth/auth-provider";
import { getCurrentIdentity } from "../../src/modules/auth/session";
import { createHeadingRepository, importHeadings, listHeadings, resolveDefaultHeadingRepository, type HeadingRepository, type TemplateHeadingInput } from "../../src/modules/accounting/heading-service";
import { MONEY_ERROR_CODES, createMoneyRepository, resolveDefaultMoneyRepository } from "../../src/modules/accounting/money-repository";
import {
  createFinancialYear,
  createMoneyAccount,
  createTransfer,
  deleteTransfer,
  listMovements,
  suggestTransferHeading,
  updateTransfer,
  type MoneyDependencies,
} from "../../src/modules/accounting/money-service";
import { createTemplateRepository, resolveDefaultTemplateRepository, type TemplateRepository } from "../../src/modules/accounting/template-service";
import type { AccountSheet } from "../../src/modules/workbook/template-profile";
import { createInMemoryOnboardingRepository, defaultOnboardingRepository, type OnboardingActor, type OnboardingRepository } from "../../src/modules/tenancy/business-service";
import { resetPersistenceContextForTests } from "../../src/modules/persistence/repository-factory";
import type { BusinessId, Membership, UserId } from "../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../helpers/business-fixtures";

vi.mock("../../src/modules/auth/session", () => ({ getCurrentIdentity: vi.fn() }));

import { POST as createTransferRoute } from "../../src/app/api/businesses/[businessId]/transfers/route";
import { DELETE as deleteTransferRoute, PATCH as patchTransferRoute } from "../../src/app/api/businesses/[businessId]/transfers/[transferGroupId]/route";
import { GET as suggestionRoute } from "../../src/app/api/businesses/[businessId]/transfers/suggestion/route";
import { DELETE as deleteMovementRoute, PATCH as patchMovementRoute } from "../../src/app/api/businesses/[businessId]/movements/[movementId]/route";

const user = (value: string) => value as UserId;
const headingInputs: TemplateHeadingInput[] = [{ position: 1, templateValue: "Transfers", valueType: "text", group: "assets", order: 1, blockedReason: null }];

async function seed(tenancy: OnboardingRepository, headings: HeadingRepository, templates: TemplateRepository, dependencies: MoneyDependencies, name: string, owner: OnboardingActor) {
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
    profile: { sheets: ["Main Bank", "Cash"].map((sheet) => ({ name: sheet }) as AccountSheet), defects: [] },
    uploadedBy: user("seed"),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const year = await createFinancialYear(business.id, { startDate: "2026-04-06", endDate: "2027-04-05" }, owner, dependencies);
  const bank = await createMoneyAccount(business.id, { name: "Main bank", kind: "bank", sheetName: "Main Bank" }, owner, dependencies);
  const cash = await createMoneyAccount(business.id, { name: "Till", kind: "cash", sheetName: "Cash" }, owner, dependencies);
  const input = { fromAccountId: bank.id, toAccountId: cash.id, date: "2026-05-01", amount: "10.00", headingId: heading.id };
  const transfer = await createTransfer(business.id, input, owner, dependencies);
  return { business, heading, year, bank, cash, input, transfer };
}

async function serviceFixture() {
  const tenancy = createInMemoryOnboardingRepository();
  const headings = createHeadingRepository();
  const templates = createTemplateRepository();
  const dependencies = { tenancyRepository: tenancy, headings, templates, money: createMoneyRepository() } satisfies MoneyDependencies;
  const a = await seed(tenancy, headings, templates, dependencies, "Transfer Harbour A", user("owner-a"));
  const b = await seed(tenancy, headings, templates, dependencies, "Transfer Harbour B", user("owner-b"));
  const membership: Membership = { membershipId: "membership-viewer", userId: user("pending-a"), businessId: a.business.id, role: "administrator", isActive: false, status: "pending" };
  tenancy.memberships.push(membership);
  return { dependencies, a, b };
}

type Side = Awaited<ReturnType<typeof serviceFixture>>["a"];

const operations = (side: Side, actor: OnboardingActor, dependencies: MoneyDependencies, businessId: BusinessId = side.business.id) => [
  () => createTransfer(businessId, side.input, actor, dependencies),
  () => updateTransfer(businessId, side.transfer.transferGroupId, { amount: "1.00" }, actor, dependencies),
  () => deleteTransfer(businessId, side.transfer.transferGroupId, actor, dependencies),
  () => suggestTransferHeading(businessId, actor, dependencies),
];

describe("transfer permission matrix", () => {
  it.each(["outsider", "pending-a", "owner-b"])("denies %s every transfer operation on business A", async (actor) => {
    const { dependencies, a, b } = await serviceFixture();
    for (const operation of operations(a, user(actor), dependencies)) await expect(operation()).rejects.toMatchObject({ code: MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    await expect(listMovements(a.business.id, { yearId: a.year.id }, user("owner-a"), dependencies)).resolves.toEqual([a.transfer.from, a.transfer.to]);
    await expect(listMovements(b.business.id, { yearId: b.year.id }, user("owner-b"), dependencies)).resolves.toEqual([b.transfer.from, b.transfer.to]);
  });

  it("refuses business B's accounts, heading and transfer inside business A", async () => {
    const { dependencies, a, b } = await serviceFixture();
    const owner = user("owner-a");
    await expect(createTransfer(a.business.id, { ...a.input, fromAccountId: b.bank.id }, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND });
    await expect(createTransfer(a.business.id, { ...a.input, toAccountId: b.cash.id }, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND });
    await expect(createTransfer(a.business.id, { ...a.input, headingId: b.heading.id }, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.HEADING_NOT_FOUND });
    await expect(updateTransfer(a.business.id, a.transfer.transferGroupId, { toAccountId: b.cash.id }, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND });
    await expect(updateTransfer(a.business.id, a.transfer.transferGroupId, { headingId: b.heading.id }, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.HEADING_NOT_FOUND });
    for (const [index, operation] of operations(b, owner, dependencies, a.business.id).entries()) {
      if (index === 1 || index === 2) await expect(operation()).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MOVEMENT_NOT_FOUND });
    }
    await expect(listMovements(a.business.id, { yearId: a.year.id }, owner, dependencies)).resolves.toEqual([a.transfer.from, a.transfer.to]);
    await expect(listMovements(b.business.id, { yearId: b.year.id }, user("owner-b"), dependencies)).resolves.toEqual([b.transfer.from, b.transfer.to]);
  });
});

describe("transfer API isolation", () => {
  const mockedIdentity = vi.mocked(getCurrentIdentity);
  const identity = (name: string): AuthIdentity => ({ provider: "firebase", providerUserId: `lh022-${name}`, email: `lh022-${name}@example.com`, displayName: name, emailVerified: true });
  const ownerA = identity("owner-a");
  const ownerB = identity("owner-b");
  const params = <T extends object>(value: T) => ({ params: Promise.resolve(value) });
  const json = (method: string, body: unknown) => new Request("http://localhost/api", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const get = () => new Request("http://localhost/api");

  async function routeFixture() {
    delete process.env.PERSISTENCE_MODE;
    await resetPersistenceContextForTests();
    const stamp = `${Date.now()}-${Math.random()}`;
    const dependencies = { tenancyRepository: defaultOnboardingRepository, headings: resolveDefaultHeadingRepository(), templates: resolveDefaultTemplateRepository(), money: resolveDefaultMoneyRepository() };
    const a = await seed(defaultOnboardingRepository, dependencies.headings, dependencies.templates, dependencies, `Route Transfer A ${stamp}`, ownerA);
    const b = await seed(defaultOnboardingRepository, dependencies.headings, dependencies.templates, dependencies, `Route Transfer B ${stamp}`, ownerB);
    return { a, b };
  }

  it("creates, suggests, updates and deletes a member's own transfer, and refuses its legs on their own", async () => {
    const { a } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    const businessId = a.business.id;
    const created = await createTransferRoute(json("POST", { ...a.input, amount: "2.5", narrative: "Float" }), params({ businessId }));
    expect(created.status).toBe(201);
    const transfer = await created.json();
    expect(transfer).toMatchObject({ from: { amount: "-2.50", narrative: "Float" }, to: { amount: "2.50" } });
    expect(await (await suggestionRoute(get(), params({ businessId }))).json()).toEqual({ headingId: a.heading.id });

    const patched = await patchTransferRoute(json("PATCH", { amount: "3.00" }), params({ businessId, transferGroupId: transfer.transferGroupId }));
    expect(await patched.json()).toMatchObject({ from: { amount: "-3.00" }, to: { amount: "3.00" } });
    const leg = await patchMovementRoute(json("PATCH", { amount: "1.00" }), params({ businessId, movementId: transfer.to.id }));
    expect({ status: leg.status, body: await leg.json() }).toMatchObject({ status: 409, body: { error: { code: "MOVEMENT_ORIGIN_NOT_EDITABLE" } } });
    const legDelete = await deleteMovementRoute(get(), params({ businessId, movementId: transfer.from.id }));
    expect(legDelete.status).toBe(409);
    expect((await deleteTransferRoute(get(), params({ businessId, transferGroupId: transfer.transferGroupId }))).status).toBe(200);

    const outside = await createTransferRoute(json("POST", { ...a.input, date: "2027-06-01" }), params({ businessId }));
    expect({ status: outside.status, body: await outside.json() }).toMatchObject({ status: 409, body: { error: { code: "MOVEMENT_OUTSIDE_OPEN_YEAR" } } });
    const same = await createTransferRoute(json("POST", { ...a.input, toAccountId: a.input.fromAccountId }), params({ businessId }));
    expect({ status: same.status, body: await same.json() }).toMatchObject({ status: 400, body: { error: { code: "INVALID_MOVEMENT" } } });
  });

  it("rejects cross-business requests and smuggled ids through the handlers", async () => {
    const { a, b } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    for (const response of [
      await createTransferRoute(json("POST", b.input), params({ businessId: b.business.id })),
      await patchTransferRoute(json("PATCH", { amount: "1.00" }), params({ businessId: b.business.id, transferGroupId: b.transfer.transferGroupId })),
      await deleteTransferRoute(get(), params({ businessId: b.business.id, transferGroupId: b.transfer.transferGroupId })),
      await suggestionRoute(get(), params({ businessId: b.business.id })),
    ]) expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 404, body: { error: { code: "BUSINESS_ACCESS_DENIED" } } });

    const businessId = a.business.id;
    for (const [response, code] of [
      [await createTransferRoute(json("POST", { ...a.input, fromAccountId: b.bank.id }), params({ businessId })), "MONEY_ACCOUNT_NOT_FOUND"],
      [await createTransferRoute(json("POST", { ...a.input, toAccountId: b.cash.id }), params({ businessId })), "MONEY_ACCOUNT_NOT_FOUND"],
      [await createTransferRoute(json("POST", { ...a.input, headingId: b.heading.id }), params({ businessId })), "HEADING_NOT_FOUND"],
      [await patchTransferRoute(json("PATCH", { headingId: b.heading.id }), params({ businessId, transferGroupId: a.transfer.transferGroupId })), "HEADING_NOT_FOUND"],
      [await patchTransferRoute(json("PATCH", { amount: "1.00" }), params({ businessId, transferGroupId: b.transfer.transferGroupId })), "MOVEMENT_NOT_FOUND"],
      [await deleteTransferRoute(get(), params({ businessId, transferGroupId: b.transfer.transferGroupId })), "MOVEMENT_NOT_FOUND"],
    ] as const) expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 404, body: { error: { code } } });

    mockedIdentity.mockResolvedValue(ownerB);
    const dependencies = { tenancyRepository: defaultOnboardingRepository, headings: resolveDefaultHeadingRepository(), templates: resolveDefaultTemplateRepository(), money: resolveDefaultMoneyRepository() };
    await expect(listMovements(b.business.id, { yearId: b.year.id }, ownerB, dependencies)).resolves.toEqual([b.transfer.from, b.transfer.to]);
  });

  it("requires sign-in and a strict body", async () => {
    const { a } = await routeFixture();
    const businessId = a.business.id;
    const transferGroupId = a.transfer.transferGroupId;
    mockedIdentity.mockResolvedValue(null);
    for (const response of [
      await createTransferRoute(json("POST", a.input), params({ businessId })),
      await patchTransferRoute(json("PATCH", { amount: "1.00" }), params({ businessId, transferGroupId })),
      await deleteTransferRoute(get(), params({ businessId, transferGroupId })),
      await suggestionRoute(get(), params({ businessId })),
    ]) expect(response.status).toBe(401);

    mockedIdentity.mockResolvedValue(ownerA);
    for (const response of [
      await createTransferRoute(json("POST", { ...a.input, amount: 10 }), params({ businessId })),
      await createTransferRoute(json("POST", { ...a.input, transferGroupId: "forged" }), params({ businessId })),
      await createTransferRoute(json("POST", { ...a.input, headingId: undefined }), params({ businessId })),
      await createTransferRoute(new Request("http://localhost/api", { method: "POST", body: "{" }), params({ businessId })),
      await patchTransferRoute(json("PATCH", {}), params({ businessId, transferGroupId })),
      await patchTransferRoute(json("PATCH", { origin: "invoice" }), params({ businessId, transferGroupId })),
    ]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_MONEY_REQUEST" } });
    }
    const negative = await createTransferRoute(json("POST", { ...a.input, amount: "-1.00" }), params({ businessId }));
    expect({ status: negative.status, body: await negative.json() }).toMatchObject({ status: 400, body: { error: { code: "INVALID_AMOUNT" } } });
  });
});
