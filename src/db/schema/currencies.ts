import { randomUUID } from "node:crypto";

import { boolean, check, integer, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { businessesReference } from "./businesses";

export const currencies = pgTable(
  "currencies",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    businessId: text("business_id").notNull().references(() => businessesReference.id),
    name: text("name").notNull(),
    isoCode: text("iso_code"),
    symbol: text("symbol").notNull(),
    decimalCount: integer("decimal_count").notNull().default(2),
    isStandard: boolean("is_standard").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("currencies_business_iso_code_unique").on(table.businessId, table.isoCode),
    uniqueIndex("currencies_business_id_unique").on(table.businessId, table.id),
    index("currencies_business_active_idx").on(table.businessId, table.isActive),
    check("currencies_decimal_count_check", sql`${table.decimalCount} between 0 and 6`),
  ],
);

export type Currency = typeof currencies.$inferSelect;
export type NewCurrency = typeof currencies.$inferInsert;
