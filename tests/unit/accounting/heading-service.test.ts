import { describe, expect, it } from "vitest";

import {
  HEADING_ERROR_CODES,
  createHeadingRepository,
  importHeadings,
  listHeadings,
  renameHeading,
  setHeadingActive,
  type HeadingDependencies,
  type TemplateHeadingInput,
} from "../../../src/modules/accounting/heading-service";
import { createInMemoryOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import type { UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const owner = "heading-owner" as UserId;

function heading(position: number, templateValue: string, overrides: Partial<TemplateHeadingInput> = {}): TemplateHeadingInput {
  return { position, templateValue, valueType: "text", group: "expenses", order: position, blockedReason: null, ...overrides };
}

async function context() {
  const tenancy = createInMemoryOnboardingRepository();
  const business = await createApprovedBusiness(tenancy, "Heading Books", owner);
  const dependencies = { tenancyRepository: tenancy, headings: createHeadingRepository() } satisfies HeadingDependencies;
  return { tenancy, business, dependencies };
}

describe("account heading service", () => {
  it("starts a new business with no headings", async () => {
    const { business, dependencies } = await context();
    await expect(listHeadings(business.id, owner, dependencies)).resolves.toEqual([]);
  });

  it("inserts template headings with exact values, defaults and sort order", async () => {
    const { business, dependencies } = await context();
    const result = await importHeadings(business.id, [
      heading(2, "Rent ", { order: 2 }),
      heading(1, "Sales", { group: "income", order: 1 }),
      heading(3, "", { order: 3, blockedReason: "blank_heading" }),
    ], owner, dependencies);

    expect(result).toMatchObject({ inserted: 3, updated: 0, missing: 0 });
    const headings = await listHeadings(business.id, owner, dependencies);
    expect(headings.map((item) => item.position)).toEqual([1, 2, 3]);
    expect(headings[0]).toMatchObject({ businessId: business.id, templateValue: "Sales", displayName: "Sales", group: "income", isActive: true, blockedReason: null });
    expect(headings[1]).toMatchObject({ templateValue: "Rent ", displayName: "Rent", isActive: true });
    expect(headings[2]).toMatchObject({ templateValue: "", displayName: "Heading 3", isActive: false, blockedReason: "blank_heading" });
  });

  it.each([
    heading(1, "42", { valueType: "number" }),
    heading(1, "7"),
    heading(1, "b"),
    heading(1, " 12a "),
  ])("imports placeholder heading $templateValue inactive", async (input) => {
    const { business, dependencies } = await context();
    await importHeadings(business.id, [input], owner, dependencies);
    await expect(listHeadings(business.id, owner, dependencies)).resolves.toMatchObject([{ isActive: false, blockedReason: null }]);
  });

  it("updates by position, keeps ids and customised names, and marks absent positions missing", async () => {
    const { tenancy, business, dependencies } = await context();
    await importHeadings(business.id, [heading(1, "Sales"), heading(2, "Rent"), heading(3, "Fuel")], owner, dependencies);
    const before = await listHeadings(business.id, owner, dependencies);
    const storedReference = before.find((item) => item.position === 2)!.id;
    await renameHeading(business.id, storedReference, "  Premises rent  ", owner, dependencies);

    const result = await importHeadings(business.id, [
      heading(1, "Sales income", { group: "income", order: 5 }),
      heading(2, "Rent and rates", { order: 1 }),
    ], owner, dependencies);

    expect(result).toMatchObject({ inserted: 0, updated: 2, missing: 1 });
    const after = await listHeadings(business.id, owner, dependencies);
    expect(after.map((item) => item.id).sort()).toEqual(before.map((item) => item.id).sort());
    const byPosition = new Map(after.map((item) => [item.position, item]));
    expect(byPosition.get(1)).toMatchObject({ templateValue: "Sales income", displayName: "Sales income", group: "income", sortOrder: 5, isActive: true });
    expect(byPosition.get(2)).toMatchObject({ id: storedReference, templateValue: "Rent and rates", displayName: "Premises rent", sortOrder: 1 });
    expect(byPosition.get(3)).toMatchObject({ templateValue: "Fuel", isActive: false, blockedReason: "missing_from_template" });
    expect(after.find((item) => item.id === storedReference)?.displayName).toBe("Premises rent");

    const importEvents = (await tenancy.listAuditEvents(business.id)).filter((event) => event.type === "account_heading_imported");
    expect(importEvents).toHaveLength(2);
    expect(importEvents[1]).toMatchObject({ entityId: business.id, metadata: { inserted: 0, updated: 2, missing: 1 } });
  });

  it("deactivates a heading that becomes blocked and keeps a user deactivation across re-import", async () => {
    const { business, dependencies } = await context();
    await importHeadings(business.id, [heading(1, "Sales"), heading(2, "Rent")], owner, dependencies);
    const [sales, rent] = await listHeadings(business.id, owner, dependencies);
    await setHeadingActive(business.id, rent.id, false, owner, dependencies);

    await importHeadings(business.id, [heading(1, "Sales", { blockedReason: "total_not_read" }), heading(2, "Rent")], owner, dependencies);

    const after = await listHeadings(business.id, owner, dependencies);
    expect(after.find((item) => item.id === sales.id)).toMatchObject({ isActive: false, blockedReason: "total_not_read" });
    expect(after.find((item) => item.id === rent.id)).toMatchObject({ isActive: false, blockedReason: null });
  });

  it("rejects activating a blocked heading and allows activating a placeholder", async () => {
    const { tenancy, business, dependencies } = await context();
    await importHeadings(business.id, [heading(1, "Do not use", { blockedReason: "marked_do_not_use" }), heading(2, "7")], owner, dependencies);
    const [blocked, placeholder] = await listHeadings(business.id, owner, dependencies);

    await expect(setHeadingActive(business.id, blocked.id, true, owner, dependencies)).rejects.toMatchObject({ code: HEADING_ERROR_CODES.HEADING_BLOCKED });
    await expect(setHeadingActive(business.id, placeholder.id, true, owner, dependencies)).resolves.toMatchObject({ id: placeholder.id, isActive: true });
    expect((await tenancy.listAuditEvents(business.id)).map((event) => event.type)).toContain("account_heading_activated");
  });

  it("renames the display name only and keeps the id resolvable", async () => {
    const { tenancy, business, dependencies } = await context();
    await importHeadings(business.id, [heading(1, "Motor ")], owner, dependencies);
    const [original] = await listHeadings(business.id, owner, dependencies);

    const renamed = await renameHeading(business.id, original.id, " Vehicle costs ", owner, dependencies);

    expect(renamed).toEqual({ ...original, displayName: "Vehicle costs", updatedAt: renamed.updatedAt });
    expect((await listHeadings(business.id, owner, dependencies)).find((item) => item.id === original.id)?.displayName).toBe("Vehicle costs");
    expect((await tenancy.listAuditEvents(business.id)).map((event) => event.type)).toContain("account_heading_renamed");
  });

  it.each(["", "   ", "x".repeat(101)])("rejects an invalid display name %#", async (displayName) => {
    const { business, dependencies } = await context();
    await importHeadings(business.id, [heading(1, "Rent")], owner, dependencies);
    const [rent] = await listHeadings(business.id, owner, dependencies);
    await expect(renameHeading(business.id, rent.id, displayName, owner, dependencies)).rejects.toMatchObject({ code: HEADING_ERROR_CODES.INVALID_HEADING });
  });

  it("returns not found for an unknown heading", async () => {
    const { business, dependencies } = await context();
    await expect(renameHeading(business.id, "missing", "Name", owner, dependencies)).rejects.toMatchObject({ code: HEADING_ERROR_CODES.HEADING_NOT_FOUND });
    await expect(setHeadingActive(business.id, "missing", false, owner, dependencies)).rejects.toMatchObject({ code: HEADING_ERROR_CODES.HEADING_NOT_FOUND });
  });

  it.each([
    { label: "an empty list", headings: [] },
    { label: "duplicate positions", headings: [heading(1, "A"), heading(1, "B")] },
    { label: "a zero position", headings: [heading(0, "A")] },
    { label: "a negative position", headings: [heading(-1, "A")] },
  ])("rejects $label without writing anything", async ({ headings }) => {
    const { tenancy, business, dependencies } = await context();
    await expect(importHeadings(business.id, headings, owner, dependencies)).rejects.toMatchObject({ code: HEADING_ERROR_CODES.INVALID_HEADING_IMPORT });
    await expect(listHeadings(business.id, owner, dependencies)).resolves.toEqual([]);
    expect((await tenancy.listAuditEvents(business.id)).some((event) => event.type.startsWith("account_heading_"))).toBe(false);
  });

  it("rolls the headings back when the audit write fails", async () => {
    const { tenancy, business, dependencies } = await context();
    tenancy.appendAuditEvent = async () => { throw new Error("audit failed"); };
    await expect(importHeadings(business.id, [heading(1, "Rent")], owner, dependencies)).rejects.toMatchObject({ code: HEADING_ERROR_CODES.HEADING_REPOSITORY_CONFLICT });
    expect(await dependencies.headings.listByBusinessId(business.id)).toEqual([]);
  });
});
