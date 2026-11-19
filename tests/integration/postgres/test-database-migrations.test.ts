import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

import { createTestDatabase } from "../../../src/db/test-database";
import {
  applyAccountHeadingsMigration,
  applyBusinessTemplatesMigration,
  applyBusinessLifecycleMigration,
  applyAllMigrations,
  checkInitialMigration,
  checkAllMigrations,
  applyInitialMigration,
  applyMembershipLifecycleMigration,
  applyProjectsMigration,
  applyPlatformControlPlaneMigration,
  checkMembershipLifecycleMigration,
  checkAccountHeadingsMigration,
  checkBusinessTemplatesMigration,
  checkProjectsMigration,
  rollbackAccountHeadingsMigration,
  rollbackBusinessTemplatesMigration,
  applyMoneyMovementsMigration,
  checkMoneyMovementsMigration,
  rollbackMoneyMovementsMigration,
  applyInvoiceCodingsMigration,
  checkInvoiceCodingsMigration,
  rollbackInvoiceCodingsMigration,
  rollbackMembershipLifecycleMigration,
  rollbackProjectsMigration,
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

  it("applies, rolls back, and reapplies projects 0005 after membership lifecycle", async () => {
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
      const config = { databaseUrl: "pglite://task5", allowStagingMigration: true as const };
      await applyInitialMigration(config, clientFactory);
      await applyPlatformControlPlaneMigration(config, clientFactory);
      await applyBusinessLifecycleMigration(config, clientFactory);
      await applyMembershipLifecycleMigration(config, clientFactory);
      await expect(applyProjectsMigration(config, clientFactory)).resolves.toEqual({ version: "0005_projects", applied: true });
      await expect(checkProjectsMigration(config, clientFactory)).resolves.toMatchObject({ applied: true, requiredTableCount: 2, ledgerRecordPresent: true });
      await expect(rollbackProjectsMigration(config, clientFactory)).resolves.toEqual({ version: "0005_projects", applied: true });
      await expect(checkProjectsMigration(config, clientFactory)).resolves.toMatchObject({ applied: false, requiredTableCount: 0, ledgerRecordPresent: false });
      await expect(applyProjectsMigration(config, clientFactory)).resolves.toEqual({ version: "0005_projects", applied: true });
      await expect(checkProjectsMigration(config, clientFactory)).resolves.toMatchObject({ applied: true, requiredTableCount: 2, ledgerRecordPresent: true });
    } finally {
      await client.close();
    }
  }, 30_000);

  it("runs and checks the canonical migration sequence through projects 0005", async () => {
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
      const config = { databaseUrl: "pglite://task5-canonical", allowStagingMigration: true as const };
      const applied = await applyAllMigrations(config, clientFactory);
      expect(Object.values(applied).map((result) => result.version)).toEqual([
        "0001_initial",
        "0002_platform_control_plane",
        "0003_business_lifecycle",
        "0004_membership_lifecycle",
        "0005_projects",
        "0006_business_request_audit",
        "0007_rate_limit_windows",
        "0008_account_headings",
        "0009_business_templates",
        "0010_money_movements",
        "0011_invoice_codings",
      ]);
      await expect(checkAllMigrations(config, clientFactory)).resolves.toMatchObject({
        projects: { applied: true, requiredTableCount: 2, ledgerRecordPresent: true },
      });
    } finally {
      await client.close();
    }
  }, 30_000);

  it("applies, rolls back exactly, and reapplies account headings 0008", async () => {
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
    const schemaObjects = async () => {
      const relations = await client.query<{ name: string }>(`
        SELECT relname AS name FROM pg_class WHERE relnamespace = 'public'::regnamespace
        UNION
        SELECT conname AS name FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype <> 'n'
        ORDER BY name
      `);
      return relations.rows.map((row) => row.name);
    };
    const ledger = async () => (await client.query<{ version: string }>("SELECT version FROM ledgerharbour_schema_migrations ORDER BY version")).rows.map((row) => row.version);
    try {
      const config = { databaseUrl: "pglite://lh014", allowStagingMigration: true as const };
      await applyAllMigrations(config, clientFactory);
      // 0010 movements and 0011 invoice codings reference account_headings, so the later migrations are rolled back first.
      await rollbackInvoiceCodingsMigration(config, clientFactory);
      await rollbackMoneyMovementsMigration(config, clientFactory);
      const withHeadings = await schemaObjects();
      await expect(checkAccountHeadingsMigration(config, clientFactory)).resolves.toMatchObject({ applied: true, requiredTableCount: 1, ledgerRecordPresent: true });

      await expect(rollbackAccountHeadingsMigration(config, clientFactory)).resolves.toEqual({ version: "0008_account_headings", applied: true });
      const withoutHeadings = await schemaObjects();
      expect(withHeadings.filter((name) => !withoutHeadings.includes(name))).toEqual([
        "account_headings",
        "account_headings_blocked_inactive_check",
        "account_headings_blocked_reason_check",
        "account_headings_business_id_fkey",
        "account_headings_business_id_unique",
        "account_headings_business_position_unique",
        "account_headings_business_sort_order_idx",
        "account_headings_display_name_check",
        "account_headings_heading_group_check",
        "account_headings_pkey",
        "account_headings_position_check",
        "account_headings_value_type_check",
      ]);
      expect(withoutHeadings.every((name) => withHeadings.includes(name))).toBe(true);
      expect(await ledger()).not.toContain("0008_account_headings");
      expect(await ledger()).toContain("0007_rate_limit_windows");
      await expect(checkAccountHeadingsMigration(config, clientFactory)).resolves.toMatchObject({ applied: false, requiredTableCount: 0, ledgerRecordPresent: false });

      await expect(applyAccountHeadingsMigration(config, clientFactory)).resolves.toEqual({ version: "0008_account_headings", applied: true });
      expect(await schemaObjects()).toEqual(withHeadings);
    } finally {
      await client.close();
    }
  }, 30_000);
  it("applies, rolls back exactly, and reapplies business templates 0009", async () => {
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
    const schemaObjects = async () => {
      const relations = await client.query<{ name: string }>(`
        SELECT relname AS name FROM pg_class WHERE relnamespace = 'public'::regnamespace
        UNION
        SELECT conname AS name FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype <> 'n'
        ORDER BY name
      `);
      return relations.rows.map((row) => row.name);
    };
    const ledger = async () => (await client.query<{ version: string }>("SELECT version FROM ledgerharbour_schema_migrations ORDER BY version")).rows.map((row) => row.version);
    try {
      const config = { databaseUrl: "pglite://lh014b", allowStagingMigration: true as const };
      await applyAllMigrations(config, clientFactory);
      const withTemplates = await schemaObjects();
      await expect(checkBusinessTemplatesMigration(config, clientFactory)).resolves.toMatchObject({ applied: true, requiredTableCount: 1, ledgerRecordPresent: true });

      await expect(rollbackBusinessTemplatesMigration(config, clientFactory)).resolves.toEqual({ version: "0009_business_templates", applied: true });
      const withoutTemplates = await schemaObjects();
      expect(withTemplates.filter((name) => !withoutTemplates.includes(name))).toEqual([
        "business_templates",
        "business_templates_business_id_fkey",
        "business_templates_business_id_unique",
        "business_templates_business_unique",
        "business_templates_checksum_check",
        "business_templates_file_name_check",
        "business_templates_pkey",
        "business_templates_size_check",
        "business_templates_uploader_business_fk",
      ]);
      expect(withoutTemplates.every((name) => withTemplates.includes(name))).toBe(true);
      expect(await ledger()).not.toContain("0009_business_templates");
      expect(await ledger()).toContain("0008_account_headings");
      await expect(checkBusinessTemplatesMigration(config, clientFactory)).resolves.toMatchObject({ applied: false, requiredTableCount: 0, ledgerRecordPresent: false });

      await expect(applyBusinessTemplatesMigration(config, clientFactory)).resolves.toEqual({ version: "0009_business_templates", applied: true });
      expect(await schemaObjects()).toEqual(withTemplates);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("applies, rolls back exactly, and reapplies money movements 0010", async () => {
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
    const schemaObjects = async () => {
      const relations = await client.query<{ name: string }>(`
        SELECT relname AS name FROM pg_class WHERE relnamespace = 'public'::regnamespace
        UNION
        SELECT conname AS name FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype <> 'n'
        ORDER BY name
      `);
      return relations.rows.map((row) => row.name);
    };
    const ledger = async () => (await client.query<{ version: string }>("SELECT version FROM ledgerharbour_schema_migrations ORDER BY version")).rows.map((row) => row.version);
    try {
      const config = { databaseUrl: "pglite://lh015", allowStagingMigration: true as const };
      await applyAllMigrations(config, clientFactory);
      const withMoney = await schemaObjects();
      await expect(checkMoneyMovementsMigration(config, clientFactory)).resolves.toMatchObject({ applied: true, requiredTableCount: 4, ledgerRecordPresent: true });
      await expect(checkAllMigrations(config, clientFactory)).resolves.toMatchObject({ moneyMovements: { version: "0010_money_movements", applied: true } });

      await expect(rollbackMoneyMovementsMigration(config, clientFactory)).resolves.toEqual({ version: "0010_money_movements", applied: true });
      const withoutMoney = await schemaObjects();
      expect(withMoney.filter((name) => !withoutMoney.includes(name))).toEqual([
        "financial_years",
        "financial_years_business_id_fkey",
        "financial_years_business_id_unique",
        "financial_years_business_start_unique",
        "financial_years_dates_check",
        "financial_years_one_open_per_business",
        "financial_years_pkey",
        "financial_years_status_check",
        "money_account_openings",
        "money_account_openings_account_fk",
        "money_account_openings_pkey",
        "money_account_openings_year_fk",
        "money_accounts",
        "money_accounts_active_name_unique",
        "money_accounts_active_sheet_unique",
        "money_accounts_business_id_fkey",
        "money_accounts_business_id_unique",
        "money_accounts_kind_check",
        "money_accounts_name_check",
        "money_accounts_pkey",
        "money_accounts_sheet_name_check",
        "movements",
        "movements_account_fk",
        "movements_amount_check",
        "movements_business_id_fkey",
        "movements_created_seq_seq",
        "movements_creator_business_fk",
        "movements_heading_check",
        "movements_heading_fk",
        "movements_listing_idx",
        "movements_narrative_check",
        "movements_origin_check",
        "movements_pkey",
        "movements_source_invoice_check",
        "movements_source_invoice_fk",
        "movements_source_invoice_idx",
        "movements_year_fk",
      ]);
      expect(withoutMoney.every((name) => withMoney.includes(name))).toBe(true);
      expect(await ledger()).not.toContain("0010_money_movements");
      expect(await ledger()).toContain("0009_business_templates");
      await expect(checkMoneyMovementsMigration(config, clientFactory)).resolves.toMatchObject({ applied: false, requiredTableCount: 0, ledgerRecordPresent: false });
      await expect(checkAllMigrations(config, clientFactory)).rejects.toThrow("money movements migration");

      await expect(applyMoneyMovementsMigration(config, clientFactory)).resolves.toEqual({ version: "0010_money_movements", applied: true });
      await expect(applyMoneyMovementsMigration(config, clientFactory)).resolves.toEqual({ version: "0010_money_movements", applied: false });
      expect(await schemaObjects()).toEqual(withMoney);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("applies, rolls back exactly, and reapplies invoice codings 0011", async () => {
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
    const schemaObjects = async () => {
      const relations = await client.query<{ name: string }>(`
        SELECT relname AS name FROM pg_class WHERE relnamespace = 'public'::regnamespace
        UNION
        SELECT conname AS name FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype <> 'n'
        ORDER BY name
      `);
      return relations.rows.map((row) => row.name);
    };
    const ledger = async () => (await client.query<{ version: string }>("SELECT version FROM ledgerharbour_schema_migrations ORDER BY version")).rows.map((row) => row.version);
    try {
      const config = { databaseUrl: "pglite://lh020", allowStagingMigration: true as const };
      await applyAllMigrations(config, clientFactory);
      const withCodings = await schemaObjects();
      await expect(checkInvoiceCodingsMigration(config, clientFactory)).resolves.toMatchObject({ applied: true, requiredTableCount: 1, ledgerRecordPresent: true });
      await expect(checkAllMigrations(config, clientFactory)).resolves.toMatchObject({ invoiceCodings: { version: "0011_invoice_codings", applied: true } });

      await expect(rollbackInvoiceCodingsMigration(config, clientFactory)).resolves.toEqual({ version: "0011_invoice_codings", applied: true });
      const withoutCodings = await schemaObjects();
      expect(withCodings.filter((name) => !withoutCodings.includes(name))).toEqual([
        "invoice_codings",
        "invoice_codings_amount_check",
        "invoice_codings_business_id_fkey",
        "invoice_codings_business_invoice_idx",
        "invoice_codings_heading_fk",
        "invoice_codings_invoice_fk",
        "invoice_codings_invoice_heading_unique",
        "invoice_codings_invoice_sort_unique",
        "invoice_codings_pkey",
      ]);
      expect(withoutCodings.every((name) => withCodings.includes(name))).toBe(true);
      expect(await ledger()).not.toContain("0011_invoice_codings");
      expect(await ledger()).toContain("0010_money_movements");
      await expect(checkInvoiceCodingsMigration(config, clientFactory)).resolves.toMatchObject({ applied: false, requiredTableCount: 0, ledgerRecordPresent: false });
      await expect(checkAllMigrations(config, clientFactory)).rejects.toThrow("invoice codings migration");

      await expect(rollbackMoneyMovementsMigration(config, clientFactory)).resolves.toMatchObject({ applied: true });
      await expect(applyInvoiceCodingsMigration(config, clientFactory)).rejects.toThrow("Money movements migration must be applied before invoice codings migration");
      await expect(applyMoneyMovementsMigration(config, clientFactory)).resolves.toMatchObject({ applied: true });

      await expect(applyInvoiceCodingsMigration(config, clientFactory)).resolves.toEqual({ version: "0011_invoice_codings", applied: true });
      await expect(applyInvoiceCodingsMigration(config, clientFactory)).resolves.toEqual({ version: "0011_invoice_codings", applied: false });
      expect(await schemaObjects()).toEqual(withCodings);
    } finally {
      await client.close();
    }
  }, 30_000);
});
