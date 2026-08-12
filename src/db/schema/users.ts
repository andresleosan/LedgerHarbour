import { randomUUID } from "node:crypto";

import { pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const VerificationState = ["unverified", "verified"] as const;
export type VerificationState = (typeof VerificationState)[number];
export const verificationStateEnum = pgEnum("verification_state", VerificationState);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    providerId: text("provider_id").notNull(),
    email: text("email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    displayName: text("display_name").notNull(),
    verificationState: verificationStateEnum("verification_state").notNull().default("unverified"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_provider_id_unique").on(table.providerId),
    uniqueIndex("users_normalized_email_unique").on(table.normalizedEmail),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserId = User["id"];
