import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { foreignKey, index, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { membershipRoleEnum, memberships } from "./memberships";
import { users } from "./users";

export const JoinRequestStatus = ["pending", "approved", "rejected"] as const;
export type JoinRequestStatus = (typeof JoinRequestStatus)[number];
export const joinRequestStatusEnum = pgEnum("join_request_status", JoinRequestStatus);

export const joinRequests = pgTable(
  "join_requests",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    requesterId: text("requester_id").notNull().references(() => users.id),
    businessId: text("business_id").notNull().references(() => businesses.id),
    requestedRole: membershipRoleEnum("requested_role").notNull().default("administrator"),
    status: joinRequestStatusEnum("status").notNull().default("pending"),
    reviewedBy: text("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("join_requests_business_status_idx").on(table.businessId, table.status),
    uniqueIndex("join_requests_one_pending_per_requester_business")
      .on(table.requesterId, table.businessId)
      .where(sql`${table.status} = 'pending'`),
    foreignKey({
      columns: [table.reviewedBy, table.businessId],
      foreignColumns: [memberships.userId, memberships.businessId],
      name: "join_requests_reviewer_business_fk",
    }),
  ],
);

export type JoinRequest = typeof joinRequests.$inferSelect;
export type NewJoinRequest = typeof joinRequests.$inferInsert;
