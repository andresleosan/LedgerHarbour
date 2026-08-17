import { expect, test } from "@playwright/test";

test("logs out from onboarding, clears the session, and redirects to login", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("logout-onboarding@example.com");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");

  await page.goto("/onboarding");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Bring clarity to every ledger." })).toBeVisible();
  await expect.poll(async () =>
    (await context.cookies()).some(({ name }) => name === "ledgerharbour_firebase_session"),
  ).toBe(false);
});
