import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as listRoute, POST as uploadRoute } from "../../../src/app/api/businesses/[businessId]/documents/route";
import { POST as manualInvoiceRoute } from "../../../src/app/api/documents/[documentId]/manual-invoice/route";
import { POST as processRoute } from "../../../src/app/api/documents/[documentId]/process/route";
import { clearCurrentIdentity, setCurrentIdentity } from "../../../src/modules/auth/session";
import type { InMemoryDocumentRepository } from "../../../src/modules/documents/document-service";
import { MAX_UPLOAD_REQUEST_BODY_BYTES } from "../../../src/modules/documents/file-validation";
import { FakeOcrProvider } from "../../../src/modules/invoices/fake-ocr-provider";
import { resolveDefaultStorage, type InMemoryInvoiceRepository } from "../../../src/modules/invoices/invoice-service";
import { OcrProviderError, type OcrProvider } from "../../../src/modules/invoices/ocr-provider";
import type { InMemoryJobRepository } from "../../../src/modules/jobs/job-service";
import { resetRateLimitersForTests } from "../../../src/modules/security/rate-limit";
import { defaultOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import type { BusinessId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

// The process route builds its provider from configuration; tests swap in a controllable one.
const ocr = vi.hoisted(() => ({ provider: null as unknown, calls: 0 }));
vi.mock("../../../src/modules/invoices/ocr-provider-factory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/modules/invoices/ocr-provider-factory")>();
  return {
    ...actual,
    createOcrProvider: () => ({
      async extract(input: Parameters<OcrProvider["extract"]>[0]) {
        ocr.calls += 1;
        return (ocr.provider as OcrProvider).extract(input);
      },
    }),
  };
});

const failing: OcrProvider = { async extract() { throw new OcrProviderError(true); } };
const succeeding = new FakeOcrProvider();

const identity = (id: string) => ({ providerUserId: id, email: `${id}@example.com`, displayName: id, emailVerified: true });
const globalRepository = <T>(key: string): T => (globalThis as typeof globalThis & { [key: symbol]: unknown })[Symbol.for(key)] as T;
const documents = () => globalRepository<InMemoryDocumentRepository>("ledgerharbour.task7.inMemoryDocumentRepository");
const jobs = () => globalRepository<InMemoryJobRepository>("ledgerharbour.task8.inMemoryJobRepository");
const invoices = () => globalRepository<InMemoryInvoiceRepository>("ledgerharbour.task8.inMemoryInvoiceRepository");

function pdfBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(`%PDF-1.7\n% ${randomUUID()}\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF\n`));
}

function upload(businessId: string, bytes: Uint8Array<ArrayBuffer>, name = "invoice.pdf") {
  const form = new FormData();
  form.set("file", new File([bytes], name, { type: "application/pdf" }));
  return uploadRoute(
    new Request("http://localhost", { method: "POST", body: form, headers: { "content-length": String(MAX_UPLOAD_REQUEST_BODY_BYTES) } }),
    { params: Promise.resolve({ businessId }) },
  );
}

function processDocument(documentId: string, body = "{}") {
  return processRoute(new Request("http://localhost", { method: "POST", body }), { params: Promise.resolve({ documentId }) });
}

function manualInvoice(documentId: string, body = "{}") {
  return manualInvoiceRoute(new Request("http://localhost", { method: "POST", body }), { params: Promise.resolve({ documentId }) });
}

function listDocuments(businessId: string) {
  return listRoute(new Request("http://localhost"), { params: Promise.resolve({ businessId }) });
}

async function setup() {
  defaultOnboardingRepository.businesses.clear();
  defaultOnboardingRepository.memberships.splice(0);
  defaultOnboardingRepository.categories.splice(0);
  defaultOnboardingRepository.joinRequests.splice(0);
  defaultOnboardingRepository.auditEvents.splice(0);
  const businessA = await createApprovedBusiness(defaultOnboardingRepository, "Recovery Books A", identity("a-owner"));
  const businessB = await createApprovedBusiness(defaultOnboardingRepository, "Recovery Books B", identity("b-owner"));
  await setCurrentIdentity(identity("a-owner"));
  return { businessA: businessA.id, businessB: businessB.id };
}

async function uploadedDocumentId(businessId: string, bytes = pdfBytes()): Promise<string> {
  const response = await upload(businessId, bytes);
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}

describe("recovering from a failed invoice reading", () => {
  beforeEach(() => {
    process.env.AUTH_MODE = "firebase";
    resetRateLimitersForTests();
    ocr.provider = failing;
    ocr.calls = 0;
  });

  afterEach(async () => {
    await clearCurrentIdentity();
  });

  it("lets the user read a failed document again on the same job", async () => {
    const { businessA } = await setup();
    const documentId = await uploadedDocumentId(businessA);

    const firstAttempt = await processDocument(documentId);
    expect(firstAttempt.status).toBe(502);
    await expect(documents().getStatus(documentId)).resolves.toBe("failed");
    const failedJob = await jobs().findByDocumentId(documentId as never);
    expect(failedJob).toMatchObject({ status: "failed", retryCount: 1 });

    ocr.provider = succeeding;
    const retry = await processDocument(documentId);

    expect(retry.status).toBe(202);
    await expect(retry.json()).resolves.toMatchObject({ job: { id: failedJob!.id, status: "completed", retryCount: 1 } });
    expect([...jobs().jobs.values()].filter((job) => job.documentId === documentId)).toHaveLength(1);
    await expect(documents().getStatus(documentId)).resolves.toBe("needs_review");
    expect([...invoices().invoices.values()].filter((invoice) => invoice.documentId === documentId)).toHaveLength(1);
  });

  it("stops retrying after the maximum attempts and lets the user fill the invoice in by hand", async () => {
    const { businessA } = await setup();
    const documentId = await uploadedDocumentId(businessA);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await processDocument(documentId);
      expect(response.status).toBe(502);
    }
    expect(ocr.calls).toBe(3);
    const exhausted = await processDocument(documentId);
    expect(exhausted.status).toBe(409);
    await expect(exhausted.json()).resolves.toEqual({
      error: { code: "OCR_RETRIES_EXHAUSTED", message: "This document could not be read. Fill the invoice in by hand." },
    });
    expect(ocr.calls).toBe(3);

    const strict = await manualInvoice(documentId, JSON.stringify({ supplier: "Injected" }));
    expect(strict.status).toBe(400);

    const created = await manualInvoice(documentId);
    expect(created.status).toBe(201);
    const { invoiceId } = await created.json() as { invoiceId: string };
    const invoice = invoices().invoices.get(invoiceId);
    expect(invoice).toMatchObject({
      documentId,
      businessId: businessA,
      supplier: null,
      invoiceNumber: null,
      invoiceDate: null,
      total: null,
      currencyReference: null,
      reviewState: "needs_review",
    });
    expect(Object.values(invoice!.confidenceData).every((value) => value === 0)).toBe(true);
    await expect(documents().getStatus(documentId)).resolves.toBe("needs_review");
    await expect(jobs().findByDocumentId(documentId as never)).resolves.toMatchObject({ status: "completed" });
    expect(defaultOnboardingRepository.auditEvents).toContainEqual(expect.objectContaining({
      businessId: businessA,
      type: "invoice_created_manually",
      entityId: invoiceId,
    }));

    const again = await manualInvoice(documentId);
    expect(again.status).toBe(409);
    await expect(again.json()).resolves.toMatchObject({ error: { code: "DOCUMENT_NOT_FAILED" } });
    expect([...invoices().invoices.values()].filter((candidate) => candidate.documentId === documentId)).toHaveLength(1);
  });

  it("only offers manual entry for a failed document", async () => {
    const { businessA } = await setup();
    const documentId = await uploadedDocumentId(businessA);

    const response = await manualInvoice(documentId);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "DOCUMENT_NOT_FAILED", message: "Only a document whose reading failed can be filled in by hand." },
    });
    await clearCurrentIdentity();
    expect((await manualInvoice(documentId)).status).toBe(401);
    await setCurrentIdentity(identity("a-owner"));
    expect((await manualInvoice("missing-document")).status).toBe(404);
  });

  it("accepts the same file again when its reading failed and reads it with fresh attempts", async () => {
    const { businessA } = await setup();
    const bytes = pdfBytes();
    const documentId = await uploadedDocumentId(businessA, bytes);
    expect((await processDocument(documentId)).status).toBe(502);
    expect((await processDocument(documentId)).status).toBe(502);
    const before = await documents().findById(documentId);

    const reupload = await upload(businessA, bytes, "invoice-again.pdf");

    expect(reupload.status).toBe(201);
    const body = await reupload.json() as Record<string, unknown>;
    expect(body).toMatchObject({ id: documentId, status: "uploaded", originalFileName: "invoice-again.pdf" });
    expect(body).not.toHaveProperty("privateObjectKey");
    const after = await documents().findById(documentId);
    expect(after!.privateObjectKey).not.toBe(before!.privateObjectKey);
    await expect(resolveDefaultStorage().get(before!.privateObjectKey)).rejects.toThrow();
    await expect(resolveDefaultStorage().get(after!.privateObjectKey)).resolves.toBeDefined();
    await expect(jobs().findByDocumentId(documentId as never)).resolves.toMatchObject({ status: "queued", retryCount: 0, errorSummary: null });
    expect([...documents().documents.values()].filter((document) => document.businessId === businessA)).toHaveLength(1);

    ocr.provider = succeeding;
    const processed = await processDocument(documentId);
    expect(processed.status).toBe(202);
    await expect(documents().getStatus(documentId)).resolves.toBe("needs_review");

    const duplicate = await upload(businessA, bytes);
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toEqual({ error: { code: "DOCUMENT_DUPLICATE_CHECKSUM", message: "This document has already been uploaded." } });
  });

  it("does not run OCR twice when two retries arrive together", async () => {
    const { businessA } = await setup();
    const documentId = await uploadedDocumentId(businessA);
    expect((await processDocument(documentId)).status).toBe(502);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    ocr.provider = { async extract(input) { await gate; return succeeding.extract(input); } } satisfies OcrProvider;
    ocr.calls = 0;

    const first = processDocument(documentId);
    const second = processDocument(documentId);
    await vi.waitFor(() => expect(ocr.calls).toBe(1));
    release();
    const responses = await Promise.all([first, second]);

    expect(ocr.calls).toBe(1);
    expect(responses.map((response) => response.status).sort()).toEqual([202, 202]);
    expect([...invoices().invoices.values()].filter((invoice) => invoice.documentId === documentId)).toHaveLength(1);
    await expect(jobs().findByDocumentId(documentId as never)).resolves.toMatchObject({ status: "completed" });
  });

  it("lists the business documents with their status and available actions", async () => {
    const { businessA, businessB } = await setup();
    const readId = await uploadedDocumentId(businessA);
    ocr.provider = succeeding;
    expect((await processDocument(readId)).status).toBe(202);
    ocr.provider = failing;
    const failedId = await uploadedDocumentId(businessA);
    expect((await processDocument(failedId)).status).toBe(502);
    await setCurrentIdentity(identity("b-owner"));
    await uploadedDocumentId(businessB);
    await setCurrentIdentity(identity("a-owner"));

    const response = await listRoute(new Request("http://localhost"), { params: Promise.resolve({ businessId: businessA }) });

    expect(response.status).toBe(200);
    const { documents: rows } = await response.json() as { documents: Record<string, unknown>[] };
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).not.toHaveProperty("privateObjectKey");
    const readInvoice = [...invoices().invoices.values()].find((invoice) => invoice.documentId === readId);
    expect(rows.find((row) => row.id === readId)).toMatchObject({ status: "needs_review", invoiceId: readInvoice!.id, canRetry: false });
    expect(rows.find((row) => row.id === failedId)).toMatchObject({ status: "failed", invoiceId: null, canRetry: true, originalFileName: "invoice.pdf" });

    await clearCurrentIdentity();
    expect((await listDocuments(businessA)).status).toBe(401);
  });

  it("keeps business B's member away from business A's documents", async () => {
    const { businessA } = await setup();
    const bytes = pdfBytes();
    const documentId = await uploadedDocumentId(businessA, bytes);
    expect((await processDocument(documentId)).status).toBe(502);
    const before = await documents().findById(documentId);
    await setCurrentIdentity(identity("b-owner"));

    const retry = await processDocument(documentId);
    const manual = await manualInvoice(documentId);
    const list = await listDocuments(businessA);
    const reupload = await upload(businessA, bytes);

    for (const response of [retry, manual, list, reupload]) {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "BUSINESS_ACCESS_DENIED" } });
    }
    await expect(documents().findById(documentId)).resolves.toEqual(before);
    await expect(jobs().findByDocumentId(documentId as never)).resolves.toMatchObject({ status: "failed", retryCount: 1 });
    expect([...invoices().invoices.values()].filter((invoice) => invoice.documentId === documentId)).toHaveLength(0);
  });

  it("does not reuse a failed document of another business with the same file", async () => {
    const { businessA, businessB } = await setup();
    const bytes = pdfBytes();
    const documentId = await uploadedDocumentId(businessA, bytes);
    expect((await processDocument(documentId)).status).toBe(502);
    const before = await documents().findById(documentId);
    await setCurrentIdentity(identity("b-owner"));

    const otherBusinessUpload = await upload(businessB as BusinessId, bytes);

    expect(otherBusinessUpload.status).toBe(201);
    await expect(otherBusinessUpload.json()).resolves.not.toMatchObject({ id: documentId });
    await expect(documents().findById(documentId)).resolves.toEqual(before);
  });
});
