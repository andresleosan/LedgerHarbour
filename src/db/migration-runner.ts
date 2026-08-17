import { readFile } from "node:fs/promises";

import { Client } from "pg";

const MIGRATION_VERSION = "0001_initial";
const MIGRATION_FILE = new URL("./migrations/0001_initial.sql", import.meta.url);
const PLATFORM_MIGRATION_VERSION = "0002_platform_control_plane";
const PLATFORM_MIGRATION_FILE = new URL("./migrations/0002_platform_control_plane.sql", import.meta.url);
const BUSINESS_LIFECYCLE_MIGRATION_VERSION = "0003_business_lifecycle";
const BUSINESS_LIFECYCLE_MIGRATION_FILE = new URL("./migrations/0003_business_lifecycle.sql", import.meta.url);
const MEMBERSHIP_LIFECYCLE_MIGRATION_VERSION = "0004_membership_lifecycle";
const MEMBERSHIP_LIFECYCLE_MIGRATION_FILE = new URL("./migrations/0004_membership_lifecycle.sql", import.meta.url);
const PROJECTS_MIGRATION_VERSION = "0005_projects";
const PROJECTS_MIGRATION_FILE = new URL("./migrations/0005_projects.sql", import.meta.url);
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
const PLATFORM_REQUIRED_TABLES = ["platform_members", "platform_audit_events"] as const;
const BUSINESS_LIFECYCLE_REQUIRED_COLUMNS = ["created_by", "status", "activated_at", "service_expires_at", "suspended_at", "suspension_reason"] as const;
const MEMBERSHIP_LIFECYCLE_REQUIRED_COLUMNS = ["status"] as const;
const PROJECTS_REQUIRED_TABLES = ["projects", "project_memberships"] as const;
const MEMBERSHIP_LIFECYCLE_ROLLBACK_FILE = new URL("./migrations/rollback/0004_membership_lifecycle_down.sql", import.meta.url);
const PROJECTS_ROLLBACK_FILE = new URL("./migrations/rollback/0005_projects_down.sql", import.meta.url);

export type MigrationQueryResult<Row = Record<string, unknown>> = {
  rows: Row[];
  rowCount: number | null;
};

export type MigrationClient = {
  query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<MigrationQueryResult<Row>>;
  exec?: (text: string) => Promise<unknown>;
  end(): Promise<void>;
};

export type MigrationClientFactory = (config: MigrationConfig) => Promise<MigrationClient>;

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
  ledgerRecordPresent: boolean;
};

export type MigrationSequence<T> = {
  initial: T;
  platform: T;
  lifecycle: T;
  membershipLifecycle: T;
  projects: T;
};

export function assertRequiredMigrations(
  initial: MigrationCheck,
  platform: MigrationCheck,
  lifecycle?: MigrationCheck,
  membershipLifecycle?: MigrationCheck,
  projects?: MigrationCheck,
): void {
  if (
    initial.version !== MIGRATION_VERSION
    || !initial.applied
    || initial.requiredTableCount !== REQUIRED_TABLES.length
    || !initial.ledgerRecordPresent
  ) {
    throw new Error("Required PostgreSQL initial migration is not applied");
  }
  if (
    platform.version !== PLATFORM_MIGRATION_VERSION
    || !platform.applied
    || !platform.ledgerRecordPresent
  ) {
    throw new Error("Required PostgreSQL platform control-plane migration is not applied");
  }
  if (platform.requiredTableCount !== PLATFORM_REQUIRED_TABLES.length) {
    throw new Error("Required PostgreSQL platform control-plane tables are missing");
  }
  if (lifecycle && (!lifecycle.applied || lifecycle.version !== BUSINESS_LIFECYCLE_MIGRATION_VERSION || lifecycle.requiredTableCount !== BUSINESS_LIFECYCLE_REQUIRED_COLUMNS.length)) {
    throw new Error("Required PostgreSQL business lifecycle migration is not applied");
  }
  if (membershipLifecycle && (!membershipLifecycle.applied || membershipLifecycle.version !== MEMBERSHIP_LIFECYCLE_MIGRATION_VERSION || membershipLifecycle.requiredTableCount !== MEMBERSHIP_LIFECYCLE_REQUIRED_COLUMNS.length)) {
    throw new Error("Required PostgreSQL membership lifecycle migration is not applied");
  }
  if (projects && (!projects.applied || projects.version !== PROJECTS_MIGRATION_VERSION || projects.requiredTableCount !== PROJECTS_REQUIRED_TABLES.length)) {
    throw new Error("Required PostgreSQL projects migration is not applied");
  }
}

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

async function connect(config: MigrationConfig): Promise<MigrationClient> {
  const client = new Client({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  await client.query("SET statement_timeout = '30s'");
  return {
    query: async <Row = Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
      const result = await client.query(text, values ? [...values] : undefined);
      return { rows: result.rows as Row[], rowCount: result.rowCount };
    },
    end: () => client.end(),
  };
}

async function ensureMigrationTable(client: MigrationClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ledgerharbour_schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function migrationWasApplied(client: MigrationClient, version: string): Promise<boolean> {
  const result = await client.query<{ version: string }>(
    "SELECT version FROM ledgerharbour_schema_migrations WHERE version = $1",
    [version],
  );
  return result.rowCount === 1;
}

async function hasPartialSchema(client: MigrationClient, requiredTables: readonly string[] = REQUIRED_TABLES): Promise<boolean> {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [requiredTables],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

async function executeMigration(client: MigrationClient, migrationSql: string): Promise<void> {
  if (client.exec) {
    await client.exec(migrationSql);
    return;
  }
  await client.query(migrationSql);
}

export async function applyInitialMigration(
  config: MigrationConfig,
  clientFactory: MigrationClientFactory = connect,
): Promise<MigrationResult> {
  const client = await clientFactory(config);

  try {
    await ensureMigrationTable(client);

    if (await migrationWasApplied(client, MIGRATION_VERSION)) {
      return { version: MIGRATION_VERSION, applied: false };
    }

    if (await hasPartialSchema(client)) {
      throw new Error("Database has schema tables without a migration record");
    }

    const migrationSql = withoutTransactionMarkers(await readFile(MIGRATION_FILE, "utf8"));
    await client.query("BEGIN");
    await executeMigration(client, migrationSql);
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

export async function checkInitialMigration(
  config: MigrationConfig,
  clientFactory: MigrationClientFactory = connect,
): Promise<MigrationCheck> {
  const client = await clientFactory(config);

  try {
    await ensureMigrationTable(client);
    const applied = await migrationWasApplied(client, MIGRATION_VERSION);
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [REQUIRED_TABLES],
    );

    return {
      version: MIGRATION_VERSION,
      applied,
      requiredTableCount: tables.rowCount ?? 0,
      ledgerRecordPresent: applied,
    };
  } finally {
    await client.end();
  }
}

export async function applyPlatformControlPlaneMigration(
  config: MigrationConfig,
  clientFactory: MigrationClientFactory = connect,
): Promise<MigrationResult> {
  const client = await clientFactory(config);

  try {
    await ensureMigrationTable(client);

    if (!(await migrationWasApplied(client, MIGRATION_VERSION))) {
      throw new Error("Initial migration must be applied before platform control-plane migration");
    }
    if (await migrationWasApplied(client, PLATFORM_MIGRATION_VERSION)) {
      return { version: PLATFORM_MIGRATION_VERSION, applied: false };
    }
    if (await hasPartialSchema(client, PLATFORM_REQUIRED_TABLES)) {
      throw new Error("Database has platform schema tables without a migration record");
    }

    const migrationSql = withoutTransactionMarkers(await readFile(PLATFORM_MIGRATION_FILE, "utf8"));
    await client.query("BEGIN");
    await executeMigration(client, migrationSql);
    await client.query(
      "INSERT INTO ledgerharbour_schema_migrations (version) VALUES ($1)",
      [PLATFORM_MIGRATION_VERSION],
    );
    await client.query("COMMIT");

    return { version: PLATFORM_MIGRATION_VERSION, applied: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function checkPlatformControlPlaneMigration(
  config: MigrationConfig,
  clientFactory: MigrationClientFactory = connect,
): Promise<MigrationCheck> {
  const client = await clientFactory(config);

  try {
    await ensureMigrationTable(client);
    const applied = await migrationWasApplied(client, PLATFORM_MIGRATION_VERSION);
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [PLATFORM_REQUIRED_TABLES],
    );

    return {
      version: PLATFORM_MIGRATION_VERSION,
      applied,
      requiredTableCount: tables.rowCount ?? 0,
      ledgerRecordPresent: applied,
    };
  } finally {
    await client.end();
  }
}

export async function applyBusinessLifecycleMigration(
  config: MigrationConfig,
  clientFactory: MigrationClientFactory = connect,
): Promise<MigrationResult> {
  const client = await clientFactory(config);
  try {
    await ensureMigrationTable(client);
    if (!(await migrationWasApplied(client, PLATFORM_MIGRATION_VERSION))) {
      throw new Error("Platform control-plane migration must be applied before business lifecycle migration");
    }
    if (await migrationWasApplied(client, BUSINESS_LIFECYCLE_MIGRATION_VERSION)) {
      return { version: BUSINESS_LIFECYCLE_MIGRATION_VERSION, applied: false };
    }
    const migrationSql = withoutTransactionMarkers(await readFile(BUSINESS_LIFECYCLE_MIGRATION_FILE, "utf8"));
    await client.query("BEGIN");
    await executeMigration(client, migrationSql);
    await client.query("INSERT INTO ledgerharbour_schema_migrations (version) VALUES ($1)", [BUSINESS_LIFECYCLE_MIGRATION_VERSION]);
    await client.query("COMMIT");
    return { version: BUSINESS_LIFECYCLE_MIGRATION_VERSION, applied: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function checkBusinessLifecycleMigration(
  config: MigrationConfig,
  clientFactory: MigrationClientFactory = connect,
): Promise<MigrationCheck> {
  const client = await clientFactory(config);
  try {
    await ensureMigrationTable(client);
    const applied = await migrationWasApplied(client, BUSINESS_LIFECYCLE_MIGRATION_VERSION);
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = ANY($1::text[])`,
      [BUSINESS_LIFECYCLE_REQUIRED_COLUMNS],
    );
    return {
      version: BUSINESS_LIFECYCLE_MIGRATION_VERSION,
      applied,
      requiredTableCount: columns.rowCount ?? 0,
      ledgerRecordPresent: applied,
    };
  } finally {
    await client.end();
  }
}

export async function applyMembershipLifecycleMigration(
  config: MigrationConfig,
  clientFactory: MigrationClientFactory = connect,
): Promise<MigrationResult> {
  const client = await clientFactory(config);
  try {
    await ensureMigrationTable(client);
    if (!(await migrationWasApplied(client, BUSINESS_LIFECYCLE_MIGRATION_VERSION))) {
      throw new Error("Business lifecycle migration must be applied before membership lifecycle migration");
    }
    if (await migrationWasApplied(client, MEMBERSHIP_LIFECYCLE_MIGRATION_VERSION)) {
      return { version: MEMBERSHIP_LIFECYCLE_MIGRATION_VERSION, applied: false };
    }
    const migrationSql = withoutTransactionMarkers(await readFile(MEMBERSHIP_LIFECYCLE_MIGRATION_FILE, "utf8"));
    await client.query("BEGIN");
    await executeMigration(client, migrationSql);
    await client.query("INSERT INTO ledgerharbour_schema_migrations (version) VALUES ($1)", [MEMBERSHIP_LIFECYCLE_MIGRATION_VERSION]);
    await client.query("COMMIT");
    return { version: MEMBERSHIP_LIFECYCLE_MIGRATION_VERSION, applied: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function rollbackMembershipLifecycleMigration(
  config: MigrationConfig,
  clientFactory: MigrationClientFactory = connect,
): Promise<MigrationResult> {
  const client = await clientFactory(config);
  try {
    await ensureMigrationTable(client);
    if (!(await migrationWasApplied(client, MEMBERSHIP_LIFECYCLE_MIGRATION_VERSION))) {
      return { version: MEMBERSHIP_LIFECYCLE_MIGRATION_VERSION, applied: false };
    }
    const rollbackSql = withoutTransactionMarkers(await readFile(MEMBERSHIP_LIFECYCLE_ROLLBACK_FILE, "utf8"));
    await client.query("BEGIN");
    await executeMigration(client, rollbackSql);
    await client.query("COMMIT");
    return { version: MEMBERSHIP_LIFECYCLE_MIGRATION_VERSION, applied: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function checkMembershipLifecycleMigration(
  config: MigrationConfig,
  clientFactory: MigrationClientFactory = connect,
): Promise<MigrationCheck> {
  const client = await clientFactory(config);
  try {
    await ensureMigrationTable(client);
    const applied = await migrationWasApplied(client, MEMBERSHIP_LIFECYCLE_MIGRATION_VERSION);
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'memberships' AND column_name = ANY($1::text[])`,
      [MEMBERSHIP_LIFECYCLE_REQUIRED_COLUMNS],
    );
    return {
      version: MEMBERSHIP_LIFECYCLE_MIGRATION_VERSION,
      applied,
      requiredTableCount: columns.rowCount ?? 0,
      ledgerRecordPresent: applied,
    };
  } finally {
    await client.end();
  }
}

export async function applyProjectsMigration(
  config: MigrationConfig,
  clientFactory: MigrationClientFactory = connect,
): Promise<MigrationResult> {
  const client = await clientFactory(config);
  try {
    await ensureMigrationTable(client);
    if (!(await migrationWasApplied(client, MEMBERSHIP_LIFECYCLE_MIGRATION_VERSION))) {
      throw new Error("Membership lifecycle migration must be applied before projects migration");
    }
    if (await migrationWasApplied(client, PROJECTS_MIGRATION_VERSION)) {
      return { version: PROJECTS_MIGRATION_VERSION, applied: false };
    }
    if (await hasPartialSchema(client, PROJECTS_REQUIRED_TABLES)) {
      throw new Error("Database has project schema tables without a migration record");
    }
    const migrationSql = withoutTransactionMarkers(await readFile(PROJECTS_MIGRATION_FILE, "utf8"));
    await client.query("BEGIN");
    await executeMigration(client, migrationSql);
    await client.query("INSERT INTO ledgerharbour_schema_migrations (version) VALUES ($1)", [PROJECTS_MIGRATION_VERSION]);
    await client.query("COMMIT");
    return { version: PROJECTS_MIGRATION_VERSION, applied: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function rollbackProjectsMigration(
  config: MigrationConfig,
  clientFactory: MigrationClientFactory = connect,
): Promise<MigrationResult> {
  const client = await clientFactory(config);
  try {
    await ensureMigrationTable(client);
    if (!(await migrationWasApplied(client, PROJECTS_MIGRATION_VERSION))) {
      return { version: PROJECTS_MIGRATION_VERSION, applied: false };
    }
    const rollbackSql = withoutTransactionMarkers(await readFile(PROJECTS_ROLLBACK_FILE, "utf8"));
    await client.query("BEGIN");
    await executeMigration(client, rollbackSql);
    await client.query("COMMIT");
    return { version: PROJECTS_MIGRATION_VERSION, applied: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function checkProjectsMigration(
  config: MigrationConfig,
  clientFactory: MigrationClientFactory = connect,
): Promise<MigrationCheck> {
  const client = await clientFactory(config);
  try {
    await ensureMigrationTable(client);
    const applied = await migrationWasApplied(client, PROJECTS_MIGRATION_VERSION);
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [PROJECTS_REQUIRED_TABLES],
    );
    return {
      version: PROJECTS_MIGRATION_VERSION,
      applied,
      requiredTableCount: tables.rowCount ?? 0,
      ledgerRecordPresent: applied,
    };
  } finally {
    await client.end();
  }
}

export async function applyAllMigrations(
  config: MigrationConfig,
  clientFactory: MigrationClientFactory = connect,
): Promise<MigrationSequence<MigrationResult>> {
  const initial = await applyInitialMigration(config, clientFactory);
  const platform = await applyPlatformControlPlaneMigration(config, clientFactory);
  const lifecycle = await applyBusinessLifecycleMigration(config, clientFactory);
  const membershipLifecycle = await applyMembershipLifecycleMigration(config, clientFactory);
  const projects = await applyProjectsMigration(config, clientFactory);
  return { initial, platform, lifecycle, membershipLifecycle, projects };
}

export async function checkAllMigrations(
  config: MigrationConfig,
  clientFactory: MigrationClientFactory = connect,
): Promise<MigrationSequence<MigrationCheck>> {
  const initial = await checkInitialMigration(config, clientFactory);
  const platform = await checkPlatformControlPlaneMigration(config, clientFactory);
  const lifecycle = await checkBusinessLifecycleMigration(config, clientFactory);
  const membershipLifecycle = await checkMembershipLifecycleMigration(config, clientFactory);
  const projects = await checkProjectsMigration(config, clientFactory);
  assertRequiredMigrations(initial, platform, lifecycle, membershipLifecycle, projects);
  return { initial, platform, lifecycle, membershipLifecycle, projects };
}
