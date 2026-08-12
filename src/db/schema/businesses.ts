import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgEnum, pgTable, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";

import { currencies } from "./currencies";

export const businessesReference = {} as { id: AnyPgColumn };

export const BaseCurrencyKind = ["standard", "custom"] as const;
export type BaseCurrencyKind = (typeof BaseCurrencyKind)[number];
export const baseCurrencyKindEnum = pgEnum("base_currency_kind", BaseCurrencyKind);

export const customCurrencyCreationContract = {
  initialBase: { kind: "standard", code: "GBP" },
  steps: [
    "create_business_with_standard_base",
    "insert_custom_currency_for_business",
    "update_business_to_custom_base",
  ],
  requiresAtomicTransaction: true,
} as const;

export const businesses = pgTable(
  "businesses",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    name: text("name").notNull(),
    normalizedSearchName: text("normalized_search_name").notNull(),
    baseCurrencyKind: baseCurrencyKindEnum("base_currency_kind").notNull().default("standard"),
    baseCurrencyCode: text("base_currency_code").default("GBP"),
    baseCurrencyId: text("base_currency_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("businesses_normalized_search_name_idx").on(table.normalizedSearchName),
    check(
      "businesses_base_currency_reference_check",
      sql`(${table.baseCurrencyKind} = 'standard' AND ${table.baseCurrencyCode} IS NOT NULL AND ${table.baseCurrencyId} IS NULL) OR (${table.baseCurrencyKind} = 'custom' AND ${table.baseCurrencyCode} IS NULL AND ${table.baseCurrencyId} IS NOT NULL)`,
    ),
    foreignKey({
      columns: [table.id, table.baseCurrencyId],
      foreignColumns: [currencies.businessId, currencies.id],
      name: "businesses_base_currency_custom_fk",
    }),
  ],
);

businessesReference.id = businesses.id;

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type BusinessId = Business["id"];
