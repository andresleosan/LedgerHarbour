import { describe, expect, it } from "vitest";

import { listHeadings, renameHeading, createHeadingRepository, type TemplateHeadingInput } from "../../../src/modules/accounting/heading-service";
import {
  TEMPLATE_ERROR_CODES,
  TEMPLATE_MAX_SIZE_BYTES,
  createTemplateRepository,
  getTemplate,
  importTemplate,
  type TemplateDependencies,
} from "../../../src/modules/accounting/template-service";
import type { StorageAdapter } from "../../../src/modules/documents/storage-adapter";
import { readTemplate } from "../../../src/modules/workbook/read-template";
import type { TemplateHeading } from "../../../src/modules/workbook/template-profile";
import { createInMemoryOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import type { UserId } from "../../../src/modules/tenancy/types";
import { buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const owner = "template-owner" as UserId;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// The reader's heading must be accepted where the heading service expects its input.
const readerHeadingFitsService: (heading: TemplateHeading) => TemplateHeadingInput = (heading) => heading;
void readerHeadingFitsService;

function memoryStorage() {
  const objects = new Map<string, Uint8Array>();
  const storage: StorageAdapter & { failDelete?: boolean } = {
    async put({ objectKey, data }) { objects.set(objectKey, data); return { objectKey, sizeBytes: data.byteLength }; },
    async get(objectKey) { const data = objects.get(objectKey)!; return new ReadableStream({ start(controller) { controller.enqueue(data); controller.close(); } }); },
    async delete(objectKey) { if (storage.failDelete) throw new Error("delete failed"); objects.delete(objectKey); },
  };
  return { objects, storage };
}

async function context() {
  const tenancy = createInMemoryOnboardingRepository();
  const business = await createApprovedBusiness(tenancy, "Template Books", owner);
  const { objects, storage } = memoryStorage();
  const dependencies = { tenancyRepository: tenancy, headings: createHeadingRepository(), templates: createTemplateRepository(), storage } satisfies TemplateDependencies;
  return { tenancy, business, objects, storage, dependencies };
}

async function file(name = "Accounts 2026.xlsx", mimeType = XLSX, data?: Uint8Array) {
  return { name, mimeType, data: data ?? new Uint8Array(await buildSyntheticTemplate()) };
}

describe("template import service", () => {
  it("stores the template, imports its headings and reports the profile without the storage key", async () => {
    const { tenancy, business, objects, dependencies } = await context();
    const upload = await file();
    const profile = await readTemplate(upload.data);

    const result = await importTemplate(business.id, upload, owner, dependencies);

    expect(result).toEqual({ inserted: profile.headings.length, updated: 0, unchanged: 0, missing: 0, sheets: profile.sheets, defects: profile.defects });
    expect([...objects.keys()]).toEqual([expect.stringMatching(new RegExp(`^business/${business.id}/template/[0-9a-f-]{36}$`))]);
    expect((await listHeadings(business.id, owner, dependencies)).map((item) => item.templateValue)).toEqual(profile.headings.map((item) => item.templateValue));

    const template = await getTemplate(business.id, owner, dependencies);
    expect(template).toEqual({ fileName: "Accounts 2026.xlsx", uploadedAt: expect.any(String), sheets: profile.sheets, defects: profile.defects });
    expect(JSON.stringify(template)).not.toContain("business/");

    const event = (await tenancy.listAuditEvents(business.id)).find((item) => item.type === "account_template_imported");
    const defectCounts: Record<string, number> = {};
    for (const defect of profile.defects) defectCounts[defect.code] = (defectCounts[defect.code] ?? 0) + 1;
    expect(event?.metadata).toEqual({ inserted: profile.headings.length, updated: 0, unchanged: 0, missing: 0, defects: defectCounts, sheets: profile.sheets.length });
    expect(JSON.stringify(event)).not.toContain("Accounts 2026");
  });

  it("returns null before any template is uploaded", async () => {
    const { business, dependencies } = await context();
    await expect(getTemplate(business.id, owner, dependencies)).resolves.toBeNull();
  });

  it("replaces the template, keeps heading ids and names, and deletes the previous object", async () => {
    const { business, objects, dependencies } = await context();
    await importTemplate(business.id, await file(), owner, dependencies);
    const [firstKey] = objects.keys();
    const before = await listHeadings(business.id, owner, dependencies);
    await renameHeading(business.id, before[0].id, "Turnover", owner, dependencies);

    const result = await importTemplate(business.id, await file("Accounts 2027.xlsx", "application/octet-stream"), owner, dependencies);

    // The same headings again: nothing stored changes, so none counts as updated.
    expect(result).toMatchObject({ inserted: 0, updated: 0, unchanged: before.length, missing: 0 });
    const after = await listHeadings(business.id, owner, dependencies);
    expect(after.map((item) => item.id)).toEqual(before.map((item) => item.id));
    expect(after[0].displayName).toBe("Turnover");
    expect(objects.has(firstKey)).toBe(false);
    expect(objects.size).toBe(1);
    await expect(getTemplate(business.id, owner, dependencies)).resolves.toMatchObject({ fileName: "Accounts 2027.xlsx" });
  });

  it("does not fail when the previous object cannot be deleted", async () => {
    const { business, objects, storage, dependencies } = await context();
    await importTemplate(business.id, await file(), owner, dependencies);
    storage.failDelete = true;
    await expect(importTemplate(business.id, await file("Second.xlsx"), owner, dependencies)).resolves.toMatchObject({ inserted: 0 });
    expect(objects.size).toBe(2);
  });

  it("leaves no stored object, heading or template behind when the transaction fails", async () => {
    const { tenancy, business, objects, dependencies } = await context();
    tenancy.appendAuditEvent = async () => { throw new Error("audit failed"); };

    await expect(importTemplate(business.id, await file(), owner, dependencies)).rejects.toMatchObject({ code: TEMPLATE_ERROR_CODES.TEMPLATE_REPOSITORY_CONFLICT });

    expect(objects.size).toBe(0);
    expect(await dependencies.headings.listByBusinessId(business.id)).toEqual([]);
    expect(await dependencies.templates.findByBusinessId(business.id)).toBeNull();
  });

  it("checks permission before looking at the file", async () => {
    const { business, objects, dependencies } = await context();
    const garbage = { name: "notes.txt", mimeType: "text/plain", data: new TextEncoder().encode("not a workbook") };
    await expect(importTemplate(business.id, garbage, "outsider" as UserId, dependencies)).rejects.toMatchObject({ code: TEMPLATE_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    expect(objects.size).toBe(0);
  });

  it.each([
    { label: "a non-xlsx name", name: "accounts.xls", mimeType: XLSX, data: undefined, code: TEMPLATE_ERROR_CODES.UNSUPPORTED_TEMPLATE_TYPE },
    { label: "a wrong MIME type", name: "accounts.xlsx", mimeType: "text/csv", data: undefined, code: TEMPLATE_ERROR_CODES.UNSUPPORTED_TEMPLATE_TYPE },
    { label: "a missing zip signature", name: "accounts.xlsx", mimeType: XLSX, data: new TextEncoder().encode("plain text"), code: TEMPLATE_ERROR_CODES.UNSUPPORTED_TEMPLATE_TYPE },
    { label: "an empty file", name: "accounts.xlsx", mimeType: XLSX, data: new Uint8Array(), code: TEMPLATE_ERROR_CODES.EMPTY_TEMPLATE },
    { label: "an oversized file", name: "accounts.xlsx", mimeType: XLSX, data: new Uint8Array(TEMPLATE_MAX_SIZE_BYTES + 1), code: TEMPLATE_ERROR_CODES.TEMPLATE_TOO_LARGE },
    { label: "a long file name", name: `${"a".repeat(251)}.xlsx`, mimeType: XLSX, data: undefined, code: TEMPLATE_ERROR_CODES.INVALID_TEMPLATE_FILE },
  ])("rejects $label before reading it", async ({ name, mimeType, data, code }) => {
    const { business, objects, dependencies } = await context();
    await expect(importTemplate(business.id, await file(name, mimeType, data), owner, dependencies)).rejects.toMatchObject({ code });
    expect(objects.size).toBe(0);
  });

  it("maps an unreadable workbook to a typed error carrying the reader's code", async () => {
    const { business, objects, dependencies } = await context();
    const zipButNotWorkbook = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0]);
    await expect(importTemplate(business.id, await file("accounts.xlsx", XLSX, zipButNotWorkbook), owner, dependencies)).rejects.toMatchObject({
      code: TEMPLATE_ERROR_CODES.TEMPLATE_UNREADABLE,
      readerCode: expect.any(String),
    });
    expect(objects.size).toBe(0);
  });
});
