import { defaultOnboardingRepository, resolveOnboardingActor, type OnboardingActor, type OnboardingRepository } from "../tenancy/business-service";
import { requireBusinessOperational } from "../tenancy/business-lifecycle-service";
import { requireCapability } from "../permissions/authorize";
import { createTenantContext } from "../tenancy/tenant-context";
import type { BusinessId, UserId } from "../tenancy/types";
import { resolveDefaultMoneyRepository } from "../accounting/money-repository";
import { resolveDefaultHeadingRepository } from "../accounting/heading-service";
import {
  getInvoice,
  inMoneyTransaction,
  INVOICE_ERROR_CODES,
  InvoiceError,
  normalizePayment,
  paymentAudit,
  paymentFields,
  resolveDefaultDocumentRepository,
  resolveDefaultInvoiceRepository,
  writeInvoiceMovements,
  type Invoice,
  type InvoiceDependencies,
  type InvoiceTransactionDependencies,
  type PaymentStatus,
} from "./invoice-service";
import { resolveInvoiceCodingRepository } from "./invoice-coding-repository";
import type { InvoiceId } from "./ocr-provider";

/** One line of the year-end lists of invoices that did not go through a business account. */
export interface InvoiceCreditorItem {
  id: InvoiceId;
  supplier: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  total: string | null;
  currency: string | null;
}

function resolve(input: InvoiceDependencies): InvoiceTransactionDependencies {
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

async function requireBusinessCapability(tenancy: OnboardingRepository, businessId: BusinessId, actorId: UserId, capability: "read_finance" | "edit_finance"): Promise<void> {
  let membership;
  try {
    await requireBusinessOperational(tenancy, businessId);
    membership = await createTenantContext(tenancy).getMembership(actorId, businessId);
  } catch {
    throw new InvoiceError(INVOICE_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  }
  if (membership?.status !== "active" || !membership.isActive) throw new InvoiceError(INVOICE_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  try {
    requireCapability(membership, capability);
  } catch {
    throw new InvoiceError(INVOICE_ERROR_CODES.INSUFFICIENT_CAPABILITY);
  }
}

/** Runs `change` on an approved, not voided invoice the actor may edit, in one money, invoice and tenancy transaction. */
async function changeApproved(
  invoiceId: InvoiceId,
  actor: OnboardingActor,
  input: InvoiceDependencies,
  change: (current: Invoice, resolved: InvoiceTransactionDependencies, transactionTenancy: OnboardingRepository, actorId: UserId) => Promise<Invoice>,
  options: { allowVoided?: boolean } = {},
): Promise<Invoice> {
  const resolved = resolve(input);
  const actorId = await resolveOnboardingActor(resolved.tenancyRepository, actor);
  const current = await getInvoice(invoiceId, actorId, input);
  await requireBusinessCapability(resolved.tenancyRepository, current.businessId, actorId, "edit_finance");
  if (current.reviewState !== "approved") throw new InvoiceError(INVOICE_ERROR_CODES.INVALID_STATE);
  if (current.voidedAt && !options.allowVoided) throw new InvoiceError(INVOICE_ERROR_CODES.INVOICE_VOIDED);
  if (current.voidedAt) return current;
  // `change` saves with updateIfUnchanged, so a concurrent change since this read is a conflict.
  const inTransaction = (transactionTenancy: OnboardingRepository) => change(current, resolved, transactionTenancy, actorId);
  return inMoneyTransaction(resolved.money, () => {
    if (resolved.transaction) return resolved.transaction(inTransaction);
    return resolved.invoices.transaction(() => resolved.tenancyRepository.transaction(inTransaction));
  });
}

/**
 * Changes how an approved invoice was paid: its movements are replaced (paid) or removed (not paid,
 * paid privately) atomically. Movements of a closed year are never touched.
 */
export async function changeInvoicePayment(invoiceId: InvoiceId, actor: OnboardingActor, payment: unknown, input: InvoiceDependencies = {}): Promise<Invoice> {
  const answer = normalizePayment(payment);
  return changeApproved(invoiceId, actor, input, async (current, resolved, transactionTenancy, actorId) => {
    // Movements first: their typed refusal (wrong account, closed year…) wins over the invoice's own keys.
    await writeInvoiceMovements(resolved, transactionTenancy, actorId, current, answer);
    const saved = await resolved.invoices.updateIfUnchanged({ ...current, ...paymentFields(answer), updatedAt: new Date().toISOString() }, "approved", current.updatedAt);
    await transactionTenancy.appendAuditEvent({ businessId: saved.businessId, actorId, type: "invoice_payment_changed", entityId: saved.id, metadata: paymentAudit(answer) });
    return saved;
  });
}

/** Voids an approved invoice for good and removes its movements. Voiding twice changes nothing. */
export async function voidInvoice(invoiceId: InvoiceId, actor: OnboardingActor, input: InvoiceDependencies = {}): Promise<Invoice> {
  return changeApproved(invoiceId, actor, input, async (current, resolved, transactionTenancy, actorId) => {
    const at = new Date().toISOString();
    await writeInvoiceMovements(resolved, transactionTenancy, actorId, current, { status: "unpaid" });
    const saved = await resolved.invoices.updateIfUnchanged({ ...current, voidedAt: at, updatedAt: at }, "approved", current.updatedAt);
    await transactionTenancy.appendAuditEvent({ businessId: saved.businessId, actorId, type: "invoice_voided", entityId: saved.id });
    return saved;
  }, { allowVoided: true });
}

async function listByPaymentStatus(businessId: BusinessId, status: PaymentStatus, actor: OnboardingActor, input: InvoiceDependencies): Promise<InvoiceCreditorItem[]> {
  const resolved = resolve(input);
  const actorId = await resolveOnboardingActor(resolved.tenancyRepository, actor);
  await requireBusinessCapability(resolved.tenancyRepository, businessId, actorId, "read_finance");
  return (await resolved.invoices.listByBusinessId(businessId))
    .filter((invoice) => invoice.reviewState === "approved" && !invoice.voidedAt && invoice.paymentStatus === status)
    .sort((left, right) => (left.invoiceDate ?? "").localeCompare(right.invoiceDate ?? "") || left.id.localeCompare(right.id))
    .map((invoice) => ({ id: invoice.id, supplier: invoice.supplier, invoiceNumber: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate, total: invoice.total, currency: invoice.currencyReference }));
}

/** Approved invoices not paid yet: the year-end creditors. */
export async function listUnpaidInvoices(businessId: BusinessId, actor: OnboardingActor, input: InvoiceDependencies = {}): Promise<InvoiceCreditorItem[]> {
  return listByPaymentStatus(businessId, "unpaid", actor, input);
}

/** Approved invoices the owner paid with private money or cash outside the app: capital introduced. */
export async function listPrivatelyPaidInvoices(businessId: BusinessId, actor: OnboardingActor, input: InvoiceDependencies = {}): Promise<InvoiceCreditorItem[]> {
  return listByPaymentStatus(businessId, "paid_privately", actor, input);
}
