import { describe, expect, it } from "vitest";

import { can, requireCapability } from "../../src/modules/permissions/authorize";
import { createBusinessLifecycleService } from "../../src/modules/tenancy/business-lifecycle-service";
import {
  createInMemoryOnboardingRepository,
} from "../../src/modules/tenancy/business-service";
import { createCategory } from "../../src/modules/accounting/category-service";
import { createCurrencyRepository, setCurrency } from "../../src/modules/accounting/currency-service";
import { createInvoiceRepository, approveInvoice, type Invoice } from "../../src/modules/invoices/invoice-service";
import { createDocumentRepository, type Document } from "../../src/modules/documents/document-service";
import { createMembershipService } from "../../src/modules/tenancy/membership-service";
import type { BusinessId, Membership, UserId } from "../../src/modules/tenancy/types";
import type { DocumentId, InvoiceId } from "../../src/modules/invoices/ocr-provider";
import { createApprovedBusiness } from "../helpers/business-fixtures";

const user = (value: string) => value as UserId;
const business = (value: string) => value as BusinessId;

function membership(userId: string, businessId: BusinessId, role: Membership["role"]): Membership {
  return { membershipId: `membership-${userId}`, userId: user(userId), businessId, role, isActive: true, status: "active" };
}

async function fixture() {
  const repository = createInMemoryOnboardingRepository();
  const business = await createApprovedBusiness(repository, "Permission Harbour", user("owner"));
  const general = membership("general", business.id, "general_admin");
  const administrator = membership("administrator", business.id, "administrator");
  repository.memberships.push(general, administrator);
  const owner = repository.memberships.find((candidate) => candidate.userId === user("owner"))!;
  return { repository, business, owner, general, administrator };
}

describe("Task 11 permission escalation matrix", () => {
  it("keeps finance and administrative capabilities separated by role", () => {
    expect(can("owner_admin", "read_finance")).toBe(true);
    expect(can("general_admin", "edit_finance")).toBe(true);
    expect(can("administrator", "read_finance")).toBe(true);
    expect(can("administrator", "approve_administrator")).toBe(false);
    expect(can("general_admin", "manage_general_admin")).toBe(false);
    expect(can("general_admin", "transfer_ownership")).toBe(false);
    expect(can("administrator", "deactivate_business")).toBe(false);
  });

  it("rejects inactive and unauthorized capability assertions server-side", () => {
    expect(() => requireCapability(membership("administrator", business("business"), "administrator"), "approve_administrator"))
      .toThrowError(expect.objectContaining({ code: "CAPABILITY_REQUIRED" }));
    expect(() => requireCapability({ ...membership("administrator", business("business"), "administrator"), isActive: false }, "read_finance"))
      .toThrowError(expect.objectContaining({ code: "MEMBERSHIP_REQUIRED" }));
  });

  it("allows only Owner Admin to transfer ownership and change lifecycle", async () => {
    const { repository, business, general, administrator } = await fixture();
    const membershipService = createMembershipService(repository);
    const lifecycleService = createBusinessLifecycleService(repository);
    const confirmation = { confirmationName: business.name, reauthenticatedAt: new Date().toISOString() };

    await expect(membershipService.transferOwnership({ businessId: business.id, targetMembershipId: administrator.membershipId, ...confirmation }, user("general")))
      .rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });
    await expect(lifecycleService.deactivateBusiness(business.id, user("general"), business.name))
      .rejects.toMatchObject({ code: "PLATFORM_ADMIN_REQUIRED" });
    await expect(lifecycleService.deactivateBusiness(business.id, user("administrator"), business.name))
      .rejects.toMatchObject({ code: "PLATFORM_ADMIN_REQUIRED" });

    await membershipService.transferOwnership({ businessId: business.id, targetMembershipId: general.membershipId, ...confirmation }, user("owner"));
    expect(repository.memberships.find((candidate) => candidate.userId === user("general"))?.role).toBe("owner_admin");
    expect(repository.memberships.find((candidate) => candidate.userId === user("owner"))?.role).toBe("administrator");
  });

  it("prevents General Admin from managing General Admin and prevents Administrator removal of members", async () => {
    const { repository, business, owner, general, administrator } = await fixture();
    const service = createMembershipService(repository);

    await expect(service.removeAdministrator({ businessId: business.id, membershipId: general.membershipId }, user("general")))
      .rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });
    await expect(service.removeAdministrator({ businessId: business.id, membershipId: administrator.membershipId }, user("administrator")))
      .rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });
    await expect(service.removeAdministrator({ businessId: business.id, membershipId: owner.membershipId }, user("general")))
      .rejects.toMatchObject({ code: "OWNER_PROTECTED" });
  });

  it("allows a real finance mutation and rejects an actor outside the business", async () => {
    const { repository, business } = await fixture();
    const currencies = createCurrencyRepository();
    await expect(setCurrency({ businessId: business.id, name: "Task Currency", symbol: "TC", isoCode: "TCK", decimalCount: 2 }, user("general"), { tenancyRepository: repository, currencies }))
      .resolves.toMatchObject({ businessId: business.id, name: "Task Currency", isoCode: "TCK", isActive: true });
    await expect(setCurrency({ businessId: business.id, name: "Outside Currency", symbol: "OC", isoCode: "OUT", decimalCount: 2 }, user("outsider"), { tenancyRepository: repository, currencies }))
      .rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });
  });

  it("covers positive and negative real member mutations", async () => {
    const first = await fixture();
    const firstService = createMembershipService(first.repository);
    await expect(firstService.setGeneralAdmin({ businessId: first.business.id, membershipId: first.administrator.membershipId }, user("owner")))
      .resolves.toMatchObject({ userId: user("administrator"), role: "general_admin" });
    expect(first.repository.memberships.find((candidate) => candidate.userId === user("administrator"))?.role).toBe("general_admin");
    await expect(firstService.setGeneralAdmin({ businessId: first.business.id, membershipId: first.general.membershipId }, user("general")))
      .rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });

    const second = await fixture();
    const secondService = createMembershipService(second.repository);
    await expect(secondService.removeAdministrator({ businessId: second.business.id, membershipId: second.administrator.membershipId }, user("general")))
      .resolves.toBeUndefined();
    expect(second.repository.memberships.some((candidate) => candidate.userId === user("administrator"))).toBe(false);
  });

  it("keeps category mutation and invoice approval behind finance capabilities", async () => {
    const { repository, business } = await fixture();
    await expect(createCategory({ businessId: business.id, name: "Allowed" }, user("administrator"), { tenancyRepository: repository }))
      .resolves.toMatchObject({ businessId: business.id, name: "Allowed" });

    const documents = createDocumentRepository();
    const invoices = createInvoiceRepository();
    const document: Document = {
      id: "permission-document",
      businessId: business.id,
      uploaderId: user("administrator"),
      privateObjectKey: "private/permission-document",
      originalFileName: "invoice.pdf",
      originalMimeType: "application/pdf",
      originalSizeBytes: 4,
      checksum: "permission-checksum",
      status: "needs_review",
      createdAt: new Date().toISOString(),
    };
    await documents.create(document);
    const invoice: Invoice = {
      id: "permission-invoice" as InvoiceId,
      businessId: business.id,
      documentId: document.id as DocumentId,
      supplier: "Supplier",
      invoiceNumber: "PERMISSION-1",
      invoiceDate: "2026-08-11",
      dueDate: null,
      subtotal: "10.00",
      taxAmount: "2.00",
      total: "12.00",
      currencyReference: "GBP",
      expenseCategoryReference: null,
      notes: null,
      confidenceData: Object.fromEntries(["supplier", "invoiceNumber", "invoiceDate", "dueDate", "subtotal", "taxAmount", "total", "currencyReference", "expenseCategoryReference", "notes"].map((key) => [key, 1])) as Invoice["confidenceData"],
      reviewState: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await invoices.create(invoice);
    const dependencies = { tenancyRepository: repository, documentRepository: documents, invoices };
    await expect(approveInvoice(invoice.id, user("administrator"), dependencies)).resolves.toMatchObject({ reviewState: "approved" });
  });
});
