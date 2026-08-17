import { randomUUID } from "node:crypto";

import { foreignKey, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { platformMembers } from "./platform-members";

export const platformAuditEvents = pgTable(
  "platform_audit_events",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    beforeStatus: text("before_status"),
    afterStatus: text("after_status"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("platform_audit_events_target_idx").on(table.targetType, table.targetId, table.createdAt),
    index("platform_audit_events_actor_idx").on(table.actorId, table.createdAt),
    foreignKey({
      columns: [table.actorId],
      foreignColumns: [platformMembers.id],
      name: "platform_audit_events_actor_fk",
    }),
  ],
);

export type PlatformAuditEvent = typeof platformAuditEvents.$inferSelect;
export type NewPlatformAuditEvent = typeof platformAuditEvents.$inferInsert;
