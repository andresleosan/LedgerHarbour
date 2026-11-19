import { requireCapability } from "../permissions/authorize";
import { resolveDefaultDocumentRepository, resolveDefaultInvoiceRepository, type InvoiceRepository } from "../invoices/invoice-service";
import type { DocumentId } from "../invoices/ocr-provider";
import { MAX_RETRY_COUNT, resolveDefaultJobRepository, type JobRepository } from "../jobs/job-service";
import { requireBusinessOperational } from "../tenancy/business-lifecycle-service";
import { defaultOnboardingRepository, resolveOnboardingActor, type OnboardingActor, type OnboardingRepository } from "../tenancy/business-service";
import { createTenantContext } from "../tenancy/tenant-context";
import type { BusinessId } from "../tenancy/types";
import { mapBoundaryError, toSafeDocument, type DocumentRepository, type SafeDocumentDto } from "./document-service";

export interface DocumentListItem extends SafeDocumentDto {
  invoiceId: string | null;
  canRetry: boolean;
}

export interface DocumentListDependencies {
  tenancyRepository?: OnboardingRepository;
  documentRepository?: DocumentRepository;
  invoices?: InvoiceRepository;
  jobs?: JobRepository;
}

export async function listDocuments(businessId: BusinessId, actor: OnboardingActor, dependencies: DocumentListDependencies = {}): Promise<DocumentListItem[]> {
  const tenancy = dependencies.tenancyRepository ?? defaultOnboardingRepository;
  const documents = dependencies.documentRepository ?? resolveDefaultDocumentRepository();
  const invoices = dependencies.invoices ?? resolveDefaultInvoiceRepository();
  const jobs = dependencies.jobs ?? resolveDefaultJobRepository();
  const actorId = await resolveOnboardingActor(tenancy, actor);
  try {
    const membership = await createTenantContext(tenancy).requireBusinessAccess(actorId, businessId);
    requireCapability(membership, "read_finance");
    await requireBusinessOperational(tenancy, businessId);
  } catch (error) {
    throw mapBoundaryError(error);
  }

  const rows = await documents.listByBusinessId(businessId);
  rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return Promise.all(rows.map(async (document) => {
    const [invoice, job] = await Promise.all([
      invoices.findByDocumentId(document.id as DocumentId),
      jobs.findByDocumentId(document.id as DocumentId),
    ]);
    return {
      ...toSafeDocument(document),
      invoiceId: invoice?.id ?? null,
      canRetry: document.status === "failed" && !invoice && (job?.retryCount ?? 0) < MAX_RETRY_COUNT,
    };
  }));
}
