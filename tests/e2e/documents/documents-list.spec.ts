import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures";
import { browserApiRequest } from "../helpers/browser-api";
import { createApprovedBusiness } from "../helpers/business";

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

const pdf = (name: string, marker: string) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(`%PDF-1.7\n% ${marker}\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF\n`),
});

async function uploadThroughApi(page: Page, businessId: string, file: ReturnType<typeof pdf>) {
  return browserApiRequest(page, `/api/businesses/${businessId}/documents`, { method: "POST", multipart: { file } });
}

const row = (page: Page, name: string) => page.locator("article").filter({ hasText: name });

test("lists uploaded documents with their status and actions on desktop, mobile and in Spanish", async ({ browserWithDiagnostics: browser }) => {
  // First use compiles the page, upload, OCR and list routes in the dev server.
  test.setTimeout(240_000);
  const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const owner = await ownerContext.newPage();
  await signIn(owner, "documents-list-owner@example.com");
  const businessId = await createApprovedBusiness(browser, owner, "E2E Documents List Harbour");

  // Loading the page first also makes another bundle create the shared in-memory repositories.
  await owner.goto(`/business/${businessId}/documents?locale=en`);
  await expect(owner.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
  await expect(owner.getByText("No documents yet.")).toBeVisible();
  await expect(owner.getByRole("main").getByRole("link", { name: "Upload an invoice" }).last()).toHaveAttribute("href", `/business/${businessId}/upload?locale=en`);

  const read = pdf("read-invoice.pdf", "documents-list-read");
  const readUpload = await uploadThroughApi(owner, businessId, read);
  expect(readUpload.status, readUpload.body).toBe(201);
  const readId = (JSON.parse(readUpload.body) as { id: string }).id;
  const processed = await browserApiRequest(owner, `/api/documents/${readId}/process`, { method: "POST", data: {} });
  expect(processed.status, processed.body).toBe(202);
  const waitingUpload = await uploadThroughApi(owner, businessId, pdf("waiting-invoice.pdf", "documents-list-waiting"));
  expect(waitingUpload.status, waitingUpload.body).toBe(201);

  // A real duplicate (not stubbed) must answer 409, not 500, in the memory-mode dev server.
  const duplicate = await uploadThroughApi(owner, businessId, { ...read, name: "read-invoice-again.pdf" });
  expect(duplicate.status, duplicate.body).toBe(409);
  expect(JSON.parse(duplicate.body)).toMatchObject({ error: { code: "DOCUMENT_DUPLICATE_CHECKSUM" } });

  const listed = await browserApiRequest(owner, `/api/businesses/${businessId}/documents`);
  expect(listed.status, listed.body).toBe(200);
  expect(listed.body).not.toContain("privateObjectKey");
  const documents = (JSON.parse(listed.body) as { documents: { id: string; status: string; invoiceId: string | null; canRetry: boolean }[] }).documents;
  expect(documents).toHaveLength(2);
  const readInvoiceId = documents.find((document) => document.id === readId)?.invoiceId;
  expect(readInvoiceId).toBeTruthy();

  await owner.goto(`/business/${businessId}?locale=en`);
  await owner.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Documents" }).click();
  await expect(owner).toHaveURL(new RegExp(`/business/${businessId}/documents\\?locale=en`));

  const readRow = row(owner, "read-invoice.pdf");
  await expect(readRow).toContainText("Needs review");
  await expect(readRow.getByRole("link", { name: "Open review" })).toHaveAttribute("href", `/business/${businessId}/invoices/${readInvoiceId}?locale=en`);
  await expect(readRow.getByRole("link", { name: "Download read-invoice.pdf" })).toHaveAttribute("href", `/api/documents/${readId}/download`);
  const waitingRow = row(owner, "waiting-invoice.pdf");
  await expect(waitingRow).toContainText("Waiting to be read");
  await expect(waitingRow.getByRole("link", { name: "Download waiting-invoice.pdf" })).toBeVisible();
  for (const name of ["Open review", "Read again", "Fill in by hand"]) {
    await expect(waitingRow.getByRole(name === "Open review" ? "link" : "button", { name })).toHaveCount(0);
  }
  await expect(owner.getByRole("button", { name: "Read again" })).toHaveCount(0);

  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.reload();
  await expect(row(owner, "read-invoice.pdf")).toBeVisible();
  const overflow = await owner.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const target of await owner.getByRole("main").locator("article a").all()) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const openReview = row(owner, "read-invoice.pdf").getByRole("link", { name: "Open review" });
  await openReview.focus();
  await owner.keyboard.press("Tab");
  await owner.keyboard.press("Shift+Tab");
  await expect(openReview).toBeFocused();
  expect(await openReview.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");

  await owner.goto(`/business/${businessId}/documents?locale=es`);
  await expect(owner.getByRole("heading", { name: "Documentos", level: 1 })).toBeVisible();
  await expect(row(owner, "read-invoice.pdf")).toContainText("Necesita revisión");
  await expect(row(owner, "read-invoice.pdf").getByRole("link", { name: "Abrir revisión" })).toHaveAttribute("href", `/business/${businessId}/invoices/${readInvoiceId}?locale=es`);
  await expect(row(owner, "waiting-invoice.pdf")).toContainText("Pendiente de lectura");
  await expect(row(owner, "waiting-invoice.pdf").getByRole("link", { name: "Descargar waiting-invoice.pdf" })).toBeVisible();

  const outsiderContext = await browser.newContext();
  const outsider = await outsiderContext.newPage();
  await signIn(outsider, "documents-list-outsider@example.com");
  const blocked = await browserApiRequest(outsider, `/api/businesses/${businessId}/documents`);
  expect(blocked.status).toBe(403);
  expect(blocked.body).not.toContain("read-invoice.pdf");

  await outsiderContext.close();
  await ownerContext.close();
});
