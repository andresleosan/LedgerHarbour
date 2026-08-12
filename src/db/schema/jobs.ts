import { randomUUID } from "node:crypto";

import { foreignKey, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { documents } from "./documents";
import { memberships } from "./memberships";

export const JobStatus = ["queued", "processing", "completed", "failed"] as const;
export type JobStatus = (typeof JobStatus)[number];
export const jobStatusEnum = pgEnum("job_status", JobStatus);

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    businessId: text("business_id").notNull().references(() => businesses.id),
    documentId: text("document_id").notNull(),
    requestedBy: text("requested_by").notNull(),
    jobType: text("job_type").notNull().default("ocr"),
    status: jobStatusEnum("status").notNull().default("queued"),
    retryCount: integer("retry_count").notNull().default(0),
    errorSummary: text("error_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("jobs_business_status_idx").on(table.businessId, table.status),
    uniqueIndex("jobs_business_document_type_unique").on(table.businessId, table.documentId, table.jobType),
    foreignKey({
      columns: [table.businessId, table.documentId],
      foreignColumns: [documents.businessId, documents.id],
      name: "jobs_business_document_fk",
    }),
    foreignKey({
      columns: [table.requestedBy, table.businessId],
      foreignColumns: [memberships.userId, memberships.businessId],
      name: "jobs_requested_by_business_fk",
    }),
  ],
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
