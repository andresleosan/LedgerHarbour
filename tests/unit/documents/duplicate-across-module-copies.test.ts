import { describe, expect, it, vi } from "vitest";

import { createInMemoryOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import type { UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

type DocumentService = typeof import("../../../src/modules/documents/document-service");
type JobService = typeof import("../../../src/modules/jobs/job-service");

// In `next dev` each route bundle evaluates its own copy of a module, while the in-memory
// repositories live on globalThis. Fresh module graphs reproduce that split in Vitest.
async function freshDocumentService(): Promise<DocumentService> {
  vi.resetModules();
  return import("../../../src/modules/documents/document-service");
}

async function freshJobService(): Promise<JobService> {
  vi.resetModules();
  return import("../../../src/modules/jobs/job-service");
}

const pdf = (checksum: string) => ({
  originalFileName: "invoice.pdf",
  originalMimeType: "application/pdf",
  originalSizeBytes: 4,
  checksum,
  data: new Uint8Array([1, 2, 3, 4]),
  format: "pdf" as const,
});

const storage = {
  async put(input: { objectKey: string; data: Uint8Array }) { return { objectKey: input.objectKey, sizeBytes: input.data.byteLength }; },
  async get(): Promise<ReadableStream<Uint8Array>> { throw new Error("unused"); },
  async delete() {},
};

describe("domain errors from a repository created by another module copy", () => {
  it("still reports a duplicate upload as DOCUMENT_DUPLICATE_CHECKSUM", async () => {
    const repositoryOwner = await freshDocumentService();
    const uploadRoute = await freshDocumentService();
    expect(uploadRoute.DocumentError).not.toBe(repositoryOwner.DocumentError);
    const tenancy = createInMemoryOnboardingRepository();
    const business = await createApprovedBusiness(tenancy, "Copies Books", "owner" as UserId);
    const documentRepository = repositoryOwner.createDocumentRepository();
    const dependencies = { tenancyRepository: tenancy, documentRepository, storage };
    await uploadRoute.createDocument({ businessId: business.id, upload: pdf("same-file") }, "owner" as UserId, dependencies);

    const duplicate = uploadRoute.createDocument({ businessId: business.id, upload: pdf("same-file") }, "owner" as UserId, dependencies);

    await expect(duplicate).rejects.toBeInstanceOf(uploadRoute.DocumentError);
    await expect(duplicate).rejects.toMatchObject({ code: "DOCUMENT_DUPLICATE_CHECKSUM" });
  });

  it("recognises a job error thrown by another copy of the jobs module", async () => {
    const repositoryOwner = await freshJobService();
    const processRoute = await freshJobService();

    const error = processRoute.asJobError(new repositoryOwner.JobError("OCR_RETRIES_EXHAUSTED"));

    expect(error).toBeInstanceOf(processRoute.JobError);
    expect(error?.code).toBe("OCR_RETRIES_EXHAUSTED");
    expect(processRoute.asJobError(new Error("OCR_RETRIES_EXHAUSTED"))).toBeNull();
    expect(processRoute.asJobError({ name: "JobError", code: "NOT_A_CODE" })).toBeNull();
  });
});
