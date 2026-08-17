import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  createDocument,
  createDocumentRepository,
  DOCUMENT_ERROR_CODES,
  getDocumentForDownload,
} from "../../../src/modules/documents/document-service";
import { POST as uploadRoute } from "../../../src/app/api/businesses/[businessId]/documents/route";
import { GET as downloadRoute } from "../../../src/app/api/documents/[documentId]/download/route";
import { clearCurrentIdentity, setCurrentIdentity } from "../../../src/modules/auth/session";
import { LocalPrivateStorage } from "../../../src/modules/documents/local-private-storage";
import { MAX_UPLOAD_REQUEST_BODY_BYTES, validateUpload } from "../../../src/modules/documents/file-validation";
import { resetRateLimitersForTests } from "../../../src/modules/security/rate-limit";
import {
  createInMemoryOnboardingRepository,
  defaultOnboardingRepository,
} from "../../../src/modules/tenancy/business-service";
import type { UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const user = (value: string) => value as UserId;
const pdfBytes = new Uint8Array(Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF\n"));
const pdf = (name = "invoice.pdf", data = pdfBytes) => validateUpload({
  name,
  mimeType: "application/pdf",
  sizeBytes: data.byteLength,
  data,
});

describe("private document storage and service boundaries", () => {
  let storage: LocalPrivateStorage;

  beforeEach(() => {
    storage = new LocalPrivateStorage(join(process.cwd(), "storage", ".task7-test", randomUUID()));
    defaultOnboardingRepository.businesses.clear();
    defaultOnboardingRepository.memberships.splice(0);
    defaultOnboardingRepository.categories.splice(0);
    defaultOnboardingRepository.joinRequests.splice(0);
    defaultOnboardingRepository.auditEvents.splice(0);
    process.env.AUTH_MODE = "development";
    resetRateLimitersForTests();
  });

  afterEach(async () => {
    await storage.clearForTests();
    await clearCurrentIdentity();
  });

  async function setup() {
    const tenancy = createInMemoryOnboardingRepository();
    const created = await createApprovedBusiness(tenancy, "Private Books", user("owner"));
    await tenancy.createMembership({ membershipId: "membership-member", userId: user("member"), businessId: created.id, role: "administrator", isActive: true, status: "active" });
    const other = await createApprovedBusiness(tenancy, "Other Books", user("other-owner"));
    return { tenancy, created, other };
  }

  it("stores originals privately and returns metadata without a filesystem path", async () => {
    const { tenancy, created } = await setup();
    const document = await createDocument({ businessId: created.id, upload: pdf() }, user("member"), {
      tenancyRepository: tenancy,
      documentRepository: createDocumentRepository(),
      storage,
    });

    expect(document).toMatchObject({
      businessId: created.id,
      uploaderId: user("member"),
      originalFileName: "invoice.pdf",
      originalMimeType: "application/pdf",
      originalSizeBytes: pdfBytes.byteLength,
      status: "uploaded",
    });
    expect(document).not.toHaveProperty("path");
    expect(document).not.toHaveProperty("filesystemPath");
    const stored = await storage.get(document.privateObjectKey);
    await expect(new Response(stored).arrayBuffer()).resolves.toEqual(pdfBytes.buffer);
  });

  it("prevents tenant crossover when an actor is not a member of the business", async () => {
    const { tenancy, created } = await setup();
    await expect(createDocument({ businessId: created.id, upload: pdf() }, user("other-owner"), {
      tenancyRepository: tenancy,
      documentRepository: createDocumentRepository(),
      storage,
    })).rejects.toMatchObject({ code: DOCUMENT_ERROR_CODES.BUSINESS_ACCESS_DENIED });
  });

  it("blocks uploads and downloads for inactive businesses", async () => {
    const { tenancy, created } = await setup();
    const repository = createDocumentRepository();
    const input = { tenancyRepository: tenancy, documentRepository: repository, storage };
    const document = await createDocument({ businessId: created.id, upload: pdf() }, user("member"), input);
    tenancy.businesses.get(created.id)!.isActive = false;

    await expect(createDocument({ businessId: created.id, upload: pdf("second.pdf") }, user("member"), input))
      .rejects.toMatchObject({ code: DOCUMENT_ERROR_CODES.INACTIVE_BUSINESS });
    await expect(getDocumentForDownload(document.id, user("member"), input)).rejects.toMatchObject({
      code: DOCUMENT_ERROR_CODES.INACTIVE_BUSINESS,
    });
  });

  it("rejects a duplicate checksum within the same business", async () => {
    const { tenancy, created } = await setup();
    const documentRepository = createDocumentRepository();
    const input = { tenancyRepository: tenancy, documentRepository, storage };

    await createDocument({ businessId: created.id, upload: pdf() }, user("member"), input);
    await expect(createDocument({ businessId: created.id, upload: pdf("renamed.pdf") }, user("member"), input))
      .rejects.toMatchObject({ code: DOCUMENT_ERROR_CODES.DUPLICATE_CHECKSUM });
  });

  it("serializes same-checksum uploads so one succeeds and the loser has no orphan", async () => {
    const { tenancy, created } = await setup();
    const documentRepository = createDocumentRepository();
    const delayedStorage = {
      ...storage,
      async put(input: Parameters<LocalPrivateStorage["put"]>[0]) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return storage.put(input);
      },
      async delete(objectKey: string) {
        return storage.delete(objectKey);
      },
      async get(objectKey: string) {
        return storage.get(objectKey);
      },
    };
    const input = { tenancyRepository: tenancy, documentRepository, storage: delayedStorage };

    const results = await Promise.allSettled([
      createDocument({ businessId: created.id, upload: pdf("first.pdf") }, user("member"), input),
      createDocument({ businessId: created.id, upload: pdf("second.pdf") }, user("member"), input),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: DOCUMENT_ERROR_CODES.DUPLICATE_CHECKSUM },
    });
    await expect(storage.listKeys()).resolves.toHaveLength(1);
    await expect(documentRepository.listByBusinessId(created.id)).resolves.toHaveLength(1);
  });

  it("allows a member to download but denies an unrelated business member", async () => {
    const { tenancy, created, other } = await setup();
    const input = { tenancyRepository: tenancy, documentRepository: createDocumentRepository(), storage };
    const document = await createDocument({ businessId: created.id, upload: pdf() }, user("member"), input);

    await expect(getDocumentForDownload(document.id, user("member"), input)).resolves.toMatchObject({
      document,
      stream: expect.any(ReadableStream),
    });
    await expect(getDocumentForDownload(document.id, user("other-owner"), input)).rejects.toMatchObject({
      code: DOCUMENT_ERROR_CODES.BUSINESS_ACCESS_DENIED,
    });
    expect(other.id).not.toBe(created.id);
  });

  it("hides a missing document and cleans storage when repository persistence fails", async () => {
    const { tenancy, created } = await setup();
    const documentRepository = createDocumentRepository();
    documentRepository.failNextCreate = true;

    await expect(createDocument({ businessId: created.id, upload: pdf() }, user("member"), {
      tenancyRepository: tenancy,
      documentRepository,
      storage,
    })).rejects.toMatchObject({ code: DOCUMENT_ERROR_CODES.STORAGE_FAILURE });
    await expect(storage.listKeys()).resolves.toEqual([]);
    await expect(getDocumentForDownload("missing-document", user("member"), {
      tenancyRepository: tenancy,
      documentRepository,
      storage,
    })).rejects.toMatchObject({ code: DOCUMENT_ERROR_CODES.DOCUMENT_NOT_FOUND });
  });

  it("cleans storage when the repository transaction fails after the callback", async () => {
    const { tenancy, created } = await setup();
    const documentRepository = createDocumentRepository();
    documentRepository.transaction = async (operation) => {
      await operation();
      throw new Error("transaction commit failed");
    };

    await expect(createDocument({ businessId: created.id, upload: pdf() }, user("member"), {
      tenancyRepository: tenancy,
      documentRepository,
      storage,
    })).rejects.toMatchObject({ code: DOCUMENT_ERROR_CODES.STORAGE_FAILURE });
    await expect(storage.listKeys()).resolves.toEqual([]);
  });

  it("authorizes membership before business state and preserves inactive-member behavior", async () => {
    const { tenancy, created } = await setup();
    tenancy.businesses.get(created.id)!.isActive = false;
    const input = { tenancyRepository: tenancy, documentRepository: createDocumentRepository(), storage };

    await expect(createDocument({ businessId: created.id, upload: pdf() }, user("outsider"), input)).rejects.toMatchObject({
      code: DOCUMENT_ERROR_CODES.BUSINESS_ACCESS_DENIED,
    });
    await expect(createDocument({ businessId: created.id, upload: pdf() }, user("member"), input)).rejects.toMatchObject({
      code: DOCUMENT_ERROR_CODES.INACTIVE_BUSINESS,
    });
  });

  it("covers direct upload and download route contracts and safe headers", async () => {
    const formFor = (file: File) => {
      const form = new FormData();
      form.set("file", file);
      return new Request("http://localhost", { method: "POST", body: form, headers: { "content-length": String(MAX_UPLOAD_REQUEST_BODY_BYTES) } });
    };
    const contextFor = (businessId: string) => ({ params: Promise.resolve({ businessId }) });
    const documentContextFor = (documentId: string) => ({ params: Promise.resolve({ documentId }) });
    const validFile = () => new File([pdfBytes], "invoice.pdf", { type: "application/pdf" });
    const identity = (id: string) => ({ providerUserId: id, email: `${id}@example.com`, displayName: id, emailVerified: true });

    const unauthenticatedUpload = await uploadRoute(formFor(validFile()), contextFor("missing-business"));
    expect(unauthenticatedUpload.status).toBe(401);
    await expect(unauthenticatedUpload.json()).resolves.toEqual({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } });

    const routeOwner = identity("route-owner");
    const created = await createApprovedBusiness(defaultOnboardingRepository, "Route Documents", routeOwner);
    await setCurrentIdentity(routeOwner);

    const invalidMultipart = await uploadRoute(new Request("http://localhost", { method: "POST", body: "not multipart", headers: { "content-length": "15" } }), contextFor(created.id));
    expect(invalidMultipart.status).toBe(400);
    await expect(invalidMultipart.json()).resolves.toEqual({ error: { code: "INVALID_UPLOAD", message: "The document could not be uploaded." } });

    const oversized = await uploadRoute(formFor(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" })), contextFor(created.id));
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toEqual({ error: { code: "DOCUMENT_TOO_LARGE", message: "The document exceeds the 10 MiB limit." } });

    const unsupported = await uploadRoute(formFor(new File(["not a document"], "invoice.txt", { type: "text/plain" })), contextFor(created.id));
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toEqual({ error: { code: "UNSUPPORTED_DOCUMENT_FORMAT", message: "The document format is not supported." } });
    const corrupt = await uploadRoute(formFor(new File(["%PDF-1.7\ncorrupt body"], "corrupt.pdf", { type: "application/pdf" })), contextFor(created.id));
    expect(corrupt.status).toBe(400);
    await expect(corrupt.json()).resolves.toEqual({ error: { code: "DOCUMENT_SIGNATURE_MISMATCH", message: "The document content is corrupt or does not match its format." } });
    const mismatched = await uploadRoute(formFor(new File([pdfBytes], "invoice.pdf", { type: "image/png" })), contextFor(created.id));
    expect(mismatched.status).toBe(400);
    await expect(mismatched.json()).resolves.toEqual({ error: { code: "DOCUMENT_MIME_EXTENSION_MISMATCH", message: "The document metadata does not match its content." } });

    await setCurrentIdentity(identity("unrelated-user"));
    const nonMemberUpload = await uploadRoute(formFor(new File([pdfBytes], "unrelated.pdf", { type: "application/pdf" })), contextFor(created.id));
    expect(nonMemberUpload.status).toBe(403);
    await expect(nonMemberUpload.json()).resolves.toEqual({ error: { code: "BUSINESS_ACCESS_DENIED", message: "Business access denied." } });
    await setCurrentIdentity(identity("route-owner"));
    defaultOnboardingRepository.businesses.get(created.id)!.isActive = false;
    const inactiveUpload = await uploadRoute(formFor(new File([pdfBytes], "inactive.pdf", { type: "application/pdf" })), contextFor(created.id));
    expect(inactiveUpload.status).toBe(403);
    await expect(inactiveUpload.json()).resolves.toEqual({ error: { code: "INACTIVE_BUSINESS", message: "This business is inactive." } });
    defaultOnboardingRepository.businesses.get(created.id)!.isActive = true;
    const missingBusinessUpload = await uploadRoute(formFor(validFile()), contextFor("nonexistent-business"));
    expect(missingBusinessUpload.status).toBe(403);
    await expect(missingBusinessUpload.json()).resolves.toEqual({ error: { code: "BUSINESS_ACCESS_DENIED", message: "Business access denied." } });

    const createdResponse = await uploadRoute(formFor(validFile()), contextFor(created.id));
    expect(createdResponse.status).toBe(201);
    const createdDto = await createdResponse.json() as { id: string; privateObjectKey?: string };
    expect(createdDto.privateObjectKey).toBeUndefined();

    const duplicate = await uploadRoute(formFor(new File([pdfBytes], "renamed.pdf", { type: "application/pdf" })), contextFor(created.id));
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toEqual({ error: { code: "DOCUMENT_DUPLICATE_CHECKSUM", message: "This document has already been uploaded." } });

    const unauthenticatedDownload = await (async () => {
      await clearCurrentIdentity();
      return downloadRoute(new Request("http://localhost"), documentContextFor(createdDto.id));
    })();
    expect(unauthenticatedDownload.status).toBe(401);
    await expect(unauthenticatedDownload.json()).resolves.toEqual({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } });
    await setCurrentIdentity(identity("route-owner"));

    const download = await downloadRoute(new Request("http://localhost"), documentContextFor(createdDto.id));
    expect(download.status).toBe(200);
    expect(Object.fromEntries(download.headers)).toMatchObject({
      "cache-control": "private, no-store",
      "content-disposition": 'attachment; filename="invoice.pdf"',
      "content-length": String(pdfBytes.byteLength),
      "content-type": "application/pdf",
      "x-content-type-options": "nosniff",
    });
    await expect(download.arrayBuffer()).resolves.toEqual(pdfBytes.buffer);

    const getFailure = vi.spyOn(LocalPrivateStorage.prototype, "get").mockRejectedValueOnce(new Error("private filesystem detail"));
    const downloadFailure = await downloadRoute(new Request("http://localhost"), documentContextFor(createdDto.id));
    getFailure.mockRestore();
    expect(downloadFailure.status).toBe(500);
    await expect(downloadFailure.json()).resolves.toEqual({ error: { code: "DOCUMENT_STORAGE_FAILURE", message: "The document could not be stored." } });

    const hidden = await downloadRoute(new Request("http://localhost"), documentContextFor("missing-document"));
    expect(hidden.status).toBe(404);
    await expect(hidden.json()).resolves.toEqual({ error: { code: "DOCUMENT_NOT_FOUND", message: "Document not found." } });

    defaultOnboardingRepository.memberships.splice(0);
    await defaultOnboardingRepository.createMembership({
      membershipId: "membership-route-member",
      userId: user("other-user"), businessId: "other-business" as typeof created.id, role: "administrator", isActive: true, status: "active",
    });
    await setCurrentIdentity(identity("other-user"));
    const forbidden = await downloadRoute(new Request("http://localhost"), documentContextFor(createdDto.id));
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({ error: { code: "BUSINESS_ACCESS_DENIED", message: "Business access denied." } });

    await setCurrentIdentity(identity("route-owner"));
    const routeOwnerId = await defaultOnboardingRepository.upsertUser(identity("route-owner"));
    await defaultOnboardingRepository.createMembership({ membershipId: "membership-route-owner", userId: routeOwnerId, businessId: created.id, role: "owner_admin", isActive: true, status: "active" });
    defaultOnboardingRepository.businesses.get(created.id)!.isActive = false;
    const inactive = await downloadRoute(new Request("http://localhost"), documentContextFor(createdDto.id));
    expect(inactive.status).toBe(403);
    await expect(inactive.json()).resolves.toEqual({ error: { code: "INACTIVE_BUSINESS", message: "This business is inactive." } });

    const putFailure = vi.spyOn(LocalPrivateStorage.prototype, "put").mockRejectedValueOnce(new Error("private filesystem detail"));
    defaultOnboardingRepository.businesses.get(created.id)!.isActive = true;
    const storageFailure = await uploadRoute(formFor(new File([pdfBytes], "failure.pdf", { type: "application/pdf" })), contextFor(created.id));
    putFailure.mockRestore();
    expect(storageFailure.status).toBe(500);
    await expect(storageFailure.json()).resolves.toEqual({ error: { code: "DOCUMENT_STORAGE_FAILURE", message: "The document could not be stored." } });
  });
});
