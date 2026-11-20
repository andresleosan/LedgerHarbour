import type { Page } from "@playwright/test";

import { buildSyntheticTemplate, SYNTHETIC_SHEETS } from "../../fixtures/workbook/synthetic-template";
import { expect, test } from "../fixtures";
import { browserApiRequest } from "../helpers/browser-api";
import { createApprovedBusiness } from "../helpers/business";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// The dev server compiles the routes and pages on first use.
const firstCompile = { timeout: 180_000 };

type Movement = { sourceInvoiceId: string | null; moneyAccountId: string; movementDate: string; narrative: string; headingId: string | null; amount: string };

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

async function api<T>(page: Page, url: string, method = "GET", body?: unknown): Promise<T> {
  const result = await browserApiRequest(page, url, body === undefined ? { method } : { method, data: body });
  expect(result.status, `${method} ${url}: ${result.body}`).toBeLessThan(300);
  return JSON.parse(result.body) as T;
}

/** Reads the movements through the movements API from the page itself, as the app would. */
async function invoiceMovements(page: Page, businessId: string, yearId: string, invoiceId: string): Promise<Movement[]> {
  const movements = await page.evaluate(async (url) => (await fetch(url)).json(), `/api/businesses/${businessId}/movements?yearId=${yearId}`) as Movement[];
  return movements.filter((movement) => movement.sourceInvoiceId === invoiceId);
}

async function uploadInvoice(page: Page, businessId: string, name: string) {
  await page.goto(`/business/${businessId}/upload?locale=en`);
  await page.locator('input[type="file"][multiple]').setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(`%PDF-1.7\n% ${name}\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF\n`),
  });
  await expect(page.getByRole("listitem").filter({ hasText: name }).getByRole("status")).toContainText("Ready for review", firstCompile);
}

/** Opens the only invoice waiting for review, codes it to Premises and saves the confirmed fields. */
async function reviewAndCode(page: Page, businessId: string, options: { creditNote?: boolean } = {}): Promise<string> {
  await page.goto(`/business/${businessId}/invoices?status=needs_review&locale=en`);
  const link = page.getByRole("link", { name: "Open review" });
  await expect(link).toHaveCount(1);
  const invoiceId = (await link.getAttribute("href"))?.match(/invoices\/([^?]+)\?/)?.[1];
  expect(invoiceId).toBeTruthy();
  await link.click();
  await expect(page.getByRole("heading", { name: "Extracted fields" })).toBeVisible(firstCompile);
  await page.getByLabel("Code", { exact: true }).selectOption({ label: "Premises" });
  await expect(page.getByLabel("Invoice", { exact: true })).toBeChecked();
  if (options.creditNote) await page.getByLabel("Credit note").check();
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByRole("status")).toContainText("Correction saved.");
  return invoiceId as string;
}

// Chromium logs a real 4xx as a console error; the real status is asserted through the API first.
async function stubNextApproval(page: Page, status: number, code: string) {
  await page.evaluate(({ status, code }) => {
    const originalFetch = window.fetch.bind(window);
    let remaining = 1;
    window.fetch = async (input, init) => {
      if (remaining > 0 && init?.method === "PATCH" && typeof init.body === "string" && init.body.includes("\"approve\"")) {
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

test("owner says how each approved invoice was paid and its movement follows every change", async ({ page, browserWithDiagnostics: browser }) => {
  test.setTimeout(900_000);
  const suffix = Date.now().toString();
  await signIn(page, `payment-${suffix}@example.com`);
  const businessId = await createApprovedBusiness(browser, page, `Payment Books ${suffix}`);
  await page.goto(`/business/${businessId}/invoices?locale=en`);
  const template = await browserApiRequest(page, `/api/businesses/${businessId}/template`, {
    method: "POST",
    multipart: { file: { name: "accounts.xlsx", mimeType: XLSX_TYPE, buffer: await buildSyntheticTemplate() } },
  });
  expect(template.status, template.body).toBeLessThan(300);
  const year = await api<{ id: string }>(page, `/api/businesses/${businessId}/financial-years`, "POST", { startDate: "2026-04-06", endDate: "2027-04-05" });
  const bank = await api<{ id: string }>(page, `/api/businesses/${businessId}/money-accounts`, "POST", { name: "Main bank", kind: "bank", sheetName: SYNTHETIC_SHEETS.main });
  const cash = await api<{ id: string }>(page, `/api/businesses/${businessId}/money-accounts`, "POST", { name: "Cash float", kind: "cash", sheetName: SYNTHETIC_SHEETS.cash });
  const headings = await api<Array<{ id: string; displayName: string }>>(page, `/api/businesses/${businessId}/headings`);
  const premises = headings.find((heading) => heading.displayName === "Premises")!.id;

  // 1. Paid from a business account: one negative movement, "supplier number", the code, the date.
  await uploadInvoice(page, businessId, "payment-first.pdf");
  const firstId = await reviewAndCode(page, businessId);
  await page.getByRole("button", { name: "Approve invoice" }).click();
  await expect(page.getByRole("group", { name: "How was it paid?" })).toBeVisible();
  await page.getByLabel("From a business account").check();
  await expect(page.getByLabel("Date paid")).toHaveValue("2026-08-01");
  await expect(page.getByLabel("Amount taken (£)")).toHaveValue("120.00");
  await page.getByLabel("Account", { exact: true }).selectOption({ label: "Main bank (bank)" });
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Invoice approved.");
  await expect(page.getByText("Paid from Main bank on 2026-08-01: £120.00")).toBeVisible();
  const first = (await api<{ invoice: { supplier: string; invoiceNumber: string } }>(page, `/api/invoices/${firstId}/review`)).invoice;
  expect(await invoiceMovements(page, businessId, year.id, firstId)).toEqual([expect.objectContaining({ moneyAccountId: bank.id, movementDate: "2026-08-01", narrative: `${first.supplier} ${first.invoiceNumber}`, headingId: premises, amount: "-120.00" })]);

  // 2. Changing the account, date and amount replaces the movement: still exactly one.
  await page.getByRole("button", { name: "Change payment" }).click();
  await expect(page.getByLabel("From a business account")).toBeChecked();
  await page.getByLabel("Account", { exact: true }).selectOption({ label: "Cash float (cash)" });
  await page.getByLabel("Date paid").fill("2026-09-15");
  await page.getByLabel("Amount taken (£)").fill("119.5");
  await page.getByRole("button", { name: "Save payment" }).click();
  await expect(page.getByRole("status")).toContainText("Payment saved.");
  await expect(page.getByText("Paid from Cash float on 2026-09-15: £119.50")).toBeVisible();
  expect(await invoiceMovements(page, businessId, year.id, firstId)).toEqual([expect.objectContaining({ moneyAccountId: cash.id, movementDate: "2026-09-15", amount: "-119.50" })]);

  // 3. Not paid yet: no movement, listed under "Not paid", and marked as paid later.
  await uploadInvoice(page, businessId, "payment-second.pdf");
  const secondId = await reviewAndCode(page, businessId);
  await page.getByRole("button", { name: "Approve invoice" }).click();
  await page.getByLabel("Not paid yet").check();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Invoice approved.");
  await expect(page.locator("#payment-title + p")).toHaveText("Not paid yet");
  expect(await invoiceMovements(page, businessId, year.id, secondId)).toEqual([]);
  const creditors = await page.evaluate(async (url) => (await fetch(url)).json(), `/api/businesses/${businessId}/invoices/unpaid`) as { unpaid: Array<{ id: string }>; paidPrivately: unknown[] };
  expect(creditors.unpaid.map((item) => item.id)).toEqual([secondId]);
  expect(creditors.paidPrivately).toEqual([]);

  await page.goto(`/business/${businessId}/invoices?locale=en`);
  await page.getByRole("button", { name: "Not paid", exact: true }).click();
  await expect(page).toHaveURL(/status=unpaid/);
  const unpaidRows = page.locator(".invoice-row");
  await expect(unpaidRows).toHaveCount(1);
  await expect(unpaidRows.getByRole("link", { name: "Open review" })).toHaveAttribute("href", new RegExp(`/invoices/${secondId}\\?`));
  await expect(unpaidRows.locator(".status-badge")).toHaveText("Not paid");
  await expectNoHorizontalOverflow(page);

  await unpaidRows.getByRole("link", { name: "Open review" }).click();
  await page.getByRole("button", { name: "Mark as paid" }).click(firstCompile);
  await expect(page.getByLabel("From a business account")).toBeChecked();
  await page.getByLabel("Account", { exact: true }).selectOption({ label: "Main bank (bank)" });
  await page.getByRole("button", { name: "Save payment" }).click();
  await expect(page.getByRole("status")).toContainText("Payment saved.");
  expect(await invoiceMovements(page, businessId, year.id, secondId)).toEqual([expect.objectContaining({ moneyAccountId: bank.id, movementDate: "2026-08-01", amount: "-120.00" })]);

  // 4. Voiding the first invoice removes its movement for good.
  await page.goto(`/business/${businessId}/invoices/${firstId}?locale=en`);
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("its movement is removed");
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Void invoice" }).click(firstCompile);
  await expect(page.getByRole("status")).toContainText("Invoice voided.");
  await expect(page.getByText("This invoice was voided.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change payment" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Void invoice" })).toHaveCount(0);
  expect(await invoiceMovements(page, businessId, year.id, firstId)).toEqual([]);
  await page.goto(`/business/${businessId}/invoices?status=approved&locale=en`);
  await expect(page.locator(".invoice-row").filter({ has: page.locator(`a[href*="${firstId}"]`) }).locator(".status-badge")).toHaveText("Voided");

  // 5. A credit note enters positive; a date outside the open year is refused in plain words.
  await uploadInvoice(page, businessId, "payment-credit.pdf");
  const creditId = await reviewAndCode(page, businessId, { creditNote: true });
  const outside = await browserApiRequest(page, `/api/invoices/${creditId}/review`, { method: "PATCH", data: { action: "approve", payment: { status: "paid", accountId: bank.id, paidOn: "2028-01-01", amountDebited: "120.00" } } });
  expect(outside.status).toBe(409);
  expect(JSON.parse(outside.body).error.code).toBe("MOVEMENT_OUTSIDE_OPEN_YEAR");
  await page.getByRole("button", { name: "Approve invoice" }).click();
  await page.getByLabel("From a business account").check();
  await page.getByLabel("Account", { exact: true }).selectOption({ label: "Main bank (bank)" });
  await stubNextApproval(page, 409, "MOVEMENT_OUTSIDE_OPEN_YEAR");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.locator("#payment-error")).toHaveText("That date is outside the open financial year. Choose a date inside it.");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Invoice approved.");
  expect(await invoiceMovements(page, businessId, year.id, creditId)).toEqual([expect.objectContaining({ moneyAccountId: bank.id, headingId: premises, amount: "120.00" })]);
  await expectNoHorizontalOverflow(page);
});
