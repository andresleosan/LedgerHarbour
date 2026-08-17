import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("business lifecycle migration rollback", () => {
  it("removes its ledger record before dropping lifecycle objects", async () => {
    const rollback = await readFile(new URL("../../../src/db/migrations/rollback/0003_business_lifecycle_down.sql", import.meta.url), "utf8");
    const ledgerIndex = rollback.indexOf("DELETE FROM ledgerharbour_schema_migrations");
    const objectIndex = rollback.indexOf("DROP TRIGGER");

    expect(ledgerIndex).toBeGreaterThanOrEqual(0);
    expect(ledgerIndex).toBeLessThan(objectIndex);
    expect(rollback).toContain("0003_business_lifecycle");
  });
});
