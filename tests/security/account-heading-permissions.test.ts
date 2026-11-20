import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../../src/modules/auth/auth-provider";
import { getCurrentIdentity } from "../../src/modules/auth/session";
import type { Capability } from "../../src/modules/permissions/capabilities";
import {
  HEADING_ERROR_CODES,
  createHeadingRepository,
  importHeadings,
  listHeadings,
  renameHeading,
  resolveDefaultHeadingRepository,
  setHeadingActive,
  type HeadingDependencies,
  type TemplateHeadingInput,
} from "../../src/modules/accounting/heading-service";
import { createInMemoryOnboardingRepository, defaultOnboardingRepository } from "../../src/modules/tenancy/business-service";
import { resetPersistenceContextForTests } from "../../src/modules/persistence/repository-factory";
import type { Membership, UserId } from "../../src/modules/tenancy/types";
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

import { GET as listRoute } from "../../src/app/api/businesses/[businessId]/headings/route";
import { PATCH as patchRoute } from "../../src/app/api/businesses/[businessId]/headings/[headingId]/route";
import { GET as listCategoriesRoute } from "../../src/app/api/businesses/[businessId]/categories/route";

const user = (value: string) => value as UserId;
const headings: TemplateHeadingInput[] = [
  { position: 1, templateValue: "Sales", valueType: "text", group: "income", order: 1, blockedReason: null },
  { position: 2, templateValue: "Rent", valueType: "text", group: "expenses", order: 2, blockedReason: null },
];

function member(userId: string, businessId: Membership["businessId"], role: Membership["role"], status: Membership["status"] = "active"): Membership {
  return { membershipId: `membership-${userId}`, userId: user(userId), businessId, role, isActive: status === "active", status };
}

async function serviceFixture() {
  const tenancy = createInMemoryOnboardingRepository();
  const businessA = await createApprovedBusiness(tenancy, "Heading Harbour A", user("owner-a"));
  const businessB = await createApprovedBusiness(tenancy, "Heading Harbour B", user("owner-b"));
  tenancy.memberships.push(
    member("general-a", businessA.id, "general_admin"),
    member("administrator-a", businessA.id, "administrator"),
    member("pending-a", businessA.id, "administrator", "pending"),
  );
  const dependencies = { tenancyRepository: tenancy, headings: createHeadingRepository() } satisfies HeadingDependencies;
  await importHeadings(businessA.id, headings, user("owner-a"), dependencies);
  await importHeadings(businessB.id, headings, user("owner-b"), dependencies);
  const [headingA] = await listHeadings(businessA.id, user("owner-a"), dependencies);
  const [headingB] = await listHeadings(businessB.id, user("owner-b"), dependencies);
  return { businessA, businessB, dependencies, headingA, headingB };
}

beforeEach(() => {
  denied.clear();
  checked.splice(0);
});

describe("account heading permission matrix", () => {
  it.each(["owner-a", "general-a", "administrator-a"])("lets active member %s read and write its own business", async (actor) => {
    const { businessA, dependencies, headingA } = await serviceFixture();
    await expect(listHeadings(businessA.id, user(actor), dependencies)).resolves.toHaveLength(2);
    await expect(renameHeading(businessA.id, headingA.id, `Renamed by ${actor}`, user(actor), dependencies)).resolves.toMatchObject({ id: headingA.id });
    await expect(setHeadingActive(businessA.id, headingA.id, false, user(actor), dependencies)).resolves.toMatchObject({ isActive: false });
    await expect(importHeadings(businessA.id, headings, user(actor), dependencies)).resolves.toMatchObject({ updated: 0, unchanged: 2 });
  });

  it("requires read_finance to list and edit_finance to write", async () => {
    const { businessA, dependencies, headingA } = await serviceFixture();
    checked.splice(0);
    await listHeadings(businessA.id, user("owner-a"), dependencies);
    expect(checked).toEqual(["read_finance"]);
    checked.splice(0);
    await renameHeading(businessA.id, headingA.id, "Checked", user("owner-a"), dependencies);
    await setHeadingActive(businessA.id, headingA.id, true, user("owner-a"), dependencies);
    await importHeadings(businessA.id, headings, user("owner-a"), dependencies);
    expect(checked).toEqual(["edit_finance", "edit_finance", "edit_finance"]);

    denied.add("edit_finance");
    await expect(listHeadings(businessA.id, user("owner-a"), dependencies)).resolves.toHaveLength(2);
    for (const write of [
      () => renameHeading(businessA.id, headingA.id, "Denied", user("owner-a"), dependencies),
      () => setHeadingActive(businessA.id, headingA.id, false, user("owner-a"), dependencies),
      () => importHeadings(businessA.id, headings, user("owner-a"), dependencies),
    ]) await expect(write()).rejects.toMatchObject({ code: HEADING_ERROR_CODES.INSUFFICIENT_CAPABILITY });

    denied.clear();
    denied.add("read_finance");
    await expect(listHeadings(businessA.id, user("owner-a"), dependencies)).rejects.toMatchObject({ code: HEADING_ERROR_CODES.INSUFFICIENT_CAPABILITY });
    expect((await dependencies.headings.findById(headingA.id, businessA.id))?.displayName).toBe("Checked");
  });

  it.each(["outsider", "pending-a"])("denies %s access to the business headings", async (actor) => {
    const { businessA, dependencies, headingA } = await serviceFixture();
    for (const operation of [
      () => listHeadings(businessA.id, user(actor), dependencies),
      () => renameHeading(businessA.id, headingA.id, "Denied", user(actor), dependencies),
      () => setHeadingActive(businessA.id, headingA.id, false, user(actor), dependencies),
      () => importHeadings(businessA.id, headings, user(actor), dependencies),
    ]) await expect(operation()).rejects.toMatchObject({ code: HEADING_ERROR_CODES.BUSINESS_ACCESS_DENIED });
  });

  it("isolates business A members from business B headings", async () => {
    const { businessA, businessB, dependencies, headingA, headingB } = await serviceFixture();
    for (const operation of [
      () => listHeadings(businessB.id, user("owner-a"), dependencies),
      () => renameHeading(businessB.id, headingB.id, "Crossed", user("owner-a"), dependencies),
      () => setHeadingActive(businessB.id, headingB.id, false, user("owner-a"), dependencies),
      () => importHeadings(businessB.id, headings, user("owner-a"), dependencies),
    ]) await expect(operation()).rejects.toMatchObject({ code: HEADING_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    await expect(renameHeading(businessA.id, headingB.id, "Crossed", user("owner-a"), dependencies)).rejects.toMatchObject({ code: HEADING_ERROR_CODES.HEADING_NOT_FOUND });
    await expect(setHeadingActive(businessA.id, headingB.id, false, user("owner-a"), dependencies)).rejects.toMatchObject({ code: HEADING_ERROR_CODES.HEADING_NOT_FOUND });

    expect(await dependencies.headings.findById(headingB.id, businessB.id)).toMatchObject({ displayName: "Sales", isActive: true });
    expect((await listHeadings(businessA.id, user("owner-a"), dependencies)).map((item) => item.id)).toContain(headingA.id);
    expect((await listHeadings(businessA.id, user("owner-a"), dependencies)).map((item) => item.id)).not.toContain(headingB.id);
  });
});

describe("account heading API isolation", () => {
  const mockedIdentity = vi.mocked(getCurrentIdentity);
  const identity = (name: string): AuthIdentity => ({ provider: "firebase", providerUserId: `lh014-${name}`, email: `lh014-${name}@example.com`, displayName: name, emailVerified: true });
  const ownerA = identity("owner-a");
  const ownerB = identity("owner-b");
  const outsider = identity("outsider");
  const params = <T extends object>(value: T) => ({ params: Promise.resolve(value) });
  const patch = (body: unknown) => new Request("http://localhost/api/businesses/business/headings/heading", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function routeFixture() {
    delete process.env.PERSISTENCE_MODE;
    await resetPersistenceContextForTests();
    const stamp = `${Date.now()}-${Math.random()}`;
    const businessA = await createApprovedBusiness(defaultOnboardingRepository, `Route Heading A ${stamp}`, ownerA);
    const businessB = await createApprovedBusiness(defaultOnboardingRepository, `Route Heading B ${stamp}`, ownerB);
    const dependencies = { tenancyRepository: defaultOnboardingRepository, headings: resolveDefaultHeadingRepository() };
    await importHeadings(businessA.id, headings, ownerA, dependencies);
    await importHeadings(businessB.id, headings, ownerB, dependencies);
    const [headingA] = await listHeadings(businessA.id, ownerA, dependencies);
    const [headingB] = await listHeadings(businessB.id, ownerB, dependencies);
    return { businessA, businessB, headingA, headingB };
  }

  it("serves and updates a member's own headings", async () => {
    const { businessA, headingA } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    const list = await listRoute(new Request("http://localhost"), params({ businessId: businessA.id }));
    expect(list.status).toBe(200);
    expect((await list.json()).map((item: { id: string }) => item.id)).toContain(headingA.id);

    const response = await patchRoute(patch({ displayName: " Turnover ", isActive: false }), params({ businessId: businessA.id, headingId: headingA.id }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: headingA.id, displayName: "Turnover", isActive: false, templateValue: "Sales" });
  });

  it("rejects cross-business reads and writes through the handlers", async () => {
    const { businessA, businessB, headingB } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);

    const list = await listRoute(new Request("http://localhost"), params({ businessId: businessB.id }));
    expect(list.status).toBe(404);
    expect(await list.json()).toMatchObject({ error: { code: "BUSINESS_ACCESS_DENIED" } });
    const crossed = await patchRoute(patch({ displayName: "Crossed" }), params({ businessId: businessB.id, headingId: headingB.id }));
    expect(crossed.status).toBe(404);
    expect(await crossed.json()).toMatchObject({ error: { code: "BUSINESS_ACCESS_DENIED" } });
    const smuggled = await patchRoute(patch({ isActive: false }), params({ businessId: businessA.id, headingId: headingB.id }));
    expect(smuggled.status).toBe(404);
    expect(await smuggled.json()).toMatchObject({ error: { code: "HEADING_NOT_FOUND" } });
    expect(await resolveDefaultHeadingRepository().findById(headingB.id, businessB.id)).toMatchObject({ displayName: "Sales", isActive: true });
  });

  it("gives a non-member the same response as the other finance routes", async () => {
    const { businessA, headingA } = await routeFixture();
    mockedIdentity.mockResolvedValue(outsider);
    const categories = await listCategoriesRoute(new Request("http://localhost"), params({ businessId: businessA.id }));
    const list = await listRoute(new Request("http://localhost"), params({ businessId: businessA.id }));
    const update = await patchRoute(patch({ displayName: "Outsider" }), params({ businessId: businessA.id, headingId: headingA.id }));
    const expected = { status: categories.status, body: await categories.json() };
    expect(expected).toEqual({ status: 404, body: { error: { code: "BUSINESS_ACCESS_DENIED", message: "Business access denied." } } });
    expect({ status: list.status, body: await list.json() }).toEqual(expected);
    expect({ status: update.status, body: await update.json() }).toEqual(expected);
  });

  it("requires sign-in and a strict body", async () => {
    const { businessA, headingA } = await routeFixture();
    mockedIdentity.mockResolvedValue(null);
    expect((await listRoute(new Request("http://localhost"), params({ businessId: businessA.id }))).status).toBe(401);
    expect((await patchRoute(patch({ isActive: false }), params({ businessId: businessA.id, headingId: headingA.id }))).status).toBe(401);

    mockedIdentity.mockResolvedValue(ownerA);
    for (const body of [{}, { displayName: "" }, { isActive: "yes" }, { displayName: "Ok", templateValue: "Hacked" }]) {
      const response = await patchRoute(patch(body), params({ businessId: businessA.id, headingId: headingA.id }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_HEADING_REQUEST" } });
    }
  });
});
