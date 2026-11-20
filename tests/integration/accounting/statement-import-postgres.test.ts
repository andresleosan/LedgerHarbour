import { describe, expect, it } from "vitest";

import { createTestDatabase } from "../../../src/db/test-database";
import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import { importHeadings, listHeadings, type TemplateHeadingInput } from "../../../src/modules/accounting/heading-service";
import { createFinancialYear, createMoneyAccount, createMovement, listMovements } from "../../../src/modules/accounting/money-service";
import { createPostgresHeadingRepository } from "../../../src/modules/accounting/postgres-heading-repository";
import { createPostgresMoneyRepository } from "../../../src/modules/accounting/postgres-money-repository";
import { createPostgresTemplateRepository } from "../../../src/modules/accounting/postgres-template-repository";
import { STATEMENT_IMPORT_ERROR_CODES, codeStatementMovement, importStatement, listUncodedStatementMovements, previewStatement } from "../../../src/modules/accounting/statement-import-service";
import type { AccountSheet } from "../../../src/modules/workbook/template-profile";
import { createPostgresOnboardingRepository } from "../../../src/modules/tenancy/postgres-tenancy-repository";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

// Synthetic statement: invented lines only.
const owner: AuthIdentity = { providerUserId: "statement-pg-owner", email: "statement-pg-owner@example.com", displayName: "Statement owner", emailVerified: true };
const headingInputs: TemplateHeadingInput[] = [{ position: 1, templateValue: "Sales", valueType: "text", group: "income", order: 1, blockedReason: null }];

describe("statement import on PostgreSQL", () => {
  it("imports uncoded statement rows once, matches a manual payment and codes a line", async () => {
    const database = await createTestDatabase();
    try {
      const tenancy = createPostgresOnboardingRepository(database.db);
      const headings = createPostgresHeadingRepository(database.db);
      const templates = createPostgresTemplateRepository(database.db);
      const dependencies = { tenancyRepository: tenancy, headings, templates, money: createPostgresMoneyRepository(database.db) };
      const business = await createApprovedBusiness(tenancy, "Statement PG Books", owner);
      const ownerId = await tenancy.upsertUser(owner);
      await importHeadings(business.id, headingInputs, owner, { tenancyRepository: tenancy, headings });
      const [sales] = await listHeadings(business.id, owner, { tenancyRepository: tenancy, headings });
      await templates.upsert({
        id: "template-statement", businessId: business.id, privateObjectKey: `business/${business.id}/template/one`, originalFileName: "Accounts.xlsx", sizeBytes: 1,
        checksum: "a".repeat(64), profile: { sheets: [{ name: "Main Bank" } as AccountSheet], defects: [] }, uploadedBy: ownerId,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      });
      const year = await createFinancialYear(business.id, { startDate: "2026-04-06", endDate: "2027-04-05" }, owner, dependencies);
      const bank = await createMoneyAccount(business.id, { name: "Main bank", kind: "bank", sheetName: "Main Bank" }, owner, dependencies);
      await createMovement(business.id, { accountId: bank.id, date: "2026-05-01", narrative: "Rent paid", headingId: sales.id, amount: "-500.00" }, owner, dependencies);

      const csv = "Date;Description;Paid in;Paid out\n03/05/2026;Landlord;;500.00\n04/05/2026;Shop;12.34;\n04/05/2026;Shop;12.34;";
      expect((await importStatement(business.id, { accountId: bank.id, csv }, owner, dependencies)).counts).toMatchObject({ toImport: 2, alreadyRecorded: 1 });
      expect((await previewStatement(business.id, { accountId: bank.id, csv }, owner, dependencies)).counts).toMatchObject({ toImport: 0, alreadyImported: 2, alreadyRecorded: 1 });
      await expect(importStatement(business.id, { accountId: bank.id, csv: `${csv}\n31/02/2026;Bad;1;` }, owner, dependencies)).rejects.toMatchObject({ code: STATEMENT_IMPORT_ERROR_CODES.STATEMENT_HAS_ERRORS });

      const tray = await listUncodedStatementMovements(business.id, year.id, owner, dependencies);
      expect(tray.map((row) => [row.narrative, row.amount, row.headingId, row.origin])).toEqual([["Shop", "12.34", null, "statement"], ["Shop", "12.34", null, "statement"]]);
      await codeStatementMovement(business.id, tray[0].id, sales.id, owner, dependencies);
      expect(await listUncodedStatementMovements(business.id, year.id, owner, dependencies)).toHaveLength(1);
      expect((await listMovements(business.id, { yearId: year.id }, owner, dependencies)).map((row) => row.amount)).toEqual(["-500.00", "12.34", "12.34"]);
    } finally {
      await database.close();
    }
  }, 60_000);
});
