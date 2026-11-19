import type { Page } from "@playwright/test";

import { buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";
import { expect, test } from "../fixtures";
import { browserApiRequest } from "../helpers/browser-api";
import { createApprovedBusiness } from "../helpers/business";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// The dev server compiles the template route, its reader and the review page on first use.
const firstCompile = { timeout: 90_000 };

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
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

async function openPendingReview(page: Page, businessId: string): Promise<string> {
  await page.goto(`/business/${businessId}/invoices?status=needs_review&locale=en`);
  const link = page.getByRole("link", { name: "Open review" });
  await expect(link).toHaveCount(1);
  const invoiceId = (await link.getAttribute("href"))?.match(/invoices\/([^?]+)\?/)?.[1];
  expect(invoiceId).toBeTruthy();
  await link.click();
  await expect(page.getByRole("heading", { name: "Extracted fields" })).toBeVisible(firstCompile);
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

test("owner codes invoices from the chart of accounts, gets the supplier's last code and splits an invoice", async ({ page, browserWithDiagnostics: browser }) => {
  test.setTimeout(480_000);
  const suffix = Date.now().toString();
  await signIn(page, `coding-${suffix}@example.com`);
  const businessId = await createApprovedBusiness(browser, page, `Coding Books ${suffix}`);
  await page.goto(`/business/${businessId}/invoices?locale=en`);
  const template = await browserApiRequest(page, `/api/businesses/${businessId}/template`, {
    method: "POST",
    multipart: { file: { name: "accounts.xlsx", mimeType: XLSX_TYPE, buffer: await buildSyntheticTemplate() } },
  });
  expect(template.status, template.body).toBeLessThan(300);

  await uploadInvoice(page, businessId, "coding-first.pdf");
  const firstId = await openPendingReview(page, businessId);
  const code = page.getByLabel("Code", { exact: true });
  await expect(code).toBeVisible();
  expect(await code.locator("optgroup").evaluateAll((groups) => groups.map((group) => group.getAttribute("label")))).toEqual(["Income", "Cost of sales", "Expenses", "Assets", "Liabilities", "Equity"]);
  await expect(code.locator("optgroup[label='Expenses'] option")).toHaveText(["Premises", "Staff costs", "Phone"]);
  await expect(code.locator("option", { hasText: "Motor - do not use" })).toHaveCount(0);
  await expect(page.getByLabel("Category")).toHaveCount(0);

  // Confirm the extracted fields first so that the only thing missing for approval is the code.
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByRole("status")).toContainText("Correction saved.");
  const uncoded = await browserApiRequest(page, `/api/invoices/${firstId}/review`, { method: "PATCH", data: { action: "approve" } });
  expect(uncoded.status).toBe(409);
  expect(JSON.parse(uncoded.body).error.code).toBe("CODING_REQUIRED");
  page.on("dialog", (dialog) => void dialog.accept());
  await stubNextApproval(page, 409, "CODING_REQUIRED");
  const approve = page.getByRole("button", { name: "Approve invoice" });
  await approve.click();
  await expect(page.locator(".review-coding").getByRole("alert")).toContainText("Choose a code and save it before approving.");
  await expect(approve).toBeEnabled();

  await code.selectOption({ label: "Premises" });
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByRole("status")).toContainText("Correction saved.");
  await approve.click();
  await expect(page.getByRole("status")).toContainText("Invoice approved.");
  await expect(page.locator(".page-error")).toHaveCount(0);
  await expect(code).toBeDisabled();

  await uploadInvoice(page, businessId, "coding-second.pdf");
  const secondId = await openPendingReview(page, businessId);
  expect(secondId).not.toBe(firstId);
  await expect(code.locator("option:checked")).toHaveText("Premises");
  await expect(page.getByText("Suggested from your last invoice from this supplier")).toBeVisible();

  await page.getByRole("button", { name: "Split between codes" }).click();
  await expect(page.getByLabel("Code 1").locator("option:checked")).toHaveText("Premises");
  await page.getByLabel("Code 2").selectOption({ label: "Staff costs" });
  await expect(page.getByText("Left to assign: £120.00")).toBeVisible();
  await page.getByLabel("Amount 1").fill("100.00");
  await expect(page.getByText("Left to assign: £20.00")).toBeVisible();
  await page.getByLabel("Amount 2").fill("20");
  await expect(page.getByText("Left to assign: £0.00")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByRole("status")).toContainText("Correction saved.");
  await expect(page.locator(".page-error")).toHaveCount(0);

  await page.reload();
  await expect(page.getByLabel("Code 1").locator("option:checked")).toHaveText("Premises", firstCompile);
  await expect(page.getByLabel("Code 2").locator("option:checked")).toHaveText("Staff costs");
  await expect(page.getByLabel("Amount 1")).toHaveValue("100.00");
  await expect(page.getByLabel("Amount 2")).toHaveValue("20.00");
  await expect(page.getByText("Left to assign: £0.00")).toBeVisible();
  await expect(page.getByText("Suggested from your last invoice from this supplier")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
