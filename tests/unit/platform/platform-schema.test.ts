import { readFileSync } from "node:fs";

import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  PlatformRole,
  platformAuditEvents,
  platformMembers,
  platformRoleEnum,
  schema,
} from "../../../src/db/schema";
import {
  normalizePlatformAdminEmail,
  resolvePlatformAdminEmails,
} from "../../../src/db/platform-bootstrap";
import { assertRequiredMigrations } from "../../../src/db/migration-runner";
import { resolvePlatformBootstrapEmails } from "../../../scripts/db/bootstrap-platform-admins";

const migrationSql = readFileSync(
  new URL("../../../src/db/migrations/0002_platform_control_plane.sql", import.meta.url),
  "utf8",
);
const rollbackSql = readFileSync(
  new URL("../../../src/db/migrations/rollback/0002_platform_control_plane_down.sql", import.meta.url),
  "utf8",
);

describe("platform control-plane schema", () => {
  it("exposes only the global platform_admin role and both tables", () => {
    expect(PlatformRole).toEqual(["platform_admin"]);
    expect(platformRoleEnum.enumValues).toEqual(["platform_admin"]);
    expect(schema.platformMembers).toBe(platformMembers);
    expect(schema.platformAuditEvents).toBe(platformAuditEvents);
  });

  it("requires normalized unique platform members with an optional linked user", () => {
    const columns = getTableColumns(platformMembers);
    const indexes = getTableConfig(platformMembers).indexes.map((index) => index.config.name);

    expect(columns.userId.notNull).toBe(false);
    expect(columns.normalizedEmail.notNull).toBe(true);
    expect(columns.role.notNull).toBe(true);
    expect(columns.isActive.notNull).toBe(true);
    expect(indexes).toContain("platform_members_normalized_email_unique");
    expect(indexes).toContain("platform_members_user_id_unique");
    expect(migrationSql).toContain("platform_members_role_check");
    expect(migrationSql).toContain("platform_members_normalized_email_check");
  });

  it("models platform audit events without secret or document payload columns", () => {
    const columns = getTableColumns(platformAuditEvents);

    expect(columns.actorId.notNull).toBe(true);
    expect(columns.action.notNull).toBe(true);
    expect(columns.targetType.notNull).toBe(true);
    expect(columns.targetId.notNull).toBe(true);
    expect(columns.beforeStatus.notNull).toBe(false);
    expect(columns.afterStatus.notNull).toBe(false);
    expect(columns.reason.notNull).toBe(false);
    expect(Object.keys(columns)).not.toEqual(expect.arrayContaining([
      "token",
      "secret",
      "bytes",
      "payload",
      "metadata",
    ]));
    expect(migrationSql).toContain("platform_audit_events_append_only");
    expect(migrationSql).toContain("platform_audit_events_truncate_append_only");
    expect(migrationSql).toContain("BEFORE TRUNCATE ON platform_audit_events");
    expect(migrationSql).toContain("REVOKE UPDATE, DELETE, TRUNCATE ON platform_audit_events FROM PUBLIC;");
  });

  it("keeps the migration reversible and free of destructive forward statements", () => {
    expect(migrationSql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migrationSql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migrationSql).not.toMatch(/\bDROP\s+(TABLE|TYPE)\b/i);
    expect(rollbackSql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(rollbackSql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(rollbackSql).toContain("DROP TABLE IF EXISTS platform_audit_events");
    expect(rollbackSql).toContain("DROP TABLE IF EXISTS platform_members");
    expect(rollbackSql).toContain("DELETE FROM ledgerharbour_schema_migrations");
  });

  it("normalizes an explicit bootstrap list without an authorization allowlist", () => {
    expect(normalizePlatformAdminEmail("  Andres.San1404@GMAIL.COM ")).toBe("andres.san1404@gmail.com");
    expect(resolvePlatformAdminEmails(["--emails", "andres.san1404@gmail.com, partner@example.com"])).toEqual([
      "andres.san1404@gmail.com",
      "partner@example.com",
    ]);
    expect(() => resolvePlatformAdminEmails(["--emails", "not-an-email"])).toThrow("valid email");
  });

  it("requires explicit production bootstrap and a controlled non-production environment", () => {
    expect(resolvePlatformBootstrapEmails(["--emails", "operator@example.com"], {
      NODE_ENV: "production",
    })).toEqual(["operator@example.com"]);
    expect(() => resolvePlatformBootstrapEmails([], {
      NODE_ENV: "production",
      PLATFORM_ADMIN_EMAILS: "operator@example.com",
      PLATFORM_ADMIN_BOOTSTRAP: "true",
    })).toThrow("explicit --emails");
    expect(() => resolvePlatformBootstrapEmails([], {
      NODE_ENV: "qa",
      PLATFORM_ADMIN_EMAILS: "operator@example.com",
      PLATFORM_ADMIN_BOOTSTRAP: "true",
    })).toThrow("controlled");
    expect(() => resolvePlatformBootstrapEmails([], {
      NODE_ENV: "staging",
      PLATFORM_ADMIN_EMAILS: "operator@example.com",
    })).toThrow("PLATFORM_ADMIN_BOOTSTRAP=true");
    expect(resolvePlatformBootstrapEmails([], {
      NODE_ENV: "staging",
      PLATFORM_ADMIN_EMAILS: "operator@example.com",
      PLATFORM_ADMIN_BOOTSTRAP: "true",
    })).toEqual(["operator@example.com"]);
  });

  it("fails the migration check when platform migration or tables are missing", () => {
    expect(() => assertRequiredMigrations(
      { version: "0001_initial", applied: true, requiredTableCount: 11 },
      { version: "0002_platform_control_plane", applied: false, requiredTableCount: 0 },
    )).toThrow("platform control-plane migration");
    expect(() => assertRequiredMigrations(
      { version: "0001_initial", applied: true, requiredTableCount: 11 },
      { version: "0002_platform_control_plane", applied: true, requiredTableCount: 1 },
    )).toThrow("platform control-plane tables");
  });
});
