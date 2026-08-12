import { and, eq, or } from "drizzle-orm";

import type { Database } from "../../db/client";
import { databaseForOperation, transactionWithDatabase } from "../../db/transaction-scope";
import { categories, currencies, invoices } from "../../db/schema";
import {
  INVOICE_ERROR_CODES,
  InvoiceError,
  type Invoice,
  type InvoiceRepository,
} from "./invoice-service";
import type { InvoiceDraft } from "./invoice-parser";
import type { BusinessId } from "../tenancy/types";
import type { DocumentId, InvoiceId } from "./ocr-provider";
import { OCR_FIELD_NAMES, type OcrConfidenceData } from "./ocr-provider";

function id<T extends string>(value: string): T {
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function driverCode(error: unknown): string | null {
  if (!isRecord(error)) return null;
  if (typeof error.code === "string") return error.code;
  return driverCode(error.cause);
}

function isDomainError(error: unknown): error is InvoiceError {
  return error instanceof InvoiceError;
}

function mapDatabaseError(error: unknown): InvoiceError | null {
  if (isDomainError(error)) return error;
  const code = driverCode(error);
  if (!code) return null;
  if (code === "23503" || code === "23505" || code === "23514" || code === "23523") {
    return new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
  }
  return new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
}

function preserveOrMap(error: unknown): never {
  if (error instanceof InvoiceError) throw error;
  const mapped = mapDatabaseError(error);
  if (mapped) throw mapped;
  throw new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
}

function confidenceData(value: unknown): OcrConfidenceData {
  if (!isRecord(value)) throw new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
  const result: OcrConfidenceData = {
    supplier: 0,
    invoiceNumber: 0,
    invoiceDate: 0,
    dueDate: 0,
    subtotal: 0,
    taxAmount: 0,
    total: 0,
    currencyReference: 0,
    expenseCategoryReference: 0,
    notes: 0,
  };
  for (const field of OCR_FIELD_NAMES) {
    const fieldValue = value[field];
    if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue) || fieldValue < 0 || fieldValue > 1) {
      throw new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
    }
    result[field] = fieldValue;
  }
  return result;
}

function dateValue(value: string | null): string | null {
  return value;
}

async function currencyIdFor(database: Database, businessId: string, reference: string | null): Promise<string | null> {
  if (reference === null) return null;
  const [row] = await database.select({ id: currencies.id }).from(currencies).where(and(
    eq(currencies.businessId, businessId),
    or(eq(currencies.id, reference), eq(currencies.isoCode, reference)),
  )).limit(1);
  if (!row) throw new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
  return row.id;
}

async function categoryIdFor(database: Database, businessId: string, reference: string | null): Promise<string | null> {
  if (reference === null) return null;
  const [row] = await database.select({ id: categories.id }).from(categories).where(and(
    eq(categories.businessId, businessId),
    eq(categories.id, reference),
  )).limit(1);
  if (!row) throw new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
  return row.id;
}

async function referenceFor(database: Database, businessId: string, currencyId: string | null): Promise<string | null> {
  if (currencyId === null) return null;
  const [row] = await database.select({ id: currencies.id, isoCode: currencies.isoCode }).from(currencies).where(and(
    eq(currencies.businessId, businessId),
    eq(currencies.id, currencyId),
  )).limit(1);
  if (!row) throw new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
  return row.isoCode ?? row.id;
}

async function categoryReferenceFor(database: Database, businessId: string, categoryId: string | null): Promise<string | null> {
  if (categoryId === null) return null;
  const [row] = await database.select({ id: categories.id }).from(categories).where(and(
    eq(categories.businessId, businessId),
    eq(categories.id, categoryId),
  )).limit(1);
  if (!row) throw new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
  return row.id;
}

async function mapInvoice(database: Database, row: typeof invoices.$inferSelect): Promise<Invoice> {
  return {
    id: id<InvoiceId>(row.id),
    businessId: id<BusinessId>(row.businessId),
    documentId: id<DocumentId>(row.documentId),
    supplier: row.supplier,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: dateValue(row.invoiceDate),
    dueDate: dateValue(row.dueDate),
    subtotal: row.subtotal,
    taxAmount: row.taxAmount,
    total: row.total,
    currencyReference: await referenceFor(database, row.businessId, row.currencyId),
    expenseCategoryReference: await categoryReferenceFor(database, row.businessId, row.categoryId),
    notes: row.notes,
    confidenceData: confidenceData(row.confidenceData),
    reviewState: row.reviewState,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function valuesFor(database: Database, invoice: Invoice) {
  return {
    id: invoice.id,
    businessId: invoice.businessId,
    documentId: invoice.documentId,
    supplier: invoice.supplier,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    subtotal: invoice.subtotal,
    taxAmount: invoice.taxAmount,
    total: invoice.total,
    currencyId: await currencyIdFor(database, invoice.businessId, invoice.currencyReference),
    categoryId: await categoryIdFor(database, invoice.businessId, invoice.expenseCategoryReference),
    confidenceData: invoice.confidenceData,
    notes: invoice.notes,
    reviewState: invoice.reviewState,
    createdAt: new Date(invoice.createdAt),
    updatedAt: new Date(invoice.updatedAt),
  };
}

function createRepository(database: Database): InvoiceRepository {
  const repository: InvoiceRepository = {
    async transaction<T>(operation: () => Promise<T>): Promise<T> {
      try {
        return await transactionWithDatabase(database, operation);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async create(invoice) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.insert(invoices).values(await valuesFor(db, invoice)).returning();
        if (!row) throw new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
        return mapInvoice(db, row);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async findById(invoiceId) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
        return row ? mapInvoice(db, row) : null;
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async findByDocumentId(documentId) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.select().from(invoices).where(eq(invoices.documentId, documentId)).limit(1);
        return row ? mapInvoice(db, row) : null;
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async hasCurrencyReference(businessId, reference) {
      const db = databaseForOperation(database);
      try {
        const rows = await db.select({ id: invoices.id }).from(invoices)
          .innerJoin(currencies, eq(invoices.currencyId, currencies.id))
          .where(and(
            eq(invoices.businessId, businessId),
            or(eq(currencies.id, reference), eq(currencies.isoCode, reference)),
          )).limit(1);
        return rows.length > 0;
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async update(invoice) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.update(invoices).set(await valuesFor(db, invoice)).where(eq(invoices.id, invoice.id)).returning();
        if (!row) throw new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
        return mapInvoice(db, row);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async updateIfUnchanged(invoice, expectedReviewState: InvoiceDraft["reviewState"], expectedUpdatedAt) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.update(invoices).set(await valuesFor(db, invoice)).where(and(
          eq(invoices.id, invoice.id),
          eq(invoices.reviewState, expectedReviewState),
          eq(invoices.updatedAt, new Date(expectedUpdatedAt)),
        )).returning();
        if (!row) throw new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
        return mapInvoice(db, row);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async listByBusinessId(businessId) {
      const db = databaseForOperation(database);
      try {
        const rows = await db.select().from(invoices).where(eq(invoices.businessId, businessId));
        return Promise.all(rows.map((row) => mapInvoice(db, row)));
      } catch (error) {
        return preserveOrMap(error);
      }
    },
  };
  return repository;
}

export function createPostgresInvoiceRepository(database: Database): InvoiceRepository {
  return createRepository(database);
}
