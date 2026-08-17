import { describe, expect, it } from "vitest";

import {
  createInMemoryOnboardingRepository,
  type Business,
} from "../../../src/modules/tenancy/business-service";
import {
  createDocumentRepository,
  type Document,
} from "../../../src/modules/documents/document-service";
import {
  createInvoiceRepository,
  type Invoice,
} from "../../../src/modules/invoices/invoice-service";
import {
  getBusinessDashboard,
  listUserBusinesses,
} from "../../../src/modules/tenancy/portfolio-service";
import type { BusinessId, UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const user = (value: string) => value as UserId;
const business = (value: string) => value as BusinessId;

function documentFor(
  businessId: BusinessId,
  id: string,
  createdAt: string,
): Document {
  return {
    id,
    businessId,
    uploaderId: user("portfolio-user"),
    privateObjectKey: `private/${id}`,
    originalFileName: `${id}.pdf`,
    originalMimeType: "application/pdf",
    originalSizeBytes: 100,
    checksum: `checksum-${id}`,
    status: "uploaded",
    createdAt,
  };
}

function invoiceFor(
  businessId: BusinessId,
  id: string,
  documentId: string,
  reviewState: Invoice["reviewState"],
): Invoice {
  return {
    id: id as Invoice["id"],
    businessId,
    documentId: documentId as Invoice["documentId"],
    supplier: "Supplier",
    invoiceNumber: id,
    invoiceDate: "2026-08-01",
    dueDate: null,
    subtotal: "10.00",
    taxAmount: "2.00",
    total: "12.00",
    currencyReference: "GBP",
    expenseCategoryReference: null,
    notes: null,
    confidenceData: {
      supplier: 1,
      invoiceNumber: 1,
      invoiceDate: 1,
      dueDate: 1,
      subtotal: 1,
      taxAmount: 1,
      total: 1,
      currencyReference: 1,
      expenseCategoryReference: 1,
      notes: 1,
    },
    reviewState,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

async function createBusiness(
  name: string,
  actorId: UserId,
): Promise<{ business: Business; repository: ReturnType<typeof createInMemoryOnboardingRepository> }> {
  const repository = createInMemoryOnboardingRepository();
  const business = await createApprovedBusiness(repository, name, actorId);
  return { business, repository };
}

describe("portfolio tenant boundary", () => {
  it("lists only active memberships and preserves the real role, including inactive businesses", async () => {
    const repository = createInMemoryOnboardingRepository();
    const actorId = user("portfolio-user");
    const active = await createApprovedBusiness(repository, "Active Books", actorId);
    const inactive = await createApprovedBusiness(repository, "Closed Books", actorId);
    inactive.isActive = false;
    repository.businesses.get(inactive.id)!.isActive = false;
    repository.memberships.push({
      membershipId: "membership-other-user",
      userId: user("other-user"),
      businessId: active.id,
      role: "administrator",
      isActive: true,
    });
    repository.memberships.push({
      membershipId: "membership-hidden-business",
      userId: actorId,
      businessId: business("hidden-business"),
      role: "general_admin",
      isActive: false,
    });

    await expect(listUserBusinesses(actorId, { tenancyRepository: repository })).resolves.toEqual([
      { id: active.id, name: "Active Books", isActive: true, role: "owner_admin" },
      { id: inactive.id, name: "Closed Books", isActive: false, role: "owner_admin" },
    ]);
  });

  it("resolves an AuthIdentity to the local user before listing businesses", async () => {
    const repository = createInMemoryOnboardingRepository();
    const identity = {
      providerUserId: "provider-portfolio-user",
      email: "portfolio@example.com",
      displayName: "Portfolio User",
      emailVerified: true,
    };
    const created = await createApprovedBusiness(repository, "Identity Books", identity);

    await expect(listUserBusinesses(identity, { tenancyRepository: repository })).resolves.toEqual([
      { id: created.id, name: "Identity Books", isActive: true, role: "owner_admin" },
    ]);
  });

  it("rejects cross-tenant and inactive-business dashboard access", async () => {
    const repository = createInMemoryOnboardingRepository();
    const actorId = user("portfolio-user");
    const otherUser = user("other-user");
    const owned = await createApprovedBusiness(repository, "Owned Books", actorId);
    const other = await createApprovedBusiness(repository, "Other Books", otherUser);
    const documents = createDocumentRepository();
    const invoices = createInvoiceRepository();

    await expect(
      getBusinessDashboard(other.id, actorId, {
        tenancyRepository: repository,
        documentRepository: documents,
        invoiceRepository: invoices,
      }),
    ).rejects.toMatchObject({ message: "Business access denied" });

    repository.businesses.get(owned.id)!.isActive = false;
    await expect(
      getBusinessDashboard(owned.id, actorId, {
        tenancyRepository: repository,
        documentRepository: documents,
        invoiceRepository: invoices,
      }),
    ).rejects.toMatchObject({ message: "Business access denied" });
  });

  it("resolves an AuthIdentity to the local user before loading a dashboard", async () => {
    const repository = createInMemoryOnboardingRepository();
    const identity = {
      providerUserId: "provider-dashboard-user",
      email: "dashboard@example.com",
      displayName: "Dashboard User",
      emailVerified: true,
    };
    const business = await createApprovedBusiness(repository, "Identity Dashboard", identity);

    await expect(getBusinessDashboard(business.id, identity, {
      tenancyRepository: repository,
      documentRepository: createDocumentRepository(),
      invoiceRepository: createInvoiceRepository(),
    })).resolves.toMatchObject({ business: { id: business.id, role: "owner_admin" } });
  });

  it("counts and orders only the requested tenant and returns a safe five-upload window", async () => {
    const actorId = user("portfolio-user");
    const otherUser = user("other-user");
    const { business: owned, repository } = await createBusiness("Owned Books", actorId);
    const other = await createApprovedBusiness(repository, "Other Books", otherUser);
    const documents = createDocumentRepository();
    const invoices = createInvoiceRepository();

    for (let index = 0; index < 6; index += 1) {
      const id = `owned-document-${index}`;
      await documents.create(documentFor(owned.id, id, `2026-08-0${index + 1}T00:00:00.000Z`));
    }
    await documents.create(documentFor(other.id, "other-document", "2026-08-20T00:00:00.000Z"));
    await invoices.create(invoiceFor(owned.id, "owned-review", "owned-document-1", "needs_review"));
    await invoices.create(invoiceFor(owned.id, "owned-approved", "owned-document-2", "approved"));
    await invoices.create(invoiceFor(other.id, "other-review", "other-document", "needs_review"));

    const dashboard = await getBusinessDashboard(owned.id, actorId, {
      tenancyRepository: repository,
      documentRepository: documents,
      invoiceRepository: invoices,
    });

    expect(dashboard.business).toEqual({
      id: owned.id,
      name: "Owned Books",
      isActive: true,
      role: "owner_admin",
    });
    expect(dashboard.documentCount).toBe(6);
    expect(dashboard.invoicesNeedingReview).toBe(1);
    expect(dashboard.recentUploads.map((upload) => upload.id)).toEqual([
      "owned-document-5",
      "owned-document-4",
      "owned-document-3",
      "owned-document-2",
      "owned-document-1",
    ]);
    expect(dashboard.recentUploads).not.toSatisfy((uploads: readonly { privateObjectKey?: string }[]) =>
      uploads.some((upload) => "privateObjectKey" in upload),
    );
    expect(JSON.stringify(dashboard)).not.toContain("private/");
    expect(JSON.stringify(dashboard)).not.toMatch(/total|balance|amount/i);
  });

  it("uses async tenant queries without requiring repository maps", async () => {
    const actorId = user("portfolio-user");
    const { business: owned, repository } = await createBusiness("Async Portfolio", actorId);
    const documents = createDocumentRepository();
    const invoices = createInvoiceRepository();
    const documentQueries = Object.create(documents) as typeof documents;
    const invoiceQueries = Object.create(invoices) as typeof invoices;
    Object.defineProperty(documentQueries, "listByBusinessId", { value: async () => [] });
    Object.defineProperty(invoiceQueries, "listByBusinessId", { value: async () => [] });

    await expect(getBusinessDashboard(owned.id, actorId, {
      tenancyRepository: repository,
      documentRepository: documentQueries,
      invoiceRepository: invoiceQueries,
    })).resolves.toMatchObject({
      documentCount: 0,
      invoicesNeedingReview: 0,
      recentUploads: [],
    });
  });
});
