import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { boolean, index, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { users } from "./users";

export const MembershipRole = ["owner_admin", "general_admin", "administrator"] as const;
export type MembershipRole = (typeof MembershipRole)[number];
export const membershipRoleEnum = pgEnum("membership_role", MembershipRole);

export const ownerAdminInvariant = {
  role: "owner_admin",
  activePredicate: "role = 'owner_admin' AND is_active = true",
  replacementOrder: "deactivate the current owner before activating the replacement",
  requiresAtomicTransaction: true,
} as const;

export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id").notNull().references(() => users.id),
    businessId: text("business_id").notNull().references(() => businesses.id),
    role: membershipRoleEnum("role").notNull().default("administrator"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_user_business_unique").on(table.userId, table.businessId),
    uniqueIndex("memberships_one_active_owner_per_business")
      .on(table.businessId)
      .where(sql`${table.role} = 'owner_admin' AND ${table.isActive} = true`),
    index("memberships_business_active_idx").on(table.businessId, table.isActive),
  ],
);

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
export type MembershipId = Membership["id"];
