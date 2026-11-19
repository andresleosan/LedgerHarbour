import { describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../../src/modules/auth/auth-provider";
import { getCurrentIdentity } from "../../src/modules/auth/session";
import { createHeadingRepository, importHeadings, listHeadings, resolveDefaultHeadingRepository, type HeadingRepository, type TemplateHeadingInput } from "../../src/modules/accounting/heading-service";
import { MONEY_ERROR_CODES, createMoneyRepository, resolveDefaultMoneyRepository } from "../../src/modules/accounting/money-repository";
import { createFinancialYear, createMoneyAccount, listMovements, type MoneyDependencies } from "../../src/modules/accounting/money-service";
import { codeStatementMovement, deleteStatementMovement, importStatement, listUncodedStatementMovements, previewStatement } from "../../src/modules/accounting/statement-import-service";
import { createTemplateRepository, resolveDefaultTemplateRepository, type TemplateRepository } from "../../src/modules/accounting/template-service";
import type { AccountSheet } from "../../src/modules/workbook/template-profile";
import { createInMemoryOnboardingRepository, defaultOnboardingRepository, type OnboardingActor, type OnboardingRepository } from "../../src/modules/tenancy/business-service";
import { resetPersistenceContextForTests } from "../../src/modules/persistence/repository-factory";
import type { BusinessId, Membership, UserId } from "../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../helpers/business-fixtures";

const { enforceAuthenticatedRateLimit } = vi.hoisted(() => ({ enforceAuthenticatedRateLimit: vi.fn() }));
vi.mock("../../src/modules/auth/session", () => ({ getCurrentIdentity: vi.fn() }));
vi.mock(import("../../src/modules/security/authenticated-rate-limit"), async (importOriginal) => ({ ...(await importOriginal()), enforceAuthenticatedRateLimit }));

import { POST as importRoute } from "../../src/app/api/businesses/[businessId]/statement-imports/route";
import { POST as previewRoute } from "../../src/app/api/businesses/[businessId]/statement-imports/preview/route";
import { GET as trayRoute } from "../../src/app/api/businesses/[businessId]/statement-imports/tray/route";
import { DELETE as deleteTrayRoute, PATCH as patchTrayRoute } from "../../src/app/api/businesses/[businessId]/statement-imports/tray/[movementId]/route";
import { DELETE as deleteMovementRoute, PATCH as patchMovementRoute } from "../../src/app/api/businesses/[businessId]/movements/[movementId]/route";

// Synthetic statement: invented lines only.
const user = (value: string) => value as UserId;
const csv = "Date,Description,Amount\n2026-05-01,Card takings,50.00\n2026-05-02,Bank fee,-2.50";
const headingInputs: TemplateHeadingInput[] = [{ position: 1, templateValue: "Sales", valueType: "text", group: "income", order: 1, blockedReason: null }];

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
    profile: { sheets: [{ name: "Main Bank" } as AccountSheet], defects: [] },
    uploadedBy: user("seed"),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const year = await createFinancialYear(business.id, { startDate: "2026-04-06", endDate: "2027-04-05" }, owner, dependencies);
  const bank = await createMoneyAccount(business.id, { name: "Main bank", kind: "bank", sheetName: "Main Bank" }, owner, dependencies);
  await importStatement(business.id, { accountId: bank.id, csv }, owner, dependencies);
  const [line] = await listUncodedStatementMovements(business.id, year.id, owner, dependencies);
  return { business, heading, year, bank, line };
}

async function serviceFixture() {
  const tenancy = createInMemoryOnboardingRepository();
  const headings = createHeadingRepository();
  const templates = createTemplateRepository();
  const dependencies = { tenancyRepository: tenancy, headings, templates, money: createMoneyRepository() } satisfies MoneyDependencies;
  const a = await seed(tenancy, headings, templates, dependencies, "Statement Harbour A", user("owner-a"));
  const b = await seed(tenancy, headings, templates, dependencies, "Statement Harbour B", user("owner-b"));
  const membership: Membership = { membershipId: "membership-pending", userId: user("pending-a"), businessId: a.business.id, role: "administrator", isActive: false, status: "pending" };
  tenancy.memberships.push(membership);
  return { dependencies, a, b };
}

type Side = Awaited<ReturnType<typeof serviceFixture>>["a"];

const operations = (side: Side, actor: OnboardingActor, dependencies: MoneyDependencies, businessId: BusinessId = side.business.id) => [
  () => previewStatement(businessId, { accountId: side.bank.id, csv }, actor, dependencies),
  () => importStatement(businessId, { accountId: side.bank.id, csv: `${csv}\n2026-05-03,More,1` }, actor, dependencies),
  () => listUncodedStatementMovements(businessId, side.year.id, actor, dependencies),
  () => codeStatementMovement(businessId, side.line.id, side.heading.id, actor, dependencies),
  () => deleteStatementMovement(businessId, side.line.id, actor, dependencies),
];

describe("statement import permission matrix", () => {
  it.each(["outsider", "pending-a", "owner-b"])("denies %s every statement operation on business A", async (actor) => {
    const { dependencies, a } = await serviceFixture();
    for (const operation of operations(a, user(actor), dependencies)) await expect(operation()).rejects.toMatchObject({ code: MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    await expect(listUncodedStatementMovements(a.business.id, a.year.id, user("owner-a"), dependencies)).resolves.toHaveLength(2);
  });

  it("refuses business B's account, year, heading and lines inside business A", async () => {
    const { dependencies, a, b } = await serviceFixture();
    const owner = user("owner-a");
    const id = a.business.id;
    await expect(previewStatement(id, { accountId: b.bank.id, csv }, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND });
    await expect(importStatement(id, { accountId: b.bank.id, csv }, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND });
    await expect(listUncodedStatementMovements(id, b.year.id, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND });
    await expect(codeStatementMovement(id, a.line.id, b.heading.id, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.HEADING_NOT_FOUND });
    await expect(codeStatementMovement(id, b.line.id, a.heading.id, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MOVEMENT_NOT_FOUND });
    await expect(deleteStatementMovement(id, b.line.id, owner, dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.MOVEMENT_NOT_FOUND });
    expect(await listMovements(b.business.id, { yearId: b.year.id }, user("owner-b"), dependencies)).toEqual(expect.arrayContaining([expect.objectContaining({ id: b.line.id, headingId: null, deletedAt: null })]));
    expect(await listMovements(b.business.id, { yearId: b.year.id }, user("owner-b"), dependencies)).toHaveLength(2);
  });
});

describe("statement import API", () => {
  const mockedIdentity = vi.mocked(getCurrentIdentity);
  const identity = (name: string): AuthIdentity => ({ provider: "firebase", providerUserId: `lh023-${name}`, email: `lh023-${name}@example.com`, displayName: name, emailVerified: true });
  const ownerA = identity("owner-a");
  const ownerB = identity("owner-b");
  const params = <T extends object>(value: T) => ({ params: Promise.resolve(value) });
  const post = (body: unknown, length?: string) => {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json", "content-length": length ?? String(new TextEncoder().encode(text).length) }, body: text });
  };
  const json = (method: string, body: unknown) => new Request("http://localhost/api", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const get = (query = "") => new Request(`http://localhost/api${query}`);

  async function routeFixture() {
    delete process.env.PERSISTENCE_MODE;
    await resetPersistenceContextForTests();
    enforceAuthenticatedRateLimit.mockReset().mockResolvedValue(undefined);
    const stamp = `${Date.now()}-${Math.random()}`;
    const dependencies = { tenancyRepository: defaultOnboardingRepository, headings: resolveDefaultHeadingRepository(), templates: resolveDefaultTemplateRepository(), money: resolveDefaultMoneyRepository() };
    const a = await seed(defaultOnboardingRepository, dependencies.headings, dependencies.templates, dependencies, `Route Statement A ${stamp}`, ownerA);
    const b = await seed(defaultOnboardingRepository, dependencies.headings, dependencies.templates, dependencies, `Route Statement B ${stamp}`, ownerB);
    return { a, b };
  }

  it("previews, imports, lists, codes and deletes a member's own lines; the movements routes still refuse them", async () => {
    const { a } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    const businessId = a.business.id;
    const more = `${csv}\n2026-05-03,Refund,4.00`;
    const preview = await previewRoute(post({ accountId: a.bank.id, csv: more }), params({ businessId }));
    expect(preview.status).toBe(200);
    expect((await preview.json()).counts).toMatchObject({ toImport: 1, alreadyImported: 2 });
    const imported = await importRoute(post({ accountId: a.bank.id, csv: more, mapping: { date: 0, description: 1, amount: 2 } }), params({ businessId }));
    expect({ status: imported.status, body: await imported.json() }).toMatchObject({ status: 201, body: { imported: 1 } });
    expect(enforceAuthenticatedRateLimit).toHaveBeenCalledWith("upload", ownerA.providerUserId, expect.any(Headers));

    const tray = await trayRoute(get(`?yearId=${a.year.id}`), params({ businessId }));
    expect((await tray.json()).map((row: { narrative: string }) => row.narrative)).toEqual(["Card takings", "Bank fee", "Refund"]);
    const coded = await patchTrayRoute(json("PATCH", { headingId: a.heading.id }), params({ businessId, movementId: a.line.id }));
    expect({ status: coded.status, body: await coded.json() }).toMatchObject({ status: 200, body: { headingId: a.heading.id, origin: "statement" } });
    expect((await patchTrayRoute(json("PATCH", { headingId: null }), params({ businessId, movementId: a.line.id }))).status).toBe(200);
    const viaMovements = await patchMovementRoute(json("PATCH", { headingId: a.heading.id }), params({ businessId, movementId: a.line.id }));
    expect({ status: viaMovements.status, body: await viaMovements.json() }).toMatchObject({ status: 409, body: { error: { code: "MOVEMENT_ORIGIN_NOT_EDITABLE" } } });
    expect((await deleteMovementRoute(get(), params({ businessId, movementId: a.line.id }))).status).toBe(409);
    expect((await deleteTrayRoute(get(), params({ businessId, movementId: a.line.id }))).status).toBe(200);
    expect((await deleteTrayRoute(get(), params({ businessId, movementId: a.line.id }))).status).toBe(404);

    const bad = await importRoute(post({ accountId: a.bank.id, csv: `${csv}\n2026-05-09,Broken,12.345` }), params({ businessId }));
    expect({ status: bad.status, body: await bad.json() }).toMatchObject({ status: 422, body: { error: { code: "STATEMENT_HAS_ERRORS" }, errors: [{ line: 4, reason: "INVALID_AMOUNT" }] } });
    const malformed = await previewRoute(post({ accountId: a.bank.id, csv: "Date,Description,Amount\n2026-05-01,\"open,1" }), params({ businessId }));
    expect({ status: malformed.status, body: await malformed.json() }).toMatchObject({ status: 422, body: { error: { code: "MALFORMED_CSV" } } });
  });

  it("rejects cross-business requests and smuggled ids through the handlers", async () => {
    const { a, b } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    for (const response of [
      await previewRoute(post({ accountId: b.bank.id, csv }), params({ businessId: b.business.id })),
      await importRoute(post({ accountId: b.bank.id, csv }), params({ businessId: b.business.id })),
      await trayRoute(get(`?yearId=${b.year.id}`), params({ businessId: b.business.id })),
      await patchTrayRoute(json("PATCH", { headingId: b.heading.id }), params({ businessId: b.business.id, movementId: b.line.id })),
      await deleteTrayRoute(get(), params({ businessId: b.business.id, movementId: b.line.id })),
    ]) expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 404, body: { error: { code: "BUSINESS_ACCESS_DENIED" } } });

    const businessId = a.business.id;
    for (const [response, code] of [
      [await previewRoute(post({ accountId: b.bank.id, csv }), params({ businessId })), "MONEY_ACCOUNT_NOT_FOUND"],
      [await importRoute(post({ accountId: b.bank.id, csv }), params({ businessId })), "MONEY_ACCOUNT_NOT_FOUND"],
      [await trayRoute(get(`?yearId=${b.year.id}`), params({ businessId })), "FINANCIAL_YEAR_NOT_FOUND"],
      [await patchTrayRoute(json("PATCH", { headingId: b.heading.id }), params({ businessId, movementId: a.line.id })), "HEADING_NOT_FOUND"],
      [await patchTrayRoute(json("PATCH", { headingId: a.heading.id }), params({ businessId, movementId: b.line.id })), "MOVEMENT_NOT_FOUND"],
      [await deleteTrayRoute(get(), params({ businessId, movementId: b.line.id })), "MOVEMENT_NOT_FOUND"],
    ] as const) expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 404, body: { error: { code } } });

    mockedIdentity.mockResolvedValue(ownerB);
    expect((await (await trayRoute(get(`?yearId=${b.year.id}`), params({ businessId: b.business.id }))).json())).toHaveLength(2);
  });

  it("requires sign-in, a capped and declared body, and strict schemas", async () => {
    const { a } = await routeFixture();
    const businessId = a.business.id;
    const movementId = a.line.id;
    const body = { accountId: a.bank.id, csv };
    mockedIdentity.mockResolvedValue(null);
    for (const response of [
      await previewRoute(post(body), params({ businessId })),
      await importRoute(post(body), params({ businessId })),
      await trayRoute(get(`?yearId=${a.year.id}`), params({ businessId })),
      await patchTrayRoute(json("PATCH", { headingId: null }), params({ businessId, movementId })),
      await deleteTrayRoute(get(), params({ businessId, movementId })),
    ]) expect(response.status).toBe(401);

    mockedIdentity.mockResolvedValue(ownerA);
    for (const route of [previewRoute, importRoute]) {
      const tooLarge = await route(post(body, String(1024 * 1024 + 64 * 1024 + 1)), params({ businessId }));
      expect({ status: tooLarge.status, body: await tooLarge.json() }).toMatchObject({ status: 413, body: { error: { code: "UPLOAD_REQUEST_TOO_LARGE" } } });
      const undeclared = await route(new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) }), params({ businessId }));
      expect(undeclared.status).toBe(411);
      const bigFile = await route(post({ accountId: a.bank.id, csv: `Date,Description,Amount\n${"x".repeat(1024 * 1024)}` }), params({ businessId }));
      expect({ status: bigFile.status, body: await bigFile.json() }).toMatchObject({ status: 413, body: { error: { code: "TOO_LARGE" } } });
      for (const invalid of [
        { ...body, origin: "manual" },
        { ...body, csv: 7 },
        { ...body, mapping: { date: 0, description: 1, amount: "2" } },
        { ...body, mapping: { date: 0, description: 1 } },
        { ...body, mapping: { date: 0, description: 1, amount: 2, moneyIn: 3, moneyOut: 4 } },
        { ...body, dateFormat: "year_first" },
        { accountId: a.bank.id },
      ]) {
        const response = await route(post(invalid), params({ businessId }));
        expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 400, body: { error: { code: "INVALID_MONEY_REQUEST" } } });
      }
      expect((await route(post("{"), params({ businessId }))).status).toBe(400);
      enforceAuthenticatedRateLimit.mockRejectedValueOnce(Object.assign(new Error("limited"), { code: "AUTHENTICATED_RATE_LIMITED" }));
      expect((await route(post(body), params({ businessId }))).status).toBe(429);
    }
    for (const invalid of [{}, { headingId: "" }, { headingId: a.heading.id, origin: "manual" }, { headingId: 3 }]) {
      expect((await patchTrayRoute(json("PATCH", invalid), params({ businessId, movementId }))).status).toBe(400);
    }
    expect((await trayRoute(get(), params({ businessId }))).status).toBe(400);
  });
});
