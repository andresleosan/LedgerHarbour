import type { BusinessId } from "../tenancy/types";
import type { InvoiceRepository } from "./invoice-service";
import type { InvoiceId } from "./ocr-provider";

/** One line of an invoice's coding. The amount is pounds as a decimal string ("12.30"). */
export interface InvoiceCodingLine {
  headingId: string;
  amount: string;
}

export interface InvoiceCodingRepository {
  transaction<T>(operation: () => Promise<T>): Promise<T>;
  /** Lines in their saved order; [] when the invoice is not coded. */
  list(businessId: BusinessId, invoiceId: InvoiceId): Promise<InvoiceCodingLine[]>;
  /** Replaces every line of the invoice; [] clears the coding. */
  replace(businessId: BusinessId, invoiceId: InvoiceId, lines: readonly InvoiceCodingLine[], now: string): Promise<InvoiceCodingLine[]>;
  /**
   * Heading of the most recently updated other invoice of the business whose supplier
   * matches `supplier` (see `supplierKey`) and that is coded to exactly one line.
   */
  findSupplierHeadingId(businessId: BusinessId, supplier: string, excludeInvoiceId: InvoiceId): Promise<string | null>;
}

/** Trimmed, case-insensitive supplier name; null when there is nothing to match on. */
export function supplierKey(supplier: string | null): string | null {
  const key = supplier?.trim().toLowerCase() ?? "";
  return key || null;
}

type StoredCoding = { businessId: BusinessId; lines: InvoiceCodingLine[] };
type InvoiceSource = Pick<InvoiceRepository, "listByBusinessId">;

class MemoryInvoiceCodingRepository implements InvoiceCodingRepository {
  private readonly codings = new Map<string, StoredCoding>();
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly invoices: InvoiceSource) {}

  async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise((resolve) => { release = resolve; });
    await previous;
    const snapshot = new Map(this.codings);
    try {
      return await operation();
    } catch (error) {
      this.codings.clear();
      snapshot.forEach((coding, id) => this.codings.set(id, coding));
      throw error;
    } finally {
      release();
    }
  }

  async list(businessId: BusinessId, invoiceId: InvoiceId): Promise<InvoiceCodingLine[]> {
    const stored = this.codings.get(invoiceId);
    return stored?.businessId === businessId ? stored.lines.map((line) => ({ ...line })) : [];
  }

  async replace(businessId: BusinessId, invoiceId: InvoiceId, lines: readonly InvoiceCodingLine[]): Promise<InvoiceCodingLine[]> {
    const stored = this.codings.get(invoiceId);
    if (stored && stored.businessId !== businessId) throw new Error("Invoice coding belongs to another business.");
    if (lines.length === 0) this.codings.delete(invoiceId);
    else this.codings.set(invoiceId, { businessId, lines: lines.map((line) => ({ headingId: line.headingId, amount: line.amount })) });
    return lines.map((line) => ({ headingId: line.headingId, amount: line.amount }));
  }

  async findSupplierHeadingId(businessId: BusinessId, supplier: string, excludeInvoiceId: InvoiceId): Promise<string | null> {
    const candidates = (await this.invoices.listByBusinessId(businessId))
      .filter((invoice) => invoice.id !== excludeInvoiceId && supplierKey(invoice.supplier) === supplier)
      .filter((invoice) => this.codings.get(invoice.id)?.businessId === businessId && this.codings.get(invoice.id)!.lines.length === 1)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
    return candidates[0] ? this.codings.get(candidates[0].id)!.lines[0].headingId : null;
  }
}

/** An in-memory coding store that reads suppliers and update times from `invoices`. */
export function createInvoiceCodingRepository(invoices: InvoiceSource): InvoiceCodingRepository {
  return new MemoryInvoiceCodingRepository(invoices);
}

const CODING_REPOSITORIES_KEY = Symbol.for("ledgerharbour.lh020.invoiceCodingRepositories");
type GlobalState = typeof globalThis & { [key: symbol]: unknown };

/** The in-memory coding store paired with an invoice repository, shared across route bundles. */
export function resolveInvoiceCodingRepository(invoices: InvoiceSource): InvoiceCodingRepository {
  const state = globalThis as GlobalState;
  let repositories = state[CODING_REPOSITORIES_KEY] as WeakMap<object, InvoiceCodingRepository> | undefined;
  if (!(repositories instanceof WeakMap)) {
    repositories = new WeakMap();
    Object.defineProperty(state, CODING_REPOSITORIES_KEY, { configurable: false, enumerable: false, writable: false, value: repositories });
  }
  let repository = repositories.get(invoices);
  if (!repository) {
    repository = createInvoiceCodingRepository(invoices);
    repositories.set(invoices, repository);
  }
  return repository;
}
