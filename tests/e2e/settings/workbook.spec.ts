import type { Page } from "@playwright/test";

import { buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";
import { expect, test } from "../fixtures";
import { browserApiRequest } from "../helpers/browser-api";
import { createApprovedBusiness } from "../helpers/business";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// The dev server compiles the template route and its reader on first use.
const firstCompile = { timeout: 90_000 };

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

// Chromium logs a real 4xx as a console error; the real status is asserted through the API first.
async function stubNextTemplateUpload(page: Page, status: number, code: string) {
  await page.evaluate(({ status, code }) => {
    const originalFetch = window.fetch.bind(window);
    let remaining = 1;
    window.fetch = async (input, init) => {
      const requestUrl = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (remaining > 0 && init?.method === "POST" && requestUrl.endsWith("/template")) {
        remaining -= 1;
        return new Response(JSON.stringify({ error: { code } }), { status, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(input, init);
    };
  }, { status, code });
}

async function pickTemplate(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, replacing: boolean) {
  if (replacing) {
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("Codes you have already used are kept");
      void dialog.accept();
    });
  }
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: replacing ? "Replace template" : "Upload template" }).click();
  await (await chooser).setFiles(file);
}

async function expectNoHorizontalOverflow(page: Page) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(fits, `no horizontal overflow at ${viewport.width}px`).toBe(true);
  }
}

test("owner uploads the accountant template, sees what to tell the accountant and manages the chart of accounts", async ({ page, browserWithDiagnostics: browser }) => {
  test.setTimeout(420_000);
  const suffix = Date.now().toString();
  await signIn(page, `workbook-${suffix}@example.com`);
  const businessId = await createApprovedBusiness(browser, page, `Workbook Books ${suffix}`);
  const template = {
    name: "accounts-2026.xlsx",
    mimeType: XLSX_TYPE,
    buffer: await buildSyntheticTemplate({
      brokenReferenceCells: 3,
      truncate: [{ sheet: "deposit", position: 6, lastFormulaRow: 20 }, { sheet: "cash", position: 6, lastFormulaRow: 20 }],
      staleClosingBalanceRow: 20,
      readTwicePosition: 10,
      notReadPosition: 14,
    }),
  };

  await page.goto(`/business/${businessId}/invoices?locale=en`);
  await page.getByRole("link", { name: "Accounts template" }).click();
  await expect(page).toHaveURL(`/business/${businessId}/settings/workbook?locale=en`);
  await expect(page.getByRole("heading", { level: 1, name: "Accounts template" })).toBeVisible();
  const templateSection = page.getByRole("region", { name: "Your accountant's template" });
  await expect(templateSection).toContainText("No template yet.", firstCompile);

  await pickTemplate(page, template, false);
  await expect(templateSection.getByRole("status")).toContainText("Template read.", firstCompile);
  await expect(templateSection).toContainText("accounts-2026.xlsx");
  await expect(templateSection).toContainText("3 account sheets read");
  await expect(templateSection).toContainText("Current Account: room for 30 rows");
  await expect(templateSection).toContainText("Deposit Account: room for 14 rows");
  await expect(templateSection).toContainText("Cash Float: room for 14 rows");
  await expect(templateSection).toContainText("Headings: 16 added, 0 updated, 0 no longer in the template.");

  const advice = page.getByRole("region", { name: "What to tell your accountant" });
  await expect(advice).toContainText("3 formulas in the template point at something that was deleted");
  await expect(advice).toContainText("Deposit Account (14 rows) and Cash Float (14 rows)");
  await expect(advice).toContainText("The closing balance at the bottom of Current Account can be wrong once the sheet gets long");
  await expect(advice).toContainText("Cash Float is not added into the accounts");
  await expect(advice).toContainText("The app will not let you use Phone and Tax owed");
  await expect(advice).toContainText("The template has a heading with no name");
  await expect(advice).not.toContainText("space");
  await expect(advice.getByRole("listitem")).toHaveCount(6);

  const chart = page.getByRole("region", { name: "Chart of accounts" });
  await expect(chart).toContainText("Numbered headings are spare lines your accountant has not named yet");
  const row = (name: string) => chart.getByRole("article", { name, exact: true });

  await expect(row("Sundry income")).toContainText("In the template: Sundry income·");
  await expect(row("Sundry income")).toContainText("ends with a space");

  await row("Sales").getByRole("button", { name: "Rename" }).click();
  await chart.getByLabel("New name for Sales").fill("Shop sales");
  await chart.getByLabel("New name for Sales").press("Enter");
  await expect(row("Shop sales")).toContainText("In the template: Sales");
  await row("Shop sales").getByRole("button", { name: "Rename" }).click();
  await chart.getByLabel("New name for Shop sales").fill("Discarded");
  await chart.getByLabel("New name for Shop sales").press("Escape");
  await expect(row("Shop sales")).toBeVisible();
  await expect(row("Discarded")).toHaveCount(0);

  await chart.locator("summary").filter({ hasText: "Expenses" }).click();
  await expect(row("17")).toContainText("Inactive");
  await row("17").getByRole("button", { name: "Activate" }).click();
  await expect(row("17").getByRole("button", { name: "Deactivate" })).toBeVisible();

  await expect(row("Motor - do not use")).toContainText("Blocked: the template marks it as not to be used.");
  await expect(row("Motor - do not use").getByRole("button", { name: "Activate" })).toHaveCount(0);
  await expect(row("Phone")).toContainText("Blocked: its total is added into the accounts twice.");

  await page.reload();
  await chart.locator("summary").filter({ hasText: "Expenses" }).click();
  await expect(row("Shop sales")).toBeVisible();
  await expect(row("17").getByRole("button", { name: "Deactivate" })).toBeVisible();
  await expect(row("Motor - do not use")).toContainText("Blocked");

  await pickTemplate(page, template, true);
  await expect(templateSection.getByRole("status")).toContainText("Template read.");
  await expect(templateSection).toContainText("Headings: 0 added, 16 updated, 0 no longer in the template.");
  await expect(row("Shop sales")).toBeVisible();

  await expectNoHorizontalOverflow(page);

  await page.goto(`/business/${businessId}/settings/workbook?locale=es`);
  await expect(page.getByRole("heading", { level: 1, name: "Plantilla de cuentas" })).toBeVisible();
  const consejo = page.getByRole("region", { name: "Qué decirle a tu contable" });
  await expect(consejo).toContainText("3 fórmulas de la plantilla apuntan a algo que se borró");
  await expect(consejo).toContainText("Cash Float no se suma a las cuentas");
  const plan = page.getByRole("region", { name: "Plan de cuentas" });
  await expect(plan.locator("summary").filter({ hasText: "Ingresos" })).toBeVisible();
  await plan.locator("summary").filter({ hasText: "Gastos" }).click();
  await expect(plan.getByRole("article", { name: "Motor - do not use" })).toContainText("Bloqueada: la plantilla indica que no se use.");
  await expect(page.getByRole("button", { name: "Reemplazar plantilla" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto(`/business/${businessId}/settings/workbook?locale=en`);
  await expect(templateSection).toContainText("accounts-2026.xlsx");
  const notes = { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a workbook") };
  const realResponse = await browserApiRequest(page, `/api/businesses/${businessId}/template`, { method: "POST", multipart: { file: notes } });
  expect(realResponse.status).toBe(415);
  expect(JSON.parse(realResponse.body).error.code).toBe("UNSUPPORTED_TEMPLATE_TYPE");
  await stubNextTemplateUpload(page, 415, "UNSUPPORTED_TEMPLATE_TYPE");
  await pickTemplate(page, notes, true);
  await expect(templateSection.getByRole("alert")).toContainText("This file is not an Excel workbook (.xlsx).");
});
