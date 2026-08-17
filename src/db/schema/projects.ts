import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { platformMembers } from "./platform-members";
import { users } from "./users";

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    businessId: text("business_id").notNull().references(() => businesses.id),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    status: text("status").notNull().default("pending"),
    isActive: boolean("is_active").notNull().default(false),
    createdBy: text("created_by").notNull().references(() => users.id),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    statusReason: text("status_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("projects_business_normalized_name_unique").on(table.businessId, table.normalizedName),
    index("projects_business_status_idx").on(table.businessId, table.status),
    index("projects_created_by_idx").on(table.createdBy),
    check("projects_status_check", sql`${table.status} IN ('pending', 'active', 'rejected', 'suspended')`),
    check(
      "projects_status_activity_consistency_check",
      sql`(${table.status} = 'active' AND ${table.isActive} = true) OR (${table.status} <> 'active' AND ${table.isActive} = false)`,
    ),
    foreignKey({
      columns: [table.reviewedBy],
      foreignColumns: [platformMembers.id],
      name: "projects_reviewed_by_fk",
    }),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
