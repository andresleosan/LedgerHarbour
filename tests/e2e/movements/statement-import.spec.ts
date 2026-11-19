import type { Page } from "@playwright/test";

import { buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";
import { expect, test } from "../fixtures";
import { browserApiRequest } from "../helpers/browser-api";
import { createApprovedBusiness } from "../helpers/business";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// The dev server compiles the import page and the statement routes on first use.
const firstCompile = { timeout: 90_000 };

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
}

// A synthetic statement: invented payees and amounts, day-first dates as UK banks write them.
const statementFile = (lines: string[]) => ({ name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(["Date,Description,Amount", ...lines].join("\r\n"), "utf8") });

test("owner imports a bank statement, skips what is already recorded and codes its lines", async ({ page, browserWithDiagnostics: browser }) => {
  test.setTimeout(600_000);
  const suffix = Date.now().toString();
  const year = new Date().getFullYear();
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, `statement-${suffix}@example.com`);
  const businessId = await createApprovedBusiness(browser, page, `Statement Books ${suffix}`);
  const base = `/api/businesses/${businessId}`;

  // Setup through the API: template, an open year, one bank account and one payment already recorded by hand.
  await page.goto(`/business/${businessId}/movements?locale=en`);
  const template = await browserApiRequest(page, `${base}/template`, { method: "POST", multipart: { file: { name: "accounts.xlsx", mimeType: XLSX_TYPE, buffer: await buildSyntheticTemplate() } } });
  expect(template.status, template.body).toBe(200);
  const openYear = await api<{ id: string }>(page, `${base}/financial-years`, "POST", { startDate: `${year}-01-01`, endDate: `${year}-12-31` });
  const bank = await api<{ id: string }>(page, `${base}/money-accounts`, "POST", { name: "Barclays", kind: "bank", sheetName: "Current Account" });
  const headings = await api<{ id: string; displayName: string }[]>(page, `${base}/headings`, "GET", undefined);
  const premises = headings.find((heading) => heading.displayName === "Premises")!;
  await api(page, `${base}/movements`, "POST", { accountId: bank.id, date: `${year}-03-10`, narrative: "Rent March", headingId: premises.id, amount: "-45.00" });

  await page.reload();
  const link = page.getByRole("link", { name: "Import bank statement" });
  await expect(link).toHaveAttribute("href", `/business/${businessId}/movements/import?locale=en`, firstCompile);
  await page.goto(`/business/${businessId}/movements/import?locale=en`);
  await expect(page.getByRole("heading", { level: 1, name: "Import bank statement" })).toBeVisible();
  const tray = page.getByRole("region", { name: "Waiting for a code" });
  await expect(tray).toContainText("Every statement line has a code.", firstCompile);
  const step1 = page.getByRole("region", { name: "1. Account and file" });
  await expect(step1).toContainText("Download the statement as CSV from your bank's website");
  await expect(step1.getByLabel("Account", { exact: true })).toHaveValue(bank.id);
  await expect(step1.getByRole("button", { name: "Choose CSV file" })).toBeEnabled();

  // The same rent payment two days later, plus four new lines.
  const statement = statementFile([
    `12/03/${year},LANDLORD LTD,-45.00`,
    `13/03/${year},Card takings,120.00`,
    `14/03/${year},Coffee Co,-3.20`,
    `15/03/${year},Bank fee,-7.50`,
    `16/03/${year},"Customer, refund",25.00`,
  ]);
  await page.locator("#statement-file").setInputFiles(statement);
  const preview = page.getByRole("region", { name: "2. Check what we understood" });
  await expect(preview).toContainText("4 new lines to import", firstCompile);
  await expect(preview).toContainText("1 already recorded from invoices or by hand");
  await expect(preview).toContainText("0 already imported before");
  await expect(preview.getByLabel("Date column").locator("option:checked")).toHaveText("Date");
  await expect(preview.getByLabel("Description column").locator("option:checked")).toHaveText("Description");
  await expect(preview.getByLabel("Amount column").locator("option:checked")).toHaveText("Amount");
  const previewRows = preview.getByRole("listitem").filter({ hasText: /Already recorded|New/ });
  await expect(previewRows).toHaveCount(5);
  await expect(previewRows.filter({ hasText: "LANDLORD LTD" })).toContainText("Already recorded");
  await expect(previewRows.filter({ hasText: "Card takings" })).toContainText("+£120.00 in");
  await expect(previewRows.filter({ hasText: "Coffee Co" })).toContainText("-£3.20 out");
  await preview.getByRole("button", { name: "Import 4 lines" }).click();
  await expect(step1.getByRole("status")).toContainText("4 lines imported.");
  await expect(preview).toHaveCount(0);

  // The tray: four lines waiting; code one.
  const trayRows = tray.getByRole("listitem");
  await expect(trayRows).toHaveCount(4);
  await expect(trayRows.filter({ hasText: "Customer, refund" })).toContainText("+£25.00 in");
  const coffee = trayRows.filter({ hasText: "Coffee Co" });
  expect(await coffee.getByLabel("Code", { exact: true }).locator("optgroup").evaluateAll((groups) => groups.length)).toBeGreaterThan(1);
  await coffee.getByLabel("Code", { exact: true }).selectOption({ label: "Premises" });
  await coffee.getByRole("button", { name: /^Save/ }).click();
  await expect(tray.getByRole("status")).toContainText("Code saved.", firstCompile);
  await expect(trayRows).toHaveCount(3);
  await expect(trayRows.filter({ hasText: "Coffee Co" })).toHaveCount(0);

  // The same file again imports nothing.
  await page.locator("#statement-file").setInputFiles(statement);
  await expect(preview).toContainText("0 new lines to import");
  await expect(preview).toContainText("4 already imported before");
  await expect(preview).toContainText("1 already recorded from invoices or by hand");
  await expect(preview.getByRole("button", { name: "Import 0 lines" })).toBeDisabled();
  await expect(preview).toContainText("There are no new lines to import.");

  // A file with a bad amount shows the line and imports nothing.
  await page.locator("#statement-file").setInputFiles(statementFile([`17/03/${year},Fine line,1.00`, `18/03/${year},Broken line,12.345`]));
  await expect(preview.getByRole("alert")).toContainText("Line 3: the amount cannot be read.");
  await expect(preview.getByRole("alert")).toContainText("Nothing has been imported. Fix the file or the columns and try again.");
  await expect(preview.getByRole("button", { name: "Import 1 line" })).toBeDisabled();
  const waiting = await api<unknown[]>(page, `${base}/statement-imports/tray?yearId=${openYear.id}`, "GET", undefined);
  expect(waiting).toHaveLength(3);
  const movements = await api<{ origin: string }[]>(page, `${base}/movements?yearId=${openYear.id}`, "GET", undefined);
  expect(movements.filter((movement) => movement.origin === "statement")).toHaveLength(4);
  await expectNoHorizontalOverflow(page);

  await page.goto(`/business/${businessId}/movements/import?locale=es`);
  await expect(page.getByRole("heading", { level: 1, name: "Importar extracto bancario" })).toBeVisible();
  const bandeja = page.getByRole("region", { name: "Esperando un código" });
  await expect(bandeja.getByRole("listitem")).toHaveCount(3, firstCompile);
  await expect(bandeja.getByRole("listitem").filter({ hasText: "Bank fee" })).toContainText("sale");
  await expect(page.getByRole("region", { name: "1. Cuenta y archivo" }).getByRole("button", { name: "Elegir archivo CSV" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
