import { expect, test } from "@playwright/test";
import { createApprovedBusiness, withPlatformAdmin } from "../helpers/business";
import { browserApiRequest } from "../helpers/browser-api";

async function signIn(page: import("@playwright/test").Page, email = "portfolio-shell@example.com") {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

test("authenticates, switches authorized businesses, preserves locale, and keeps inactive businesses non-selectable", async ({ page, browser }) => {
  await signIn(page);
  const firstName = `Portfolio Books ${Date.now()}`;
  const secondName = `Portfolio Studio ${Date.now()}`;
  const inactiveName = `Portfolio Closed ${"LongBusinessName".repeat(12)} ${Date.now()}`;
  const platformAdminEmail = "platform-admin-switcher@example.com";
  const firstId = await createApprovedBusiness(browser, page, firstName, platformAdminEmail);
  const secondId = await createApprovedBusiness(browser, page, secondName, platformAdminEmail);
  const inactiveId = await createApprovedBusiness(browser, page, inactiveName, platformAdminEmail);

  const lifecycleResponse = await withPlatformAdmin(browser, (admin) => browserApiRequest(admin, `/api/platform/businesses/${inactiveId}/suspend`, {
    method: "POST",
    data: { reason: "E2E inactive business coverage" },
  }), platformAdminEmail);
  expect(lifecycleResponse.status).toBe(200);

  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: new RegExp(firstName) })).toBeVisible();
  await expect(page.getByRole("article", { name: new RegExp(secondName) })).toBeVisible();
  const inactiveCard = page.getByRole("article", { name: new RegExp(inactiveName) });
  await expect(inactiveCard).toContainText("Inactive");
  await expect(inactiveCard.getByRole("link")).toHaveCount(0);

  await page.getByRole("link", { name: new RegExp(firstName) }).click();
  await expect(page).toHaveURL(`/business/${firstId}?locale=en`);
  await expect(page.getByRole("heading", { name: firstName })).toBeVisible();
  await expect(page.getByRole("main").getByText("Documents")).toBeVisible();
  await expect(page.getByText("0").first()).toBeVisible();

  await page.getByRole("link", { name: secondName }).click();
  await expect(page).toHaveURL(`/business/${secondId}?locale=en`);
  await expect(page.getByRole("heading", { name: secondName })).toBeVisible();

  const switcher = page.locator(".business-switcher");
  await expect(switcher.getByText(inactiveName)).toBeVisible();
  await expect(switcher.getByText(inactiveName).locator(".." ).getByRole("link")).toHaveCount(0);
  await expect(page.locator(".shell-nav a").filter({ hasText: "Upload" })).toHaveAttribute("href", `/business/${secondId}/upload?locale=en`);
  await expect(page.locator(".shell-nav a").filter({ hasText: "Invoices / review" })).toHaveAttribute("href", `/business/${secondId}/invoices?locale=en`);
  await expect(page.locator(".shell-nav a").filter({ hasText: "Settings" })).toHaveAttribute("href", `/business/${secondId}/settings/members?locale=en`);
  const metadataContrast = await page.locator(".business-option-meta").first().evaluate((element) => {
    const channels = getComputedStyle(element).color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    const luminance = (rgb: number[]) => rgb.map((channel) => channel / 255).map((channel) => channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const foreground = luminance(channels);
    const background = 1;
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
  });
  expect(metadataContrast).toBeGreaterThanOrEqual(4.5);

  await page.getByRole("link", { name: "Español" }).click();
  await expect(page).toHaveURL(`/business/${secondId}?locale=es`);
  await expect(page.getByRole("heading", { name: secondName })).toBeVisible();
  await expect(page.getByRole("main").getByText("Documentos")).toBeVisible();
  await expect(page.locator(".shell-nav a").filter({ hasText: "Cargar" })).toHaveAttribute("href", `/business/${secondId}/upload?locale=es`);
  await page.getByRole("link", { name: "Cargar" }).click();
  await expect(page).toHaveURL(`/business/${secondId}/upload?locale=es`);
  await expect(page.getByRole("heading", { name: "Sube un documento de factura" })).toBeVisible();
  await expect(page.locator(".language-switcher")).toHaveCount(1);
  await expect(page.locator(".toolbar")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Español" })).toHaveAttribute("href", /locale=es/);

  await page.route(`**/api/businesses/${secondId}/documents`, async (route) => {
    await route.fulfill({ json: { id: "fix-round-1-document", originalFileName: "invoice.pdf", status: "uploaded" } });
  });
  await page.route("**/api/documents/fix-round-1-document/process", async (route) => {
    await route.fulfill({ json: {} });
  });
  await page.goto(`/business/${secondId}/upload?locale=es&source=review`);
  await page.locator("#invoice-file").setInputFiles({ name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") });
  await page.getByRole("button", { name: "Subir documento" }).click();
  await expect(page.getByRole("status")).toContainText("uploaded");
  await page.getByRole("button", { name: "Procesar con OCR" }).click();
  await expect(page).toHaveURL(`/business/${secondId}/invoices?locale=es&source=review`);
  await expect(page.getByRole("navigation", { name: "Configuración financiera" })).toBeVisible();
  await page.locator(".page-back").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(".invoice-settings a").first()).toBeFocused();
  const darkSurfaceFocusContrast = await page.locator(".invoice-settings a").first().evaluate((element) => {
    const parseRgb = (value: string) => value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    const luminance = (rgb: number[]) => rgb.map((channel) => channel / 255).map((channel) => channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const foreground = luminance(parseRgb(getComputedStyle(element).outlineColor));
    const background = luminance(parseRgb(getComputedStyle(element.closest(".invoice-hero") as Element).backgroundColor));
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
  });
  expect(darkSurfaceFocusContrast).toBeGreaterThanOrEqual(4.5);

  await page.goto(`/business/${secondId}/upload?locale=es`);
  await expect(page.locator(".business-option-name").filter({ hasText: inactiveName })).toHaveCSS("overflow-wrap", "anywhere");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  await expect(page.locator(".language-switcher")).toHaveCSS("transition-duration", "1e-05s");
  await expect(page.locator("html")).toHaveJSProperty(
    "scrollWidth",
    await page.evaluate(() => document.documentElement.clientWidth),
  );
});
