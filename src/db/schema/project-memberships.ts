import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { projects } from "./projects";
import { users } from "./users";

export const projectMemberships = pgTable(
  "project_memberships",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    projectId: text("project_id").notNull().references(() => projects.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role").notNull().default("member"),
    isActive: boolean("is_active").notNull().default(true),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("project_memberships_project_user_unique").on(table.projectId, table.userId),
    index("project_memberships_project_active_idx").on(table.projectId, table.isActive),
    check("project_memberships_role_check", sql`${table.role} IN ('owner', 'member')`),
    check("project_memberships_status_check", sql`${table.status} IN ('pending', 'active', 'suspended', 'revoked')`),
    check(
      "project_memberships_status_activity_consistency_check",
      sql`(${table.status} = 'active' AND ${table.isActive} = true) OR (${table.status} <> 'active' AND ${table.isActive} = false)`,
    ),
  ],
);

export type ProjectMembershipRow = typeof projectMemberships.$inferSelect;
export type NewProjectMembershipRow = typeof projectMemberships.$inferInsert;
