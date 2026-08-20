import { expect, test } from "../fixtures";
import { createApprovedBusiness } from "../helpers/business";
import { browserApiRequest } from "../helpers/browser-api";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("invoice-review-shell@example.com");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

async function stubFetchResponse(page: import("@playwright/test").Page, path: string, status: number, body: unknown) {
  await page.evaluate(({ path, status, body }) => {
    const originalFetch = window.fetch.bind(window);
    let remaining = 1;
    window.fetch = async (input, init) => {
      const requestUrl = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (remaining > 0 && requestUrl.includes(path)) {
        remaining -= 1;
        return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(input, init);
    };
  }, { path, status, body });
}

test.describe("invoice review workspace", () => {
  test("invoice list exposes filters, language controls, and responsive focus states", async ({ page }) => {
    await signIn(page);
    await page.goto("/business/demo-business/invoices");

    await expect(page.getByRole("heading", { name: /invoices|facturas/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /needs review|necesita revisión/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /approved|aprobadas/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /failed|fallidas/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /español|english/i }).first()).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("main.invoice-list-page")).toBeVisible();
  });

  test("settings routes expose category and currency controls", async ({ page }) => {
    await signIn(page);
    await page.route("**/api/businesses/demo-business/categories", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.route("**/api/businesses/demo-business/currencies", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
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

  test("settings pages support real category and currency mutations with localized conflicts", async ({ page, browserWithDiagnostics: browser }) => {
    await signIn(page);
    const suffix = Date.now().toString();
    await page.goto("/login");
    await page.getByLabel(/work email|correo de trabajo/i).fill(`settings-${suffix}@example.com`);
    await page.getByRole("button", { name: /continue with email|continuar con correo/i }).click();
    await expect(page.getByRole("status")).toBeVisible();

    const createdBusinessId = await createApprovedBusiness(browser, page, `Settings Books ${suffix}`);

    await page.goto(`/business/${createdBusinessId}/settings/categories`);
    const categoryName = `E2E Category ${suffix}`;
    await page.getByLabel(/category name|nombre de categoría/i).fill(categoryName);
    await page.getByRole("button", { name: /create category|crear categoría/i }).click();
    await expect(page.getByText(categoryName)).toBeVisible();
    const duplicateCategory = await browserApiRequest(page, `/api/businesses/${createdBusinessId}/categories`, {
      method: "POST",
      data: { name: categoryName },
    });
    expect(duplicateCategory.status).toBe(409);
    await stubFetchResponse(page, `/api/businesses/${createdBusinessId}/categories`, 409, { error: { code: "CATEGORY_NAME_CONFLICT" } });
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

    await page.goto(`/business/${createdBusinessId}/settings/currencies`);
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
    await page.addInitScript(({ invoice }) => {
      let corrected = false;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const requestUrl = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
        if (!requestUrl.endsWith("/api/invoices/demo-invoice/review")) return originalFetch(input, init);
        const body = init?.body ? JSON.parse(String(init.body)) as { action?: string; notes?: string; supplier?: string } : {};
        if (!init?.method || init.method === "GET") {
          return new Response(JSON.stringify({ invoice, document: { originalFileName: "invoice.pdf", originalMimeType: "application/pdf" }, documentDownloadUrl: "/download" }), { headers: { "Content-Type": "application/json" } });
        }
        if (body.action === "approve" && corrected) {
          return new Response(JSON.stringify({ invoice: { ...invoice, reviewState: "approved" }, document: { originalFileName: "invoice.pdf", originalMimeType: "application/pdf" }, documentDownloadUrl: "/download" }), { headers: { "Content-Type": "application/json" } });
        }
        if (body.action === "approve") {
          return new Response(JSON.stringify({ error: { code: "INVOICE_INVALID_FOR_APPROVAL" } }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        if (body.supplier === "Corrected Supplier") {
          corrected = true;
          invoice.confidenceData.supplier = 1;
        }
        return new Response(JSON.stringify({ invoice: { ...invoice, notes: body.notes ?? "" }, document: { originalFileName: "invoice.pdf", originalMimeType: "application/pdf" }, documentDownloadUrl: "/download" }), { headers: { "Content-Type": "application/json" } });
      };
    }, { invoice });

    await page.goto("/business/demo-business/invoices/demo-invoice");
    await expect(page.getByText(/low confidence/i)).toBeVisible();
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /approve invoice|aprobar factura/i }).click();
    await expect(page.locator(".page-error")).toContainText(/complete required fields|completa los campos/i);
    await page.getByLabel(/supplier|proveedor/i).fill("Corrected Supplier");
    await page.getByLabel(/notes/i).fill("Checked by finance");
    await page.getByRole("button", { name: /save correction|guardar corrección/i }).click();
    await expect(page.getByRole("status")).toContainText(/saved|guardada/i);
    await page.getByRole("button", { name: /approve invoice|aprobar factura/i }).click();
    await expect(page.getByRole("status")).toContainText(/approved|aprobada/i);
    await expect(page.getByLabel(/notes/i)).toBeDisabled();
  });
});
