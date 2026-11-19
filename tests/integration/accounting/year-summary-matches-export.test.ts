import { describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import { getCurrentIdentity } from "../../../src/modules/auth/session";

const { objects } = vi.hoisted(() => ({ objects: new Map<string, Uint8Array>() }));

vi.mock("../../../src/modules/auth/session", () => ({ getCurrentIdentity: vi.fn() }));
vi.mock(import("../../../src/modules/persistence/repository-factory"), async (importOriginal) => {
  const actual = await importOriginal();
  const storage = {
    async put({ objectKey, data }: { objectKey: string; data: Uint8Array }) { objects.set(objectKey, data); return { objectKey, sizeBytes: data.byteLength }; },
    async get(objectKey: string): Promise<ReadableStream<Uint8Array>> {
      const data = objects.get(objectKey)!;
      return new ReadableStream({ start(controller) { controller.enqueue(data); controller.close(); } });
    },
    async delete(objectKey: string) { objects.delete(objectKey); },
  };
  return { ...actual, getPersistenceContext: () => ({ ...actual.getPersistenceContext(), storage }) };
});

import { GET as exportRoute } from "../../../src/app/api/businesses/[businessId]/financial-years/[yearId]/export/route";
import { GET as reportRoute } from "../../../src/app/api/businesses/[businessId]/financial-years/[yearId]/export/report/route";
import { GET as summaryRoute } from "../../../src/app/api/businesses/[businessId]/financial-years/[yearId]/summary/route";
import { listHeadings, resolveDefaultHeadingRepository } from "../../../src/modules/accounting/heading-service";
import { formatPence, parsePounds, sumPence } from "../../../src/modules/accounting/money";
import { resolveDefaultMoneyRepository } from "../../../src/modules/accounting/money-repository";
import { createFinancialYear, createMoneyAccount, createMovement, createTransfer, setOpeningBalance } from "../../../src/modules/accounting/money-service";
import { importTemplate, resolveDefaultTemplateRepository } from "../../../src/modules/accounting/template-service";
import { getPersistenceContext, resetPersistenceContextForTests } from "../../../src/modules/persistence/repository-factory";
import { defaultOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import { readTemplate } from "../../../src/modules/workbook/read-template";
import { readWrittenRows } from "../../../src/modules/workbook/write-workbook";
import { SYNTHETIC_SHEETS, buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const owner: AuthIdentity = { provider: "firebase", providerUserId: "lh025-match", email: "lh025-match@example.com", displayName: "Owner", emailVerified: true };
const params = <T extends object>(value: T) => ({ params: Promise.resolve(value) });
const get = () => new Request("http://localhost/api");

type Totals = { byHeading: Array<{ headingId: string; pence: number }>; byAccount: Array<{ accountId: string; openingPence: number; movementsPence: number; closingPence: number }> };
// Every total as a decimal string, so a stray float or rounding shows up as a different string.
const asStrings = (totals: Totals) => ({
  byHeading: totals.byHeading.map((row) => [row.headingId, formatPence(row.pence)]),
  byAccount: totals.byAccount.map((row) => [row.accountId, formatPence(row.openingPence), formatPence(row.movementsPence), formatPence(row.closingPence)]),
});

describe("year summary against the export", () => {
  it("gives the same totals per code and per account as the export report and the downloaded workbook, to the penny", async () => {
    delete process.env.PERSISTENCE_MODE;
    await resetPersistenceContextForTests();
    vi.mocked(getCurrentIdentity).mockResolvedValue(owner);
    const dependencies = { tenancyRepository: defaultOnboardingRepository, headings: resolveDefaultHeadingRepository(), templates: resolveDefaultTemplateRepository(), money: resolveDefaultMoneyRepository(), storage: getPersistenceContext().storage };
    const template = await buildSyntheticTemplate();
    const business = await createApprovedBusiness(defaultOnboardingRepository, `Summary Match ${Date.now()}`, owner);
    await importTemplate(business.id, { name: "Accounts.xlsx", mimeType: XLSX, data: new Uint8Array(template) }, owner, dependencies);
    const headings = await listHeadings(business.id, owner, dependencies);
    const code = (name: string) => headings.find((heading) => heading.displayName.trim() === name)!.id;
    const year = await createFinancialYear(business.id, { startDate: "2026-04-06", endDate: "2027-04-05" }, owner, dependencies);
    const bank = await createMoneyAccount(business.id, { name: "Bank", kind: "bank", sheetName: SYNTHETIC_SHEETS.main }, owner, dependencies);
    const deposit = await createMoneyAccount(business.id, { name: "Deposit", kind: "bank", sheetName: SYNTHETIC_SHEETS.deposit }, owner, dependencies);
    const cash = await createMoneyAccount(business.id, { name: "Cash", kind: "cash", sheetName: SYNTHETIC_SHEETS.cash }, owner, dependencies);
    await setOpeningBalance(business.id, bank.id, year.id, "2500.33", owner, dependencies);
    await setOpeningBalance(business.id, deposit.id, year.id, "-80.50", owner, dependencies);
    const add = (accountId: string, day: number, narrative: string, heading: string, amount: string) =>
      createMovement(business.id, { accountId, date: `2026-${String(5 + Math.floor(day / 28)).padStart(2, "0")}-${String(1 + (day % 28)).padStart(2, "0")}`, narrative, headingId: code(heading), amount }, owner, dependencies);

    let movements = 0;
    for (let i = 0; i < 10; i++) { await add(bank.id, i, `Takings ${i}`, "Sales", `${(i * 37.13 + 0.07).toFixed(2)}`); movements++; }
    for (let i = 0; i < 4; i++) {
      // One supplier invoice split over two codes: two rows with the same narrative.
      await add(bank.id, 10 + i, `Invoice ${i}`, "Stock bought", `-${(12.34 * (i + 1)).toFixed(2)}`);
      await add(bank.id, 10 + i, `Invoice ${i}`, "Freight in", `-${(0.99 + i).toFixed(2)}`);
      movements += 2;
    }
    await add(bank.id, 20, "Supplier refund", "Stock bought", "4.56"); movements++;
    await add(bank.id, 21, "Phone bill", "Phone", "-33.33"); movements++;
    for (let i = 0; i < 6; i++) { await add(deposit.id, i, `Interest ${i}`, "Sundry income", `0.0${i + 1}`); movements++; }
    for (let i = 0; i < 6; i++) { await add(cash.id, i, `Cash spend ${i}`, i % 2 ? "Premises" : "Owner drawings", `-${(1.1 * (i + 1)).toFixed(2)}`); movements++; }
    await createTransfer(business.id, { fromAccountId: bank.id, toAccountId: deposit.id, date: "2026-06-10", amount: "300.00", headingId: code("Loans") }, owner, dependencies);
    await createTransfer(business.id, { fromAccountId: bank.id, toAccountId: cash.id, date: "2026-06-11", amount: "50.05", headingId: code("Loans") }, owner, dependencies);
    movements += 4;
    expect(movements).toBeGreaterThanOrEqual(36);

    const ids = { businessId: business.id, yearId: year.id };
    const summaryResponse = await summaryRoute(get(), params(ids));
    expect(summaryResponse.status).toBe(200);
    const summary = await summaryResponse.json() as Totals & { uncodedCount: number };
    const report = await (await reportRoute(get(), params(ids))).json() as { blocked: boolean; totals: Totals };
    expect(report.blocked).toBe(false);
    expect(summary.uncodedCount).toBe(0);
    expect(asStrings(summary)).toEqual(asStrings(report.totals));

    const download = await exportRoute(get(), params(ids));
    expect(download.status).toBe(200);
    const sheets = readWrittenRows(Buffer.from(await download.arrayBuffer()), await readTemplate(template));
    const accountOf: Record<string, string> = { [SYNTHETIC_SHEETS.main]: bank.id, [SYNTHETIC_SHEETS.deposit]: deposit.id, [SYNTHETIC_SHEETS.cash]: cash.id };
    const valueOf = new Map(headings.map((heading) => [heading.templateValue, heading.id]));
    const perCode = new Map<string, number[]>();
    const perAccount: Totals["byAccount"] = [];
    for (const sheet of sheets) {
      const amounts = sheet.rows.map((row) => parsePounds(row.amount!));
      sheet.rows.forEach((row, i) => {
        const headingId = valueOf.get(row.code!.value)!;
        perCode.set(headingId, [...(perCode.get(headingId) ?? []), amounts[i]]);
      });
      const opening = parsePounds(sheet.openingBalance ?? "0.00");
      perAccount.push({ accountId: accountOf[sheet.sheetName], openingPence: opening, movementsPence: sumPence(amounts), closingPence: sumPence([opening, ...amounts]) });
    }
    const fromWorkbook: Totals = {
      byHeading: [...perCode].map(([headingId, amounts]) => ({ headingId, pence: sumPence(amounts) })),
      byAccount: perAccount,
    };
    const sorted = (totals: Totals) => {
      const strings = asStrings(totals);
      return { byHeading: [...strings.byHeading].sort(), byAccount: [...strings.byAccount].sort() };
    };
    expect(sorted(fromWorkbook)).toEqual(sorted(summary));
    expect(sheets.reduce((n, sheet) => n + sheet.rows.length, 0)).toBe(movements);
  });
});
