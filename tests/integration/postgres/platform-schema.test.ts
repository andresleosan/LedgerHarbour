import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  bootstrapPlatformAdmins,
  type PlatformBootstrapDatabase,
} from "../../../src/db/platform-bootstrap";
import { createTestDatabase } from "../../../src/db/test-database";

async function applyPlatformMigration(
  db: PlatformBootstrapDatabase,
  executeMigration: (migrationSql: string) => Promise<unknown>,
): Promise<void> {
  const migrationSql = await readFile(
    new URL("../../../src/db/migrations/0002_platform_control_plane.sql", import.meta.url),
    "utf8",
  );
  await executeMigration(migrationSql);
}

describe("PostgreSQL platform control-plane migration", () => {
  it("creates the tables and enforces unique normalized emails and the fixed role", async () => {
    const { db, close, execute } = await createTestDatabase();

    try {
      await applyPlatformMigration(db, execute);

      const tables = await db.execute<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('platform_members', 'platform_audit_events')
        ORDER BY table_name
      `);
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "platform_audit_events",
        "platform_members",
      ]);

      await db.execute(`
        INSERT INTO platform_members (id, normalized_email, role)
        VALUES ('platform-1', 'andres.san1404@gmail.com', 'platform_admin')
      `);
      await expect(db.execute(`
        INSERT INTO platform_members (id, normalized_email, role)
        VALUES ('platform-2', 'andres.san1404@gmail.com', 'platform_admin')
      `)).rejects.toThrow();
      await expect(db.execute(`
        INSERT INTO platform_members (id, normalized_email, role)
        VALUES ('platform-3', 'partner@example.com', 'not_a_platform_role')
      `)).rejects.toThrow();
    } finally {
      await close();
    }
  }, 30_000);

  it("bootstraps explicit operators idempotently and keeps audit events append-only", async () => {
    const { db, close, execute } = await createTestDatabase();

    try {
      await applyPlatformMigration(db, execute);

      await expect(bootstrapPlatformAdmins(db, [
        " Andres.San1404@GMAIL.COM ",
        "partner@example.com",
      ])).resolves.toMatchObject({ created: 2 });
      await expect(bootstrapPlatformAdmins(db, [
        "andres.san1404@gmail.com",
        "PARTNER@example.com",
      ])).resolves.toMatchObject({ created: 0 });

      const members = await db.execute<{ id: string; normalized_email: string; role: string; is_active: boolean }>(`
        SELECT id, normalized_email, role, is_active
        FROM platform_members
        ORDER BY normalized_email
      `);
      expect(members.rows).toHaveLength(2);
      expect(members.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          normalized_email: "andres.san1404@gmail.com",
          role: "platform_admin",
          is_active: true,
        }),
        expect.objectContaining({
          normalized_email: "partner@example.com",
          role: "platform_admin",
          is_active: true,
        }),
      ]));

      await db.execute(`
        INSERT INTO platform_audit_events
          (id, actor_id, action, target_type, target_id, before_status, after_status, reason)
        VALUES
          ('platform-audit-1', '${members.rows[0]?.id}', 'business_approved', 'business', 'business-1', 'pending', 'active', 'validated request')
      `);
      await expect(db.execute(`
        UPDATE platform_audit_events SET reason = 'changed' WHERE id = 'platform-audit-1'
      `)).rejects.toThrow();
      await expect(db.execute(`
        DELETE FROM platform_audit_events WHERE id = 'platform-audit-1'
      `)).rejects.toThrow();
    } finally {
      await close();
    }
  }, 30_000);
});
