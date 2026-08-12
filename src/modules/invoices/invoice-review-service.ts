import { createInvoiceRepository, getInvoice, approveInvoice as approveTask8Invoice, updateInvoice, InvoiceError, INVOICE_ERROR_CODES, resolveDefaultDocumentRepository, type Invoice, type InvoiceDependencies, type InvoiceRepository } from "./invoice-service";
import type { InvoiceId } from "./ocr-provider";
import type { Document } from "../documents/document-service";
import type { BusinessId } from "../tenancy/types";
import { defaultOnboardingRepository, resolveOnboardingActor, type OnboardingActor } from "../tenancy/business-service";
import { BusinessLifecycleError, requireBusinessOperational } from "../tenancy/business-lifecycle-service";
import { AuthorizationError, requireCapability } from "../permissions/authorize";
import { createTenantContext } from "../tenancy/tenant-context";

export type InvoiceReviewDependencies = InvoiceDependencies;
export type DraftFieldPatch = Partial<Pick<Invoice, "supplier" | "invoiceNumber" | "invoiceDate" | "dueDate" | "subtotal" | "taxAmount" | "total" | "currencyReference" | "expenseCategoryReference" | "notes">>;

export interface UpdateInvoiceDraftInput {
  invoiceId: InvoiceId;
  fields?: DraftFieldPatch;
  [field: string]: unknown;
}

export interface InvoiceReview {
  invoice: Invoice;
  document: Omit<Document, "privateObjectKey">;
  documentDownloadUrl: string;
}

export type InvoiceListItem = Invoice & { documentStatus: Document["status"] };

const INVOICE_REPOSITORY_KEY = Symbol.for("ledgerharbour.task8.inMemoryInvoiceRepository");
type GlobalState = typeof globalThis & { [key: symbol]: unknown };

function defaultInvoiceRepository(): InvoiceRepository {
  const state = globalThis as GlobalState;
  const existing = state[INVOICE_REPOSITORY_KEY] as InvoiceRepository | undefined;
  if (existing && typeof existing.findById === "function" && typeof existing.listByBusinessId === "function") return existing;
  const repository = createInvoiceRepository();
  Object.defineProperty(state, INVOICE_REPOSITORY_KEY, { configurable: false, enumerable: false, writable: false, value: repository });
  return repository;
}

export const INVOICE_REVIEW_ERROR_CODES = {
  BUSINESS_ACCESS_DENIED: "BUSINESS_ACCESS_DENIED",
  INACTIVE_BUSINESS: "INACTIVE_BUSINESS",
} as const;

function fieldsFrom(input: UpdateInvoiceDraftInput): DraftFieldPatch {
  if (input.fields && typeof input.fields === "object") return input.fields;
  const fields = { ...input } as Record<string, unknown>;
  Reflect.deleteProperty(fields, "invoiceId");
  Reflect.deleteProperty(fields, "fields");
  return fields as DraftFieldPatch;
}

export async function updateInvoiceDraft(input: UpdateInvoiceDraftInput, actor: OnboardingActor, dependencies: InvoiceReviewDependencies = {}): Promise<Invoice> {
  return updateInvoice(input.invoiceId, actor, fieldsFrom(input), dependencies);
}

export async function approveInvoice(invoiceId: InvoiceId, actor: OnboardingActor, dependencies: InvoiceReviewDependencies = {}): Promise<Invoice> {
  return approveTask8Invoice(invoiceId, actor, dependencies);
}

export async function getInvoiceReview(invoiceId: InvoiceId, actor: OnboardingActor, dependencies: InvoiceReviewDependencies = {}): Promise<InvoiceReview> {
  const invoice = await getInvoice(invoiceId, actor, dependencies);
  const document = await (dependencies.documentRepository ?? resolveDefaultDocumentRepository()).findById(invoice.documentId);
  if (!document) {
    throw new InvoiceError(INVOICE_ERROR_CODES.DOCUMENT_NOT_FOUND);
  }
  const safeDocument = { ...document };
  Reflect.deleteProperty(safeDocument, "privateObjectKey");
  return { invoice, document: safeDocument, documentDownloadUrl: `/api/documents/${document.id}/download` };
}

export async function listInvoices(businessId: BusinessId, actor: OnboardingActor, dependencies: InvoiceReviewDependencies = {}): Promise<InvoiceListItem[]> {
  const tenancy = dependencies.tenancyRepository ?? defaultOnboardingRepository;
  const invoices = dependencies.invoices ?? defaultInvoiceRepository();
  const actorId = await resolveOnboardingActor(tenancy, actor);
  try {
    await requireBusinessOperational(tenancy, businessId);
    const membership = await createTenantContext(tenancy).getMembership(actorId, businessId);
    requireCapability(membership!, "read_finance");
    const values = await invoices.listByBusinessId(businessId);
    const result: InvoiceListItem[] = [];
    for (const invoice of values) {
      try {
        const visibleInvoice = await getInvoice(invoice.id, actorId, dependencies);
        const document = await (dependencies.documentRepository ?? resolveDefaultDocumentRepository()).findById(visibleInvoice.documentId);
        if (document) result.push({ ...visibleInvoice, documentStatus: document.status });
      } catch {
        // A broken document link is not returned as an invoice review row.
      }
    }
    return result;
  } catch (error) {
    if (error instanceof BusinessLifecycleError || error instanceof AuthorizationError) throw error;
    throw error;
  }
}
