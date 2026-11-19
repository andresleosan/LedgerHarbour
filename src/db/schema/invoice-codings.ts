import { randomUUID } from "node:crypto";

import { check, foreignKey, index, integer, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { accountHeadings } from "./account-headings";
import { businessesReference } from "./businesses";
import { invoices } from "./invoices";

/** One line of an invoice's coding; an unsplit invoice has a single line equal to its total. */
export const invoiceCodings = pgTable(
  "invoice_codings",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    businessId: text("business_id").notNull().references(() => businessesReference.id),
    invoiceId: text("invoice_id").notNull(),
    headingId: text("heading_id").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("invoice_codings_business_invoice_idx").on(table.businessId, table.invoiceId),
    uniqueIndex("invoice_codings_invoice_sort_unique").on(table.invoiceId, table.sortOrder),
    uniqueIndex("invoice_codings_invoice_heading_unique").on(table.invoiceId, table.headingId),
    foreignKey({ columns: [table.businessId, table.invoiceId], foreignColumns: [invoices.businessId, invoices.id], name: "invoice_codings_invoice_fk" }),
    foreignKey({ columns: [table.businessId, table.headingId], foreignColumns: [accountHeadings.businessId, accountHeadings.id], name: "invoice_codings_heading_fk" }),
    check("invoice_codings_amount_check", sql`${table.amount} > 0`),
  ],
);

export type InvoiceCodingRow = typeof invoiceCodings.$inferSelect;
