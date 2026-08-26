import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyAllMigrations,
  checkAllMigrations,
  applyRateLimitMigration,
  checkRateLimitMigration,
  rollbackRateLimitMigration,
  type MigrationConfig,
} from "../../../src/db/migration-runner";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();

function assertDisposableDatabaseUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid disposable PostgreSQL URL");
  }

  const isPostgres = parsed.protocol === "postgres:" || parsed.protocol === "postgresql:";
  const isLoopback = parsed.hostname === "127.0.0.1"
    || parsed.hostname === "localhost"
    || parsed.hostname === "[::1]";
  const databaseName = parsed.pathname.replace(/^\//, "");
  const isDisposableName = databaseName === "ledgerharbour_test"
    || databaseName.startsWith("ledgerharbour_lh009_");

  if (!isPostgres || !isLoopback || !isDisposableName) {
    throw new Error("Native PostgreSQL gate requires a loopback disposable test database");
  }
}

describe.skipIf(!databaseUrl)("native PostgreSQL migration gate", () => {
  const config: MigrationConfig = {
    databaseUrl: databaseUrl ?? "",
    allowStagingMigration: true,
  };
  let client: Client | undefined;
  let applied: Awaited<ReturnType<typeof applyAllMigrations>>;
  let checked: Awaited<ReturnType<typeof checkAllMigrations>>;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
    assertDisposableDatabaseUrl(databaseUrl);

    applied = await applyAllMigrations(config);
    checked = await checkAllMigrations(config);
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  }, 30_000);

  afterAll(async () => {
    await client?.end();
  });

  it("applies and verifies the complete ordered migration sequence", () => {
    expect(Object.values(applied).map((migration) => migration.version)).toEqual([
      "0001_initial",
      "0002_platform_control_plane",
      "0003_business_lifecycle",
      "0004_membership_lifecycle",
      "0005_projects",
      "0006_business_request_audit",
      "0007_rate_limit_windows",
    ]);
    expect(Object.values(applied).every((migration) => migration.applied)).toBe(true);
    expect(checked).toMatchObject({
      initial: { applied: true, requiredTableCount: 10, ledgerRecordPresent: true },
      platform: { applied: true, requiredTableCount: 2, ledgerRecordPresent: true },
      lifecycle: { applied: true, requiredTableCount: 6, ledgerRecordPresent: true },
      membershipLifecycle: { applied: true, requiredTableCount: 1, ledgerRecordPresent: true },
      projects: { applied: true, requiredTableCount: 2, ledgerRecordPresent: true },
      businessRequestAudit: { applied: true, ledgerRecordPresent: true },
      rateLimit: { applied: true, requiredTableCount: 1, ledgerRecordPresent: true },
    });
  });

  it("creates the canonical native tables, constraints, indexes, and triggers", async () => {
    if (!client) throw new Error("native PostgreSQL client is not initialized");

    const tables = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "audit_events",
      "businesses",
      "categories",
      "currencies",
      "documents",
      "invoices",
      "jobs",
      "join_requests",
      "ledgerharbour_schema_migrations",
      "memberships",
      "platform_audit_events",
      "platform_members",
      "project_memberships",
      "projects",
      "rate_limit_windows",
      "users",
    ]);

    const constraints = await client.query<{ conname: string }>(`
      SELECT conname
      FROM pg_constraint
      WHERE conname IN (
        'audit_events_user_actor_fk',
        'documents_uploader_business_fk',
        'invoices_business_document_fk',
        'jobs_requested_by_business_fk',
        'join_requests_reviewer_business_fk',
        'project_memberships_status_activity_consistency_check',
        'projects_status_activity_consistency_check'
      )
      ORDER BY conname
    `);
    expect(constraints.rows.map((row) => row.conname)).toEqual([
      "audit_events_user_actor_fk",
      "documents_uploader_business_fk",
      "invoices_business_document_fk",
      "jobs_requested_by_business_fk",
      "join_requests_reviewer_business_fk",
      "project_memberships_status_activity_consistency_check",
      "projects_status_activity_consistency_check",
    ]);

    const triggers = await client.query<{ trigger_name: string }>(`
      SELECT DISTINCT trigger_name
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
        AND trigger_name IN (
          'audit_events_append_only',
          'documents_uploader_active_membership',
          'memberships_exactly_one_active_owner',
          'platform_audit_events_append_only'
        )
      ORDER BY trigger_name
    `);
    expect(triggers.rows.map((row) => row.trigger_name)).toEqual([
      "audit_events_append_only",
      "documents_uploader_active_membership",
      "memberships_exactly_one_active_owner",
      "platform_audit_events_append_only",
    ]);

    const indexes = await client.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'memberships_one_active_owner_per_business',
          'documents_business_checksum_unique',
          'jobs_business_document_type_unique',
          'project_memberships_project_user_unique',
          'projects_business_normalized_name_unique',
          'rate_limit_windows_window_started_at_idx'
        )
      ORDER BY indexname
    `);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "documents_business_checksum_unique",
      "jobs_business_document_type_unique",
      "memberships_one_active_owner_per_business",
      "project_memberships_project_user_unique",
      "projects_business_normalized_name_unique",
      "rate_limit_windows_window_started_at_idx",
    ]);
  }, 30_000);

  it("rolls back and reapplies the latest migration with ledger parity", async () => {
    await expect(rollbackRateLimitMigration(config)).resolves.toEqual({
      version: "0007_rate_limit_windows",
      applied: true,
    });
    await expect(checkRateLimitMigration(config)).resolves.toMatchObject({
      applied: false,
      ledgerRecordPresent: false,
    });
    await expect(applyRateLimitMigration(config)).resolves.toEqual({
      version: "0007_rate_limit_windows",
      applied: true,
    });
    await expect(checkRateLimitMigration(config)).resolves.toMatchObject({
      applied: true,
      ledgerRecordPresent: true,
    });
  }, 30_000);

  it("enforces tenant boundaries and append-only audit behavior", async () => {
    if (!client) throw new Error("native PostgreSQL client is not initialized");

    await client.query("BEGIN");
    try {
      for (const suffix of ["a", "b"] as const) {
        await client.query(`
          INSERT INTO users (id, provider_id, email, normalized_email, display_name)
          VALUES ($1, $2, $3, $3, $4)
        `, [
          `native-user-${suffix}`,
          `native-provider-${suffix}`,
          `native-${suffix}@example.test`,
          `Native ${suffix.toUpperCase()}`,
        ]);
        await client.query(`
          INSERT INTO businesses (id, name, normalized_search_name, created_by, status, is_active)
          VALUES ($1, $2, $3, $4, 'active', true)
        `, [
          `native-business-${suffix}`,
          `Native Business ${suffix.toUpperCase()}`,
          `native business ${suffix}`,
          `native-user-${suffix}`,
        ]);
        await client.query(`
          INSERT INTO memberships (id, user_id, business_id, role, is_active, status)
          VALUES ($1, $2, $3, 'owner_admin', true, 'active')
        `, [
          `native-membership-${suffix}`,
          `native-user-${suffix}`,
          `native-business-${suffix}`,
        ]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    await expect(client.query(`
      INSERT INTO documents (
        id, business_id, uploader_id, private_object_key,
        original_file_name, original_mime_type, original_size_bytes
      ) VALUES (
        'native-cross-tenant-document', 'native-business-b', 'native-user-a',
        'native/cross-tenant', 'synthetic.pdf', 'application/pdf', 1
      )
    `)).rejects.toThrow();

    await client.query(`
      INSERT INTO audit_events (
        id, business_id, actor_type, actor_id, action, entity_type, entity_id
      ) VALUES (
        'native-audit-event', 'native-business-a', 'user', 'native-user-a',
        'business_requested', 'business', 'native-business-a'
      )
    `);
    await expect(client.query(`
      UPDATE audit_events SET entity_id = 'changed' WHERE id = 'native-audit-event'
    `)).rejects.toThrow(/append-only/i);
  }, 30_000);

  it("rolls back ordinary data changes without leaving a row behind", async () => {
    if (!client) throw new Error("native PostgreSQL client is not initialized");

    await client.query("BEGIN");
    try {
      await client.query(`
        INSERT INTO users (id, provider_id, email, normalized_email, display_name)
        VALUES ('native-rollback-user', 'native-rollback-provider', 'rollback@example.test', 'rollback@example.test', 'Rollback User')
      `);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const result = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count FROM users WHERE id = 'native-rollback-user'
    `);
    expect(result.rows).toEqual([{ count: "0" }]);
  }, 30_000);
});
