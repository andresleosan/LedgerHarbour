import { statSync } from "node:fs";

import type { Page } from "@playwright/test";

import { SYNTHETIC_LAYOUT, buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";
import { expect, test } from "../fixtures";
import { browserApiRequest } from "../helpers/browser-api";
import { createApprovedBusiness } from "../helpers/business";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// The dev server compiles the year page and the finance routes on first use.
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

async function uploadTemplate(page: Page, base: string, template: Buffer) {
  const response = await browserApiRequest(page, `${base}/template`, { method: "POST", multipart: { file: { name: "accounts.xlsx", mimeType: XLSX_TYPE, buffer: template } } });
  expect(response.status, response.body).toBe(200);
}

async function expectNoHorizontalOverflow(page: Page) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(fits, `no horizontal overflow at ${viewport.width}px`).toBe(true);
  }
}

/** The label and figure of every row of one card, as shown. */
function rows(page: Page, region: string, card: string) {
  const article = page.getByRole("region", { name: region, exact: true }).getByRole("article", { name: card, exact: true });
  return async () => (await article.locator("dl > div").evaluateAll((items) => items.map((item) => `${item.querySelector("dt")?.textContent}: ${item.querySelector("dd")?.textContent}`)))
    .map((text) => text.replace(/\s+/g, " "));
}

test("owner sees the year's figures to the penny and downloads the filled workbook, or learns what blocks it", async ({ page, browserWithDiagnostics: browser }) => {
  test.setTimeout(600_000);
  const suffix = Date.now().toString();
  const year = new Date().getFullYear();
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, `year-${suffix}@example.com`);
  const businessId = await createApprovedBusiness(browser, page, `Year Books ${suffix}`);
  const base = `/api/businesses/${businessId}`;

  await page.goto(`/business/${businessId}/invoices?locale=en`);
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Year", exact: true }).click();
  await expect(page).toHaveURL(`/business/${businessId}/year?locale=en`, firstCompile);
  await expect(page.getByRole("heading", { level: 1, name: "Your year" })).toBeVisible();
  await expect(page.getByText("There is no financial year yet.")).toBeVisible(firstCompile);
  await expect(page.getByRole("link", { name: "Money accounts and year" })).toHaveAttribute("href", `/business/${businessId}/settings/accounts?locale=en`);
  await expect(page.getByRole("link", { name: "Download workbook" })).toHaveCount(0);

  // Set-up through the API: template, open year, a bank and a cash account, a handful of movements.
  await uploadTemplate(page, base, await buildSyntheticTemplate());
  const openYear = await api<{ id: string }>(page, `${base}/financial-years`, "POST", { startDate: `${year}-01-01`, endDate: `${year}-12-31` });
  const bank = await api<{ id: string }>(page, `${base}/money-accounts`, "POST", { name: "Barclays", kind: "bank", sheetName: "Current Account" });
  const cash = await api<{ id: string }>(page, `${base}/money-accounts`, "POST", { name: "Petty cash", kind: "cash", sheetName: "Cash Float" });
  await api(page, `${base}/money-accounts/${bank.id}`, "PATCH", { openingBalance: { yearId: openYear.id, amount: "1000.00" } });
  const headings = await api<{ id: string; displayName: string; position: number }[]>(page, `${base}/headings`, "GET", undefined);
  const heading = (name: string) => headings.find((item) => item.displayName.trim() === name)!;
  const date = `${year}-01-15`;
  const move = (accountId: string, name: string, amount: string, narrative: string) => api(page, `${base}/movements`, "POST", { accountId, date, narrative, headingId: heading(name).id, amount });
  await move(bank.id, "Sales", "120.00", "Card takings");
  await move(bank.id, "Premises", "-7.50", "Monthly fee");
  await move(bank.id, "Stock bought", "-30.25", "Stock");
  await move(bank.id, "Stock bought", "5.10", "Stock refund");
  await move(cash.id, "Owner drawings", "-45.00", "Cash for me");
  await api(page, `${base}/transfers`, "POST", { fromAccountId: bank.id, toAccountId: cash.id, date, amount: "200.00", headingId: heading("Loans").id });

  await page.reload();
  const workbook = page.getByRole("region", { name: "Your workbook" });
  await expect(workbook).toContainText("Your accountant's workbook with this year's 7 movements filled in.", firstCompile);
  await expect(workbook).toContainText("Current Account: 5 of 30 rows used");
  await expect(workbook).toContainText("Cash Float: 2 of 20 rows used");
  await expect(workbook.getByRole("link", { name: "Download closing notes for your accountant" })).toHaveAttribute("href", `${base}/financial-years/${openYear.id}/annex`);
  await expect(page.getByLabel("Financial year")).toHaveValue(openYear.id);

  expect(await rows(page, "Accounts", "Barclays")()).toEqual(["Opening balance: £1,000.00", "Money in: £125.10", "Money out: £237.75", "Closing balance: £887.35"]);
  expect(await rows(page, "Accounts", "Petty cash")()).toEqual(["Opening balance: £0.00", "Money in: £200.00", "Money out: £45.00", "Closing balance: £155.00"]);
  const totals = page.getByRole("region", { name: "Totals by code" });
  expect(await rows(page, "Totals by code", "Income")()).toEqual(["Sales: £120.00", "Subtotal: £120.00"]);
  expect(await rows(page, "Totals by code", "Cost of sales")()).toEqual(["Stock bought: -£25.15", "Subtotal: -£25.15"]);
  expect(await rows(page, "Totals by code", "Expenses")()).toEqual(["Premises: -£7.50", "Subtotal: -£7.50"]);
  expect(await rows(page, "Totals by code", "Equity")()).toEqual(["Owner drawings: -£45.00", "Subtotal: -£45.00"]);
  // The transfer nets to zero on its code, and zero rows are hidden.
  await expect(totals.getByRole("article", { name: "Liabilities", exact: true })).toHaveCount(0);
  await expect(totals).toContainText("Waiting for a code: 0 movements");
  await expect(totals.getByRole("link", { name: "Invoices not paid yet: 0" })).toHaveAttribute("href", `/business/${businessId}/invoices?locale=en&status=unpaid`);
  await expect(totals).toContainText("Paid with your own money: 0");

  const advice = page.getByRole("region", { name: "Tell your accountant" });
  await expect(advice).toContainText("LedgerHarbour already works around the small quirks of the template.");
  await expect(advice).toContainText("Cash Float is not added into the accounts");
  await expect(advice).toContainText("1 transfer touches a sheet");
  await expect(advice).toContainText("opening balances");

  const [download] = await Promise.all([page.waitForEvent("download"), workbook.getByRole("link", { name: "Download workbook" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  expect(statSync(await download.path()).size).toBeGreaterThan(0);

  // A real blocked state the public API allows: the accountant sends a template whose Sales total
  // is no longer read and whose cash sheet has room for two rows, and a third cash row is added.
  await move(cash.id, "Premises", "-2.00", "Cash spend");
  // A heading's position is its template column; the fixture counts headings from 1.
  const ordinal = (name: string) => heading(name).position - SYNTHETIC_LAYOUT.firstAnalysisColumn + 1;
  await uploadTemplate(page, base, await buildSyntheticTemplate({ notReadPosition: ordinal("Sales"), truncate: [{ sheet: "cash", position: ordinal("Premises"), lastFormulaRow: 8 }] }));
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(workbook.getByRole("heading", { name: "The workbook cannot be downloaded yet" })).toBeVisible();
  await expect(workbook).toContainText("1 movement uses a code the template no longer accepts.");
  await expect(workbook).toContainText("The sheet Cash Float has room for 2 rows and this year has 3, so your accountant must extend the template.");
  await expect(workbook.getByRole("link", { name: "Movements" })).toHaveAttribute("href", `/business/${businessId}/movements?locale=en`);
  await expect(workbook.getByRole("link", { name: "Download workbook" })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Figures loaded");
  expect(await rows(page, "Accounts", "Petty cash")()).toEqual(["Opening balance: £0.00", "Money in: £200.00", "Money out: £47.00", "Closing balance: £153.00"]);
  await expect(advice).toContainText("The app will not let you use Sales");
  await expectNoHorizontalOverflow(page);

  await page.goto(`/business/${businessId}/year?locale=es`);
  await expect(page.getByRole("heading", { level: 1, name: "Tu ejercicio" })).toBeVisible();
  const libro = page.getByRole("region", { name: "Tu libro de cuentas" });
  await expect(libro.getByRole("heading", { name: "Todavía no se puede descargar el libro" })).toBeVisible(firstCompile);
  await expect(libro).toContainText("1 movimiento usa un código que la plantilla ya no acepta.");
  await expect(libro).toContainText("La hoja Cash Float tiene sitio para 2 filas y este ejercicio tiene 3, así que tu contable debe ampliar la plantilla.");
  expect(await rows(page, "Cuentas", "Barclays")()).toEqual(["Saldo inicial: 1000,00 £", "Entradas: 125,10 £", "Salidas: 237,75 £", "Saldo final: 887,35 £"]);
  await expect(page.getByRole("navigation", { name: "Espacio de trabajo" }).getByRole("link", { name: "Ejercicio", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
