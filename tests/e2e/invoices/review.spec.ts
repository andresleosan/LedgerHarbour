import { buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";
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

  test("a load error on the review follows a later language change", async ({ page }) => {
    await signIn(page);
    // Answered inside the page, so the expected 404 is not a browser network error.
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
        if (url.includes("/api/invoices/missing-invoice/review")) return new Response(JSON.stringify({ error: { code: "INVOICE_NOT_FOUND" } }), { status: 404, headers: { "Content-Type": "application/json" } });
        if (url.includes("/api/businesses/demo-business/")) return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
        return originalFetch(input, init);
      };
    });
    await page.goto("/business/demo-business/invoices/missing-invoice?locale=en");
    const loadError = page.locator("main .page-error");
    await expect(loadError).toHaveText("This invoice is no longer available.");
    await page.getByRole("link", { name: "Español" }).first().click();
    await expect(page).toHaveURL(/locale=es/);
    await expect(loadError).toHaveText("Esta factura ya no está disponible.");
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

  test("review saves and approves through the real review API without errors", async ({ page, browserWithDiagnostics: browser }) => {
    const suffix = Date.now().toString();
    await page.goto("/login");
    await page.getByLabel("Work email").fill(`review-${suffix}@example.com`);
    await page.getByRole("button", { name: "Continue with email" }).click();
    await expect(page.getByRole("status")).toContainText("Signed in as");
    const businessId = await createApprovedBusiness(browser, page, `Review Books ${suffix}`);
    // Approval needs a code from the business's chart of accounts, which comes from its template.
    const template = await browserApiRequest(page, `/api/businesses/${businessId}/template`, {
      method: "POST",
      multipart: { file: { name: "accounts.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await buildSyntheticTemplate() } },
    });
    expect(template.status).toBeLessThan(300);

    await page.goto(`/business/${businessId}/upload?locale=en`);
    await page.locator('input[type="file"][multiple]').setInputFiles({
      name: "review-invoice.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF\n"),
    });
    await expect(page.getByRole("listitem").filter({ hasText: "review-invoice.pdf" }).getByRole("status")).toContainText("Ready for review");
    await page.getByRole("link", { name: "Review invoices" }).click();
    await expect(page).toHaveURL(new RegExp(`/business/${businessId}/invoices/[^/?]+\\?locale=en$`));
    await expect(page.getByRole("heading", { name: "Extracted fields" })).toBeVisible();
    await expect(page.getByText(/low confidence/i).first()).toBeVisible();

    await page.getByLabel(/supplier/i).fill("Corrected Supplier");
    await page.getByLabel(/invoice number/i).fill("REVIEW-001");
    await page.getByLabel(/notes/i).fill("Checked by finance");
    await page.getByLabel("Code", { exact: true }).selectOption({ label: "Premises" });
    await page.getByRole("button", { name: "Save correction" }).click();
    await expect(page.getByRole("status")).toContainText("Correction saved.");
    await expect(page.locator(".page-error")).toHaveCount(0);
    await expect(page.getByLabel(/supplier/i)).toHaveValue("Corrected Supplier");

    await page.getByRole("button", { name: "Approve invoice" }).click();
    await page.getByLabel("Not paid yet").check();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Invoice approved.");
    await expect(page.locator(".page-error")).toHaveCount(0);
    await expect(page.getByLabel(/notes/i)).toBeDisabled();
    await expect(page.getByRole("button", { name: "Approve invoice" })).toBeDisabled();

    await page.reload();
    await expect(page.getByLabel(/notes/i)).toHaveValue("Checked by finance");
    await expect(page.getByLabel(/notes/i)).toBeDisabled();
  });
});
