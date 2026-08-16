import { expect, test, type APIResponse } from "@playwright/test";

async function expectPng(response: APIResponse) {
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("image/png");
}

test("serves the approved logo and static icon assets", async ({ page, request }) => {
  await page.goto("/");
  const logo = page.getByRole("img", { name: "LedgerHarbour" }).first();
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", /ledgerharbour-logo/);

  await expectPng(await request.get("/brand/ledgerharbour-logo.png"));
  await expectPng(await request.get("/icon.png"));
  await expectPng(await request.get("/apple-icon.png"));
});

test("uses the full logo on login and in the authenticated shell", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("img", { name: "LedgerHarbour" })).toBeVisible();

  await page.getByLabel("Work email").fill("branding-task7@example.com");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");

  await page.goto("/portfolio");
  await expect(page.locator(".shell-brand img")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "LedgerHarbour" })).toBeVisible();
  await expect(page.locator(".shell-brand-mark")).toHaveCount(0);
  await expect(page.getByRole("img", { name: "LedgerHarbour" })).toBeVisible();
});

test("keeps branded surfaces within the viewport on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("img", { name: "LedgerHarbour" }).first()).toBeVisible();
  await expect(page.locator("html")).toHaveJSProperty(
    "scrollWidth",
    await page.evaluate(() => document.documentElement.clientWidth),
  );
});
