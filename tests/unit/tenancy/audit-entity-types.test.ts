import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { auditEntityType } from "../../../src/modules/tenancy/postgres-tenancy-repository";

const MODULES = join(__dirname, "../../../src/modules");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

/** Every snake_case literal on a `type:` / `auditType:` / `…Audit(` line of a module that writes business audit events. */
function auditActions(): Map<string, string> {
  const actions = new Map<string, string>();
  for (const file of sourceFiles(MODULES)) {
    if (file.includes(join("modules", "platform")) || file.endsWith("postgres-tenancy-repository.ts")) continue;
    const source = readFileSync(file, "utf8");
    if (!/appendAuditEvent|appendAudit\(/.test(source)) continue;
    for (const line of source.split("\n")) {
      if (!/\b(type|auditType):|Audit\(/.test(line)) continue;
      for (const [, action] of line.matchAll(/"([a-z]+(?:_[a-z]+)+)"/g)) actions.set(action!, file);
    }
  }
  return actions;
}

describe("audit entity types", () => {
  it("finds the audit actions of this week's features", () => {
    expect([...auditActions().keys()]).toEqual(expect.arrayContaining([
      "movement_created", "transfer_created", "statement_imported", "account_template_imported",
      "workbook_exported", "annex_downloaded", "invoice_created_manually", "financial_year_dates_updated",
      "money_account_opening_balance_set", "statement_movement_coded", "invoice_payment_changed",
    ]));
  });

  it("maps every audit action written by a module to an explicit entity type", () => {
    const unmapped = [...auditActions()].filter(([action]) => auditEntityType(action) === null).map(([action, file]) => `${action} (${file})`);
    expect(unmapped).toEqual([]);
  });

  it.each([
    ["movement_created", "movement"],
    ["movement_deleted", "movement"],
    ["transfer_updated", "transfer"],
    ["statement_imported", "statement_import"],
    ["statement_movement_coded", "movement"],
    ["account_template_imported", "account_template"],
    ["account_heading_renamed", "account_heading"],
    ["financial_year_reopened", "financial_year"],
    ["money_account_opening_balance_set", "money_account"],
    ["workbook_exported", "workbook_export"],
    ["annex_downloaded", "annex"],
    ["invoice_created_manually", "invoice"],
    ["invoice_payment_changed", "invoice"],
    ["project_created", "project"],
    ["ownership_transferred", "membership"],
    ["business_requested", "business"],
  ])("stores %s as %s", (action, entityType) => {
    expect(auditEntityType(action)).toBe(entityType);
  });

  it("has no mapping for an unknown action", () => {
    expect(auditEntityType("something_new")).toBeNull();
  });
});
