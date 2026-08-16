import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

async function createBusiness(page: import("@playwright/test").Page, name: string) {
  await page.goto("/onboarding/create-business");
  await page.getByLabel("Business name").fill(name);
  await page.getByRole("button", { name: "Create business" }).click();
  const status = page.getByRole("status");
  await expect(status).toContainText(name);
  const businessId = (await status.textContent())?.match(/business-[\w-]+/)?.[0];
  expect(businessId).toBeTruthy();
  return businessId as string;
}

test("verifies the local MVP critical path and cross-tenant access block", async ({ browser }) => {
  const ownerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const owner = await ownerContext.newPage();
  await signIn(owner, "task11-owner@example.com");
  const businessId = await createBusiness(owner, "Task Eleven Harbour");

  await owner.goto(`/business/${businessId}?locale=en`);
  await expect(owner.getByRole("heading", { name: "Task Eleven Harbour" })).toBeVisible();
  await expect(owner.getByRole("main").getByText("Documents")).toBeVisible();
  await expect(owner.getByRole("main").getByText("Invoices needing review")).toBeVisible();
  await expect(owner.getByText("0", { exact: true }).first()).toBeVisible();

  await owner.goto(`/business/${businessId}/upload`);
  await owner.locator('input[type="file"]').setInputFiles({
    name: "task11-invoice.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF\n"),
  });
  await owner.getByRole("button", { name: "Upload document" }).click();
  await expect(owner.getByRole("status")).toContainText("uploaded");
  const download = owner.getByRole("link", { name: "Download task11-invoice.pdf" });
  const downloadHref = await download.getAttribute("href");
  expect(downloadHref).toMatch(/\/api\/documents\/.+\/download/);

  const documentId = downloadHref?.match(/documents\/([^/]+)\/download/)?.[1];
  expect(documentId).toBeTruthy();

  const processResponsePromise = owner.waitForResponse((response) => response.url().endsWith(`/api/documents/${documentId}/process`) && response.request().method() === "POST");
  await owner.getByRole("button", { name: "Process with OCR" }).click();
  const processResponse = await processResponsePromise;
  expect(processResponse.status()).toBe(202);
  await expect(processResponse.json()).resolves.toMatchObject({ job: { documentId, status: "completed" } });
  await expect(owner).toHaveURL(`/business/${businessId}/invoices?locale=en`);

  const reviewLink = owner.getByRole("link", { name: "Open review" });
  await expect(reviewLink).toHaveCount(1);
  const reviewHref = await reviewLink.getAttribute("href");
  expect(reviewHref).toMatch(new RegExp(`/business/${businessId}/invoices/[^?]+\\?locale=en`));
  const invoiceId = reviewHref?.match(/invoices\/([^?]+)\?/)?.[1];
  expect(invoiceId).toBeTruthy();

  const directReviewResponse = await owner.evaluate(async (id) => {
    const response = await fetch(`/api/invoices/${id}/review`);
    return { status: response.status, body: await response.json() };
  }, invoiceId);
  expect(directReviewResponse.status).toBe(200);
  expect(directReviewResponse.body.invoice).toMatchObject({ id: invoiceId, reviewState: "needs_review" });

  const reviewResponse = owner.waitForResponse((response) => response.url().endsWith(`/api/invoices/${invoiceId}/review`) && response.request().method() === "GET");
  await reviewLink.click();
  expect((await reviewResponse).status()).toBe(200);
  await expect(owner).toHaveURL(`/business/${businessId}/invoices/${invoiceId}?locale=en`);
  await owner.goto(`/business/${businessId}/invoices/${invoiceId}?locale=es`);
  await expect(owner).toHaveURL(`/business/${businessId}/invoices/${invoiceId}?locale=es`);
  await expect(owner.getByRole("heading", { name: /Campos extraídos/ })).toBeVisible();
  await expect(owner.getByText(/confianza baja/i).first()).toBeVisible();
  await owner.getByLabel(/proveedor/i).fill("Corrected Supplier");
  await owner.getByLabel(/número de factura/i).fill("TASK-11-001");
  await owner.getByLabel(/notas/i).fill("Reviewed in Task 11");
  const savedResponse = await owner.evaluate(async (id) => {
    const response = await fetch(`/api/invoices/${id}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplier: "Corrected Supplier", invoiceNumber: "TASK-11-001", notes: "Reviewed in Task 11" }),
    });
    return { status: response.status, body: await response.json() };
  }, invoiceId);
  expect(savedResponse.status).toBe(200);
  expect(savedResponse.body).toMatchObject({ supplier: "Corrected Supplier", invoiceNumber: "TASK-11-001", notes: "Reviewed in Task 11" });

  const approveResponse = await owner.evaluate(async (id) => {
    const response = await fetch(`/api/invoices/${id}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    return { status: response.status, body: await response.json() };
  }, invoiceId);
  expect(approveResponse.status).toBe(200);
  expect(approveResponse.body).toMatchObject({ reviewState: "approved" });

  const approvedReview = await owner.evaluate(async (url) => (await fetch(url)).json(), `/api/invoices/${invoiceId}/review`) as { invoice: { reviewState: string; notes: string; supplier: string } };
  expect(approvedReview.invoice.reviewState).toBe("approved");
  const editAfterApproval = await owner.evaluate(async (url) => {
    const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: "Should not change" }) });
    return { status: response.status, body: await response.json() };
  }, `/api/invoices/${invoiceId}/review`);
  expect(editAfterApproval.status).toBe(409);
  expect((await owner.evaluate(async (url) => (await fetch(url)).json(), `/api/invoices/${invoiceId}/review`)).invoice).toMatchObject({ reviewState: "approved", notes: "Reviewed in Task 11", supplier: "Corrected Supplier" });

  await owner.goto(`/business/${businessId}/invoices?locale=es`);
  await expect(owner.getByRole("heading", { name: /Facturas/ })).toBeVisible();
  await expect(owner.getByRole("link", { name: "Español" })).toBeVisible();

  await owner.goto(`/business/${businessId}/upload?locale=es`);
  await expect(owner.getByRole("heading", { name: "Sube un documento de factura" })).toBeVisible();
  await owner.getByRole("button", { name: "English" }).focus();
  await expect(owner.getByRole("button", { name: "English" })).toBeFocused();
  await expect(owner.getByRole("button", { name: "English" })).toHaveCSS("outline-style", "solid");
  await owner.emulateMedia({ reducedMotion: "reduce" });
  expect(await owner.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  expect(await owner.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await owner.evaluate(() => document.documentElement.clientWidth),
  );

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signIn(other, "task11-other@example.com");
  const otherBusinessId = await createBusiness(other, "Task Eleven Other Harbour");
  await other.goto(`/business/${businessId}`);
  await expect(other).toHaveURL(/\/portfolio$/);
  const crossTenantReview = other.waitForResponse((response) => response.url().endsWith(`/api/invoices/${invoiceId}/review`) && response.request().method() === "GET");
  await other.goto(`/business/${businessId}/invoices/${invoiceId}`);
  expect((await crossTenantReview).status()).toBe(403);
  const crossTenant = await other.evaluate(async (url) => {
    const response = await fetch(url);
    return response.status;
  }, downloadHref as string);
  expect(crossTenant).toBe(403);
  expect(otherBusinessId).not.toBe(businessId);

  await ownerContext.close();
  await otherContext.close();
});
