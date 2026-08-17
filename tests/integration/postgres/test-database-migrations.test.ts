import { describe, expect, it } from "vitest";

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
});
