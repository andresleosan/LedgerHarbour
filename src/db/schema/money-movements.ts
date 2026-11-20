import { randomUUID } from "node:crypto";

import { bigint, boolean, check, date, foreignKey, index, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { accountHeadings } from "./account-headings";
import { businessesReference } from "./businesses";
import { invoices } from "./invoices";
import { memberships } from "./memberships";

export const financialYears = pgTable(
  "financial_years",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    businessId: text("business_id").notNull().references(() => businessesReference.id),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("financial_years_business_id_unique").on(table.businessId, table.id),
    uniqueIndex("financial_years_business_start_unique").on(table.businessId, table.startDate),
    uniqueIndex("financial_years_one_open_per_business").on(table.businessId).where(sql`status = 'open'`),
    check("financial_years_dates_check", sql`${table.endDate} > ${table.startDate}`),
    check("financial_years_status_check", sql`${table.status} IN ('open', 'closed')`),
  ],
);

export const moneyAccounts = pgTable(
  "money_accounts",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    businessId: text("business_id").notNull().references(() => businessesReference.id),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    sheetName: text("sheet_name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("money_accounts_business_id_unique").on(table.businessId, table.id),
    uniqueIndex("money_accounts_active_name_unique").on(table.businessId, sql`lower(name)`).where(sql`is_active`),
    uniqueIndex("money_accounts_active_sheet_unique").on(table.businessId, table.sheetName).where(sql`is_active`),
    check("money_accounts_name_check", sql`char_length(${table.name}) BETWEEN 1 AND 100`),
    check("money_accounts_kind_check", sql`${table.kind} IN ('bank', 'cash')`),
    check("money_accounts_sheet_name_check", sql`char_length(${table.sheetName}) BETWEEN 1 AND 100`),
  ],
);

export const moneyAccountOpenings = pgTable(
  "money_account_openings",
  {
    businessId: text("business_id").notNull(),
    moneyAccountId: text("money_account_id").notNull(),
    financialYearId: text("financial_year_id").notNull(),
    openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [
    primaryKey({ name: "money_account_openings_pkey", columns: [table.businessId, table.moneyAccountId, table.financialYearId] }),
    foreignKey({ columns: [table.businessId, table.moneyAccountId], foreignColumns: [moneyAccounts.businessId, moneyAccounts.id], name: "money_account_openings_account_fk" }),
    foreignKey({ columns: [table.businessId, table.financialYearId], foreignColumns: [financialYears.businessId, financialYears.id], name: "money_account_openings_year_fk" }),
  ],
);

export const movements = pgTable(
  "movements",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    /** Creation order; breaks ties between movements of the same date. */
    createdSeq: bigint("created_seq", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    businessId: text("business_id").notNull().references(() => businessesReference.id),
    financialYearId: text("financial_year_id").notNull(),
    moneyAccountId: text("money_account_id").notNull(),
    movementDate: date("movement_date", { mode: "string" }).notNull(),
    narrative: text("narrative").notNull(),
    headingId: text("heading_id"),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    origin: text("origin").notNull(),
    sourceInvoiceId: text("source_invoice_id"),
    sourceRef: text("source_ref"),
    transferGroupId: text("transfer_group_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("movements_listing_idx").on(table.businessId, table.financialYearId, table.moneyAccountId, table.movementDate, table.createdSeq),
    index("movements_source_invoice_idx").on(table.businessId, table.sourceInvoiceId).where(sql`source_invoice_id IS NOT NULL`),
    foreignKey({ columns: [table.businessId, table.financialYearId], foreignColumns: [financialYears.businessId, financialYears.id], name: "movements_year_fk" }),
    foreignKey({ columns: [table.businessId, table.moneyAccountId], foreignColumns: [moneyAccounts.businessId, moneyAccounts.id], name: "movements_account_fk" }),
    foreignKey({ columns: [table.businessId, table.headingId], foreignColumns: [accountHeadings.businessId, accountHeadings.id], name: "movements_heading_fk" }),
    foreignKey({ columns: [table.businessId, table.sourceInvoiceId], foreignColumns: [invoices.businessId, invoices.id], name: "movements_source_invoice_fk" }),
    foreignKey({ columns: [table.createdBy, table.businessId], foreignColumns: [memberships.userId, memberships.businessId], name: "movements_creator_business_fk" }),
    check("movements_narrative_check", sql`char_length(${table.narrative}) BETWEEN 1 AND 200`),
    check("movements_amount_check", sql`${table.amount} <> 0`),
    check("movements_origin_check", sql`${table.origin} IN ('invoice', 'manual', 'statement')`),
    check("movements_heading_check", sql`${table.headingId} IS NOT NULL OR ${table.origin} = 'statement'`),
    check("movements_source_invoice_check", sql`(${table.sourceInvoiceId} IS NOT NULL) = (${table.origin} = 'invoice')`),
  ],
);

export type FinancialYearRow = typeof financialYears.$inferSelect;
export type MoneyAccountRow = typeof moneyAccounts.$inferSelect;
export type MovementRow = typeof movements.$inferSelect;
