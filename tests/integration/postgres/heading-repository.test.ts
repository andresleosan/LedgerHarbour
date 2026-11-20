import { describe, expect, it } from "vitest";

import { createTestDatabase } from "../../../src/db/test-database";
import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import {
  HEADING_ERROR_CODES,
  importHeadings,
  listHeadings,
  renameHeading,
  type AccountHeading,
  type TemplateHeadingInput,
} from "../../../src/modules/accounting/heading-service";
import { createPostgresHeadingRepository } from "../../../src/modules/accounting/postgres-heading-repository";
import { createPostgresOnboardingRepository } from "../../../src/modules/tenancy/postgres-tenancy-repository";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

function identity(name: string): AuthIdentity {
  return { providerUserId: `heading-${name}`, email: `heading-${name}@example.com`, displayName: `Heading ${name}`, emailVerified: true };
}

function heading(businessId: AccountHeading["businessId"], overrides: Partial<AccountHeading> = {}): AccountHeading {
  return {
    id: "heading-rent",
    businessId,
    position: 4,
    templateValue: "Rent ",
    valueType: "text",
    group: "expenses",
    sortOrder: 4,
    displayName: "Rent",
    isActive: true,
    blockedReason: null,
    createdAt: "2026-11-19T12:00:00.000Z",
    updatedAt: "2026-11-19T12:00:00.000Z",
    ...overrides,
  };
}

async function setup() {
  const database = await createTestDatabase();
  const tenancy = createPostgresOnboardingRepository(database.db);
  const businessA = await createApprovedBusiness(tenancy, "Heading Books A", identity("owner-a"));
  const businessB = await createApprovedBusiness(tenancy, "Heading Books B", identity("owner-b"));
  return { ...database, tenancy, businessA, businessB, headings: createPostgresHeadingRepository(database.db) };
}

describe("PostgreSQL account heading repository", () => {
  it("round-trips headings, preserving a trailing space and an empty template value exactly", async () => {
    const { close, businessA, headings } = await setup();
    try {
      const rent = heading(businessA.id);
      const blank = heading(businessA.id, { id: "heading-blank", position: 2, sortOrder: 2, templateValue: "", displayName: "Heading 2", isActive: false, blockedReason: "blank_heading" });
      await expect(headings.create(rent)).resolves.toEqual(rent);
      await expect(headings.create(blank)).resolves.toEqual(blank);
      await expect(headings.findById(rent.id, businessA.id)).resolves.toEqual(rent);
      await expect(headings.listByBusinessId(businessA.id)).resolves.toEqual([blank, rent]);

      const renamed = { ...rent, displayName: "Premises", updatedAt: "2026-11-19T12:05:00.000Z" };
      await expect(headings.update(renamed, businessA.id)).resolves.toEqual(renamed);
      expect((await headings.findById(rent.id, businessA.id))?.templateValue).toBe("Rent ");
      expect((await headings.findById(blank.id, businessA.id))?.templateValue).toBe("");
    } finally {
      await close();
    }
  }, 30_000);

  it("enforces one heading per business position and scopes reads and writes to the business", async () => {
    const { close, businessA, businessB, headings } = await setup();
    try {
      await headings.create(heading(businessA.id));
      await expect(headings.create(heading(businessA.id, { id: "heading-other" }))).rejects.toMatchObject({ code: HEADING_ERROR_CODES.HEADING_REPOSITORY_CONFLICT });
      await expect(headings.create(heading(businessB.id, { id: "heading-b" }))).resolves.toMatchObject({ businessId: businessB.id, position: 4 });

      await expect(headings.findById("heading-rent", businessB.id)).resolves.toBeNull();
      await expect(headings.update(heading(businessA.id, { displayName: "Hijacked" }), businessB.id)).rejects.toMatchObject({ code: HEADING_ERROR_CODES.HEADING_NOT_FOUND });
      await expect(headings.update(heading(businessB.id, { displayName: "Hijacked" }), businessB.id)).rejects.toMatchObject({ code: HEADING_ERROR_CODES.HEADING_NOT_FOUND });
      expect((await headings.listByBusinessId(businessB.id)).map((item) => item.id)).toEqual(["heading-b"]);
      expect((await headings.findById("heading-rent", businessA.id))?.displayName).toBe("Rent");
    } finally {
      await close();
    }
  }, 30_000);

  it.each([
    ["position", "position = 0"],
    ["value type", "value_type = 'date'"],
    ["group", "heading_group = 'overheads'"],
    ["blocked reason", "blocked_reason = 'unknown'"],
    ["blocked and active", "blocked_reason = 'blank_heading', is_active = true"],
    ["empty display name", "display_name = ''"],
  ])("rejects an invalid %s with a CHECK constraint", async (_label, assignment) => {
    const { close, execute, businessA, headings } = await setup();
    try {
      await headings.create(heading(businessA.id));
      await expect(execute(`UPDATE account_headings SET ${assignment} WHERE id = 'heading-rent'`)).rejects.toMatchObject({ code: "23514" });
    } finally {
      await close();
    }
  }, 30_000);

  it("exposes a same-tenant key that a cross-business reference cannot satisfy", async () => {
    const { close, execute, businessA, businessB, headings } = await setup();
    try {
      await headings.create(heading(businessA.id));
      await execute(`CREATE TABLE heading_refs (business_id text NOT NULL, heading_id text NOT NULL, FOREIGN KEY (business_id, heading_id) REFERENCES account_headings (business_id, id))`);
      await expect(execute(`INSERT INTO heading_refs VALUES ('${businessA.id}', 'heading-rent')`)).resolves.toBeDefined();
      await expect(execute(`INSERT INTO heading_refs VALUES ('${businessB.id}', 'heading-rent')`)).rejects.toMatchObject({ code: "23503" });
      await expect(execute("DELETE FROM account_headings WHERE id = 'heading-rent'")).rejects.toMatchObject({ code: "23503" });
    } finally {
      await close();
    }
  }, 30_000);

  it("runs the import service in one transaction with an audit event carrying the counts", async () => {
    const { db, close, tenancy, businessA } = await setup();
    try {
      const dependencies = { tenancyRepository: tenancy, headings: createPostgresHeadingRepository(db) };
      const owner = identity("owner-a");
      const input = (position: number, templateValue: string): TemplateHeadingInput => ({ position, templateValue, valueType: "text", group: "expenses", order: position, blockedReason: null });
      await importHeadings(businessA.id, [input(1, "Rent "), input(2, "Fuel")], owner, dependencies);
      const [rent] = await listHeadings(businessA.id, owner, dependencies);
      await renameHeading(businessA.id, rent.id, "Premises", owner, dependencies);

      await expect(importHeadings(businessA.id, [input(1, "Rent and rates"), input(3, "Phone")], owner, dependencies)).resolves.toMatchObject({ inserted: 1, updated: 1, missing: 1 });
      const after = await listHeadings(businessA.id, owner, dependencies);
      expect(after.find((item) => item.id === rent.id)).toMatchObject({ templateValue: "Rent and rates", displayName: "Premises", isActive: true });
      expect(after.find((item) => item.position === 2)).toMatchObject({ isActive: false, blockedReason: "missing_from_template" });

      const audit = await db.execute<{ action: string; entity_type: string; metadata: unknown }>(`SELECT action, entity_type, metadata FROM audit_events WHERE action = 'account_heading_imported' ORDER BY created_at`);
      expect(audit.rows.at(-1)).toEqual({ action: "account_heading_imported", entity_type: "account_heading", metadata: { inserted: 1, updated: 1, unchanged: 0, missing: 1 } });

      tenancy.transaction = async () => { throw new Error("audit failed"); };
      await expect(importHeadings(businessA.id, [input(9, "Late")], owner, dependencies)).rejects.toMatchObject({ code: HEADING_ERROR_CODES.HEADING_REPOSITORY_CONFLICT });
      expect((await dependencies.headings.listByBusinessId(businessA.id)).some((item) => item.position === 9)).toBe(false);
    } finally {
      await close();
    }
  }, 30_000);
});
