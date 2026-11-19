import type { Locator, Page } from "@playwright/test";

import { buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";
import { expect, test } from "../fixtures";
import { browserApiRequest } from "../helpers/browser-api";
import { createApprovedBusiness } from "../helpers/business";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// The dev server compiles the movements page and the money routes on first use.
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

// Chromium logs a real 4xx as a console error; the real status is asserted through the API first.
async function stubNextMovementCreate(page: Page, status: number, code: string) {
  await page.evaluate(({ status, code }) => {
    const originalFetch = window.fetch.bind(window);
    let remaining = 1;
    window.fetch = async (input, init) => {
      const requestUrl = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (remaining > 0 && init?.method === "POST" && requestUrl.endsWith("/movements")) {
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

/** The four figures of one account's balance card, as shown. */
function balance(page: Page, name: string) {
  const card = page.getByRole("region", { name: "Balances this year" }).getByRole("article", { name, exact: true });
  return () => card.locator("dl > div").evaluateAll((rows) => rows.map((row) => row.querySelector("dd")?.textContent ?? ""));
}

const pence = (shown: string) => Math.round(Number(shown.replace(/[£,]/g, "")) * 100);

async function addMovement(form: Locator, kind: string, values: { account?: string; from?: string; to?: string; amount: string; code?: string; narrative?: string }) {
  await form.getByRole("radio", { name: kind }).check();
  if (values.account) await form.getByLabel("Account", { exact: true }).selectOption({ label: values.account });
  if (values.from) await form.getByLabel("From", { exact: true }).selectOption({ label: values.from });
  if (values.to) await form.getByLabel("To", { exact: true }).selectOption({ label: values.to });
  await form.getByLabel("Amount (£)").fill(values.amount);
  if (values.code) await form.getByLabel("Code", { exact: true }).selectOption({ label: values.code });
  if (values.narrative !== undefined) await form.getByLabel(/^Description/).fill(values.narrative);
  await form.getByRole("button", { name: /^Save (movement|transfer)$/ }).click();
}

test("owner records income, drawings, bank charges and transfers without an invoice from the phone", async ({ page, browserWithDiagnostics: browser }) => {
  test.setTimeout(600_000);
  const suffix = Date.now().toString();
  const year = new Date().getFullYear();
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, `movements-${suffix}@example.com`);
  const businessId = await createApprovedBusiness(browser, page, `Movements Books ${suffix}`);
  const base = `/api/businesses/${businessId}`;

  await page.goto(`/business/${businessId}/invoices?locale=en`);
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Movements", exact: true }).click();
  await expect(page).toHaveURL(`/business/${businessId}/movements?locale=en`, firstCompile);
  await expect(page.getByRole("heading", { level: 1, name: "Movements" })).toBeVisible();
  await expect(page.getByText("open a financial year and add at least one bank or cash account")).toBeVisible(firstCompile);
  await expect(page.getByRole("link", { name: "Money accounts and year" })).toHaveAttribute("href", `/business/${businessId}/settings/accounts?locale=en`);
  await expect(page.getByRole("radio")).toHaveCount(0);

  // Setup through the API: template (headings and sheets), an open year, a bank and a cash account.
  const template = await browserApiRequest(page, `${base}/template`, { method: "POST", multipart: { file: { name: "accounts.xlsx", mimeType: XLSX_TYPE, buffer: await buildSyntheticTemplate() } } });
  expect(template.status, template.body).toBe(200);
  const openYear = await api<{ id: string }>(page, `${base}/financial-years`, "POST", { startDate: `${year}-01-01`, endDate: `${year}-12-31` });
  const bank = await api<{ id: string }>(page, `${base}/money-accounts`, "POST", { name: "Barclays", kind: "bank", sheetName: "Current Account" });
  await api(page, `${base}/money-accounts`, "POST", { name: "Petty cash", kind: "cash", sheetName: "Cash Float" });
  await api(page, `${base}/money-accounts/${bank.id}`, "PATCH", { openingBalance: { yearId: openYear.id, amount: "1000.00" } });
  const headings = await api<{ id: string; displayName: string }[]>(page, `${base}/headings`, "GET", undefined);
  const sales = headings.find((heading) => heading.displayName === "Sales")!;

  await page.reload();
  const add = page.getByRole("region", { name: "Add movement" });
  const list = page.getByRole("region", { name: "Movements this year" });
  const row = (text: string) => list.getByRole("listitem").filter({ hasText: text });
  await expect(list).toContainText("No movements yet.", firstCompile);
  expect(await balance(page, "Barclays")()).toEqual(["£1,000.00", "£0.00", "£0.00", "£1,000.00"]);
  expect(await balance(page, "Petty cash")()).toEqual(["£0.00", "£0.00", "£0.00", "£0.00"]);
  expect(await add.getByRole("radio").evaluateAll((radios) => radios.map((radio) => radio.closest("label")?.textContent))).toEqual([
    "Money came in", "I took money out for myself", "The bank charged me", "I moved money between my accounts",
  ]);
  await expect(add.getByLabel("Amount (£)")).toHaveCount(0);

  // Income: typed positive, shown as money in; the form resets keeping account and date.
  await add.getByRole("radio", { name: "Money came in" }).check();
  await expect(add).toContainText("This will be recorded as money in.");
  const today = await add.getByLabel("Date").inputValue();
  expect(await add.getByLabel("Code", { exact: true }).locator("optgroup").evaluateAll((groups) => groups.map((group) => group.getAttribute("label")))).toEqual(["Income", "Cost of sales", "Expenses", "Assets", "Liabilities", "Equity"]);
  await expect(add.getByLabel("Code", { exact: true })).toHaveValue("");
  await addMovement(add, "Money came in", { account: "Barclays", amount: "120", code: "Sales", narrative: "Card takings" });
  await expect(add.getByRole("status")).toContainText("Movement saved.", firstCompile);
  await expect(row("Card takings")).toContainText("+£120.00 in");
  await expect(row("Card takings")).toContainText("Barclays · Sales");
  await expect(row("Card takings")).toContainText("Manual");
  await expect(add.getByLabel("Amount (£)")).toHaveValue("");
  await expect(add.getByLabel("Account", { exact: true })).toHaveValue(bank.id);
  await expect(add.getByLabel("Date")).toHaveValue(today);

  await addMovement(add, "I took money out for myself", { account: "Petty cash", amount: "45", code: "Owner drawings", narrative: "Cash for me" });
  await expect(row("Cash for me")).toContainText("-£45.00 out");
  await add.getByRole("radio", { name: "The bank charged me" }).check();
  await expect(add).toContainText("This will be recorded as money out.");
  await addMovement(add, "The bank charged me", { account: "Barclays", amount: "7.5", code: "Premises", narrative: "Monthly fee" });
  await expect(row("Monthly fee")).toContainText("-£7.50 out");
  await expect.poll(balance(page, "Barclays")).toEqual(["£1,000.00", "£120.00", "£7.50", "£1,112.50"]);
  await expect.poll(balance(page, "Petty cash")).toEqual(["£0.00", "£0.00", "£45.00", "-£45.00"]);

  // A transfer: two rows sharing the code; the total of both accounts is unchanged.
  const total = async () => pence((await balance(page, "Barclays")())[3]) + pence((await balance(page, "Petty cash")())[3]);
  const before = await total();
  await add.getByRole("radio", { name: "I moved money between my accounts" }).check();
  await expect(add).toContainText("Both sides of a transfer carry the same code");
  await expect(add.getByLabel("Code", { exact: true })).toHaveValue("");
  await addMovement(add, "I moved money between my accounts", { from: "Barclays", to: "Petty cash", amount: "200", code: "Loans" });
  await expect(add.getByRole("status")).toContainText("Transfer saved.");
  const legs = row("Transfer");
  await expect(legs).toHaveCount(2);
  await expect(legs.filter({ hasText: "-£200.00 out" })).toContainText("Barclays · Loans");
  await expect(legs.filter({ hasText: "+£200.00 in" })).toContainText("Petty cash · Loans");
  await expect.poll(balance(page, "Barclays")).toEqual(["£1,000.00", "£120.00", "£207.50", "£912.50"]);
  expect(await total()).toBe(before);

  // The next transfer starts from the code used last time.
  await page.reload();
  await add.getByRole("radio", { name: "I moved money between my accounts" }).check({ timeout: 90_000 });
  await expect(add.getByLabel("Code", { exact: true }).locator("option:checked")).toHaveText("Loans");
  await add.getByRole("radio", { name: "Money came in" }).check();
  await expect(add.getByLabel("Code", { exact: true })).toHaveValue("");

  // Editing one leg edits the whole transfer.
  await legs.filter({ hasText: "+£200.00 in" }).getByRole("button", { name: "Edit" }).click();
  const editing = list.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Save changes" }) });
  await expect(editing.getByLabel("From", { exact: true })).toHaveValue(bank.id);
  await expect(editing.getByLabel("Amount (£)")).toHaveValue("200.00");
  await editing.getByLabel("Amount (£)").fill("250");
  await editing.getByRole("button", { name: "Save changes" }).click();
  await expect(list.getByRole("status")).toContainText("Changes saved.");
  await expect(legs.filter({ hasText: "-£250.00 out" })).toHaveCount(1);
  await expect(legs.filter({ hasText: "+£250.00 in" })).toHaveCount(1);
  await expect.poll(balance(page, "Petty cash")).toEqual(["£0.00", "£250.00", "£45.00", "£205.00"]);
  expect(await total()).toBe(before);

  // Delete one movement, then the transfer (both sides).
  page.once("dialog", (dialog) => { expect(dialog.message()).toBe("Delete this movement?"); void dialog.accept(); });
  await row("Monthly fee").getByRole("button", { name: "Delete" }).click();
  await expect(list.getByRole("status")).toContainText("Movement deleted.");
  await expect(row("Monthly fee")).toHaveCount(0);
  page.once("dialog", (dialog) => { expect(dialog.message()).toContain("Both sides are removed"); void dialog.accept(); });
  await legs.first().getByRole("button", { name: "Delete" }).click();
  await expect(list.getByRole("status")).toContainText("Transfer deleted.");
  await expect(legs).toHaveCount(0);

  await page.reload();
  await expect(row("Card takings")).toContainText("+£120.00 in", firstCompile);
  await expect(row("Cash for me")).toContainText("-£45.00 out");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect.poll(balance(page, "Barclays")).toEqual(["£1,000.00", "£120.00", "£0.00", "£1,120.00"]);
  await expect.poll(balance(page, "Petty cash")).toEqual(["£0.00", "£0.00", "£45.00", "-£45.00"]);
  await list.getByLabel("Show", { exact: true }).selectOption({ label: "Petty cash" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(row("Cash for me")).toBeVisible();
  await list.getByLabel("Show", { exact: true }).selectOption({ label: "All accounts" });

  // A date outside the year: limited by the input, refused by the page and by the server.
  await add.getByRole("radio", { name: "Money came in" }).check();
  await expect(add.getByLabel("Date")).toHaveAttribute("min", `${year}-01-01`);
  await expect(add.getByLabel("Date")).toHaveAttribute("max", `${year}-12-31`);
  await add.getByLabel("Date").fill(`${year + 1}-01-15`);
  await add.getByLabel("Amount (£)").fill("10");
  await add.getByLabel("Code", { exact: true }).selectOption({ label: "Sales" });
  await add.getByLabel(/^Description/).fill("Too late");
  await add.getByRole("button", { name: "Save movement" }).click();
  await expect(add.getByRole("alert")).toContainText("Pick a date between");
  await expect(add.getByLabel("Date")).toHaveAttribute("aria-invalid", "true");
  const refused = await browserApiRequest(page, `${base}/movements`, { method: "POST", data: { accountId: bank.id, date: `${year + 1}-01-15`, narrative: "Too late", headingId: sales.id, amount: "10.00" } });
  expect(refused.status).toBe(409);
  expect(JSON.parse(refused.body).error.code).toBe("MOVEMENT_OUTSIDE_OPEN_YEAR");
  await stubNextMovementCreate(page, 409, "MOVEMENT_OUTSIDE_OPEN_YEAR");
  await add.getByLabel("Date").fill(today);
  await add.getByRole("button", { name: "Save movement" }).click();
  await expect(add.getByRole("alert")).toContainText("This date is outside the open financial year.");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expectNoHorizontalOverflow(page);

  await page.goto(`/business/${businessId}/movements?locale=es`);
  await expect(page.getByRole("heading", { level: 1, name: "Movimientos" })).toBeVisible();
  const lista = page.getByRole("region", { name: "Movimientos de este ejercicio" });
  await expect(lista.getByRole("listitem").filter({ hasText: "Cash for me" })).toContainText("sale", firstCompile);
  await expect(lista.getByRole("listitem").filter({ hasText: "Card takings" })).toContainText("entra");
  const anadir = page.getByRole("region", { name: "Añadir movimiento" });
  await anadir.getByRole("radio", { name: "Moví dinero entre mis cuentas" }).check();
  await expect(anadir.getByLabel("Desde", { exact: true })).toBeVisible();
  await expect(anadir).toContainText("Los dos lados de un traspaso llevan el mismo código");
  await expectNoHorizontalOverflow(page);
});
