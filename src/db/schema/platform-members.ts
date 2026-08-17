import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { users } from "./users";

export const PlatformRole = ["platform_admin"] as const;
export type PlatformRole = (typeof PlatformRole)[number];
export const platformRoleEnum = pgEnum("platform_role", PlatformRole);

export const platformMembers = pgTable(
  "platform_members",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id"),
    normalizedEmail: text("normalized_email").notNull(),
    role: platformRoleEnum("role").notNull().default("platform_admin"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_members_normalized_email_unique").on(table.normalizedEmail),
    uniqueIndex("platform_members_user_id_unique").on(table.userId),
    index("platform_members_active_idx").on(table.isActive),
    check("platform_members_role_check", sql`${table.role} = 'platform_admin'`),
    check(
      "platform_members_normalized_email_check",
      sql`${table.normalizedEmail} = lower(btrim(${table.normalizedEmail})) AND length(${table.normalizedEmail}) > 3`,
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "platform_members_user_fk",
    }),
  ],
);

export type PlatformMember = typeof platformMembers.$inferSelect;
export type NewPlatformMember = typeof platformMembers.$inferInsert;
export type PlatformMemberId = PlatformMember["id"];
