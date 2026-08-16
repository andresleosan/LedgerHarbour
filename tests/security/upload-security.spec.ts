import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentIdentity, enforceAuthenticatedRateLimit } = vi.hoisted(() => ({
  getCurrentIdentity: vi.fn(),
  enforceAuthenticatedRateLimit: vi.fn(),
}));
vi.mock("../../src/modules/auth/session", () => ({ getCurrentIdentity }));
vi.mock("../../src/modules/security/authenticated-rate-limit", () => ({ enforceAuthenticatedRateLimit }));

import { createDocument, createDocumentRepository, getDocumentForDownload } from "../../src/modules/documents/document-service";
import { MAX_UPLOAD_SIZE_BYTES, UPLOAD_ERROR_CODES, validateUpload } from "../../src/modules/documents/file-validation";
import { createInMemoryOnboardingRepository, createOnboardingServices, defaultOnboardingRepository, type OnboardingRepository } from "../../src/modules/tenancy/business-service";
import { POST } from "../../src/app/api/businesses/[businessId]/documents/route";
import type { StorageAdapter } from "../../src/modules/documents/storage-adapter";
import type { BusinessId, UserId } from "../../src/modules/tenancy/types";

const user = (value: string) => value as UserId;
const pdfBytes = new Uint8Array(Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF\n"));

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, Uint8Array>();

  async put(input: { objectKey: string; data: Uint8Array }) {
    this.values.set(input.objectKey, input.data.slice());
    return { objectKey: input.objectKey, sizeBytes: input.data.byteLength };
  }

  async get(objectKey: string) {
    const data = this.values.get(objectKey);
    if (!data) throw new Error("missing object");
    return new ReadableStream({ start(controller) { controller.enqueue(data.slice()); controller.close(); } });
  }

  async delete(objectKey: string) { this.values.delete(objectKey); }
}

const upload = (name: string, mimeType: string, data: Uint8Array = pdfBytes) => ({ name, mimeType, sizeBytes: data.byteLength, data });

describe("Task 11 upload security matrix", () => {
  let tenancy: OnboardingRepository;
  let businessId: BusinessId;
  let storage: MemoryStorage;

  beforeEach(async () => {
    getCurrentIdentity.mockReset();
    enforceAuthenticatedRateLimit.mockReset().mockResolvedValue(undefined);
    tenancy = createInMemoryOnboardingRepository();
    storage = new MemoryStorage();
    const business = await createOnboardingServices(tenancy).createBusiness({ name: "Upload Harbour" }, user("owner"));
    businessId = business.id;
  });

  it("rejects the real upload route without an authenticated identity", async () => {
    getCurrentIdentity.mockReturnValue(null);
    const response = await POST(new Request("http://localhost/api/businesses/business/documents", { method: "POST", body: new FormData() }), { params: Promise.resolve({ businessId: "business" }) });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "IDENTITY_REQUIRED" } });
  });

  it("returns a generic 429 before materializing multipart data when upload is limited", async () => {
    getCurrentIdentity.mockReturnValue({ providerUserId: "owner", email: "owner@example.com", displayName: "Owner", emailVerified: true });
    enforceAuthenticatedRateLimit.mockRejectedValue(new Error("private limiter input@example.com"));
    const formData = vi.fn();

    const response = await POST({ headers: new Headers(), formData } as unknown as Request, { params: Promise.resolve({ businessId: "business" }) });

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body).toEqual({ error: { code: "RATE_LIMITED", message: "Too many requests." } });
    expect(JSON.stringify(body)).not.toContain("input@example.com");
    expect(formData).not.toHaveBeenCalled();
  });

  it("rejects an oversized Content-Length before materializing multipart data", async () => {
    getCurrentIdentity.mockReturnValue({ providerUserId: "owner", email: "owner@example.com", displayName: "Owner", emailVerified: true });
    const formData = vi.fn();

    const response = await POST({
      headers: new Headers({ "content-length": String(MAX_UPLOAD_SIZE_BYTES + 1) }),
      formData,
    } as unknown as Request, { params: Promise.resolve({ businessId: "business" }) });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: UPLOAD_ERROR_CODES.FILE_TOO_LARGE } });
    expect(formData).not.toHaveBeenCalled();
  });

  it("rejects a real multipart request without a file", async () => {
    getCurrentIdentity.mockReturnValue({ providerUserId: "owner", email: "owner@example.com", displayName: "Owner", emailVerified: true });
    const form = new FormData();
    form.set("notFile", "unexpected");
    const response = await POST(new Request("http://localhost/api/businesses/business/documents", { method: "POST", body: form }), { params: Promise.resolve({ businessId: "business" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_UPLOAD" } });
  });

  it("accepts an authenticated FormData File and returns only the safe document DTO", async () => {
    const identity = { providerUserId: user("route-owner"), email: "route-owner@example.com", displayName: "Route Owner", emailVerified: true };
    getCurrentIdentity.mockReturnValue(identity);
    const business = await createOnboardingServices(defaultOnboardingRepository).createBusiness({ name: `HTTP Upload Harbour ${Date.now()}` }, identity);
    const form = new FormData();
    form.set("file", new File([pdfBytes], "route-invoice.pdf", { type: "application/pdf" }));

    const response = await POST(new Request("http://localhost/api/businesses/business/documents", { method: "POST", body: form }), { params: Promise.resolve({ businessId: business.id }) });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ businessId: business.id, originalFileName: "route-invoice.pdf", status: "uploaded" });
    expect(body).not.toHaveProperty("privateObjectKey");
    expect(JSON.stringify(body)).not.toContain("private/");
  });

  it("rejects MIME spoofing, unsupported extensions, corrupt and empty content", () => {
    expect(() => validateUpload(upload("invoice.pdf", "image/png"))).toThrowError(expect.objectContaining({ code: UPLOAD_ERROR_CODES.MIME_EXTENSION_MISMATCH }));
    expect(() => validateUpload(upload("invoice.exe", "application/octet-stream", new Uint8Array([0x4d, 0x5a])))).toThrowError(expect.objectContaining({ code: UPLOAD_ERROR_CODES.UNSUPPORTED_FORMAT }));
    expect(() => validateUpload(upload("corrupt.pdf", "application/pdf", new Uint8Array(Buffer.from("%PDF-1.7 corrupt"))))).toThrowError(expect.objectContaining({ code: UPLOAD_ERROR_CODES.SIGNATURE_MISMATCH }));
    expect(() => validateUpload(upload("empty.pdf", "application/pdf", new Uint8Array()))).toThrowError(expect.objectContaining({ code: UPLOAD_ERROR_CODES.EMPTY_FILE }));
  });

  it("rejects oversized and declared-size mismatch inputs", () => {
    const oversized = new Uint8Array(MAX_UPLOAD_SIZE_BYTES + 1);
    oversized.set(pdfBytes);
    expect(() => validateUpload(upload("large.pdf", "application/pdf", oversized))).toThrowError(expect.objectContaining({ code: UPLOAD_ERROR_CODES.FILE_TOO_LARGE }));
    expect(() => validateUpload({ ...upload("invoice.pdf", "application/pdf"), sizeBytes: 1 })).toThrowError(expect.objectContaining({ code: UPLOAD_ERROR_CODES.SIZE_MISMATCH }));
  });

  it("keeps traversal names as metadata but never uses them as storage paths", async () => {
    const validated = validateUpload(upload("../../private/../invoice.pdf", "application/pdf"));
    const repository = createDocumentRepository();
    const document = await createDocument({ businessId, upload: validated }, user("owner"), { tenancyRepository: tenancy, documentRepository: repository, storage });

    expect(document.originalFileName).toContain("..");
    expect(document.privateObjectKey).not.toContain("..");
    expect(document.privateObjectKey).not.toMatch(/^[A-Za-z]:|^\\\\|^\//);
    expect(JSON.stringify(document)).not.toContain("secret");
  });

  it("denies unauthorized download and keeps the public error generic", async () => {
    const repository = createDocumentRepository();
    const document = await createDocument({ businessId, upload: validateUpload(upload("invoice.pdf", "application/pdf")) }, user("owner"), { tenancyRepository: tenancy, documentRepository: repository, storage });
    const other = await createOnboardingServices(tenancy).createBusiness({ name: "Other Upload Harbour" }, user("other-owner"));

    await expect(getDocumentForDownload(document.id, user("other-owner"), { tenancyRepository: tenancy, documentRepository: repository, storage }))
      .rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED", message: "Business access denied." });
    expect((await getDocumentForDownload(document.id, user("owner"), { tenancyRepository: tenancy, documentRepository: repository, storage })).document.privateObjectKey).toBeTruthy();
    expect(other.id).not.toBe(businessId);
  });
});
