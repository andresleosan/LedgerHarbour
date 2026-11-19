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
import { resolveDefaultHeadingRepository, type HeadingRepository } from "../accounting/heading-service";
import { formatPence, parsePounds, sumPence } from "../accounting/money";
import { MONEY_ERROR_CODES, MoneyError, resolveDefaultMoneyRepository, type MoneyErrorCode, type MoneyRepository } from "../accounting/money-repository";
import { replaceInvoiceMovements, type MovementWriteContext } from "../accounting/money-service";
import { resolveInvoiceCodingRepository, supplierKey, type InvoiceCodingLine, type InvoiceCodingRepository } from "./invoice-coding-repository";
import { invoiceNarrative, shareDebit } from "./payment-shares";

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
  INVALID_CODING: "INVALID_CODING",
  CODING_REQUIRED: "CODING_REQUIRED",
  CODING_TOTAL_MISMATCH: "CODING_TOTAL_MISMATCH",
  CODING_DUPLICATE_HEADING: "CODING_DUPLICATE_HEADING",
  HEADING_NOT_FOUND: "HEADING_NOT_FOUND",
  HEADING_NOT_USABLE: "HEADING_NOT_USABLE",
  PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
  INVALID_PAYMENT: "INVALID_PAYMENT",
  INVOICE_VOIDED: "INVOICE_VOIDED",
  MOVEMENT_OUTSIDE_OPEN_YEAR: "MOVEMENT_OUTSIDE_OPEN_YEAR",
  MONEY_ACCOUNT_NOT_FOUND: "MONEY_ACCOUNT_NOT_FOUND",
  MONEY_ACCOUNT_INACTIVE: "MONEY_ACCOUNT_INACTIVE",
  FINANCIAL_YEAR_CLOSED: "FINANCIAL_YEAR_CLOSED",
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
  INVALID_CODING: "The invoice coding is not valid.",
  CODING_REQUIRED: "Choose a code that covers the invoice total before approving it.",
  CODING_TOTAL_MISMATCH: "The coded amounts must add up to the invoice total.",
  CODING_DUPLICATE_HEADING: "Each code can be used only once on an invoice.",
  HEADING_NOT_FOUND: "Code not found.",
  HEADING_NOT_USABLE: "This code is inactive or blocked.",
  PAYMENT_REQUIRED: "Say how the invoice was paid before approving it.",
  INVALID_PAYMENT: "The payment details are not valid.",
  INVOICE_VOIDED: "This invoice was voided and cannot be changed.",
  MOVEMENT_OUTSIDE_OPEN_YEAR: "That date is outside the open financial year.",
  MONEY_ACCOUNT_NOT_FOUND: "That account was not found.",
  MONEY_ACCOUNT_INACTIVE: "That account is no longer in use.",
  FINANCIAL_YEAR_CLOSED: "That financial year is closed, so its movements cannot change.",
};

const conflictCodes = new Set<InvoiceErrorCode>([
  INVOICE_ERROR_CODES.INVALID_STATE,
  INVOICE_ERROR_CODES.REPOSITORY_CONFLICT,
  INVOICE_ERROR_CODES.CODING_REQUIRED,
  INVOICE_ERROR_CODES.PAYMENT_REQUIRED,
  INVOICE_ERROR_CODES.INVOICE_VOIDED,
  INVOICE_ERROR_CODES.MOVEMENT_OUTSIDE_OPEN_YEAR,
  INVOICE_ERROR_CODES.MONEY_ACCOUNT_INACTIVE,
  INVOICE_ERROR_CODES.FINANCIAL_YEAR_CLOSED,
]);

/** HTTP status of an invoice error, shared by the invoice routes. */
export function invoiceErrorStatus(code: InvoiceErrorCode): number {
  if (code === INVOICE_ERROR_CODES.INVOICE_NOT_FOUND || code === INVOICE_ERROR_CODES.DOCUMENT_NOT_FOUND) return 404;
  if (code === INVOICE_ERROR_CODES.BUSINESS_ACCESS_DENIED || code === INVOICE_ERROR_CODES.INACTIVE_BUSINESS || code === INVOICE_ERROR_CODES.INSUFFICIENT_CAPABILITY) return 403;
  return conflictCodes.has(code) ? 409 : 400;
}

export class InvoiceError extends Error {
  readonly name = "InvoiceError";

  constructor(readonly code: InvoiceErrorCode) {
    super(publicMessages[code]);
  }
}

export const INVOICE_KINDS = ["invoice", "credit_note"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];
export const PAYMENT_STATUSES = ["paid", "unpaid", "paid_privately"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
/** How an approved invoice was paid. `amountDebited` is the pounds the bank took ("120.00"). */
export type InvoicePayment =
  | { status: "paid"; accountId: string; paidOn: string; amountDebited: string }
  | { status: "unpaid" }
  | { status: "paid_privately" };

export interface Invoice extends InvoiceDraft {
  id: InvoiceId;
  businessId: BusinessId;
  documentId: DocumentId;
  createdAt: string;
  updatedAt: string;
  /** Absent means the stored default: an invoice, not paid yet answered, not voided. */
  kind?: InvoiceKind;
  paymentStatus?: PaymentStatus | null;
  paidAccountId?: string | null;
  paidOn?: string | null;
  amountDebited?: string | null;
  voidedAt?: string | null;
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
  codings?: InvoiceCodingRepository;
  headings?: HeadingRepository;
  money?: MoneyRepository;
}

function dependencies(input: InvoiceDependencies = {}) {
  const invoices = input.invoices ?? resolveDefaultInvoiceRepository();
  return {
    tenancyRepository: input.tenancyRepository ?? defaultOnboardingRepository,
    documentRepository: input.documentRepository ?? resolveDefaultDocumentRepository(),
    invoices,
    transaction: input.transaction,
    codings: input.codings ?? resolveInvoiceCodingRepository(invoices),
    headings: input.headings ?? resolveDefaultHeadingRepository(),
    money: input.money ?? resolveDefaultMoneyRepository(),
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

export type { InvoiceCodingLine } from "./invoice-coding-repository";
export type InvoiceCodingInput = readonly { headingId: string; amount: string }[];
export const MAX_CODING_LINES = 20;

function penceOf(amount: string | null): number | null {
  if (amount === null) return null;
  try {
    return parsePounds(amount);
  } catch {
    return Number.NaN;
  }
}

/** True when the lines cover the invoice total exactly, in pence. */
function codingCoversTotal(lines: readonly InvoiceCodingLine[], total: string | null): boolean {
  const totalPence = penceOf(total);
  return totalPence !== null && lines.length > 0 && sumPence(lines.map((line) => parsePounds(line.amount))) === totalPence;
}

function normalizeCoding(input: InvoiceCodingInput): InvoiceCodingLine[] {
  if (!Array.isArray(input) || input.length > MAX_CODING_LINES) throw new InvoiceError(INVOICE_ERROR_CODES.INVALID_CODING);
  const seen = new Set<string>();
  return input.map((line) => {
    if (typeof line?.headingId !== "string" || !line.headingId.trim()) throw new InvoiceError(INVOICE_ERROR_CODES.INVALID_CODING);
    const pence = penceOf(typeof line.amount === "string" ? line.amount : "");
    if (pence === null || !Number.isSafeInteger(pence) || pence <= 0) throw new InvoiceError(INVOICE_ERROR_CODES.INVALID_CODING);
    if (seen.has(line.headingId)) throw new InvoiceError(INVOICE_ERROR_CODES.CODING_DUPLICATE_HEADING);
    seen.add(line.headingId);
    return { headingId: line.headingId, amount: formatPence(pence) };
  });
}

async function requireUsableHeadings(headings: HeadingRepository, businessId: BusinessId, lines: readonly InvoiceCodingLine[]): Promise<void> {
  for (const line of lines) {
    const heading = await headings.findById(line.headingId, businessId);
    if (!heading) throw new InvoiceError(INVOICE_ERROR_CODES.HEADING_NOT_FOUND);
    if (!heading.isActive || heading.blockedReason !== null) throw new InvoiceError(INVOICE_ERROR_CODES.HEADING_NOT_USABLE);
  }
}

/**
 * The lines to store with a draft save, or null to keep the stored ones. A single stored line follows
 * a new total; several stored lines must still add up to it.
 */
async function codingForSave(current: Invoice, updated: Invoice, coding: InvoiceCodingInput | undefined, resolved: ReturnType<typeof dependencies>): Promise<InvoiceCodingLine[] | null> {
  if (coding !== undefined) {
    const lines = normalizeCoding(coding);
    await requireUsableHeadings(resolved.headings, current.businessId, lines);
    if (updated.total !== null && lines.length > 0 && !codingCoversTotal(lines, updated.total)) throw new InvoiceError(INVOICE_ERROR_CODES.CODING_TOTAL_MISMATCH);
    return lines;
  }
  if (updated.total === null || updated.total === current.total) return null;
  const stored = await resolved.codings.list(current.businessId, current.id);
  if (stored.length === 0 || codingCoversTotal(stored, updated.total)) return null;
  const totalPence = penceOf(updated.total)!;
  if (stored.length > 1 || !Number.isSafeInteger(totalPence) || totalPence <= 0) throw new InvoiceError(INVOICE_ERROR_CODES.CODING_TOTAL_MISMATCH);
  return [{ headingId: stored[0].headingId, amount: formatPence(totalPence) }];
}

async function requireApprovableCoding(invoice: Invoice, codings: InvoiceCodingRepository): Promise<void> {
  if (!codingCoversTotal(await codings.list(invoice.businessId, invoice.id), invoice.total)) {
    throw new InvoiceError(INVOICE_ERROR_CODES.CODING_REQUIRED);
  }
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
    draft = parseInvoice(result, "ocr");
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
  patch: Partial<Omit<InvoiceDraft, "confidenceData" | "reviewState">> & { kind?: InvoiceKind },
  input: InvoiceDependencies = {},
  coding?: InvoiceCodingInput,
): Promise<Invoice> {
  const resolved = dependencies(input);
  const actorId = await resolveOnboardingActor(resolved.tenancyRepository, actor);
  const current = await getInvoice(invoiceId, actorId, input);
  if (current.reviewState === "approved") throw new InvoiceError(INVOICE_ERROR_CODES.INVALID_STATE);
  const { kind, ...fieldPatch } = patch;
  if (kind !== undefined && !INVOICE_KINDS.includes(kind)) throw new InvoiceError(INVOICE_ERROR_CODES.INVALID_INVOICE);
  const fields = { ...current, ...fieldPatch };
  const confidenceData = { ...current.confidenceData };
  for (const field of Object.keys(fieldPatch) as (keyof typeof confidenceData)[]) confidenceData[field] = 1;
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
  const updated = { ...current, ...draft, ...(kind === undefined ? {} : { kind }), updatedAt: new Date().toISOString() };
  await requireInvoiceDocument(current, resolved.documentRepository);
  const lines = await codingForSave(current, updated, coding, resolved);
  if (lines === null) return resolved.invoices.updateIfUnchanged(updated, current.reviewState, current.updatedAt);
  return resolved.invoices.transaction(() => resolved.codings.transaction(async () => {
    const saved = await resolved.invoices.updateIfUnchanged(updated, current.reviewState, current.updatedAt);
    await resolved.codings.replace(saved.businessId, saved.id, lines, saved.updatedAt);
    return saved;
  }));
}

/** The invoice's coding lines in order, for a member of its business. */
export async function getInvoiceCoding(invoiceId: InvoiceId, actor: OnboardingActor, input: InvoiceDependencies = {}): Promise<InvoiceCodingLine[]> {
  const invoice = await getInvoice(invoiceId, actor, input);
  return dependencies(input).codings.list(invoice.businessId, invoice.id);
}

/**
 * The invoice with its coding and the code last used alone with the same supplier in the same
 * business, offered only while that heading is still active and unblocked.
 */
export async function getInvoiceWithCoding(invoiceId: InvoiceId, actor: OnboardingActor, input: InvoiceDependencies = {}): Promise<{ invoice: Invoice; coding: InvoiceCodingLine[]; suggestedHeadingId: string | null }> {
  const resolved = dependencies(input);
  const invoice = await getInvoice(invoiceId, actor, input);
  const coding = await resolved.codings.list(invoice.businessId, invoice.id);
  const key = supplierKey(invoice.supplier);
  const headingId = key ? await resolved.codings.findSupplierHeadingId(invoice.businessId, key, invoice.id) : null;
  const heading = headingId ? await resolved.headings.findById(headingId, invoice.businessId) : null;
  const suggestedHeadingId = heading?.isActive && heading.blockedReason === null ? heading.id : null;
  return { invoice, coding, suggestedHeadingId };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(value: unknown): value is string {
  const match = typeof value === "string" ? ISO_DATE.exec(value) : null;
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** Checks a payment answer from a request; amounts come back normalised to pence ("120" → "120.00"). */
export function normalizePayment(input: unknown): InvoicePayment {
  if (input === undefined || input === null) throw new InvoiceError(INVOICE_ERROR_CODES.PAYMENT_REQUIRED);
  const payment = input as Record<string, unknown>;
  if (typeof input !== "object" || !PAYMENT_STATUSES.includes(payment.status as PaymentStatus)) throw new InvoiceError(INVOICE_ERROR_CODES.INVALID_PAYMENT);
  if (payment.status !== "paid") return { status: payment.status as "unpaid" | "paid_privately" };
  const pence = typeof payment.amountDebited === "string" ? penceOf(payment.amountDebited) : null;
  if (typeof payment.accountId !== "string" || !payment.accountId || !isCalendarDate(payment.paidOn) || pence === null || !Number.isSafeInteger(pence) || pence <= 0) {
    throw new InvoiceError(INVOICE_ERROR_CODES.INVALID_PAYMENT);
  }
  return { status: "paid", accountId: payment.accountId, paidOn: payment.paidOn, amountDebited: formatPence(pence) };
}

/** The invoice's stored payment columns for an answer. */
export function paymentFields(payment: InvoicePayment): Pick<Invoice, "paymentStatus" | "paidAccountId" | "paidOn" | "amountDebited"> {
  return payment.status === "paid"
    ? { paymentStatus: "paid", paidAccountId: payment.accountId, paidOn: payment.paidOn, amountDebited: payment.amountDebited }
    : { paymentStatus: payment.status, paidAccountId: null, paidOn: null, amountDebited: null };
}

const movementErrors = new Map<MoneyErrorCode, InvoiceErrorCode>([
  [MONEY_ERROR_CODES.MOVEMENT_OUTSIDE_OPEN_YEAR, INVOICE_ERROR_CODES.MOVEMENT_OUTSIDE_OPEN_YEAR],
  [MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND, INVOICE_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND],
  [MONEY_ERROR_CODES.MONEY_ACCOUNT_INACTIVE, INVOICE_ERROR_CODES.MONEY_ACCOUNT_INACTIVE],
  [MONEY_ERROR_CODES.FINANCIAL_YEAR_CLOSED, INVOICE_ERROR_CODES.FINANCIAL_YEAR_CLOSED],
  [MONEY_ERROR_CODES.HEADING_NOT_FOUND, INVOICE_ERROR_CODES.HEADING_NOT_FOUND],
  [MONEY_ERROR_CODES.HEADING_NOT_USABLE, INVOICE_ERROR_CODES.HEADING_NOT_USABLE],
  [MONEY_ERROR_CODES.INVALID_AMOUNT, INVOICE_ERROR_CODES.INVALID_PAYMENT],
  [MONEY_ERROR_CODES.INVALID_MOVEMENT, INVOICE_ERROR_CODES.INVALID_PAYMENT],
]);

/** Runs a movement write and turns the money module's refusals into the invoice's own typed codes. */
export async function asInvoiceError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MoneyError) throw new InvoiceError(movementErrors.get(error.code) ?? INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
    throw error;
  }
}

/**
 * Runs `operation` inside a money transaction and rethrows its own error: the PostgreSQL money
 * repository would otherwise turn any non-money error into a money conflict. Taken before the
 * invoice and tenancy locks, the same order as the money service, so the memory locks never cross.
 */
export async function inMoneyTransaction<T>(money: MoneyRepository, operation: () => Promise<T>): Promise<T> {
  const failure: { error?: unknown; failed?: true } = {};
  try {
    return await money.transaction(async () => {
      try {
        return await operation();
      } catch (error) {
        failure.error = error;
        failure.failed = true;
        throw error;
      }
    });
  } catch (error) {
    throw failure.failed ? failure.error : error;
  }
}

/** The tenancy repository of an open transaction, whose nested transactions run inline (the memory lock is not reentrant). */
function inlineTenancy(tenancy: OnboardingRepository): OnboardingRepository {
  return new Proxy(tenancy, {
    get(target, property) {
      if (property === "transaction") return <T>(operation: (repository: OnboardingRepository) => Promise<T>) => operation(target);
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export type InvoiceTransactionDependencies = ReturnType<typeof dependencies>;

/**
 * Writes the invoice's movements for a payment inside the caller's transaction: one per coding line
 * when paid (negative for an invoice, positive for a credit note), none otherwise.
 */
export async function writeInvoiceMovements(
  resolved: InvoiceTransactionDependencies,
  transactionTenancy: OnboardingRepository,
  actorId: UserId,
  invoice: Invoice,
  payment: InvoicePayment,
): Promise<void> {
  const context: MovementWriteContext = { businessId: invoice.businessId, actorId, tenancy: inlineTenancy(transactionTenancy), money: resolved.money, headings: resolved.headings };
  if (payment.status !== "paid") {
    await asInvoiceError(() => replaceInvoiceMovements(context, invoice.id, []));
    return;
  }
  const lines = await resolved.codings.list(invoice.businessId, invoice.id);
  const sign = (invoice.kind ?? "invoice") === "credit_note" ? 1 : -1;
  const shares = shareDebit(lines.map((line) => parsePounds(line.amount)), parsePounds(payment.amountDebited));
  const narrative = invoiceNarrative(invoice.supplier, invoice.invoiceNumber);
  const rows = lines.flatMap((line, index) => shares[index] === 0 ? [] : [{
    accountId: payment.accountId,
    date: payment.paidOn,
    narrative,
    headingId: line.headingId,
    amount: formatPence(sign * shares[index]),
  }]);
  await asInvoiceError(() => replaceInvoiceMovements(context, invoice.id, rows));
}

/** Payment audit metadata: ids only, never amounts or names. */
export function paymentAudit(payment: InvoicePayment): Record<string, unknown> {
  return payment.status === "paid" ? { paymentStatus: payment.status, moneyAccountId: payment.accountId } : { paymentStatus: payment.status };
}

/**
 * Approves a coded invoice and records how it was paid. A payment from a business account creates
 * the invoice's movements in the same transaction; any refusal leaves nothing written.
 */
export async function approveInvoice(invoiceId: InvoiceId, actor: OnboardingActor, input: InvoiceDependencies = {}, payment?: unknown): Promise<Invoice> {
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
  await requireApprovableCoding(current, resolved.codings);
  const answer = normalizePayment(payment);

  const approveInTransaction: ApprovalTransaction = async (transactionTenancy) => {
      const latest = await resolved.invoices.findById(invoiceId);
      if (!latest || latest.reviewState === "approved") throw new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
      if (!validForApproval(latest)) throw new InvoiceError(INVOICE_ERROR_CODES.INVALID_FOR_APPROVAL);
      const document = await resolved.documentRepository.findById(current.documentId);
      if (!document || document.businessId !== current.businessId) throw new InvoiceError(INVOICE_ERROR_CODES.DOCUMENT_NOT_FOUND);
      const previousDocumentStatus = await resolved.documentRepository.getStatus(current.documentId);
      const approved: Invoice = { ...current, reviewState: "approved", kind: current.kind ?? "invoice", ...paymentFields(answer), voidedAt: current.voidedAt ?? null, updatedAt: new Date().toISOString() };
      try {
        // Movements first: their typed refusal (wrong account, closed year…) wins over the invoice's own keys.
        if (answer.status === "paid") await writeInvoiceMovements(resolved, transactionTenancy, actorId, approved, answer);
        const saved = await resolved.invoices.updateIfUnchanged(approved, current.reviewState, current.updatedAt);
      if (!await setDocumentState(resolved.documentRepository, saved.documentId, "approved")) {
        throw new InvoiceError(INVOICE_ERROR_CODES.DOCUMENT_NOT_FOUND);
      }
      await transactionTenancy.appendAuditEvent({
        businessId: saved.businessId,
        actorId,
        type: "invoice_approved",
        entityId: saved.id,
        metadata: paymentAudit(answer),
      });
      return saved;
    } catch (error) {
      if (previousDocumentStatus) await setDocumentState(resolved.documentRepository, latest.documentId, previousDocumentStatus);
      throw error;
    }
  };

  return inMoneyTransaction(resolved.money, () => {
    if (resolved.transaction) return resolved.transaction(approveInTransaction);
    return resolved.invoices.transaction(async () => {
      return resolved.tenancyRepository.transaction((transaction) => approveInTransaction(transaction));
    });
  });
}

export { setDocumentState };
