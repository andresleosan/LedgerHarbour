import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../../src/modules/auth/auth-provider";
import { getCurrentIdentity } from "../../src/modules/auth/session";
import type { Capability } from "../../src/modules/permissions/capabilities";
import type { Membership, UserId } from "../../src/modules/tenancy/types";

const denied = new Set<Capability>();
const checked: Capability[] = [];
const { limitedScopes, limit } = vi.hoisted(() => ({ limitedScopes: [] as string[], limit: { next: null as null | "limited" } }));

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

import { GET as annexRoute } from "../../src/app/api/businesses/[businessId]/financial-years/[yearId]/annex/route";
import { buildYearAnnex, downloadYearAnnex, type AnnexDependencies } from "../../src/modules/accounting/annex-service";
import { createHeadingRepository, importHeadings, listHeadings, resolveDefaultHeadingRepository } from "../../src/modules/accounting/heading-service";
import { MONEY_ERROR_CODES, createMoneyRepository, resolveDefaultMoneyRepository } from "../../src/modules/accounting/money-repository";
import { createInvoiceRepository, resolveDefaultInvoiceRepository } from "../../src/modules/invoices/invoice-service";
import type { DocumentId, InvoiceId } from "../../src/modules/invoices/ocr-provider";
import { resetPersistenceContextForTests } from "../../src/modules/persistence/repository-factory";
import { createInMemoryOnboardingRepository, defaultOnboardingRepository, type OnboardingActor, type OnboardingRepository } from "../../src/modules/tenancy/business-service";
import { createApprovedBusiness } from "../helpers/business-fixtures";

const user = (value: string) => value as UserId;
const at = "2026-01-01T00:00:00.000Z";
const confident = { supplier: 1, invoiceNumber: 1, invoiceDate: 1, dueDate: 1, subtotal: 1, taxAmount: 1, total: 1, currencyReference: 1, expenseCategoryReference: 1, notes: 1 };

function member(userId: string, businessId: Membership["businessId"], role: Membership["role"], status: Membership["status"] = "active"): Membership {
  return { membershipId: `membership-${userId}`, userId: user(userId), businessId, role, isActive: status === "active", status };
}

/** A business with a year, an unpaid invoice and an asset purchase, all named after the business. */
async function seed(tenancy: OnboardingRepository, dependencies: Required<Pick<AnnexDependencies, "money" | "headings" | "invoices">>, name: string, owner: OnboardingActor) {
  const business = await createApprovedBusiness(tenancy, name, owner);
  await importHeadings(business.id, [{ position: 1, templateValue: "Equipment", valueType: "text", group: "assets", order: 1, blockedReason: null }], owner, { tenancyRepository: tenancy, headings: dependencies.headings });
  const [equipment] = await listHeadings(business.id, owner, { tenancyRepository: tenancy, headings: dependencies.headings });
  const year = await dependencies.money.createYear({ id: `${business.id}-year`, businessId: business.id, startDate: "2026-04-06", endDate: "2027-04-05", status: "open", createdAt: at, updatedAt: at });
  const account = await dependencies.money.createAccount({ id: `${business.id}-bank`, businessId: business.id, name: `${name} bank`, kind: "bank", sheetName: "Bank", isActive: true, createdAt: at, updatedAt: at });
  await dependencies.money.createMovement({
    id: `${business.id}-laptop`, businessId: business.id, financialYearId: year.id, moneyAccountId: account.id, movementDate: "2026-05-01", narrative: `${name} laptop`, headingId: equipment.id,
    amount: "-900.00", origin: "manual", sourceInvoiceId: null, sourceRef: null, transferGroupId: null, deletedAt: null, createdBy: user("seed"), createdAt: at, updatedAt: at,
  });
  await dependencies.invoices.create({
    id: `${business.id}-invoice` as InvoiceId, businessId: business.id, documentId: `${business.id}-document` as DocumentId, supplier: `${name} supplier`, invoiceNumber: "INV-1", invoiceDate: "2026-08-11", dueDate: null,
    subtotal: null, taxAmount: null, total: "50.00", currencyReference: "GBP", expenseCategoryReference: null, notes: null, confidenceData: { ...confident },
    reviewState: "approved", paymentStatus: "unpaid", createdAt: at, updatedAt: at,
  });
  return { business, year, account };
}

beforeEach(() => {
  denied.clear();
  checked.splice(0);
  limitedScopes.splice(0);
  limit.next = null;
});

describe("closing annex permission matrix", () => {
  async function fixture() {
    const tenancy = createInMemoryOnboardingRepository();
    const dependencies = { tenancyRepository: tenancy, money: createMoneyRepository(), headings: createHeadingRepository(), invoices: createInvoiceRepository() };
    const a = await seed(tenancy, dependencies, "Annex Harbour A", user("owner-a"));
    const b = await seed(tenancy, dependencies, "Annex Harbour B", user("owner-b"));
    tenancy.memberships.push(
      member("general-a", a.business.id, "general_admin"),
      member("administrator-a", a.business.id, "administrator"),
      member("pending-a", a.business.id, "administrator", "pending"),
    );
    return { tenancy, dependencies, a, b };
  }

  it.each(["owner-a", "general-a", "administrator-a"])("lets active member %s read its own annex with read_finance only", async (actor) => {
    const { dependencies, a } = await fixture();
    checked.splice(0);
    await expect(buildYearAnnex(a.business.id, a.year.id, user(actor), dependencies)).resolves.toMatchObject({ totals: { unpaidInvoices: { count: 1 }, assetPurchases: { count: 1 } } });
    await expect(downloadYearAnnex(a.business.id, a.year.id, user(actor), dependencies)).resolves.toMatchObject({ csv: expect.stringContaining("Annex Harbour A laptop") });
    expect(new Set(checked)).toEqual(new Set(["read_finance"]));
  });

  it("refuses without read_finance", async () => {
    const { dependencies, a } = await fixture();
    denied.add("read_finance");
    await expect(buildYearAnnex(a.business.id, a.year.id, user("owner-a"), dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.INSUFFICIENT_CAPABILITY });
    await expect(downloadYearAnnex(a.business.id, a.year.id, user("owner-a"), dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.INSUFFICIENT_CAPABILITY });
  });

  it.each(["outsider", "pending-a"])("denies %s", async (actor) => {
    const { dependencies, a } = await fixture();
    await expect(buildYearAnnex(a.business.id, a.year.id, user(actor), dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    await expect(downloadYearAnnex(a.business.id, a.year.id, user(actor), dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED });
  });

  it("keeps a member of A out of B's annex and B's year out of A's", async () => {
    const { tenancy, dependencies, a, b } = await fixture();
    await expect(buildYearAnnex(b.business.id, b.year.id, user("owner-a"), dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    await expect(downloadYearAnnex(b.business.id, b.year.id, user("owner-a"), dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    await expect(buildYearAnnex(a.business.id, b.year.id, user("owner-a"), dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND });
    await expect(downloadYearAnnex(a.business.id, b.year.id, user("owner-a"), dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND });
    expect((await tenancy.listAuditEvents(a.business.id)).concat(await tenancy.listAuditEvents(b.business.id)).filter((e) => e.type === "annex_downloaded")).toEqual([]);

    const own = await downloadYearAnnex(a.business.id, a.year.id, user("owner-a"), dependencies);
    expect(own.csv).toContain("Annex Harbour A supplier");
    expect(own.csv).not.toContain("Harbour B");
  });
});

describe("closing annex API", () => {
  const mockedIdentity = vi.mocked(getCurrentIdentity);
  const identity = (name: string): AuthIdentity => ({ provider: "firebase", providerUserId: `lh026-${name}`, email: `lh026-${name}@example.com`, displayName: name, emailVerified: true });
  const ownerA = identity("owner-a");
  const ownerB = identity("owner-b");
  const params = (value: { businessId: string; yearId: string }) => ({ params: Promise.resolve(value) });
  const csv = () => new Request("http://localhost/api");
  const json = () => new Request("http://localhost/api?format=json");

  async function routeFixture() {
    delete process.env.PERSISTENCE_MODE;
    await resetPersistenceContextForTests();
    const stamp = `${Date.now()}-${Math.random()}`;
    const dependencies = { money: resolveDefaultMoneyRepository(), headings: resolveDefaultHeadingRepository(), invoices: resolveDefaultInvoiceRepository() };
    const a = await seed(defaultOnboardingRepository, dependencies, `Route Annex A ${stamp}`, ownerA);
    const b = await seed(defaultOnboardingRepository, dependencies, `Route Annex B ${stamp}`, ownerB);
    const annexAudit = async (businessId: typeof a.business.id) => (await defaultOnboardingRepository.listAuditEvents(businessId)).filter((e) => e.type === "annex_downloaded");
    return { a, b, annexAudit };
  }

  it("serves the CSV with download headers and one audit event, and the JSON without one", async () => {
    const { a, annexAudit } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    const ids = { businessId: a.business.id, yearId: a.year.id };

    const download = await annexRoute(csv(), params(ids));
    expect(download.status).toBe(200);
    expect(Object.fromEntries(download.headers)).toMatchObject({
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="closing-notes-2026-04-06-2027-04-05.csv"',
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder().decode(bytes);
    expect(body).toContain(`Unpaid at year end,2026-08-11,${a.business.name} supplier,INV-1,,50.00,GBP\r\n`);
    expect(limitedScopes).toEqual(["upload"]);
    expect(await annexAudit(a.business.id)).toHaveLength(1);

    const screen = await annexRoute(json(), params(ids));
    expect(screen.status).toBe(200);
    expect(screen.headers.get("cache-control")).toBe("private, no-store");
    expect(await screen.json()).toMatchObject({ year: { id: a.year.id }, assetPurchases: [{ amount: "900.00", accountName: `${a.business.name} bank` }], totals: { unpaidInvoices: { count: 1 } } });
    expect(await annexAudit(a.business.id)).toHaveLength(1);
  });

  it("gives another business's member, a foreign year, an outsider and an anonymous caller nothing", async () => {
    const { a, b, annexAudit } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    for (const request of [csv, json]) {
      const response = await annexRoute(request(), params({ businessId: b.business.id, yearId: b.year.id }));
      expect({ status: response.status, body: await response.json() }).toEqual({ status: 404, body: { error: { code: "BUSINESS_ACCESS_DENIED", message: "Business access denied." } } });
      const smuggled = await annexRoute(request(), params({ businessId: a.business.id, yearId: b.year.id }));
      const text = await smuggled.text();
      expect({ status: smuggled.status, body: JSON.parse(text) }).toEqual({ status: 404, body: { error: { code: "FINANCIAL_YEAR_NOT_FOUND", message: "Financial year not found." } } });
      expect(text).not.toContain("Route Annex");
    }
    expect(await annexAudit(a.business.id)).toEqual([]);
    expect(await annexAudit(b.business.id)).toEqual([]);

    mockedIdentity.mockResolvedValue(identity("outsider"));
    for (const request of [csv, json]) expect((await annexRoute(request(), params({ businessId: a.business.id, yearId: a.year.id }))).status).toBe(404);
    mockedIdentity.mockResolvedValue(null);
    for (const request of [csv, json]) expect((await annexRoute(request(), params({ businessId: a.business.id, yearId: a.year.id }))).status).toBe(401);
  });

  it("rate-limits the download", async () => {
    const { a, annexAudit } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    limit.next = "limited";
    const response = await annexRoute(csv(), params({ businessId: a.business.id, yearId: a.year.id }));
    expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 429, body: { error: { code: "RATE_LIMITED" } } });
    expect(await annexAudit(a.business.id)).toEqual([]);
  });
});
