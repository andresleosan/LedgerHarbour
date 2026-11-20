import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHeadingRepository, importHeadings, listHeadings, type TemplateHeadingInput } from "../../src/modules/accounting/heading-service";
import { createMoneyRepository } from "../../src/modules/accounting/money-repository";
import { createDocumentRepository, type Document } from "../../src/modules/documents/document-service";
import { createInvoiceCodingRepository } from "../../src/modules/invoices/invoice-coding-repository";
import { changeInvoicePayment, voidInvoice } from "../../src/modules/invoices/invoice-payment-service";
import { getInvoiceReview, updateInvoiceDraft } from "../../src/modules/invoices/invoice-review-service";
import { createInvoiceRepository, getInvoice, getInvoiceCoding, getInvoiceWithCoding, updateInvoice } from "../../src/modules/invoices/invoice-service";
import type { DocumentId, InvoiceId } from "../../src/modules/invoices/ocr-provider";
import { createJobRepository, createManualInvoice } from "../../src/modules/jobs/job-service";
import type { Capability } from "../../src/modules/permissions/capabilities";
import { createInMemoryOnboardingRepository } from "../../src/modules/tenancy/business-service";
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

const user = (value: string) => value as UserId;
const owner = user("owner");
const headingInputs: TemplateHeadingInput[] = [{ position: 1, templateValue: "Rent", valueType: "text", group: "expenses", order: 1, blockedReason: null }];
const confident = { supplier: 1, invoiceNumber: 1, invoiceDate: 1, dueDate: 1, subtotal: 1, taxAmount: 1, total: 1, currencyReference: 1, expenseCategoryReference: 1, notes: 1 };
const at = "2026-01-01T00:00:00.000Z";

async function fixture() {
  const tenancy = createInMemoryOnboardingRepository();
  const headings = createHeadingRepository();
  const documents = createDocumentRepository();
  const invoices = createInvoiceRepository();
  const codings = createInvoiceCodingRepository(invoices);
  const money = createMoneyRepository();
  const jobs = createJobRepository();
  const business = await createApprovedBusiness(tenancy, "Finance Permission Harbour", owner);
  await importHeadings(business.id, headingInputs, owner, { tenancyRepository: tenancy, headings });
  const [heading] = await listHeadings(business.id, owner, { tenancyRepository: tenancy, headings });
  const document = async (id: string, status: Document["status"]) => documents.create({
    id, businessId: business.id, uploaderId: owner, privateObjectKey: `private/${id}`, originalFileName: "a.pdf", originalMimeType: "application/pdf", originalSizeBytes: 4, checksum: `checksum-${id}`, status, createdAt: at,
  });
  const invoice = async (id: string, approved: boolean) => {
    await document(`${id}-document`, "needs_review");
    const created = await invoices.create({
      id: id as InvoiceId, businessId: business.id, documentId: `${id}-document` as DocumentId, supplier: "Supplier", invoiceNumber: id, invoiceDate: "2026-08-11", dueDate: null,
      subtotal: null, taxAmount: null, total: "50.00", currencyReference: "GBP", expenseCategoryReference: null, notes: null, confidenceData: { ...confident },
      reviewState: approved ? "approved" : "needs_review", createdAt: at, updatedAt: at, ...(approved ? { paymentStatus: "unpaid" as const } : {}),
    });
    await codings.replace(business.id, created.id, [{ headingId: heading.id, amount: "50.00" }], at);
    return created;
  };
  await document("failed-document", "failed");
  const dependencies = { tenancyRepository: tenancy, documentRepository: documents, invoices, headings, codings, money };
  return { dependencies, jobs, invoices, draft: await invoice("draft", false), approved: await invoice("approved", true) };
}

beforeEach(() => {
  denied.clear();
  checked.splice(0);
});

describe("invoice finance capabilities", () => {
  it("requires read_finance to read an invoice, its coding and its review", async () => {
    const { dependencies, draft } = await fixture();
    denied.add("read_finance");

    await expect(getInvoice(draft.id, owner, dependencies)).rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });
    await expect(getInvoiceCoding(draft.id, owner, dependencies)).rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });
    await expect(getInvoiceWithCoding(draft.id, owner, dependencies)).rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });
    await expect(getInvoiceReview(draft.id, owner, dependencies)).rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });
    expect(checked).toContain("read_finance");
  });

  it("requires edit_finance to save an invoice draft and leaves it unchanged", async () => {
    const { dependencies, invoices, draft } = await fixture();
    denied.add("edit_finance");

    await expect(updateInvoice(draft.id, owner, { notes: "changed" }, dependencies)).rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });
    await expect(updateInvoiceDraft({ invoiceId: draft.id, fields: { notes: "changed" }, coding: [] }, owner, dependencies)).rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });
    expect(checked).toContain("edit_finance");
    await expect(invoices.findById(draft.id)).resolves.toEqual(draft);
    await expect(dependencies.codings.list(draft.businessId, draft.id)).resolves.toHaveLength(1);
  });

  it("still saves a draft for a member who holds edit_finance", async () => {
    const { dependencies, draft } = await fixture();

    await expect(updateInvoice(draft.id, owner, { notes: "changed" }, dependencies)).resolves.toMatchObject({ notes: "changed" });
    expect(checked).toEqual(expect.arrayContaining(["read_finance", "edit_finance"]));
  });

  it("requires edit_finance to change a payment or void an approved invoice", async () => {
    const { dependencies, invoices, approved } = await fixture();
    denied.add("edit_finance");

    await expect(changeInvoicePayment(approved.id, owner, { status: "paid_privately" }, dependencies)).rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });
    await expect(voidInvoice(approved.id, owner, dependencies)).rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });
    await expect(invoices.findById(approved.id)).resolves.toEqual(approved);
  });

  it("requires edit_finance to fill a failed reading in by hand", async () => {
    const { dependencies, jobs, invoices } = await fixture();
    denied.add("edit_finance");

    await expect(createManualInvoice("failed-document" as DocumentId, owner, { ...dependencies, jobs })).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });
    expect(checked).toContain("edit_finance");
    await expect(invoices.findByDocumentId("failed-document" as DocumentId)).resolves.toBeNull();
    await expect(dependencies.documentRepository.getStatus("failed-document")).resolves.toBe("failed");

    denied.clear();
    await expect(createManualInvoice("failed-document" as DocumentId, owner, { ...dependencies, jobs })).resolves.toEqual(expect.any(String));
  });
});
