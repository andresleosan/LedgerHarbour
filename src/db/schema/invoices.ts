import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { categories } from "./categories";
import { currencies } from "./currencies";
import { documents } from "./documents";
import { moneyAccounts } from "./money-movements";

export const InvoiceReviewState = ["draft", "needs_review", "approved"] as const;
export type InvoiceReviewState = (typeof InvoiceReviewState)[number];
export const invoiceReviewStateEnum = pgEnum("invoice_review_state", InvoiceReviewState);

export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    businessId: text("business_id").notNull().references(() => businesses.id),
    documentId: text("document_id").notNull(),
    supplier: text("supplier"),
    invoiceNumber: text("invoice_number"),
    invoiceDate: date("invoice_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }),
    taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }),
    total: numeric("total", { precision: 14, scale: 2 }),
    currencyId: text("currency_id"),
    categoryId: text("category_id"),
    confidenceData: jsonb("confidence_data").notNull().default({}),
    notes: text("notes"),
    reviewState: invoiceReviewStateEnum("review_state").notNull().default("draft"),
    kind: text("kind").notNull().default("invoice"),
    paymentStatus: text("payment_status"),
    paidAccountId: text("paid_account_id"),
    paidOn: date("paid_on", { mode: "string" }),
    amountDebited: numeric("amount_debited", { precision: 14, scale: 2 }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("invoices_document_unique").on(table.documentId),
    index("invoices_business_invoice_number_idx").on(table.businessId, table.invoiceNumber),
    uniqueIndex("invoices_business_id_unique").on(table.businessId, table.id),
    foreignKey({
      columns: [table.businessId, table.documentId],
      foreignColumns: [documents.businessId, documents.id],
      name: "invoices_business_document_fk",
    }),
    foreignKey({
      columns: [table.businessId, table.currencyId],
      foreignColumns: [currencies.businessId, currencies.id],
      name: "invoices_business_currency_fk",
    }),
    foreignKey({
      columns: [table.businessId, table.categoryId],
      foreignColumns: [categories.businessId, categories.id],
      name: "invoices_business_category_fk",
    }),
    // Same-tenant key: an invoice is only ever paid from an account of its own business.
    foreignKey({
      columns: [table.businessId, table.paidAccountId],
      foreignColumns: [moneyAccounts.businessId, moneyAccounts.id],
      name: "invoices_paid_account_fk",
    }),
    check("invoices_kind_check", sql`${table.kind} IN ('invoice', 'credit_note')`),
    check("invoices_payment_status_check", sql`${table.paymentStatus} IN ('paid', 'unpaid', 'paid_privately')`),
    check("invoices_amount_debited_check", sql`${table.amountDebited} > 0`),
    check("invoices_payment_details_check", sql`(${table.paymentStatus} = 'paid' AND ${table.paidAccountId} IS NOT NULL AND ${table.paidOn} IS NOT NULL AND ${table.amountDebited} IS NOT NULL) OR (${table.paymentStatus} IS DISTINCT FROM 'paid' AND ${table.paidAccountId} IS NULL AND ${table.paidOn} IS NULL AND ${table.amountDebited} IS NULL)`),
  ],
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceId = Invoice["id"];
