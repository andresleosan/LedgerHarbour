import { readFileSync } from "node:fs";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  auditEvents,
  AuditActorType,
  businesses,
  categories,
  currencies,
  documents,
  DocumentStatus,
  invoices,
  jobs,
  joinRequests,
  JoinRequestStatus,
  memberships,
  MembershipRole,
  ownerAdminInvariant,
  projectMemberships,
  projects,
  schema,
  users,
} from "../../../src/db/schema";
import { customCurrencyCreationContract } from "../../../src/db/schema/businesses";
import {
  defaultCategorySeeds,
  defaultCurrencySeed,
  standardCurrencySeeds,
} from "../../../src/db/seed/default-categories";

const migrationSql = readFileSync(
  new URL("../../../src/db/migrations/0001_initial.sql", import.meta.url),
  "utf8",
);

function validateMigrationContract(sql: string) {
  const requiredTables = [
    "users",
    "businesses",
    "memberships",
    "join_requests",
    "documents",
    "categories",
    "currencies",
    "invoices",
    "audit_events",
    "jobs",
  ];
  const requiredContracts = [
    "BEGIN;",
    "COMMIT;",
    "documents_uploader_business_fk",
    "audit_events_append_only",
    "memberships_exactly_one_active_owner",
    "businesses_base_currency_custom_fk",
    "REVOKE DELETE, TRUNCATE",
  ];
  const missingTables = requiredTables.filter((table) => !sql.includes(`CREATE TABLE ${table} (`));
  const missingContracts = requiredContracts.filter((contract) => !sql.includes(contract));
  const destructiveStatements = sql.match(/\b(?:DROP\s+(?:TABLE|TYPE)|TRUNCATE\s+TABLE)\b/gi) ?? [];

  return {
    valid: missingTables.length === 0 && missingContracts.length === 0 && destructiveStatements.length === 0,
    tableCount: requiredTables.length,
    integrityContractCount: requiredContracts.length,
    missingTables,
    missingContracts,
    destructiveStatements,
  };
}

const migrationValidation = validateMigrationContract(migrationSql);

describe("relational domain schema", () => {
  it("provides a reproducible SQL contract validation result", () => {
    expect(migrationValidation).toEqual({
      valid: true,
      tableCount: 10,
      integrityContractCount: 7,
      missingTables: [],
      missingContracts: [],
      destructiveStatements: [],
    });
  });

  it("exposes the exact domain enum values", () => {
    expect(MembershipRole).toEqual([
      "owner_admin",
      "general_admin",
      "administrator",
    ]);
    expect(JoinRequestStatus).toEqual(["pending", "approved", "rejected"]);
    expect(DocumentStatus).toEqual([
      "uploaded",
      "processing",
      "needs_review",
      "approved",
      "failed",
    ]);
    expect(AuditActorType).toEqual(["user", "system"]);
  });

  it("exports every required relational table", () => {
    expect(Object.keys(schema)).toEqual([
      "users",
      "businesses",
      "memberships",
      "joinRequests",
      "documents",
      "invoices",
      "categories",
      "currencies",
      "auditEvents",
      "jobs",
      "platformMembers",
      "platformAuditEvents",
      "projects",
      "projectMemberships",
    ]);
    expect([
      users,
      businesses,
      memberships,
      joinRequests,
      documents,
      invoices,
      categories,
      currencies,
      auditEvents,
      jobs,
      schema.platformMembers,
      schema.platformAuditEvents,
      projects,
      projectMemberships,
    ].map(getTableName)).toEqual([
      "users",
      "businesses",
      "memberships",
      "join_requests",
      "documents",
      "invoices",
      "categories",
      "currencies",
      "audit_events",
      "jobs",
      "platform_members",
      "platform_audit_events",
      "projects",
      "project_memberships",
    ]);
  });

  it("requires a non-null business_id on every tenant-owned table", () => {
    for (const table of [
      memberships,
      joinRequests,
      documents,
      invoices,
      categories,
      currencies,
      auditEvents,
      jobs,
      projects,
    ]) {
      expect(getTableColumns(table).businessId.notNull).toBe(true);
    }
  });

  it("keeps invoice and job references inside the same business", () => {
    const invoiceForeignKeys = getTableConfig(invoices).foreignKeys.map((foreignKey) => ({
      name: foreignKey.getName(),
      localColumns: foreignKey.reference().columns.map((column) => column.name),
      foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
    }));
    const jobForeignKeys = getTableConfig(jobs).foreignKeys.map((foreignKey) => ({
      name: foreignKey.getName(),
      localColumns: foreignKey.reference().columns.map((column) => column.name),
      foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
    }));

    expect(invoiceForeignKeys).toContainEqual({
      name: "invoices_business_document_fk",
      localColumns: ["business_id", "document_id"],
      foreignColumns: ["business_id", "id"],
    });
    expect(invoiceForeignKeys).toContainEqual({
      name: "invoices_business_currency_fk",
      localColumns: ["business_id", "currency_id"],
      foreignColumns: ["business_id", "id"],
    });
    expect(invoiceForeignKeys).toContainEqual({
      name: "invoices_business_category_fk",
      localColumns: ["business_id", "category_id"],
      foreignColumns: ["business_id", "id"],
    });
    expect(jobForeignKeys).toContainEqual({
      name: "jobs_business_document_fk",
      localColumns: ["business_id", "document_id"],
      foreignColumns: ["business_id", "id"],
    });
  });

  it("attributes document uploaders and user audit actors to an active membership", () => {
    const documentForeignKeys = getTableConfig(documents).foreignKeys.map((foreignKey) => ({
      name: foreignKey.getName(),
      localColumns: foreignKey.reference().columns.map((column) => column.name),
      foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
    }));
    const auditForeignKeys = getTableConfig(auditEvents).foreignKeys.map((foreignKey) => ({
      name: foreignKey.getName(),
      localColumns: foreignKey.reference().columns.map((column) => column.name),
      foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
    }));

    expect(documentForeignKeys).toContainEqual({
      name: "documents_uploader_business_fk",
      localColumns: ["uploader_id", "business_id"],
      foreignColumns: ["user_id", "business_id"],
    });
    expect(auditForeignKeys).toContainEqual({
      name: "audit_events_user_actor_business_fk",
      localColumns: ["actor_id", "business_id"],
      foreignColumns: ["user_id", "business_id"],
    });
    expect(getTableColumns(auditEvents).actorType.notNull).toBe(true);
    expect(getTableColumns(auditEvents).actorId.notNull).toBe(false);
    expect(migrationSql).toContain("documents_uploader_active_membership");
    expect(migrationSql).toContain("audit_events_user_actor_active_membership");
    expect(migrationSql).toContain(
      "actor_type = 'system' AND actor_id IS NULL",
    );
  });

  it("protects audit events from update and delete at the database boundary", () => {
    expect(migrationSql).toContain("CREATE FUNCTION prevent_audit_event_mutation()");
    expect(migrationSql).toContain("BEFORE UPDATE OR DELETE ON audit_events");
    expect(migrationSql).toContain("RAISE EXCEPTION 'audit events are append-only'");
  });

  it("removes ordinary delete privileges from business financial records", () => {
    expect(migrationSql).toContain(
      "REVOKE DELETE, TRUNCATE ON documents, invoices, categories, currencies, audit_events, jobs FROM PUBLIC;",
    );
  });

  it("wraps the initial migration in one non-destructive transaction", () => {
    expect(migrationSql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migrationSql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migrationSql).not.toMatch(/\b(DROP\s+(TABLE|TYPE)|TRUNCATE\s+TABLE)\b/i);
  });

  it("defines an atomic exactly-one-active-owner contract", () => {
    expect(migrationSql).toContain("memberships_one_active_owner_per_business");
    expect(migrationSql).toContain(
      "WHERE role = 'owner_admin' AND is_active = true",
    );
    expect(migrationSql).toContain("CREATE FUNCTION enforce_exactly_one_active_owner()");
    expect(migrationSql).toContain(
      "COUNT(*) INTO active_owner_count FROM memberships WHERE business_id = target_business_id",
    );
    expect(migrationSql).toContain("OLD.business_id IS DISTINCT FROM NEW.business_id");
    expect(migrationSql).toContain("memberships_exactly_one_active_owner");
    expect(migrationSql).toContain("businesses_exactly_one_active_owner");
    expect(migrationSql).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migrationSql).toContain(
      "deactivate the current owner before activating the replacement",
    );
    expect(ownerAdminInvariant).toEqual({
      role: "owner_admin",
      activePredicate: "role = 'owner_admin' AND is_active = true",
      replacementOrder: "deactivate the current owner before activating the replacement",
      requiresAtomicTransaction: true,
    });
  });

  it("keeps Owner Admin trigger row fields inside the memberships branch", () => {
    expect(migrationSql).toContain("IF TG_TABLE_NAME = 'memberships' THEN");
    expect(migrationSql).toContain(
      "IF TG_OP = 'UPDATE' AND OLD.business_id IS DISTINCT FROM NEW.business_id THEN",
    );
    expect(migrationSql).not.toContain(
      "IF TG_TABLE_NAME = 'memberships'\n    AND TG_OP = 'UPDATE'",
    );
  });

  it("represents standard and custom base currencies with aligned seed fields", () => {
    const businessColumns = getTableColumns(businesses);
    const currencyColumns = getTableColumns(currencies);

    expect(businessColumns.baseCurrencyKind.notNull).toBe(true);
    expect(businessColumns.baseCurrencyCode.notNull).toBe(false);
    expect(businessColumns.baseCurrencyId.notNull).toBe(false);
    expect(currencyColumns.isoCode.notNull).toBe(false);
    expect(migrationSql).toContain("businesses_base_currency_custom_fk");
    expect(migrationSql).toContain("base_currency_kind = 'custom'");
    expect(defaultCurrencySeed).toEqual({
      name: "British Pound",
      isoCode: "GBP",
      symbol: "GBP",
      decimalCount: 2,
      isStandard: true,
    });
    expect(standardCurrencySeeds.map(({ isoCode }) => isoCode)).toEqual([
      "GBP",
      "EUR",
      "USD",
    ]);
  });

  it("keeps the custom base-currency FK aligned between ORM and migration", () => {
    const businessForeignKeys = getTableConfig(businesses).foreignKeys.map((foreignKey) => ({
      name: foreignKey.getName(),
      localColumns: foreignKey.reference().columns.map((column) => column.name),
      foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
    }));

    expect(businessForeignKeys).toContainEqual({
      name: "businesses_base_currency_custom_fk",
      localColumns: ["id", "base_currency_id"],
      foreignColumns: ["business_id", "id"],
    });
    expect(migrationSql).toContain("CONSTRAINT businesses_base_currency_custom_fk");
    expect(migrationSql).toContain("FOREIGN KEY (id, base_currency_id)");
  });

  it("defines the two-phase custom-currency creation transaction", () => {
    expect(customCurrencyCreationContract).toEqual({
      initialBase: { kind: "standard", code: "GBP" },
      steps: [
        "create_business_with_standard_base",
        "insert_custom_currency_for_business",
        "update_business_to_custom_base",
      ],
      requiresAtomicTransaction: true,
    });
    expect(migrationSql).toContain("base_currency_code text DEFAULT 'GBP'");
    expect(migrationSql).toContain("currencies_business_id_unique");
    expect(migrationSql).toContain("businesses_base_currency_custom_fk");
  });

  it("defines the default currency and category seeds", () => {
    expect(defaultCurrencySeed).toEqual({
      name: "British Pound",
      isoCode: "GBP",
      symbol: "GBP",
      decimalCount: 2,
      isStandard: true,
    });
    expect(standardCurrencySeeds.map(({ isoCode }) => isoCode)).toEqual([
      "GBP",
      "EUR",
      "USD",
    ]);
    expect(defaultCategorySeeds.map(({ name }) => name)).toEqual([
      "Office expenses",
      "Travel",
      "Utilities",
      "Professional services",
      "Other expenses",
    ]);
  });
});
