import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Capability } from "../../src/modules/permissions/capabilities";
import type { Membership, UserId } from "../../src/modules/tenancy/types";

const { denied, checked, getCurrentIdentity, enforceAuthenticatedRateLimit, objects } = vi.hoisted(() => ({
  denied: new Set<string>(),
  checked: [] as string[],
  getCurrentIdentity: vi.fn(),
  enforceAuthenticatedRateLimit: vi.fn(),
  objects: new Map<string, Uint8Array>(),
}));

vi.mock(import("../../src/modules/permissions/authorize"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    requireCapability: (membership: Membership, capability: Capability) => {
      checked.push(capability);
      if (denied.has(capability)) throw new original.AuthorizationError("CAPABILITY_REQUIRED", "Capability required");
      return original.requireCapability(membership, capability);
    },
  };
});
vi.mock("../../src/modules/auth/session", () => ({ getCurrentIdentity }));
vi.mock(import("../../src/modules/security/authenticated-rate-limit"), async (importOriginal) => ({
  ...(await importOriginal()),
  enforceAuthenticatedRateLimit,
}));
vi.mock(import("../../src/modules/persistence/repository-factory"), async (importOriginal) => {
  const actual = await importOriginal();
  const storage = {
    async put({ objectKey, data }: { objectKey: string; data: Uint8Array }) { objects.set(objectKey, data); return { objectKey, sizeBytes: data.byteLength }; },
    async get(): Promise<ReadableStream<Uint8Array>> { throw new Error("unused"); },
    async delete(objectKey: string) { objects.delete(objectKey); },
  };
  return { ...actual, getPersistenceContext: () => ({ ...actual.getPersistenceContext(), storage }) };
});

import { GET, POST } from "../../src/app/api/businesses/[businessId]/template/route";
import { GET as listCategoriesRoute } from "../../src/app/api/businesses/[businessId]/categories/route";
import { createHeadingRepository } from "../../src/modules/accounting/heading-service";
import { TEMPLATE_ERROR_CODES, createTemplateRepository, getTemplate, importTemplate, type TemplateDependencies } from "../../src/modules/accounting/template-service";
import type { AuthIdentity } from "../../src/modules/auth/auth-provider";
import type { StorageAdapter } from "../../src/modules/documents/storage-adapter";
import { createInMemoryOnboardingRepository, defaultOnboardingRepository } from "../../src/modules/tenancy/business-service";
import { buildSyntheticTemplate } from "../fixtures/workbook/synthetic-template";
import { createApprovedBusiness } from "../helpers/business-fixtures";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const user = (value: string) => value as UserId;
let workbook: Uint8Array;
const file = () => ({ name: "Accounts.xlsx", mimeType: XLSX, data: workbook });
const garbage = { name: "x.txt", mimeType: "text/plain", data: new TextEncoder().encode("garbage") };

function member(userId: string, businessId: Membership["businessId"], role: Membership["role"], status: Membership["status"] = "active"): Membership {
  return { membershipId: `membership-${userId}`, userId: user(userId), businessId, role, isActive: status === "active", status };
}

async function serviceFixture() {
  workbook ??= new Uint8Array(await buildSyntheticTemplate());
  const tenancy = createInMemoryOnboardingRepository();
  const businessA = await createApprovedBusiness(tenancy, "Template Harbour A", user("owner-a"));
  const businessB = await createApprovedBusiness(tenancy, "Template Harbour B", user("owner-b"));
  tenancy.memberships.push(
    member("general-a", businessA.id, "general_admin"),
    member("administrator-a", businessA.id, "administrator"),
    member("pending-a", businessA.id, "administrator", "pending"),
  );
  const stored = new Map<string, Uint8Array>();
  const storage: StorageAdapter = {
    async put({ objectKey, data }) { stored.set(objectKey, data); return { objectKey, sizeBytes: data.byteLength }; },
    async get() { throw new Error("unused"); },
    async delete(objectKey) { stored.delete(objectKey); },
  };
  const dependencies = { tenancyRepository: tenancy, headings: createHeadingRepository(), templates: createTemplateRepository(), storage } satisfies TemplateDependencies;
  await importTemplate(businessB.id, file(), user("owner-b"), dependencies);
  return { businessA, businessB, dependencies, stored };
}

beforeEach(() => {
  denied.clear();
  checked.splice(0);
  objects.clear();
});

describe("business template permission matrix", () => {
  it.each(["owner-a", "general-a", "administrator-a"])("lets active member %s upload and read its own template", async (actor) => {
    const { businessA, dependencies } = await serviceFixture();
    await expect(importTemplate(businessA.id, file(), user(actor), dependencies)).resolves.toMatchObject({ updated: 0 });
    await expect(getTemplate(businessA.id, user(actor), dependencies)).resolves.toMatchObject({ fileName: "Accounts.xlsx" });
  });

  it("requires edit_finance to upload and read_finance to read", async () => {
    const { businessA, dependencies } = await serviceFixture();
    checked.splice(0);
    await importTemplate(businessA.id, file(), user("owner-a"), dependencies);
    await getTemplate(businessA.id, user("owner-a"), dependencies);
    expect(checked).toEqual(["edit_finance", "read_finance"]);

    denied.add("edit_finance");
    await expect(importTemplate(businessA.id, garbage, user("owner-a"), dependencies)).rejects.toMatchObject({ code: TEMPLATE_ERROR_CODES.INSUFFICIENT_CAPABILITY });
    await expect(getTemplate(businessA.id, user("owner-a"), dependencies)).resolves.not.toBeNull();
    denied.clear();
    denied.add("read_finance");
    await expect(getTemplate(businessA.id, user("owner-a"), dependencies)).rejects.toMatchObject({ code: TEMPLATE_ERROR_CODES.INSUFFICIENT_CAPABILITY });
  });

  it.each(["outsider", "pending-a"])("denies %s before looking at the file", async (actor) => {
    const { businessA, dependencies, stored } = await serviceFixture();
    const before = stored.size;
    await expect(importTemplate(businessA.id, garbage, user(actor), dependencies)).rejects.toMatchObject({ code: TEMPLATE_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    await expect(importTemplate(businessA.id, file(), user(actor), dependencies)).rejects.toMatchObject({ code: TEMPLATE_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    await expect(getTemplate(businessA.id, user(actor), dependencies)).rejects.toMatchObject({ code: TEMPLATE_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    expect(stored.size).toBe(before);
  });

  it("isolates business A members from business B's template", async () => {
    const { businessB, dependencies, stored } = await serviceFixture();
    const before = await dependencies.templates.findByBusinessId(businessB.id);
    await expect(importTemplate(businessB.id, file(), user("owner-a"), dependencies)).rejects.toMatchObject({ code: TEMPLATE_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    await expect(getTemplate(businessB.id, user("owner-a"), dependencies)).rejects.toMatchObject({ code: TEMPLATE_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    await expect(dependencies.templates.findByBusinessId(businessB.id)).resolves.toEqual(before);
    expect(stored.size).toBe(1);
  });
});

describe("business template API isolation", () => {
  const identity = (name: string): AuthIdentity => ({ provider: "firebase", providerUserId: `lh014b-${name}`, email: `lh014b-${name}@example.com`, displayName: name, emailVerified: true });
  const ownerA = identity("owner-a");
  const ownerB = identity("owner-b");
  const params = (businessId: string) => ({ params: Promise.resolve({ businessId }) });
  const upload = (data: Uint8Array, name = "Accounts.xlsx", type = XLSX) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(data)], name, { type }));
    return new Request("http://localhost", { method: "POST", body: form, headers: { "content-length": String(data.byteLength + 1024) } });
  };

  async function routeFixture() {
    workbook ??= new Uint8Array(await buildSyntheticTemplate());
    enforceAuthenticatedRateLimit.mockReset().mockResolvedValue(undefined);
    const stamp = `${Date.now()}-${Math.random()}`;
    const businessA = await createApprovedBusiness(defaultOnboardingRepository, `Template Route A ${stamp}`, ownerA);
    const businessB = await createApprovedBusiness(defaultOnboardingRepository, `Template Route B ${stamp}`, ownerB);
    getCurrentIdentity.mockResolvedValue(ownerB);
    expect((await POST(upload(workbook), params(businessB.id))).status).toBe(200);
    return { businessA, businessB };
  }

  it("rejects cross-business reads and uploads through the handlers", async () => {
    const { businessB } = await routeFixture();
    const keys = [...objects.keys()];
    getCurrentIdentity.mockResolvedValue(ownerA);

    const read = await GET(new Request("http://localhost"), params(businessB.id));
    expect(read.status).toBe(404);
    expect(await read.json()).toMatchObject({ error: { code: "BUSINESS_ACCESS_DENIED" } });
    const write = await POST(upload(workbook, "Hijack.xlsx"), params(businessB.id));
    expect(write.status).toBe(404);
    const junk = await POST(upload(new TextEncoder().encode("junk"), "junk.txt", "text/plain"), params(businessB.id));
    expect(junk.status).toBe(404);
    expect([...objects.keys()]).toEqual(keys);

    getCurrentIdentity.mockResolvedValue(ownerB);
    expect(await (await GET(new Request("http://localhost"), params(businessB.id))).json()).toMatchObject({ fileName: "Accounts.xlsx" });
  });

  it("gives a non-member the same response as the other finance routes", async () => {
    const { businessA } = await routeFixture();
    getCurrentIdentity.mockResolvedValue(identity("outsider"));
    const categories = await listCategoriesRoute(new Request("http://localhost"), params(businessA.id));
    const expected = { status: categories.status, body: await categories.json() };
    expect(expected).toEqual({ status: 404, body: { error: { code: "BUSINESS_ACCESS_DENIED", message: "Business access denied." } } });
    const read = await GET(new Request("http://localhost"), params(businessA.id));
    const write = await POST(upload(workbook), params(businessA.id));
    expect({ status: read.status, body: await read.json() }).toEqual(expected);
    expect({ status: write.status, body: await write.json() }).toEqual(expected);
  });
});
