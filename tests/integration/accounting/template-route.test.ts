import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentIdentity, enforceAuthenticatedRateLimit, objects } = vi.hoisted(() => ({
  getCurrentIdentity: vi.fn(),
  enforceAuthenticatedRateLimit: vi.fn(),
  objects: new Map<string, Uint8Array>(),
}));
vi.mock("../../../src/modules/auth/session", () => ({ getCurrentIdentity }));
vi.mock(import("../../../src/modules/security/authenticated-rate-limit"), async (importOriginal) => ({
  ...(await importOriginal()),
  enforceAuthenticatedRateLimit,
}));
vi.mock(import("../../../src/modules/persistence/repository-factory"), async (importOriginal) => {
  const actual = await importOriginal();
  const storage = {
    async put({ objectKey, data }: { objectKey: string; data: Uint8Array }) { objects.set(objectKey, data); return { objectKey, sizeBytes: data.byteLength }; },
    async get(): Promise<ReadableStream<Uint8Array>> { throw new Error("unused"); },
    async delete(objectKey: string) { objects.delete(objectKey); },
  };
  return { ...actual, getPersistenceContext: () => ({ ...actual.getPersistenceContext(), storage }) };
});

import { GET, POST } from "../../../src/app/api/businesses/[businessId]/template/route";
import { TEMPLATE_MAX_SIZE_BYTES } from "../../../src/modules/accounting/template-service";
import { AuthenticatedRateLimitError } from "../../../src/modules/security/rate-limit-errors";
import { defaultOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import { buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const owner: AuthIdentity = { provider: "firebase", providerUserId: "lh014b-route-owner", email: "lh014b-route-owner@example.com", displayName: "Route Owner", emailVerified: true };

function upload(data: Uint8Array, name = "Accounts.xlsx", type = XLSX, contentLength?: string) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(data)], name, { type }));
  return new Request("http://localhost/api/businesses/business/template", {
    method: "POST",
    body: form,
    headers: { "content-length": contentLength ?? String(data.byteLength + 1024) },
  });
}

async function business() {
  return createApprovedBusiness(defaultOnboardingRepository, `Template Route ${Date.now()}-${Math.random()}`, owner);
}

const params = (businessId: string) => ({ params: Promise.resolve({ businessId }) });

describe("template HTTP contract", () => {
  beforeEach(() => {
    delete process.env.PERSISTENCE_MODE;
    objects.clear();
    getCurrentIdentity.mockReset().mockResolvedValue(owner);
    enforceAuthenticatedRateLimit.mockReset().mockResolvedValue(undefined);
  });

  it("uploads a template, imports its headings and serves the summary", async () => {
    const { id } = await business();
    const response = await POST(upload(new Uint8Array(await buildSyntheticTemplate())), params(id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.inserted).toBeGreaterThan(0);
    expect(Object.keys(body).sort()).toEqual(["defects", "inserted", "missing", "sheets", "updated"]);
    expect(enforceAuthenticatedRateLimit).toHaveBeenCalledWith("upload", owner.providerUserId, expect.any(Headers));
    expect(objects.size).toBe(1);

    const summary = await GET(new Request("http://localhost"), params(id));
    expect(summary.status).toBe(200);
    const template = await summary.json();
    expect(template).toMatchObject({ fileName: "Accounts.xlsx", sheets: body.sheets, defects: body.defects });
    expect(JSON.stringify(template)).not.toContain("business/");
  });

  it("returns null before a template exists", async () => {
    const { id } = await business();
    const response = await GET(new Request("http://localhost"), params(id));
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("returns 413 for a file over 10 MiB and for an oversized declared body", async () => {
    const { id } = await business();
    const tooLarge = await POST(upload(new Uint8Array(TEMPLATE_MAX_SIZE_BYTES + 1)), params(id));
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({ error: { code: "TEMPLATE_TOO_LARGE" } });

    const formData = vi.fn();
    const declared = await POST({ headers: new Headers({ "content-length": String(TEMPLATE_MAX_SIZE_BYTES + 64 * 1024 + 1) }), formData } as unknown as Request, params(id));
    expect(declared.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
    expect(objects.size).toBe(0);
  });

  it.each([
    ["a non-xlsx name", "Accounts.csv", XLSX],
    ["a wrong MIME type", "Accounts.xlsx", "application/pdf"],
  ])("returns 415 for %s", async (_label, name, type) => {
    const { id } = await business();
    const response = await POST(upload(new Uint8Array(await buildSyntheticTemplate()), name, type), params(id));
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ error: { code: "UNSUPPORTED_TEMPLATE_TYPE" } });
  });

  it("returns 415 for bytes that are not a zip archive", async () => {
    const { id } = await business();
    const response = await POST(upload(new TextEncoder().encode("date,amount\n")), params(id));
    expect(response.status).toBe(415);
  });

  it("returns 422 with the reader's code for an unreadable workbook", async () => {
    const { id } = await business();
    const response = await POST(upload(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6])), params(id));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_A_WORKBOOK" } });
    expect(objects.size).toBe(0);
  });

  it("requires sign-in, a Content-Length, a file part and an available limiter", async () => {
    const { id } = await business();
    getCurrentIdentity.mockResolvedValue(null);
    expect((await POST(upload(new Uint8Array([1])), params(id))).status).toBe(401);
    expect((await GET(new Request("http://localhost"), params(id))).status).toBe(401);

    getCurrentIdentity.mockResolvedValue(owner);
    const formData = vi.fn();
    expect((await POST({ headers: new Headers(), formData } as unknown as Request, params(id))).status).toBe(411);

    const form = new FormData();
    form.set("notFile", "x");
    const missing = await POST(new Request("http://localhost", { method: "POST", body: form, headers: { "content-length": "512" } }), params(id));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: { code: "INVALID_TEMPLATE_FILE" } });

    enforceAuthenticatedRateLimit.mockRejectedValue(new AuthenticatedRateLimitError());
    expect((await POST(upload(new Uint8Array([1])), params(id))).status).toBe(429);
  });
});
