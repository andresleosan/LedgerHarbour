import { randomUUID } from "node:crypto";

import { boolean, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { businesses } from "./businesses";

export const categories = pgTable(
  "categories",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    businessId: text("business_id").notNull().references(() => businesses.id),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("categories_business_name_unique").on(table.businessId, table.name),
    uniqueIndex("categories_business_id_unique").on(table.businessId, table.id),
    index("categories_business_active_idx").on(table.businessId, table.isActive),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
