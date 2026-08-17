import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import {
  applyAllMigrations,
  checkAllMigrations,
} from "../../../src/db/migration-runner";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!databaseUrl)("native PostgreSQL project schema", () => {
  let client: Client | undefined;

  afterAll(async () => {
    await client?.end();
  });

  it("applies and verifies the ordered project migration when a test database is configured", async () => {
    if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");

    const config = { databaseUrl, allowStagingMigration: true as const };
    const applied = await applyAllMigrations(config);
    expect(applied.projects.version).toBe("0005_projects");

    const check = await checkAllMigrations(config);
    expect(check.projects).toMatchObject({
      version: "0005_projects",
      applied: true,
      requiredTableCount: 2,
      ledgerRecordPresent: true,
    });

    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const tables = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('projects', 'project_memberships')
      ORDER BY table_name
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual(["project_memberships", "projects"]);

    const constraints = await client.query<{ conname: string }>(`
      SELECT conname
      FROM pg_constraint
      WHERE conname IN (
        'projects_status_check',
        'projects_status_activity_consistency_check',
        'project_memberships_status_check',
        'project_memberships_status_activity_consistency_check'
      )
      ORDER BY conname
    `);
    expect(constraints.rows.map((row) => row.conname)).toEqual([
      "project_memberships_status_activity_consistency_check",
      "project_memberships_status_check",
      "projects_status_activity_consistency_check",
      "projects_status_check",
    ]);
  }, 30_000);
});
