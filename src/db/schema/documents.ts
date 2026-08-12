import { randomUUID } from "node:crypto";

import { bigint, foreignKey, index, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { businesses } from "./businesses";
import { memberships } from "./memberships";

export const DocumentStatus = ["uploaded", "processing", "needs_review", "approved", "failed"] as const;
export type DocumentStatus = (typeof DocumentStatus)[number];
export const documentStatusEnum = pgEnum("document_status", DocumentStatus);

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    businessId: text("business_id").notNull().references(() => businesses.id),
     uploaderId: text("uploader_id").notNull(),
    privateObjectKey: text("private_object_key").notNull(),
    originalFileName: text("original_file_name").notNull(),
    originalMimeType: text("original_mime_type").notNull(),
    originalSizeBytes: bigint("original_size_bytes", { mode: "number" }).notNull(),
    checksum: text("checksum"),
    status: documentStatusEnum("status").notNull().default("uploaded"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("documents_business_status_idx").on(table.businessId, table.status),
      uniqueIndex("documents_business_object_key_unique").on(table.businessId, table.privateObjectKey),
      uniqueIndex("documents_business_id_unique").on(table.businessId, table.id),
      uniqueIndex("documents_business_checksum_unique").on(table.businessId, table.checksum).where(sql`${table.checksum} IS NOT NULL`),
    foreignKey({
      columns: [table.uploaderId, table.businessId],
      foreignColumns: [memberships.userId, memberships.businessId],
      name: "documents_uploader_business_fk",
    }),
  ],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentId = Document["id"];
