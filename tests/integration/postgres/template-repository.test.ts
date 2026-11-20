import { describe, expect, it } from "vitest";

import { createTestDatabase } from "../../../src/db/test-database";
import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import { createPostgresHeadingRepository } from "../../../src/modules/accounting/postgres-heading-repository";
import { createPostgresTemplateRepository } from "../../../src/modules/accounting/postgres-template-repository";
import { listHeadings } from "../../../src/modules/accounting/heading-service";
import {
  TEMPLATE_ERROR_CODES,
  getTemplate,
  importTemplate,
  type BusinessTemplate,
} from "../../../src/modules/accounting/template-service";
import type { StorageAdapter } from "../../../src/modules/documents/storage-adapter";
import { createPostgresOnboardingRepository } from "../../../src/modules/tenancy/postgres-tenancy-repository";
import { buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function identity(name: string): AuthIdentity {
  return { providerUserId: `template-${name}`, email: `template-${name}@example.com`, displayName: `Template ${name}`, emailVerified: true };
}

async function setup() {
  const database = await createTestDatabase();
  const tenancy = createPostgresOnboardingRepository(database.db);
  const businessA = await createApprovedBusiness(tenancy, "Template Books A", identity("owner-a"));
  const businessB = await createApprovedBusiness(tenancy, "Template Books B", identity("owner-b"));
  const ownerA = await tenancy.upsertUser(identity("owner-a"));
  const ownerB = await tenancy.upsertUser(identity("owner-b"));
  return { ...database, tenancy, businessA, businessB, ownerA, ownerB, templates: createPostgresTemplateRepository(database.db) };
}

function template(businessId: BusinessTemplate["businessId"], uploadedBy: BusinessTemplate["uploadedBy"], overrides: Partial<BusinessTemplate> = {}): BusinessTemplate {
  return {
    id: "template-1",
    businessId,
    privateObjectKey: `business/${businessId}/template/one`,
    originalFileName: "Accounts.xlsx",
    sizeBytes: 1234,
    checksum: "a".repeat(64),
    profile: { sheets: [], defects: [{ code: "TRAILING_SPACE", position: 2, detail: { count: 1 } }] },
    uploadedBy,
    createdAt: "2026-11-19T12:00:00.000Z",
    updatedAt: "2026-11-19T12:00:00.000Z",
    ...overrides,
  };
}

function memoryStorage() {
  const objects = new Map<string, Uint8Array>();
  const storage: StorageAdapter = {
    async put({ objectKey, data }) { objects.set(objectKey, data); return { objectKey, sizeBytes: data.byteLength }; },
    async get() { throw new Error("unused"); },
    async delete(objectKey) { objects.delete(objectKey); },
  };
  return { objects, storage };
}

describe("PostgreSQL business template repository", () => {
  it("round-trips a template and replaces it in place, keeping one row per business", async () => {
    const { close, execute, businessA, ownerA, templates } = await setup();
    try {
      const first = template(businessA.id, ownerA);
      await expect(templates.upsert(first)).resolves.toEqual(first);
      await expect(templates.findByBusinessId(businessA.id)).resolves.toEqual(first);

      const second = template(businessA.id, ownerA, { id: "template-2", privateObjectKey: "business/x/template/two", originalFileName: "Next.xlsx", checksum: "b".repeat(64), profile: { sheets: [], defects: [] }, createdAt: "2026-11-20T12:00:00.000Z", updatedAt: "2026-11-20T12:00:00.000Z" });
      await expect(templates.upsert(second)).resolves.toEqual({ ...second, id: first.id, createdAt: first.createdAt });

      await expect(execute(`INSERT INTO business_templates (id, business_id, private_object_key, original_file_name, size_bytes, checksum, profile, uploaded_by)
        VALUES ('duplicate', '${businessA.id}', 'k', 'a.xlsx', 1, '${"c".repeat(64)}', '{}', '${ownerA}')`)).rejects.toMatchObject({ code: "23505" });
    } finally {
      await close();
    }
  }, 30_000);

  it.each([
    ["checksum", "checksum = 'not-a-sha'"],
    ["size", "size_bytes = 0"],
    ["file name", `original_file_name = '${"n".repeat(256)}'`],
  ])("rejects an invalid %s with a CHECK constraint", async (_label, assignment) => {
    const { close, execute, businessA, ownerA, templates } = await setup();
    try {
      await templates.upsert(template(businessA.id, ownerA));
      await expect(execute(`UPDATE business_templates SET ${assignment}`)).rejects.toMatchObject({ code: "23514" });
    } finally {
      await close();
    }
  }, 30_000);

  it("only accepts an uploader who is a member of the same business and scopes reads", async () => {
    const { close, businessA, businessB, ownerA, ownerB, templates } = await setup();
    try {
      await expect(templates.upsert(template(businessA.id, ownerB))).rejects.toMatchObject({ code: TEMPLATE_ERROR_CODES.TEMPLATE_REPOSITORY_CONFLICT });
      await templates.upsert(template(businessA.id, ownerA));
      await expect(templates.findByBusinessId(businessB.id)).resolves.toBeNull();
    } finally {
      await close();
    }
  }, 30_000);

  it("imports and replaces a template in one transaction with the headings and the audit event", async () => {
    const { db, close, tenancy, businessA } = await setup();
    try {
      const { objects, storage } = memoryStorage();
      const dependencies = { tenancyRepository: tenancy, headings: createPostgresHeadingRepository(db), templates: createPostgresTemplateRepository(db), storage };
      const owner = identity("owner-a");
      const data = new Uint8Array(await buildSyntheticTemplate());

      const first = await importTemplate(businessA.id, { name: "Accounts.xlsx", mimeType: XLSX, data }, owner, dependencies);
      const headingIds = (await listHeadings(businessA.id, owner, dependencies)).map((item) => item.id);
      expect(first.inserted).toBe(headingIds.length);
      const [firstKey] = objects.keys();

      await expect(importTemplate(businessA.id, { name: "Accounts v2.xlsx", mimeType: XLSX, data }, owner, dependencies)).resolves.toMatchObject({ inserted: 0, updated: 0, unchanged: headingIds.length });
      expect((await listHeadings(businessA.id, owner, dependencies)).map((item) => item.id)).toEqual(headingIds);
      expect(objects.has(firstKey)).toBe(false);
      await expect(getTemplate(businessA.id, owner, dependencies)).resolves.toMatchObject({ fileName: "Accounts v2.xlsx", sheets: first.sheets, defects: first.defects });

      const audit = await db.execute<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM audit_events WHERE action = 'account_template_imported' ORDER BY created_at`);
      expect(audit.rows).toHaveLength(2);
      expect(audit.rows[1].metadata).toMatchObject({ inserted: 0, updated: 0, unchanged: headingIds.length, missing: 0, sheets: first.sheets.length });

      tenancy.transaction = async () => { throw new Error("audit failed"); };
      await expect(importTemplate(businessA.id, { name: "Broken.xlsx", mimeType: XLSX, data }, owner, dependencies)).rejects.toMatchObject({ code: TEMPLATE_ERROR_CODES.TEMPLATE_REPOSITORY_CONFLICT });
      expect(objects.size).toBe(1);
      await expect(dependencies.templates.findByBusinessId(businessA.id)).resolves.toMatchObject({ originalFileName: "Accounts v2.xlsx" });
    } finally {
      await close();
    }
  }, 30_000);
});
