import { randomUUID } from "node:crypto";

import {
  defaultOnboardingRepository,
  resolveOnboardingActor,
  type OnboardingActor,
  type OnboardingRepository,
} from "../tenancy/business-service";
import { BusinessLifecycleError, LIFECYCLE_ERROR_CODES, requireBusinessOperational } from "../tenancy/business-lifecycle-service";
import { AuthorizationError, requireCapability } from "../permissions/authorize";
import { createTenantContext } from "../tenancy/tenant-context";
import type { BusinessId, UserId } from "../tenancy/types";
import {
  INVOICE_PARSER_ERROR_CODES,
  type InvoiceDraft,
  parseInvoice,
} from "./invoice-parser";
import type { DocumentId, InvoiceId, OcrResult } from "./ocr-provider";
export type { InvoiceId } from "./ocr-provider";
import type { Document, DocumentRepository } from "../documents/document-service";
import { createDocumentRepository } from "../documents/document-service";
import type { StorageAdapter } from "../documents/storage-adapter";
import { createStorageAdapter } from "../documents/storage-factory";

export const INVOICE_ERROR_CODES = {
  INVOICE_NOT_FOUND: "INVOICE_NOT_FOUND",
  DOCUMENT_NOT_FOUND: "DOCUMENT_NOT_FOUND",
  BUSINESS_ACCESS_DENIED: "BUSINESS_ACCESS_DENIED",
  INACTIVE_BUSINESS: "INACTIVE_BUSINESS",
  INSUFFICIENT_CAPABILITY: "INSUFFICIENT_CAPABILITY",
  INVALID_INVOICE: "INVALID_INVOICE",
  INVALID_FOR_APPROVAL: "INVOICE_INVALID_FOR_APPROVAL",
  INVALID_STATE: "INVALID_INVOICE_STATE",
  REPOSITORY_CONFLICT: "INVOICE_REPOSITORY_CONFLICT",
} as const;

export type InvoiceErrorCode = (typeof INVOICE_ERROR_CODES)[keyof typeof INVOICE_ERROR_CODES];

const publicMessages: Record<InvoiceErrorCode, string> = {
  INVOICE_NOT_FOUND: "Invoice not found.",
  DOCUMENT_NOT_FOUND: "Document not found.",
  BUSINESS_ACCESS_DENIED: "Business access denied.",
  INACTIVE_BUSINESS: "This business is inactive.",
  INSUFFICIENT_CAPABILITY: "You do not have permission to update this invoice.",
  INVALID_INVOICE: "The invoice draft is not valid.",
  INVOICE_INVALID_FOR_APPROVAL: "The invoice draft is not valid for approval.",
  INVALID_INVOICE_STATE: "The invoice is not in a reviewable state.",
  INVOICE_REPOSITORY_CONFLICT: "The invoice changed elsewhere.",
};

export class InvoiceError extends Error {
  readonly name = "InvoiceError";

  constructor(readonly code: InvoiceErrorCode) {
    super(publicMessages[code]);
  }
}

export interface Invoice extends InvoiceDraft {
  id: InvoiceId;
  businessId: BusinessId;
  documentId: DocumentId;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceRepository {
  transaction<T>(operation: () => Promise<T>): Promise<T>;
  create(invoice: Invoice): Promise<Invoice>;
  findById(invoiceId: InvoiceId): Promise<Invoice | null>;
  findByDocumentId(documentId: DocumentId): Promise<Invoice | null>;
  hasCurrencyReference(businessId: BusinessId, reference: string): Promise<boolean>;
  update(invoice: Invoice): Promise<Invoice>;
  updateIfUnchanged(invoice: Invoice, expectedReviewState: InvoiceDraft["reviewState"], expectedUpdatedAt: string): Promise<Invoice>;
  listByBusinessId(businessId: BusinessId): Promise<Invoice[]>;
}

export interface InMemoryInvoiceRepository extends InvoiceRepository {
  readonly invoices: Map<string, Invoice>;
}

class MemoryInvoiceRepository implements InMemoryInvoiceRepository {
  readonly invoices = new Map<string, Invoice>();
  private writeTail: Promise<void> = Promise.resolve();


  async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeTail;
    let release!: () => void;
    this.writeTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const snapshot = new Map([...this.invoices].map(([id, invoice]) => [id, { ...invoice, confidenceData: { ...invoice.confidenceData } }]));
    try {
      return await operation();
    } catch (error) {
      this.invoices.clear();
      snapshot.forEach((invoice, id) => this.invoices.set(id, invoice));
      throw error;
    } finally {
      release();
    }
  }

  async create(invoice: Invoice): Promise<Invoice> {
    if (this.invoices.has(invoice.id) || [...this.invoices.values()].some((candidate) => candidate.documentId === invoice.documentId)) {
      throw new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
    }
    this.invoices.set(invoice.id, { ...invoice, confidenceData: { ...invoice.confidenceData } });
    return { ...invoice, confidenceData: { ...invoice.confidenceData } };
  }

  async findById(invoiceId: InvoiceId): Promise<Invoice | null> {
    const invoice = this.invoices.get(invoiceId);
    return invoice ? { ...invoice, confidenceData: { ...invoice.confidenceData } } : null;
  }

  async findByDocumentId(documentId: DocumentId): Promise<Invoice | null> {
    const invoice = [...this.invoices.values()].find((candidate) => candidate.documentId === documentId);
    return invoice ? { ...invoice, confidenceData: { ...invoice.confidenceData } } : null;
  }

  async hasCurrencyReference(businessId: BusinessId, reference: string): Promise<boolean> {
    return [...this.invoices.values()].some((invoice) => invoice.businessId === businessId && invoice.currencyReference === reference);
  }

  async update(invoice: Invoice): Promise<Invoice> {
    if (!this.invoices.has(invoice.id)) throw new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
    this.invoices.set(invoice.id, { ...invoice, confidenceData: { ...invoice.confidenceData } });
    return { ...invoice, confidenceData: { ...invoice.confidenceData } };
  }

  async updateIfUnchanged(invoice: Invoice, expectedReviewState: InvoiceDraft["reviewState"], expectedUpdatedAt: string): Promise<Invoice> {
    const current = this.invoices.get(invoice.id);
    if (!current || current.reviewState !== expectedReviewState || current.updatedAt !== expectedUpdatedAt) {
      throw new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
    }
    this.invoices.set(invoice.id, { ...invoice, confidenceData: { ...invoice.confidenceData } });
    return { ...invoice, confidenceData: { ...invoice.confidenceData } };
  }

  async listByBusinessId(businessId: BusinessId): Promise<Invoice[]> {
    return [...this.invoices!.values()]
      .filter((invoice) => invoice.businessId === businessId)
      .map((invoice) => ({ ...invoice, confidenceData: { ...invoice.confidenceData } }));
  }
}

export function createInvoiceRepository(): InMemoryInvoiceRepository {
  return new MemoryInvoiceRepository();
}

const INVOICE_REPOSITORY_KEY = Symbol.for("ledgerharbour.task8.inMemoryInvoiceRepository");
const DOCUMENT_REPOSITORY_KEY = Symbol.for("ledgerharbour.task7.inMemoryDocumentRepository");
const STORAGE_KEY = Symbol.for("ledgerharbour.task7.localPrivateStorage");
type GlobalState = typeof globalThis & { [key: symbol]: unknown };

function isDocumentRepository(value: unknown): value is DocumentRepository {
  const candidate = value as Partial<DocumentRepository>;
  return Boolean(candidate && typeof candidate.findById === "function" && typeof candidate.getStatus === "function" && typeof candidate.setStatus === "function" && typeof candidate.listByBusinessId === "function");
}

export function resolveDefaultDocumentRepository(): DocumentRepository {
  const state = globalThis as GlobalState;
  if (isDocumentRepository(state[DOCUMENT_REPOSITORY_KEY])) return state[DOCUMENT_REPOSITORY_KEY];
  const repository = createDocumentRepository();
  Object.defineProperty(state, DOCUMENT_REPOSITORY_KEY, { configurable: false, enumerable: false, writable: false, value: repository });
  return repository;
}

function isStorageAdapter(value: unknown): value is StorageAdapter {
  const candidate = value as Partial<StorageAdapter>;
  return Boolean(candidate && typeof candidate.get === "function" && typeof candidate.put === "function");
}

export function resolveDefaultStorage(): StorageAdapter {
  const state = globalThis as GlobalState;
  if (isStorageAdapter(state[STORAGE_KEY])) return state[STORAGE_KEY];
  const storage = createStorageAdapter();
  Object.defineProperty(state, STORAGE_KEY, { configurable: false, enumerable: false, writable: false, value: storage });
  return storage;
}

export function resolveDefaultInvoiceRepository(): InvoiceRepository {
  const state = globalThis as GlobalState;
  const existing = state[INVOICE_REPOSITORY_KEY] as InvoiceRepository | undefined;
  if (existing && typeof existing.findById === "function" && typeof existing.listByBusinessId === "function") return existing;
   const repository = createInvoiceRepository();
  Object.defineProperty(state, INVOICE_REPOSITORY_KEY, { configurable: false, enumerable: false, writable: false, value: repository });
  return repository;
}

export interface InvoiceDependencies {
  tenancyRepository?: OnboardingRepository;
  documentRepository?: DocumentRepository;
  invoices?: InvoiceRepository;
  transaction?: <T>(operation: (tenancyRepository: OnboardingRepository) => Promise<T>) => Promise<T>;
}

function dependencies(input: InvoiceDependencies = {}) {
  return {
    tenancyRepository: input.tenancyRepository ?? defaultOnboardingRepository,
    documentRepository: input.documentRepository ?? resolveDefaultDocumentRepository(),
    invoices: input.invoices ?? resolveDefaultInvoiceRepository(),
    transaction: input.transaction,
  };
}

function mapBoundaryError(error: unknown): InvoiceError {
  if (error instanceof InvoiceError) return error;
  if (error instanceof BusinessLifecycleError && error.code === LIFECYCLE_ERROR_CODES.INACTIVE_BUSINESS) return new InvoiceError(INVOICE_ERROR_CODES.INACTIVE_BUSINESS);
  if (error instanceof BusinessLifecycleError && error.code === LIFECYCLE_ERROR_CODES.BUSINESS_NOT_FOUND) return new InvoiceError(INVOICE_ERROR_CODES.DOCUMENT_NOT_FOUND);
  if (error instanceof AuthorizationError) return new InvoiceError(INVOICE_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  return new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
}

async function requireInvoiceAccess(invoice: Invoice, actorId: UserId, input: InvoiceDependencies): Promise<void> {
  const resolved = dependencies(input);
  try {
    const membership = await createTenantContext(resolved.tenancyRepository).getMembership(actorId, invoice.businessId);
    if (membership?.status !== "active" || !membership.isActive) throw new AuthorizationError("BUSINESS_ACCESS_DENIED", "Business access denied");
    await requireBusinessOperational(resolved.tenancyRepository, invoice.businessId);
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

async function requireInvoiceDocument(invoice: Invoice, repository: DocumentRepository): Promise<Document> {
  const document = await repository.findById(invoice.documentId);
  if (!document || document.businessId !== invoice.businessId) throw new InvoiceError(INVOICE_ERROR_CODES.DOCUMENT_NOT_FOUND);
  return document;
}

async function setDocumentState(repository: DocumentRepository, documentId: DocumentId, status: Document["status"]): Promise<Document | null> {
  return repository.setStatus(documentId, status);
}

const requiredFields: readonly (keyof Pick<InvoiceDraft, "supplier" | "invoiceNumber" | "invoiceDate" | "total" | "currencyReference">)[] = ["supplier", "invoiceNumber", "invoiceDate", "total", "currencyReference"];
const minimumApprovalConfidence = 0.8;

function validForApproval(invoice: Invoice): boolean {
  return requiredFields.every((field) => invoice[field] !== null && (invoice.confidenceData[field] ?? 0) >= minimumApprovalConfidence);
}

type ApprovalTransaction = (tenancyRepository: OnboardingRepository) => Promise<Invoice>;

export async function createInvoiceFromOcr(
  businessId: BusinessId,
  documentId: DocumentId,
  result: OcrResult,
  input: InvoiceDependencies = {},
): Promise<Invoice> {
  const resolved = dependencies(input);
  let draft: InvoiceDraft;
  try {
    draft = parseInvoice(result);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === INVOICE_PARSER_ERROR_CODES.MALFORMED_OCR_OUTPUT) {
      throw new InvoiceError(INVOICE_ERROR_CODES.INVALID_INVOICE);
    }
    throw error;
  }
  const existing = await resolved.invoices.findByDocumentId(documentId);
  if (existing) return existing;
  const now = new Date().toISOString();
  return resolved.invoices.create({ ...draft, id: randomUUID() as InvoiceId, businessId, documentId, createdAt: now, updatedAt: now });
}

export async function getInvoice(invoiceId: InvoiceId, actor: OnboardingActor, input: InvoiceDependencies = {}): Promise<Invoice> {
  const resolved = dependencies(input);
  const actorId = await resolveOnboardingActor(resolved.tenancyRepository, actor);
  const invoice = await resolved.invoices.findById(invoiceId);
  if (!invoice) throw new InvoiceError(INVOICE_ERROR_CODES.INVOICE_NOT_FOUND);
  await requireInvoiceDocument(invoice, resolved.documentRepository);
  await requireInvoiceAccess(invoice, actorId, input);
  return invoice;
}

export async function updateInvoice(
  invoiceId: InvoiceId,
  actor: OnboardingActor,
  patch: Partial<Omit<InvoiceDraft, "confidenceData" | "reviewState">>,
  input: InvoiceDependencies = {},
): Promise<Invoice> {
  const resolved = dependencies(input);
  const actorId = await resolveOnboardingActor(resolved.tenancyRepository, actor);
  const current = await getInvoice(invoiceId, actorId, input);
  if (current.reviewState === "approved") throw new InvoiceError(INVOICE_ERROR_CODES.INVALID_STATE);
  const fields = { ...current, ...patch };
  const confidenceData = { ...current.confidenceData };
  for (const field of Object.keys(patch) as (keyof typeof confidenceData)[]) confidenceData[field] = 1;
  const result: OcrResult = { fields: {
    supplier: fields.supplier,
    invoiceNumber: fields.invoiceNumber,
    invoiceDate: fields.invoiceDate,
    dueDate: fields.dueDate,
    subtotal: fields.subtotal,
    taxAmount: fields.taxAmount,
    total: fields.total,
    currencyReference: fields.currencyReference,
    expenseCategoryReference: fields.expenseCategoryReference,
    notes: fields.notes,
  }, confidence: confidenceData };
  let draft: InvoiceDraft;
  try {
    draft = parseInvoice(result);
  } catch {
    throw new InvoiceError(INVOICE_ERROR_CODES.INVALID_INVOICE);
  }
  const updated = { ...current, ...draft, updatedAt: new Date().toISOString() };
  await requireInvoiceDocument(current, resolved.documentRepository);
  return resolved.invoices.updateIfUnchanged(updated, current.reviewState, current.updatedAt);
}

export async function approveInvoice(invoiceId: InvoiceId, actor: OnboardingActor, input: InvoiceDependencies = {}): Promise<Invoice> {
  const resolved = dependencies(input);
  const actorId = await resolveOnboardingActor(resolved.tenancyRepository, actor);
  const current = await getInvoice(invoiceId, actorId, input);
  const membership = await createTenantContext(resolved.tenancyRepository).getMembership(actorId, current.businessId);
  try {
    requireCapability(membership!, "edit_finance");
  } catch {
    throw new InvoiceError(INVOICE_ERROR_CODES.INSUFFICIENT_CAPABILITY);
  }
  if (current.reviewState === "approved") throw new InvoiceError(INVOICE_ERROR_CODES.INVALID_STATE);
  if (!validForApproval(current)) throw new InvoiceError(INVOICE_ERROR_CODES.INVALID_FOR_APPROVAL);

  const approveInTransaction: ApprovalTransaction = async (transactionTenancy) => {
      const latest = await resolved.invoices.findById(invoiceId);
      if (!latest || latest.reviewState === "approved") throw new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
      if (!validForApproval(latest)) throw new InvoiceError(INVOICE_ERROR_CODES.INVALID_FOR_APPROVAL);
      const document = await resolved.documentRepository.findById(current.documentId);
      if (!document || document.businessId !== current.businessId) throw new InvoiceError(INVOICE_ERROR_CODES.DOCUMENT_NOT_FOUND);
      const previousDocumentStatus = await resolved.documentRepository.getStatus(current.documentId);
      const approved = { ...current, reviewState: "approved" as const, updatedAt: new Date().toISOString() };
      try {
        const saved = await resolved.invoices.updateIfUnchanged(approved, current.reviewState, current.updatedAt);
      if (!await setDocumentState(resolved.documentRepository, saved.documentId, "approved")) {
        throw new InvoiceError(INVOICE_ERROR_CODES.DOCUMENT_NOT_FOUND);
      }
      await transactionTenancy.appendAuditEvent({
        businessId: saved.businessId,
        actorId,
        type: "invoice_approved",
        entityId: saved.id,
      });
      return saved;
    } catch (error) {
      if (previousDocumentStatus) await setDocumentState(resolved.documentRepository, latest.documentId, previousDocumentStatus);
      throw error;
    }
  };

  if (resolved.transaction) return resolved.transaction(approveInTransaction);
  return resolved.invoices.transaction(async () => {
    return resolved.tenancyRepository.transaction((transaction) => approveInTransaction(transaction));
  });
}

export { setDocumentState };
