import { readFile } from "node:fs/promises";

import { Client } from "pg";

const MIGRATION_VERSION = "0001_initial";
const MIGRATION_FILE = new URL("./migrations/0001_initial.sql", import.meta.url);
const REQUIRED_TABLES = [
  "users",
  "businesses",
  "memberships",
  "documents",
  "invoices",
  "jobs",
  "categories",
  "currencies",
  "join_requests",
  "audit_events",
] as const;

export type MigrationConfigInput = {
  databaseUrl?: string;
  allowStagingMigration?: boolean;
};

export type MigrationConfig = {
  databaseUrl: string;
  allowStagingMigration: true;
};

export type MigrationResult = {
  version: string;
  applied: boolean;
};

export type MigrationCheck = MigrationResult & {
  requiredTableCount: number;
};

export function resolveMigrationConfig(input: MigrationConfigInput = {}): MigrationConfig {
  const databaseUrl = (input.databaseUrl ?? process.env.DATABASE_URL ?? "").trim();
  const allowStagingMigration = input.allowStagingMigration ?? process.env.ALLOW_STAGING_MIGRATION === "true";

  if (!databaseUrl) throw new Error("DATABASE_URL is required for migrations");
  if (!allowStagingMigration) throw new Error("ALLOW_STAGING_MIGRATION=true is required");

  return { databaseUrl, allowStagingMigration: true };
}

function withoutTransactionMarkers(sql: string): string {
  return sql
    .replace(/^\s*BEGIN;\s*/i, "")
    .replace(/\s*COMMIT;\s*$/i, "");
}

async function connect(config: MigrationConfig): Promise<Client> {
  const client = new Client({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  await client.query("SET statement_timeout = '30s'");
  return client;
}

async function ensureMigrationTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ledgerharbour_schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function migrationWasApplied(client: Client): Promise<boolean> {
  const result = await client.query<{ version: string }>(
    "SELECT version FROM ledgerharbour_schema_migrations WHERE version = $1",
    [MIGRATION_VERSION],
  );
  return result.rowCount === 1;
}

async function hasPartialSchema(client: Client): Promise<boolean> {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [REQUIRED_TABLES],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function applyInitialMigration(config: MigrationConfig): Promise<MigrationResult> {
  const client = await connect(config);

  try {
    await ensureMigrationTable(client);

    if (await migrationWasApplied(client)) {
      return { version: MIGRATION_VERSION, applied: false };
    }

    if (await hasPartialSchema(client)) {
      throw new Error("Database has schema tables without a migration record");
    }

    const migrationSql = withoutTransactionMarkers(await readFile(MIGRATION_FILE, "utf8"));
    await client.query("BEGIN");
    await client.query(migrationSql);
    await client.query(
      "INSERT INTO ledgerharbour_schema_migrations (version) VALUES ($1)",
      [MIGRATION_VERSION],
    );
    await client.query("COMMIT");

    return { version: MIGRATION_VERSION, applied: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function checkInitialMigration(config: MigrationConfig): Promise<MigrationCheck> {
  const client = await connect(config);

  try {
    await ensureMigrationTable(client);
    const applied = await migrationWasApplied(client);
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [REQUIRED_TABLES],
    );

    return {
      version: MIGRATION_VERSION,
      applied,
      requiredTableCount: (tables.rowCount ?? 0) + (applied ? 1 : 0),
    };
  } finally {
    await client.end();
  }
}
