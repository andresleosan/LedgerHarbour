import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../../src/modules/auth/auth-provider";
import { getCurrentIdentity } from "../../src/modules/auth/session";
import type { Capability } from "../../src/modules/permissions/capabilities";
import type { Membership, UserId } from "../../src/modules/tenancy/types";

const denied = new Set<Capability>();
const checked: Capability[] = [];
const { objects, limitedScopes, limit } = vi.hoisted(() => ({
  objects: new Map<string, Uint8Array>(),
  limitedScopes: [] as string[],
  limit: { next: null as null | "limited" },
}));

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
vi.mock(import("../../src/modules/security/authenticated-rate-limit"), async (importOriginal) => ({
  ...(await importOriginal()),
  authenticatedRateLimitResponse: async (scope: string) => {
    limitedScopes.push(scope);
    if (limit.next !== "limited") return null;
    limit.next = null;
    return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429 });
  },
}));
vi.mock(import("../../src/modules/persistence/repository-factory"), async (importOriginal) => {
  const actual = await importOriginal();
  const storage = {
    async put({ objectKey, data }: { objectKey: string; data: Uint8Array }) { objects.set(objectKey, data); return { objectKey, sizeBytes: data.byteLength }; },
    async get(objectKey: string): Promise<ReadableStream<Uint8Array>> {
      const data = objects.get(objectKey)!;
      return new ReadableStream({ start(controller) { controller.enqueue(data); controller.close(); } });
    },
    async delete(objectKey: string) { objects.delete(objectKey); },
  };
  return { ...actual, getPersistenceContext: () => ({ ...actual.getPersistenceContext(), storage }) };
});

import { GET as exportRoute } from "../../src/app/api/businesses/[businessId]/financial-years/[yearId]/export/route";
import { GET as reportRoute } from "../../src/app/api/businesses/[businessId]/financial-years/[yearId]/export/report/route";
import { buildYearExport, getExportReport, type ExportDependencies } from "../../src/modules/accounting/export-service";
import { createHeadingRepository, listHeadings, resolveDefaultHeadingRepository } from "../../src/modules/accounting/heading-service";
import { MONEY_ERROR_CODES, createMoneyRepository, resolveDefaultMoneyRepository } from "../../src/modules/accounting/money-repository";
import { createFinancialYear, createMoneyAccount, createMovement } from "../../src/modules/accounting/money-service";
import { createTemplateRepository, importTemplate, resolveDefaultTemplateRepository } from "../../src/modules/accounting/template-service";
import { getPersistenceContext, resetPersistenceContextForTests } from "../../src/modules/persistence/repository-factory";
import { createInMemoryOnboardingRepository, defaultOnboardingRepository, type OnboardingActor, type OnboardingRepository } from "../../src/modules/tenancy/business-service";
import { readTemplate } from "../../src/modules/workbook/read-template";
import { readWrittenRows } from "../../src/modules/workbook/write-workbook";
import { SYNTHETIC_SHEETS, buildSyntheticTemplate } from "../fixtures/workbook/synthetic-template";
import { createApprovedBusiness } from "../helpers/business-fixtures";

const user = (value: string) => value as UserId;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const templateBytes = buildSyntheticTemplate();

function member(userId: string, businessId: Membership["businessId"], role: Membership["role"], status: Membership["status"] = "active"): Membership {
  return { membershipId: `membership-${userId}`, userId: user(userId), businessId, role, isActive: status === "active", status };
}

async function seed(tenancy: OnboardingRepository, dependencies: ExportDependencies, name: string, owner: OnboardingActor) {
  const business = await createApprovedBusiness(tenancy, name, owner);
  await importTemplate(business.id, { name: "Accounts.xlsx", mimeType: XLSX, data: new Uint8Array(await templateBytes) }, owner, { ...dependencies, tenancyRepository: tenancy });
  const [sales] = await listHeadings(business.id, owner, { ...dependencies, tenancyRepository: tenancy });
  const year = await createFinancialYear(business.id, { startDate: "2026-04-06", endDate: "2027-04-05" }, owner, dependencies);
  const account = await createMoneyAccount(business.id, { name: "Main bank", kind: "bank", sheetName: SYNTHETIC_SHEETS.main }, owner, dependencies);
  await createMovement(business.id, { accountId: account.id, date: "2026-05-01", narrative: `${name} takings`, headingId: sales.id, amount: "10.00" }, owner, dependencies);
  return { business, year, account };
}

async function serviceFixture() {
  const tenancy = createInMemoryOnboardingRepository();
  const storage = getPersistenceContext().storage;
  const dependencies = { tenancyRepository: tenancy, headings: createHeadingRepository(), templates: createTemplateRepository(), money: createMoneyRepository(), storage } satisfies ExportDependencies;
  const a = await seed(tenancy, dependencies, "Export Harbour A", user("owner-a"));
  const b = await seed(tenancy, dependencies, "Export Harbour B", user("owner-b"));
  tenancy.memberships.push(
    member("general-a", a.business.id, "general_admin"),
    member("administrator-a", a.business.id, "administrator"),
    member("pending-a", a.business.id, "administrator", "pending"),
  );
  return { dependencies, a, b };
}

beforeEach(() => {
  denied.clear();
  checked.splice(0);
  limitedScopes.splice(0);
});

describe("workbook export permission matrix", () => {
  it.each(["owner-a", "general-a", "administrator-a"])("lets active member %s export its own business with read_finance", async (actor) => {
    const { dependencies, a } = await serviceFixture();
    checked.splice(0);
    await expect(getExportReport(a.business.id, a.year.id, user(actor), dependencies)).resolves.toMatchObject({ blocked: false });
    const { bytes } = await buildYearExport(a.business.id, a.year.id, user(actor), dependencies);
    expect(bytes).not.toBeNull();
    expect(new Set(checked)).toEqual(new Set(["read_finance"]));
  });

  it("refuses without read_finance", async () => {
    const { dependencies, a } = await serviceFixture();
    denied.add("read_finance");
    await expect(getExportReport(a.business.id, a.year.id, user("owner-a"), dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.INSUFFICIENT_CAPABILITY });
    await expect(buildYearExport(a.business.id, a.year.id, user("owner-a"), dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.INSUFFICIENT_CAPABILITY });
  });

  it.each(["outsider", "pending-a"])("denies %s", async (actor) => {
    const { dependencies, a } = await serviceFixture();
    await expect(getExportReport(a.business.id, a.year.id, user(actor), dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    await expect(buildYearExport(a.business.id, a.year.id, user(actor), dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED });
  });

  it("keeps a member of A out of B's export and B's year out of A's", async () => {
    const { dependencies, a, b } = await serviceFixture();
    await expect(getExportReport(b.business.id, b.year.id, user("owner-a"), dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    await expect(buildYearExport(b.business.id, b.year.id, user("owner-a"), dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    const smuggled = await buildYearExport(a.business.id, b.year.id, user("owner-a"), dependencies);
    expect(smuggled).toMatchObject({ bytes: null, year: null, report: { blocked: true, blockers: [{ code: "YEAR_NOT_FOUND" }], totals: { byHeading: [], byAccount: [] } } });
    expect(JSON.stringify(smuggled.report)).not.toContain(b.account.id);

    const own = await buildYearExport(a.business.id, a.year.id, user("owner-a"), dependencies);
    const [main] = readWrittenRows(own.bytes!, await readTemplate(await templateBytes));
    expect(main.rows.map((r) => r.narrative)).toEqual(["Export Harbour A takings"]);
  });
});

describe("workbook export API", () => {
  const mockedIdentity = vi.mocked(getCurrentIdentity);
  const identity = (name: string): AuthIdentity => ({ provider: "firebase", providerUserId: `lh024-${name}`, email: `lh024-${name}@example.com`, displayName: name, emailVerified: true });
  const ownerA = identity("owner-a");
  const ownerB = identity("owner-b");
  const params = (value: { businessId: string; yearId: string }) => ({ params: Promise.resolve(value) });
  const get = () => new Request("http://localhost/api");

  async function routeFixture() {
    delete process.env.PERSISTENCE_MODE;
    await resetPersistenceContextForTests();
    const stamp = `${Date.now()}-${Math.random()}`;
    const dependencies = { headings: resolveDefaultHeadingRepository(), templates: resolveDefaultTemplateRepository(), money: resolveDefaultMoneyRepository(), storage: getPersistenceContext().storage };
    const a = await seed(defaultOnboardingRepository, { ...dependencies, tenancyRepository: defaultOnboardingRepository }, `Route Export A ${stamp}`, ownerA);
    const b = await seed(defaultOnboardingRepository, { ...dependencies, tenancyRepository: defaultOnboardingRepository }, `Route Export B ${stamp}`, ownerB);
    return { a, b, dependencies };
  }

  it("serves the report and the workbook to a member, with download headers", async () => {
    const { a } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    const ids = { businessId: a.business.id, yearId: a.year.id };

    const report = await reportRoute(get(), params(ids));
    expect(report.status).toBe(200);
    expect(await report.json()).toMatchObject({ blocked: false, sheets: [{ sheetName: SYNTHETIC_SHEETS.main, accountId: a.account.id, rowsWritten: 1 }, {}, {}] });

    const download = await exportRoute(get(), params(ids));
    expect(download.status).toBe(200);
    expect(Object.fromEntries(download.headers)).toMatchObject({
      "content-type": XLSX,
      "content-disposition": 'attachment; filename="accounts-2026-04-06-2027-04-05.xlsx"',
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
    const bytes = Buffer.from(await download.arrayBuffer());
    expect(download.headers.get("content-length")).toBe(String(bytes.length));
    expect(readWrittenRows(bytes, await readTemplate(await templateBytes))[0].rows).toHaveLength(1);
    expect(limitedScopes).toEqual(["upload"]);
  });

  it("answers a blocked export with 409 and the report, and the report route with 200", async () => {
    const { a, dependencies } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    await dependencies.money.createMovement({
      id: `uncoded-${a.business.id}`, businessId: a.business.id, financialYearId: a.year.id, moneyAccountId: a.account.id, movementDate: "2026-05-02", narrative: "Statement line",
      headingId: null, amount: "-3.00", origin: "statement", sourceInvoiceId: null, sourceRef: null, transferGroupId: null, deletedAt: null, createdBy: user("seed"), createdAt: "", updatedAt: "",
    });
    const ids = { businessId: a.business.id, yearId: a.year.id };
    const download = await exportRoute(get(), params(ids));
    expect(download.status).toBe(409);
    expect(await download.json()).toMatchObject({ error: { code: "EXPORT_BLOCKED" }, report: { blocked: true, blockers: [{ code: "UNCODED_MOVEMENTS", count: 1 }] } });
    const report = await reportRoute(get(), params(ids));
    expect({ status: report.status, body: await report.json() }).toMatchObject({ status: 200, body: { blocked: true } });
  });

  it("gives another business's member, an outsider and an anonymous caller nothing", async () => {
    const { a, b } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    for (const route of [reportRoute, exportRoute]) {
      const response = await route(get(), params({ businessId: b.business.id, yearId: b.year.id }));
      expect({ status: response.status, body: await response.json() }).toEqual({ status: 404, body: { error: { code: "BUSINESS_ACCESS_DENIED", message: "Business access denied." } } });
    }
    const smuggled = await exportRoute(get(), params({ businessId: a.business.id, yearId: b.year.id }));
    expect({ status: smuggled.status, body: await smuggled.json() }).toMatchObject({ status: 409, body: { report: { blockers: [{ code: "YEAR_NOT_FOUND" }] } } });

    mockedIdentity.mockResolvedValue(identity("outsider"));
    for (const route of [reportRoute, exportRoute]) expect((await route(get(), params({ businessId: a.business.id, yearId: a.year.id }))).status).toBe(404);
    mockedIdentity.mockResolvedValue(null);
    for (const route of [reportRoute, exportRoute]) expect((await route(get(), params({ businessId: a.business.id, yearId: a.year.id }))).status).toBe(401);
  });

  it("rate-limits the download", async () => {
    const { a } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    limit.next = "limited";
    const response = await exportRoute(get(), params({ businessId: a.business.id, yearId: a.year.id }));
    expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 429, body: { error: { code: "RATE_LIMITED" } } });
  });
});
