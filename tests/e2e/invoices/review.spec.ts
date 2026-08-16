import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("invoice-review-shell@example.com");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

test.describe("invoice review workspace", () => {
  test("invoice list exposes filters, language controls, and responsive focus states", async ({ page }) => {
    await signIn(page);
    await page.goto("/business/demo-business/invoices");

    await expect(page.getByRole("heading", { name: /invoices|facturas/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /needs review|necesita revisión/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /approved|aprobadas/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /failed|fallidas/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /espanol|english/i }).first()).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("main.invoice-list-page")).toBeVisible();
  });

  test("settings routes expose category and currency controls", async ({ page }) => {
    await signIn(page);
    await page.goto("/business/demo-business/settings/categories");
    await expect(page.getByRole("heading", { name: /categories|categorías/i })).toBeVisible();
    await expect(page.getByLabel(/category name|nombre de categoría/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /create|crear/i })).toBeVisible();

    await page.goto("/business/demo-business/settings/currencies");
    await expect(page.getByRole("heading", { name: /currencies|monedas/i })).toBeVisible();
    await expect(page.getByLabel(/currency name|nombre de moneda/i)).toBeVisible();
    await expect(page.getByLabel(/symbol|símbolo/i)).toBeVisible();
    await expect(page.getByLabel(/decimal places|decimales/i)).toBeVisible();
    await expect(page.getByLabel(/iso code|código ISO/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /create|crear/i })).toBeVisible();
  });

  test("settings pages support real category and currency mutations with localized conflicts", async ({ page }) => {
    await signIn(page);
    const suffix = Date.now().toString();
    await page.goto("/login");
    await page.getByLabel(/work email|correo de trabajo/i).fill(`settings-${suffix}@example.com`);
    await page.getByRole("button", { name: /continue with email|continuar con correo/i }).click();
    await expect(page.getByRole("status")).toBeVisible();

    await page.goto("/onboarding/create-business");
    const businessResponse = page.waitForResponse((response) => response.url().endsWith("/api/businesses") && response.request().method() === "POST");
    await page.getByLabel(/business name|nombre del negocio/i).fill(`Settings Books ${suffix}`);
    await page.getByRole("button", { name: /create business|crear negocio/i }).click();
    const createdBusiness = await (await businessResponse).json() as { id: string };

    await page.goto(`/business/${createdBusiness.id}/settings/categories`);
    const categoryName = `E2E Category ${suffix}`;
    await page.getByLabel(/category name|nombre de categoría/i).fill(categoryName);
    await page.getByRole("button", { name: /create category|crear categoría/i }).click();
    await expect(page.getByText(categoryName)).toBeVisible();
    await page.getByLabel(/category name|nombre de categoría/i).fill(categoryName);
    await page.getByRole("button", { name: /create category|crear categoría/i }).click();
    await expect(page.locator("#categories-error")).toContainText(/already exists|ya existe/i);
    const categoryItem = page.locator("article").filter({ hasText: categoryName });
    page.once("dialog", (dialog) => void dialog.accept("Renamed Category"));
    await categoryItem.getByRole("button", { name: /rename|renombrar/i }).click();
    await expect(page.getByText("Renamed Category")).toBeVisible();
    const renamedCategoryItem = page.locator("article").filter({ hasText: "Renamed Category" });
    page.once("dialog", (dialog) => void dialog.accept());
    await renamedCategoryItem.getByRole("button", { name: /deactivate|desactivar/i }).click();
    await expect(renamedCategoryItem).toContainText(/inactive|inactiva/i);

    await page.goto(`/business/${createdBusiness.id}/settings/currencies`);
    const currencyName = `E2E Currency ${suffix}`;
    await page.getByLabel(/currency name|nombre de moneda/i).fill(currencyName);
    await page.getByLabel(/symbol|símbolo/i).fill("EC");
    await page.getByLabel(/iso code|código ISO/i).fill("EAB");
    await page.getByRole("button", { name: /create currency|crear moneda/i }).click();
    await expect(page.getByText(currencyName)).toBeVisible();
    const currencyItem = page.locator("article").filter({ hasText: currencyName });
    page.once("dialog", (dialog) => void dialog.accept());
    await currencyItem.getByRole("button", { name: /deactivate|desactivar/i }).click();
    await expect(currencyItem).toContainText(/inactive|inactiva/i);
  });

  test("review supports low-confidence correction, save, approval, and approved immutability", async ({ page }) => {
    await signIn(page);
    const invoice = {
      id: "demo-invoice",
      reviewState: "needs_review",
      supplier: "Harbour Supplier",
      invoiceNumber: "INV-42",
      invoiceDate: "2026-08-11",
      dueDate: null,
      subtotal: "100.00",
      taxAmount: "20.00",
      total: "120.00",
      currencyReference: "GBP",
      expenseCategoryReference: null,
      notes: "",
      confidenceData: { supplier: .6, invoiceNumber: 1, invoiceDate: 1, dueDate: 1, subtotal: 1, taxAmount: 1, total: 1, currencyReference: 1, expenseCategoryReference: 1, notes: 1 },
    };
    let corrected = false;
    await page.route("**/api/invoices/demo-invoice/review", async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ invoice, document: { originalFileName: "invoice.pdf", originalMimeType: "application/pdf" }, documentDownloadUrl: "/download" }) });
        return;
      }
       const body = request.postDataJSON() as { action?: string; notes?: string; supplier?: string };
      if (body.action === "approve" && corrected) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ invoice: { ...invoice, reviewState: "approved" }, document: { originalFileName: "invoice.pdf", originalMimeType: "application/pdf" }, documentDownloadUrl: "/download" }) });
        return;
      }
      if (body.action === "approve") {
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "INVOICE_INVALID_FOR_APPROVAL" } }) });
        return;
      }
      if (body.supplier === "Corrected Supplier") {
        corrected = true;
        invoice.confidenceData.supplier = 1;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ invoice: { ...invoice, notes: body.notes ?? "" }, document: { originalFileName: "invoice.pdf", originalMimeType: "application/pdf" }, documentDownloadUrl: "/download" }) });
    });

    await page.goto("/business/demo-business/invoices/demo-invoice");
    await expect(page.getByText(/low confidence/i)).toBeVisible();
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /approve invoice|aprobar factura/i }).click();
    await expect(page.locator(".error")).toContainText(/complete required fields|completa los campos/i);
    await page.getByLabel(/supplier|proveedor/i).fill("Corrected Supplier");
    await page.getByLabel(/notes/i).fill("Checked by finance");
    await page.getByRole("button", { name: /save correction|guardar corrección/i }).click();
    await expect(page.getByRole("status")).toContainText(/saved|guardada/i);
    await page.getByRole("button", { name: /approve invoice|aprobar factura/i }).click();
    await expect(page.getByRole("status")).toContainText(/approved|aprobada/i);
    await expect(page.getByLabel(/notes/i)).toBeDisabled();
  });
});
