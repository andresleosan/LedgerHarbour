import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { memberships } from "./memberships";
import { users } from "./users";

export const AuditActorType = ["user", "system"] as const;
export type AuditActorType = (typeof AuditActorType)[number];
export const auditActorTypeEnum = pgEnum("audit_actor_type", AuditActorType);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    businessId: text("business_id").notNull().references(() => businesses.id),
    actorType: auditActorTypeEnum("actor_type").notNull().default("user"),
    actorId: text("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_business_created_at_idx").on(table.businessId, table.createdAt),
    check(
      "audit_events_actor_type_check",
      sql`(${table.actorType} = 'system' AND ${table.actorId} IS NULL) OR (${table.actorType} = 'user' AND ${table.actorId} IS NOT NULL)`,
    ),
    foreignKey({
      columns: [table.actorId, table.businessId],
      foreignColumns: [memberships.userId, memberships.businessId],
      name: "audit_events_user_actor_business_fk",
    }),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
