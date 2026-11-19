import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, ne, sql } from "drizzle-orm";

import type { Database } from "../../db/client";
import { databaseForOperation, transactionWithDatabase } from "../../db/transaction-scope";
import { invoiceCodings, invoices } from "../../db/schema";
import type { InvoiceCodingLine, InvoiceCodingRepository } from "./invoice-coding-repository";
import { INVOICE_ERROR_CODES, InvoiceError } from "./invoice-service";

function preserveOrMap(error: unknown): never {
  if (error instanceof InvoiceError) throw error;
  throw new InvoiceError(INVOICE_ERROR_CODES.REPOSITORY_CONFLICT);
}

// Same characters as String.prototype.trim for the whitespace a typed name can carry.
const TRIMMED = " \t\n\r ";

export function createPostgresInvoiceCodingRepository(database: Database): InvoiceCodingRepository {
  return {
    async transaction<T>(operation: () => Promise<T>): Promise<T> {
      try {
        return await transactionWithDatabase(database, operation);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async list(businessId, invoiceId) {
      const db = databaseForOperation(database);
      try {
        const rows = await db.select({ headingId: invoiceCodings.headingId, amount: invoiceCodings.amount }).from(invoiceCodings)
          .where(and(eq(invoiceCodings.businessId, businessId), eq(invoiceCodings.invoiceId, invoiceId)))
          .orderBy(asc(invoiceCodings.sortOrder));
        return rows;
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async replace(businessId, invoiceId, lines, now) {
      try {
        // Its own transaction unless the caller already opened one, so a failed insert never leaves the lines deleted.
        return await transactionWithDatabase(database, async () => {
          const db = databaseForOperation(database);
          await db.delete(invoiceCodings).where(and(eq(invoiceCodings.businessId, businessId), eq(invoiceCodings.invoiceId, invoiceId)));
          if (lines.length === 0) return [];
          const at = new Date(now);
          const rows = await db.insert(invoiceCodings).values(lines.map((line, index) => ({
            id: randomUUID(),
            businessId,
            invoiceId,
            headingId: line.headingId,
            amount: line.amount,
            sortOrder: index,
            createdAt: at,
            updatedAt: at,
          }))).returning({ headingId: invoiceCodings.headingId, amount: invoiceCodings.amount, sortOrder: invoiceCodings.sortOrder });
          return rows.sort((left, right) => left.sortOrder - right.sortOrder).map(({ headingId, amount }): InvoiceCodingLine => ({ headingId, amount }));
        });
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async findSupplierHeadingId(businessId, supplier, excludeInvoiceId) {
      const db = databaseForOperation(database);
      try {
        const [row] = await db.select({ headingId: sql<string>`min(${invoiceCodings.headingId})` }).from(invoices)
          .innerJoin(invoiceCodings, and(eq(invoiceCodings.businessId, invoices.businessId), eq(invoiceCodings.invoiceId, invoices.id)))
          .where(and(
            eq(invoices.businessId, businessId),
            ne(invoices.id, excludeInvoiceId),
            sql`lower(btrim(${invoices.supplier}, ${TRIMMED})) = ${supplier}`,
          ))
          .groupBy(invoices.id, invoices.updatedAt)
          .having(sql`count(*) = 1`)
          .orderBy(desc(invoices.updatedAt), desc(invoices.id))
          .limit(1);
        return row?.headingId ?? null;
      } catch (error) {
        return preserveOrMap(error);
      }
    },
  };
}
