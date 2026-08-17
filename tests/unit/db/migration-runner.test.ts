import { describe, expect, it } from "vitest";

import { assertRequiredMigrations, resolveMigrationConfig } from "../../../src/db/migration-runner";

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

  it("requires membership lifecycle migration when its check is supplied", () => {
    const base = { version: "0001_initial", applied: true, requiredTableCount: 10, ledgerRecordPresent: true };
    const platform = { version: "0002_platform_control_plane", applied: true, requiredTableCount: 2, ledgerRecordPresent: true };
    const lifecycle = { version: "0003_business_lifecycle", applied: true, requiredTableCount: 6, ledgerRecordPresent: true };

    expect(() => assertRequiredMigrations(base, platform, lifecycle, {
      version: "0004_membership_lifecycle",
      applied: false,
      requiredTableCount: 1,
      ledgerRecordPresent: false,
    })).toThrow("membership lifecycle migration");
  });
});
