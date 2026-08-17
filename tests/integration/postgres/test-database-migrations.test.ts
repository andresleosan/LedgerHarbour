import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import { createTestDatabase } from "../../../src/db/test-database";

describe("PGlite test database migrations", () => {
  it("applies platform control plane before business lifecycle", async () => {
    const { db, close } = await createTestDatabase();
    try {
      const tables = await db.execute<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('platform_members', 'platform_audit_events')
        ORDER BY table_name
      `);
      const columns = await db.execute<{ column_name: string }>(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'status'
      `);
      expect(tables.rows.map((row) => row.table_name)).toEqual(["platform_audit_events", "platform_members"]);
      expect(columns.rows).toEqual([{ column_name: "status" }]);
    } finally {
      await close();
    }
  }, 30_000);

  it("applies membership lifecycle 0004 and rolls it back cleanly", async () => {
    const { db, execute, close } = await createTestDatabase();
    try {
      await db.execute("CREATE TABLE ledgerharbour_schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
      await db.execute("INSERT INTO ledgerharbour_schema_migrations (version) VALUES ('0004_membership_lifecycle')");
      const ledger = await db.execute<{ version: string }>(`
        SELECT version FROM ledgerharbour_schema_migrations ORDER BY version
      `);
      expect(ledger.rows.map((row) => row.version)).toContain("0004_membership_lifecycle");

      const rollback = await readFile(new URL("../../../src/db/migrations/rollback/0004_membership_lifecycle_down.sql", import.meta.url), "utf8");
      await execute(rollback);

      const column = await db.execute(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'memberships' AND column_name = 'status'
      `);
      const rolledBack = await db.execute<{ version: string }>(`
        SELECT version FROM ledgerharbour_schema_migrations WHERE version = '0004_membership_lifecycle'
      `);
      expect(column.rows).toEqual([]);
      expect(rolledBack.rows).toEqual([]);
    } finally {
      await close();
    }
  }, 30_000);
});
