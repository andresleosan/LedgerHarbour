import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";
import { expect, test } from "../fixtures";
import { browserApiRequest } from "../helpers/browser-api";
import { createApprovedBusiness } from "../helpers/business";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// The dev server compiles the pages and routes on first use.
const firstCompile = { timeout: 180_000 };

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

async function api<T>(page: Page, url: string, method: string, data: unknown): Promise<T> {
  const response = await browserApiRequest(page, url, { method, data });
  expect(response.status, response.body).toBeLessThan(300);
  return JSON.parse(response.body) as T;
}

async function expectNoHorizontalOverflow(page: Page) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(fits, `no horizontal overflow at ${viewport.width}px`).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

/** An approved invoice coded to Premises and marked as not paid yet, through the review screen. */
async function addUnpaidInvoice(page: Page, businessId: string) {
  await page.goto(`/business/${businessId}/upload?locale=en`);
  await page.locator('input[type="file"][multiple]').setInputFiles({
    name: "year-unpaid.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\n% year-unpaid.pdf\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF\n"),
  });
  await expect(page.getByRole("listitem").filter({ hasText: "year-unpaid.pdf" }).getByRole("status")).toContainText("Ready for review", firstCompile);
  await page.goto(`/business/${businessId}/invoices?status=needs_review&locale=en`);
  await page.getByRole("link", { name: "Open review" }).click();
  await expect(page.getByRole("heading", { name: "Extracted fields" })).toBeVisible(firstCompile);
  await page.getByLabel("Code", { exact: true }).selectOption({ label: "Premises" });
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByRole("status")).toContainText("Correction saved.");
  await page.getByRole("button", { name: "Approve invoice" }).click();
  await page.getByLabel("Not paid yet").check();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Invoice approved.");
}

test("uncoded statement lines block the workbook until they are coded in the tray; the closing notes download", async ({ page, browserWithDiagnostics: browser }) => {
  test.setTimeout(900_000);
  const suffix = Date.now().toString();
  const year = new Date().getFullYear();
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, `year-chain-${suffix}@example.com`);
  const businessId = await createApprovedBusiness(browser, page, `Year Chain ${suffix}`);
  const base = `/api/businesses/${businessId}`;

  // Set-up through the API: template, open year, one bank account and one movement typed by hand.
  await page.goto(`/business/${businessId}/invoices?locale=en`);
  const template = await browserApiRequest(page, `${base}/template`, { method: "POST", multipart: { file: { name: "accounts.xlsx", mimeType: XLSX_TYPE, buffer: await buildSyntheticTemplate() } } });
  expect(template.status, template.body).toBe(200);
  await api(page, `${base}/financial-years`, "POST", { startDate: `${year}-01-01`, endDate: `${year}-12-31` });
  const bank = await api<{ id: string }>(page, `${base}/money-accounts`, "POST", { name: "Barclays", kind: "bank", sheetName: "Current Account" });
  const headings = await api<{ id: string; displayName: string }[]>(page, `${base}/headings`, "GET", undefined);
  const sales = headings.find((heading) => heading.displayName === "Sales")!;
  await api(page, `${base}/movements`, "POST", { accountId: bank.id, date: `${year}-01-15`, narrative: "Card takings", headingId: sales.id, amount: "120.00" });
  await addUnpaidInvoice(page, businessId);

  // A synthetic statement (invented payees and amounts) imported through the API: three lines with no code.
  const csv = ["Date,Description,Amount", `14/03/${year},Coffee Co,-3.20`, `15/03/${year},Bank fee,-7.50`, `16/03/${year},Customer payment,25.00`].join("\r\n");
  await api(page, `${base}/statement-imports`, "POST", { accountId: bank.id, csv });

  await page.goto(`/business/${businessId}/year?locale=en`);
  const workbook = page.getByRole("region", { name: "Your workbook" });
  await expect(workbook.getByRole("heading", { name: "The workbook cannot be downloaded yet" })).toBeVisible(firstCompile);
  await expect(workbook).toContainText("3 movements have no code yet.");
  await expect(workbook.getByRole("link", { name: "Download workbook" })).toHaveCount(0);
  const totals = page.getByRole("region", { name: "Totals by code" });
  await expect(totals.getByRole("link", { name: "Waiting for a code: 3 movements" })).toHaveAttribute("href", `/business/${businessId}/movements/import?locale=en`);
  const unpaid = totals.getByRole("link", { name: "Invoices not paid yet: 1" });
  await expect(unpaid).toHaveAttribute("href", `/business/${businessId}/invoices?locale=en&status=unpaid`);
  await expect(totals).toContainText("Paid with your own money: 0");
  await expectNoHorizontalOverflow(page);

  // The blocker's link opens the tray with exactly those lines; code them all there.
  const fix = workbook.getByRole("link", { name: "Give them a code" });
  await expect(fix).toHaveAttribute("href", `/business/${businessId}/movements/import?locale=en`);
  await fix.click();
  await expect(page).toHaveURL(`/business/${businessId}/movements/import?locale=en`, firstCompile);
  const tray = page.getByRole("region", { name: "Waiting for a code" });
  const trayRows = tray.getByRole("listitem");
  await expect(trayRows).toHaveCount(3, firstCompile);
  for (const [narrative, code, left] of [["Coffee Co", "Premises", 2], ["Bank fee", "Premises", 1], ["Customer payment", "Sales", 0]] as const) {
    const row = trayRows.filter({ hasText: narrative });
    await row.getByLabel("Code", { exact: true }).selectOption({ label: code });
    await row.getByRole("button", { name: /^Save/ }).click();
    await expect(trayRows).toHaveCount(left, firstCompile);
  }
  await expect(tray).toContainText("Every statement line has a code.");

  // Back on the year: the workbook downloads again and nothing waits for a code.
  await page.goto(`/business/${businessId}/year?locale=en`);
  await expect(workbook).toContainText("Your accountant's workbook with this year's 4 movements filled in.", firstCompile);
  await expect(workbook.getByRole("heading", { name: "The workbook cannot be downloaded yet" })).toHaveCount(0);
  await expect(totals).toContainText("Waiting for a code: 0 movements");
  await expect(totals.getByRole("link", { name: /Waiting for a code/ })).toHaveCount(0);
  expect(await totals.getByRole("article", { name: "Expenses", exact: true }).locator("dd").allTextContents()).toEqual(["-£10.70", "-£10.70"]);
  expect(await totals.getByRole("article", { name: "Income", exact: true }).locator("dd").allTextContents()).toEqual(["£145.00", "£145.00"]);

  const [annex] = await Promise.all([page.waitForEvent("download"), workbook.getByRole("link", { name: "Download closing notes for your accountant" }).click()]);
  expect(annex.suggestedFilename()).toMatch(/\.csv$/);
  const bytes = readFileSync(await annex.path());
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = bytes.toString("utf8");
  for (const label of ["Unpaid at year end", "Paid with private money", "Fixed asset purchases", "Fixed asset receipts"]) expect(text).toContain(label);

  const [workbookFile] = await Promise.all([page.waitForEvent("download"), workbook.getByRole("link", { name: "Download workbook" }).click()]);
  expect(workbookFile.suggestedFilename()).toMatch(/\.xlsx$/);
  await expectNoHorizontalOverflow(page);

  await unpaid.click();
  await expect(page).toHaveURL(/\/invoices\?locale=en&status=unpaid$/, firstCompile);
  await expect(page.locator(".invoice-row")).toHaveCount(1);
  await expect(page.locator(".invoice-row .status-badge")).toHaveText("Not paid");

  // An earlier year does not owe an invoice dated after its end: the counts follow the closing notes.
  const current = (await api<{ id: string; status: string }[]>(page, `${base}/financial-years`, "GET", undefined)).find((item) => item.status === "open")!;
  await api(page, `${base}/financial-years/${current.id}`, "PATCH", { status: "closed" });
  const earlier = await api<{ id: string }>(page, `${base}/financial-years`, "POST", { startDate: "2020-01-01", endDate: "2020-12-31" });
  await page.goto(`/business/${businessId}/year?locale=en`);
  await expect(page.getByLabel("Financial year")).toHaveValue(earlier.id, firstCompile);
  await expect(totals.getByRole("link", { name: "Invoices not paid yet: 0" })).toBeVisible();
  await expect(totals).toContainText("Paid with your own money: 0");
  await page.getByLabel("Financial year").selectOption(current.id);
  await expect(totals.getByRole("link", { name: "Invoices not paid yet: 1" })).toBeVisible();
});
