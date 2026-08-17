import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

import { createTestDatabase } from "../../../src/db/test-database";
import {
  applyBusinessLifecycleMigration,
  checkInitialMigration,
  applyInitialMigration,
  applyMembershipLifecycleMigration,
  applyPlatformControlPlaneMigration,
  checkMembershipLifecycleMigration,
  rollbackMembershipLifecycleMigration,
  type MigrationClientFactory,
} from "../../../src/db/migration-runner";

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

  it("applies, rolls back, and reapplies membership lifecycle 0004 through the runner", async () => {
    const client = new PGlite();
    const clientFactory: MigrationClientFactory = async () => ({
      query: async <Row = Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
        if (!values && /^(BEGIN|COMMIT|ROLLBACK)\b/i.test(text.trim())) {
          await client.exec(text);
          return { rows: [] as Row[], rowCount: 0 };
        }
        const result = await client.query<Row>(text, values ? [...values] : undefined);
        return { rows: result.rows, rowCount: result.rows.length };
      },
      exec: (text: string) => client.exec(text),
      end: async () => undefined,
    });
    try {
      const config = { databaseUrl: "pglite://task4", allowStagingMigration: true as const };
      await applyInitialMigration(config, clientFactory);
      await expect(checkInitialMigration(config, clientFactory)).resolves.toMatchObject({ applied: true, ledgerRecordPresent: true });
      await applyPlatformControlPlaneMigration(config, clientFactory);
      await applyBusinessLifecycleMigration(config, clientFactory);
      const applied = await applyMembershipLifecycleMigration(config, clientFactory);
      expect(applied).toEqual({ version: "0004_membership_lifecycle", applied: true });

      const ledger = await client.query<{ version: string }>(`
        SELECT version FROM ledgerharbour_schema_migrations ORDER BY version
      `);
      expect(ledger.rows.map((row) => row.version)).toContain("0004_membership_lifecycle");

      const constraints = await client.query<{ conname: string }>(`
        SELECT conname FROM pg_constraint
        WHERE conname IN ('memberships_status_check', 'memberships_status_activity_consistency_check')
        ORDER BY conname
      `);
      expect(constraints.rows.map((row) => row.conname)).toEqual([
        "memberships_status_activity_consistency_check",
        "memberships_status_check",
      ]);

      const rollback = await rollbackMembershipLifecycleMigration(config, clientFactory);
      expect(rollback).toEqual({ version: "0004_membership_lifecycle", applied: true });
      await expect(checkMembershipLifecycleMigration(config, clientFactory)).resolves.toMatchObject({
        version: "0004_membership_lifecycle",
        applied: false,
        ledgerRecordPresent: false,
      });
      const column = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'memberships' AND column_name = 'status'
      `);
      expect(column.rows).toEqual([]);

      const reapplied = await applyMembershipLifecycleMigration(config, clientFactory);
      expect(reapplied).toEqual({ version: "0004_membership_lifecycle", applied: true });
      await expect(checkMembershipLifecycleMigration(config, clientFactory)).resolves.toMatchObject({
        version: "0004_membership_lifecycle",
        applied: true,
        ledgerRecordPresent: true,
      });
    } finally {
      await client.close();
    }
  }, 30_000);
});
