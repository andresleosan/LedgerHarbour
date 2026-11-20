import { randomUUID } from "node:crypto";

import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { businessesReference } from "./businesses";

export const accountHeadings = pgTable(
  "account_headings",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    businessId: text("business_id").notNull().references(() => businessesReference.id),
    position: integer("position").notNull(),
    templateValue: text("template_value").notNull(),
    valueType: text("value_type").notNull(),
    headingGroup: text("heading_group").notNull(),
    sortOrder: integer("sort_order").notNull(),
    displayName: text("display_name").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    blockedReason: text("blocked_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("account_headings_business_id_unique").on(table.businessId, table.id),
    uniqueIndex("account_headings_business_position_unique").on(table.businessId, table.position),
    index("account_headings_business_sort_order_idx").on(table.businessId, table.sortOrder),
    check("account_headings_position_check", sql`${table.position} > 0`),
    check("account_headings_value_type_check", sql`${table.valueType} IN ('text', 'number')`),
    check("account_headings_heading_group_check", sql`${table.headingGroup} IN ('income', 'cost_of_sales', 'expenses', 'assets', 'liabilities', 'equity')`),
    check("account_headings_display_name_check", sql`char_length(${table.displayName}) BETWEEN 1 AND 100`),
    check("account_headings_blocked_reason_check", sql`${table.blockedReason} IS NULL OR ${table.blockedReason} IN ('blank_heading', 'marked_do_not_use', 'total_not_read', 'total_read_twice', 'truncated_formula', 'missing_from_template')`),
    check("account_headings_blocked_inactive_check", sql`${table.blockedReason} IS NULL OR ${table.isActive} = false`),
  ],
);

export type AccountHeadingRow = typeof accountHeadings.$inferSelect;
export type NewAccountHeadingRow = typeof accountHeadings.$inferInsert;
