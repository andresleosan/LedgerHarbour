import { requireCapability } from "../permissions/authorize";
import type { Document, DocumentRepository } from "../documents/document-service";
import { resolveDefaultDocumentRepository } from "../invoices/invoice-service";
import type { InvoiceRepository } from "../invoices/invoice-service";
import { resolveDefaultInvoiceRepository } from "../invoices/invoice-service";
import {
  defaultOnboardingRepository,
  resolveOnboardingActor,
  type OnboardingActor,
  type OnboardingRepository,
  type Business,
} from "./business-service";
import { requireBusinessOperational } from "./business-lifecycle-service";
import { createTenantContext } from "./tenant-context";
import type { BusinessId } from "./types";
import type { MembershipRole } from "../permissions/roles";

export interface BusinessSummary {
  id: BusinessId;
  name: string;
  isActive: boolean;
  role: MembershipRole;
}

export interface RecentUpload {
  id: string;
  originalFileName: string;
  status: Document["status"];
  createdAt: string;
}

export interface DashboardSummary {
  business: BusinessSummary;
  documentCount: number;
  invoicesNeedingReview: number;
  recentUploads: readonly RecentUpload[];
}

export interface PortfolioDependencies {
  tenancyRepository?: OnboardingRepository;
  documentRepository?: DocumentRepository;
  invoiceRepository?: InvoiceRepository;
}

function businessSummary(business: Business, role: MembershipRole): BusinessSummary {
  return {
    id: business.id,
    name: business.name,
    isActive: business.isActive,
    role,
  };
}

function repositoryFor(dependencies: PortfolioDependencies = {}) {
  return {
    tenancy: dependencies.tenancyRepository ?? defaultOnboardingRepository,
    documents: dependencies.documentRepository,
    invoices: dependencies.invoiceRepository,
  };
}

export async function listUserBusinesses(
  actor: OnboardingActor,
  dependencies: PortfolioDependencies = {},
  includeInactive = false,
): Promise<BusinessSummary[]> {
  const { tenancy } = repositoryFor(dependencies);
  const userId = await resolveOnboardingActor(tenancy, actor);
  const entries = await tenancy.listBusinessesForUser(userId);
  return entries
    .filter(({ business }) => includeInactive || (business.status === "active" && business.isActive))
    .map(({ business, membership }) => businessSummary(business, membership.role));
}

export async function getBusinessDashboard(
  businessId: BusinessId,
  actor: OnboardingActor,
  dependencies: PortfolioDependencies = {},
): Promise<DashboardSummary> {
  const { tenancy, documents, invoices } = repositoryFor(dependencies);
  const userId = await resolveOnboardingActor(tenancy, actor);
  const membership = await createTenantContext(tenancy).requireBusinessAccess(userId, businessId);
  requireCapability(membership, "read_finance");
  const business = await requireBusinessOperational(tenancy, businessId);
  const summary = businessSummary(business, membership.role);
  const tenantDocuments = await (documents ?? resolveDefaultDocumentRepository()).listByBusinessId(businessId);
  const tenantInvoices = await (invoices ?? resolveDefaultInvoiceRepository()).listByBusinessId(businessId);

  return {
    business: summary,
    documentCount: tenantDocuments.length,
    invoicesNeedingReview: tenantInvoices.filter((invoice) => invoice.reviewState === "needs_review").length,
    recentUploads: tenantDocuments
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 5)
      .map(({ id, originalFileName, status, createdAt }) => ({ id, originalFileName, status, createdAt })),
  };
}
