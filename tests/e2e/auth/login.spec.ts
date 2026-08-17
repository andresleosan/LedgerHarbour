import { expect, test } from "@playwright/test";

test("renders the English login and completes the test email flow without demo copy", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Bring clarity to every ledger." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to home" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with email" })).toBeVisible();
  await expect(page.getByText("Development simulation")).toHaveCount(0);
  await expect(page.getByText(/Demo account/i)).toHaveCount(0);

  await page.getByLabel("Work email").fill("admin@admin.com");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
  await expect.poll(async () => {
    const sessionCookie = (await context.cookies()).find(
      ({ name }) => name === "ledgerharbour_dev_session",
    );
    return sessionCookie
      ? {
          httpOnly: sessionCookie.httpOnly,
          sameSite: sessionCookie.sameSite,
          path: sessionCookie.path,
        }
      : null;
  }).toEqual({ httpOnly: true, sameSite: "Lax", path: "/" });

  await page.getByLabel("Work email").fill("not-an-email");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.locator("#auth-error")).toContainText("Enter a valid email address.");

  await page.getByRole("button", { name: "Espanol" }).click();
  await expect(page.getByRole("heading", { name: "Claridad para cada libro contable." })).toBeVisible();
  await expect(page.getByText("Inicia sesión para mantener tu trabajo financiero en un espacio tranquilo y auditable.")).toBeVisible();
  await expect(page.getByText("o", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Bring clarity to every ledger." })).toBeVisible();

  await context.close();
});

test("keeps the login usable without horizontal overflow on mobile", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Bring clarity to every ledger." })).toBeVisible();
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", await page.evaluate(() => document.documentElement.clientWidth));

  await context.close();
});

test("renders register without demo status and generic auth failure states", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Start with a clear workspace." })).toBeVisible();
  await expect(page.getByText("Development mode only. No production account will be created.")).toHaveCount(0);
  await expect(page.getByLabel("Work email")).toBeVisible();

  await page.goto("/login");
  await page.getByLabel("Work email").fill("missing@development.ledgerharbour.local");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.locator("#auth-error")).toContainText("We could not find an active identity.");

  await page.getByLabel("Work email").fill("failure@development.ledgerharbour.local");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.locator("#auth-error")).toContainText("Authentication is temporarily unavailable.");

  await context.close();
});
