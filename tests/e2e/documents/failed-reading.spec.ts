import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures";
import { createApprovedBusiness } from "../helpers/business";
import { relayFetches } from "./relay-fetch";

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

// The fake OCR provider fails the reading of a file named "fail-reading-…" every time, and of a file
// named "fail-reading-once-…" only the first time.
const pdf = (name: string, marker: string) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(`%PDF-1.7\n% ${marker}\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF\n`),
});

// The dev server compiles the OCR route on first use, which can exceed the default expect timeout.
const ocrCompile = { timeout: 60_000 };
const filesInput = (page: Page) => page.locator('input[type="file"][multiple]');
const queueRow = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });
const row = (page: Page, name: string) => page.locator("article").filter({ hasText: name });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// The failed reading answers a real 502 and the duplicate a real 409: relay them past the console gate.
const relayedPaths = /^\/api\/(businesses\/[^/]+\/documents|documents\/[^/]+\/(process|manual-invoice))$/;

test("reads a document again after its first reading failed", async ({ page, browserWithDiagnostics: browser }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "failed-reading-once@example.com");
  const businessId = await createApprovedBusiness(browser, page, "E2E Failed Reading Once Harbour");
  const relayed = await relayFetches(page, relayedPaths);

  const file = pdf("fail-reading-once-invoice.pdf", "failed-reading-once");
  await page.goto(`/business/${businessId}/upload?locale=en`);
  await filesInput(page).setInputFiles(file);
  await expect(queueRow(page, file.name).getByRole("status")).toContainText("The document could not be processed with OCR.", ocrCompile);
  expect(relayed.map(({ status }) => status)).toEqual([201, 502]);

  await page.goto(`/business/${businessId}/documents?locale=en`);
  const failed = row(page, file.name);
  await expect(failed).toContainText("Could not be read");
  await expect(failed.getByRole("button", { name: "Fill in by hand" })).toBeVisible();
  await failed.getByRole("button", { name: "Read again" }).click();
  await expect(failed).toContainText("Needs review", ocrCompile);
  await expect(failed.getByRole("link", { name: "Open review" })).toHaveAttribute("href", new RegExp(`^/business/${businessId}/invoices/[^/?]+\\?locale=en$`));
  await expect(failed.getByRole("button")).toHaveCount(0);
  await expect(failed.getByRole("status")).toHaveCount(0);
  expect(relayed.at(-1)?.status).toBe(202);
});

test("runs out of reading attempts, accepts the same file again and fills it in by hand", async ({ page, browserWithDiagnostics: browser }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "failed-reading-always@example.com");
  const businessId = await createApprovedBusiness(browser, page, "E2E Failed Reading Always Harbour");
  const relayed = await relayFetches(page, relayedPaths);

  const file = pdf("fail-reading-invoice.pdf", "failed-reading-always");
  await page.goto(`/business/${businessId}/upload?locale=en`);
  await filesInput(page).setInputFiles(file);
  await expect(queueRow(page, file.name).getByRole("status")).toContainText("The document could not be processed with OCR.", ocrCompile);

  // The upload used the first of three attempts; "Read again" uses the other two.
  await page.goto(`/business/${businessId}/documents?locale=en`);
  const failed = row(page, file.name);
  await expect(failed).toContainText("Could not be read");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  const readAgain = failed.getByRole("button", { name: "Read again" });
  await readAgain.click();
  await expect(failed.getByRole("status")).toContainText("It still could not be read. Try again or fill it in by hand.", ocrCompile);
  await expect(readAgain).toBeEnabled();
  await readAgain.click();
  await expect(readAgain).toHaveCount(0);
  await expect(failed).toContainText("No reading attempts left. Fill it in by hand.");
  await expect(failed.getByRole("button", { name: "Fill in by hand" })).toHaveClass(/primary-button/);
  expect(relayed.map(({ status }) => status)).toEqual([201, 502, 502, 502]);

  // Uploading the same file again is not a duplicate: the failed document gets a fresh reading.
  await page.goto(`/business/${businessId}/upload?locale=en`);
  await filesInput(page).setInputFiles(file);
  await expect(queueRow(page, file.name).getByRole("status")).toContainText("The document could not be processed with OCR.", ocrCompile);
  expect(relayed.slice(-2).map(({ status }) => status)).toEqual([201, 502]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/business/${businessId}/documents?locale=es`);
  const fallido = row(page, file.name);
  await expect(page.locator("article")).toHaveCount(1);
  await expect(fallido).toContainText("No se pudo leer");
  await expect(fallido.getByRole("button", { name: "Leer de nuevo" })).toBeVisible();
  await expect(fallido.getByRole("button", { name: "Rellenar a mano" })).toBeVisible();
  await expect(fallido).not.toContainText("No quedan intentos de lectura.");
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/business/${businessId}/documents?locale=en`);
  await row(page, file.name).getByRole("button", { name: "Fill in by hand" }).click();
  await expect(page).toHaveURL(new RegExp(`/business/${businessId}/invoices/[^/?]+\\?locale=en$`), ocrCompile);
  expect(relayed.at(-1)?.status).toBe(201);
  await expect(page.getByRole("heading", { name: "Extracted fields" })).toBeVisible();
  await expect(page.getByLabel(/supplier/i)).toHaveValue("");
  await expect(page.getByLabel(/invoice number/i)).toHaveValue("");
  await page.getByLabel(/supplier/i).fill("Hand Filled Supplier");
  await page.getByLabel(/invoice number/i).fill("HAND-001");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByRole("status")).toContainText("Correction saved.");
  await expect(page.locator(".page-error")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel(/supplier/i)).toHaveValue("Hand Filled Supplier");

  await page.goto(`/business/${businessId}/documents?locale=en`);
  const filled = row(page, file.name);
  await expect(filled).toContainText("Needs review");
  await expect(filled.getByRole("link", { name: "Open review" })).toBeVisible();
  await expect(filled.getByRole("button")).toHaveCount(0);
});
