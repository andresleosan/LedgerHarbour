import { randomUUID } from "node:crypto";

import { bigint, check, foreignKey, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { businessesReference } from "./businesses";
import { memberships } from "./memberships";

export const businessTemplates = pgTable(
  "business_templates",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    businessId: text("business_id").notNull().references(() => businessesReference.id),
    privateObjectKey: text("private_object_key").notNull(),
    originalFileName: text("original_file_name").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksum: text("checksum").notNull(),
    profile: jsonb("profile").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("business_templates_business_unique").on(table.businessId),
    uniqueIndex("business_templates_business_id_unique").on(table.businessId, table.id),
    check("business_templates_file_name_check", sql`char_length(${table.originalFileName}) BETWEEN 1 AND 255`),
    check("business_templates_size_check", sql`${table.sizeBytes} > 0`),
    check("business_templates_checksum_check", sql`${table.checksum} ~ '^[0-9a-f]{64}$'`),
    foreignKey({
      columns: [table.uploadedBy, table.businessId],
      foreignColumns: [memberships.userId, memberships.businessId],
      name: "business_templates_uploader_business_fk",
    }),
  ],
);

export type BusinessTemplateRow = typeof businessTemplates.$inferSelect;
export type NewBusinessTemplateRow = typeof businessTemplates.$inferInsert;
