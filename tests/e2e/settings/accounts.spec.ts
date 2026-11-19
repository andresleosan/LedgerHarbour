import type { Page } from "@playwright/test";

import { buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";
import { expect, test } from "../fixtures";
import { browserApiRequest } from "../helpers/browser-api";
import { createApprovedBusiness } from "../helpers/business";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// The dev server compiles the settings page and the money routes on first use.
const firstCompile = { timeout: 90_000 };

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

// Chromium logs a real 4xx as a console error; the real status is asserted through the API first.
async function stubNextAccountCreate(page: Page, status: number, code: string) {
  await page.evaluate(({ status, code }) => {
    const originalFetch = window.fetch.bind(window);
    let remaining = 1;
    window.fetch = async (input, init) => {
      const requestUrl = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (remaining > 0 && init?.method === "POST" && requestUrl.endsWith("/money-accounts")) {
        remaining -= 1;
        return new Response(JSON.stringify({ error: { code } }), { status, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(input, init);
    };
  }, { status, code });
}

async function expectNoHorizontalOverflow(page: Page) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(fits, `no horizontal overflow at ${viewport.width}px`).toBe(true);
  }
}

test("owner sets up the financial year and the money accounts that fill the accountant's workbook", async ({ page, browserWithDiagnostics: browser }) => {
  test.setTimeout(480_000);
  const suffix = Date.now().toString();
  const year = new Date().getFullYear();
  await signIn(page, `accounts-${suffix}@example.com`);
  const businessId = await createApprovedBusiness(browser, page, `Accounts Books ${suffix}`);

  await page.goto(`/business/${businessId}/invoices?locale=en`);
  await page.getByRole("link", { name: "Money accounts and year" }).click();
  await expect(page).toHaveURL(`/business/${businessId}/settings/accounts?locale=en`, firstCompile);
  await expect(page.getByRole("heading", { level: 1, name: "Money accounts and year" })).toBeVisible();

  const yearSection = page.getByRole("region", { name: "Financial year", exact: true });
  const accountsSection = page.getByRole("region", { name: "Money accounts", exact: true });
  await expect(yearSection).toContainText("No financial year yet.", firstCompile);
  await expect(yearSection.getByLabel("Start date")).toHaveValue(`${year}-01-01`);
  await expect(yearSection.getByLabel("End date")).toHaveValue(`${year}-12-31`);
  await expect(accountsSection).toContainText("Upload your accountant's template first");
  await expect(accountsSection.getByRole("link", { name: "Accounts template" })).toHaveAttribute("href", `/business/${businessId}/settings/workbook?locale=en`);
  await expect(accountsSection.getByLabel("Account name")).toHaveCount(0);

  const upload = await browserApiRequest(page, `/api/businesses/${businessId}/template`, {
    method: "POST",
    multipart: { file: { name: "accounts.xlsx", mimeType: XLSX_TYPE, buffer: await buildSyntheticTemplate() } },
  });
  expect(upload.status).toBe(200);
  await page.reload();

  await yearSection.getByRole("button", { name: "Create year" }).click();
  await expect(yearSection.getByRole("status")).toContainText("Year created.", firstCompile);
  const currentYear = yearSection.getByRole("article", { name: `Jan 1, ${year} – Dec 31, ${year}` });
  await expect(currentYear).toContainText("Open");
  await expect(yearSection).toContainText("Only one year can be open at a time");

  await currentYear.getByRole("button", { name: "Change dates" }).click();
  await yearSection.getByLabel("Start date").fill(`${year}-04-06`);
  await yearSection.getByLabel("End date").fill(`${year + 1}-04-05`);
  await yearSection.getByRole("button", { name: "Save dates" }).click();
  await expect(yearSection.getByRole("status")).toContainText("Dates saved.");
  const taxYear = yearSection.getByRole("article", { name: `Apr 6, ${year} – Apr 5, ${year + 1}` });
  await expect(taxYear).toContainText("Open");

  const sheet = accountsSection.getByLabel("Template sheet");
  await expect(accountsSection).toContainText("Each account fills one sheet of your accountant's workbook");
  await expect(sheet.locator("option")).toHaveText(["Current Account", "Deposit Account", "Cash Float"]);
  await accountsSection.getByLabel("Account name").fill("Barclays Current");
  await expect(accountsSection.getByRole("radio", { name: "Bank" })).toBeChecked();
  await sheet.selectOption("Current Account");
  await accountsSection.getByRole("button", { name: "Add account" }).click();
  await expect(accountsSection.getByRole("status")).toContainText("Account added.", firstCompile);

  await accountsSection.getByLabel("Account name").fill("Petty cash");
  await accountsSection.getByRole("radio", { name: "Cash" }).check();
  await sheet.selectOption("Cash Float");
  await accountsSection.getByRole("button", { name: "Add account" }).click();
  await expect(accountsSection.getByRole("article", { name: "Petty cash" })).toBeVisible();
  await expect(sheet.locator("option")).toHaveText(["Deposit Account"]);

  const row = (name: string) => accountsSection.getByRole("article", { name, exact: true });
  await expect(row("Barclays Current")).toContainText("Bank · Current Account");
  await expect(row("Barclays Current")).toContainText("Opening balance: £0.00");
  await expect(row("Barclays Current")).toContainText("Active");
  await expect(row("Petty cash")).toContainText("Cash · Cash Float");

  await row("Barclays Current").getByRole("button", { name: "Rename" }).click();
  await accountsSection.getByLabel("New name for Barclays Current").fill("Barclays");
  await accountsSection.getByLabel("New name for Barclays Current").press("Enter");
  await expect(row("Barclays")).toBeVisible();
  await row("Barclays").getByRole("button", { name: "Rename" }).click();
  await accountsSection.getByLabel("New name for Barclays").fill("Discarded");
  await accountsSection.getByLabel("New name for Barclays").press("Escape");
  await expect(row("Barclays")).toBeVisible();
  await expect(row("Discarded")).toHaveCount(0);

  await row("Barclays").getByRole("button", { name: "Set opening balance" }).click();
  await expect(row("Barclays")).toContainText("the balance on the first day of the year");
  await accountsSection.getByLabel("Opening balance for Barclays").fill("12.345");
  await accountsSection.getByLabel("Opening balance for Barclays").press("Enter");
  await expect(row("Barclays").getByRole("alert")).toContainText("Enter an amount in pounds with up to two decimals");
  await accountsSection.getByLabel("Opening balance for Barclays").fill("1250.5");
  await accountsSection.getByLabel("Opening balance for Barclays").press("Enter");
  await expect(row("Barclays")).toContainText("Opening balance: £1,250.50");
  await row("Petty cash").getByRole("button", { name: "Set opening balance" }).click();
  await accountsSection.getByLabel("Opening balance for Petty cash").fill("-80.25");
  await row("Petty cash").getByRole("button", { name: "Save" }).click();
  await expect(row("Petty cash")).toContainText("Opening balance: -£80.25");

  await row("Petty cash").getByRole("button", { name: "Deactivate" }).click();
  await expect(row("Petty cash")).toContainText("Inactive");
  await expect(sheet.locator("option")).toHaveText(["Deposit Account", "Cash Float"]);

  // One expected refusal: the name is already used by an active account.
  const refused = await browserApiRequest(page, `/api/businesses/${businessId}/money-accounts`, { method: "POST", data: { name: "barclays", kind: "bank", sheetName: "Deposit Account" } });
  expect(refused.status).toBe(409);
  expect(JSON.parse(refused.body).error.code).toBe("MONEY_ACCOUNT_NAME_TAKEN");
  await stubNextAccountCreate(page, 409, "MONEY_ACCOUNT_NAME_TAKEN");
  await accountsSection.getByLabel("Account name").fill("barclays");
  await sheet.selectOption("Deposit Account");
  await accountsSection.getByRole("button", { name: "Add account" }).click();
  await expect(accountsSection.getByRole("alert")).toContainText("Another active account already has this name.");
  await accountsSection.getByLabel("Account name").fill("");

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("read-only");
    void dialog.accept();
  });
  await taxYear.getByRole("button", { name: "Close year" }).click();
  await expect(yearSection.getByRole("status")).toContainText("Year closed.");
  await expect(taxYear).toContainText("Closed");
  await expect(yearSection.getByRole("button", { name: "Start next year" })).toBeVisible();
  await expect(yearSection.getByLabel("Start date")).toHaveValue(`${year + 1}-04-06`);
  await expect(yearSection.getByLabel("End date")).toHaveValue(`${year + 2}-04-05`);
  await expect(accountsSection).toContainText("Open a financial year to set opening balances.");
  await expect(accountsSection.getByRole("button", { name: "Set opening balance" })).toHaveCount(0);

  await taxYear.getByRole("button", { name: "Reopen year" }).click();
  await expect(yearSection.getByRole("status")).toContainText("Year reopened.");
  await expect(taxYear).toContainText("Open");
  await expect(row("Barclays").getByRole("button", { name: "Set opening balance" })).toBeVisible();

  await page.reload();
  await expect(taxYear).toContainText("Open", firstCompile);
  await expect(row("Barclays")).toContainText("Opening balance: £1,250.50");
  await expect(row("Petty cash")).toContainText("Opening balance: -£80.25");
  await expect(row("Petty cash")).toContainText("Inactive");
  await expectNoHorizontalOverflow(page);

  await page.goto(`/business/${businessId}/settings/accounts?locale=es`);
  await expect(page.getByRole("heading", { level: 1, name: "Cuentas de dinero y ejercicio" })).toBeVisible();
  const ejercicio = page.getByRole("region", { name: "Ejercicio contable" });
  await expect(ejercicio).toContainText("Abierto", firstCompile);
  await expect(ejercicio.getByRole("button", { name: "Cerrar ejercicio" })).toBeVisible();
  const cuentas = page.getByRole("region", { name: "Cuentas de dinero", exact: true });
  await expect(cuentas.getByRole("article", { name: "Barclays" })).toContainText("Banco · Current Account");
  await expect(cuentas.getByRole("button", { name: "Añadir cuenta" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
