import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";

import { schema } from "./schema";

export type TestDatabase = PgliteDatabase<typeof schema>;

export async function applyMigration(client: PGlite, migrationSql: string): Promise<void> {
  const sqlWithoutTransactionMarkers = migrationSql
    .replace(/^\s*BEGIN;\s*/i, "")
    .replace(/\s*COMMIT;\s*$/i, "");

  await client.transaction(async (transaction) => {
    await transaction.exec(sqlWithoutTransactionMarkers);
  });
}

export async function createTestDatabase(): Promise<{
  db: TestDatabase;
  execute: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
}> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  try {
    const migrationSql = await readFile(
      new URL("./migrations/0001_initial.sql", import.meta.url),
      "utf8",
    );
    await applyMigration(client, migrationSql);
    const platformMigration = await readFile(
      new URL("./migrations/0002_platform_control_plane.sql", import.meta.url),
      "utf8",
    );
    await applyMigration(client, platformMigration);
    const lifecycleMigration = await readFile(
      new URL("./migrations/0003_business_lifecycle.sql", import.meta.url),
      "utf8",
    );
    await applyMigration(client, lifecycleMigration);
    const membershipMigration = await readFile(
      new URL("./migrations/0004_membership_lifecycle.sql", import.meta.url),
      "utf8",
    );
    await applyMigration(client, membershipMigration);
  } catch (error) {
    await client.close();
    throw error;
  }

  return {
    db,
    execute: (sql: string) => client.exec(sql),
    close: () => client.close(),
  };
}
