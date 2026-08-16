import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page, email = "portfolio-shell@example.com") {
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

test("authenticates, switches authorized businesses, preserves locale, and keeps inactive businesses non-selectable", async ({ page }) => {
  await signIn(page);
  const firstName = `Portfolio Books ${Date.now()}`;
  const secondName = `Portfolio Studio ${Date.now()}`;
  const inactiveName = `Portfolio Closed ${Date.now()}`;
  const firstId = await createBusiness(page, firstName);
  const secondId = await createBusiness(page, secondName);
  const inactiveId = await createBusiness(page, inactiveName);

  const lifecycleResponse = await page.request.patch(`/api/businesses/${inactiveId}/lifecycle`, {
    data: { action: "deactivate", confirmationName: inactiveName },
  });
  expect(lifecycleResponse.ok()).toBeTruthy();

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
