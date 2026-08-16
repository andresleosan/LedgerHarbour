import { describe, expect, it } from "vitest";

import { resolveMigrationConfig } from "../../../src/db/migration-runner";

describe("migration runner configuration", () => {
  it("requires an explicit database URL", () => {
    expect(() => resolveMigrationConfig({})).toThrow("DATABASE_URL is required");
  });

  it("requires explicit staging authorization", () => {
    expect(() => resolveMigrationConfig({ databaseUrl: "postgresql://staging" })).toThrow(
      "ALLOW_STAGING_MIGRATION=true",
    );
  });

  it("returns a bounded staging migration configuration", () => {
    expect(resolveMigrationConfig({
      databaseUrl: "postgresql://staging",
      allowStagingMigration: true,
    })).toEqual({
      databaseUrl: "postgresql://staging",
      allowStagingMigration: true,
    });
  });
});
