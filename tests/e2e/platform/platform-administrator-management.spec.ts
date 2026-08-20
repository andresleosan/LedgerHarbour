import { expect, test } from "../fixtures";
import type { Page } from "@playwright/test";
import { browserApiRequest } from "../helpers/browser-api";

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

test("adds, claims, and removes a platform administrator", async ({ browserWithDiagnostics: browser }) => {
  const admin = await browser.newPage();
  const addedAdmin = await browser.newPage();
  const email = `task-final-added-${Date.now()}@example.com`;

  try {
    await signIn(admin, "platform-admin@example.com");
    await admin.goto("/admin/administrators");
    await admin.getByLabel("Email").last().fill(email);
    await admin.getByLabel("Reason").last().fill("Final operator onboarding");
    await admin.getByRole("button", { name: "Add platform administrator" }).click();
    const record = admin.locator("[data-testid='platform-admin-record']").filter({ hasText: email });
    await expect(record).toContainText("Active");
    await expect(record).toContainText("Unlinked; claim pending");

    await signIn(addedAdmin, email);
    const claimedBusinesses = await addedAdmin.evaluate(async () => {
      const response = await fetch("/api/platform/businesses");
      return { status: response.status, body: await response.json() };
    });
    expect(claimedBusinesses.status).toBe(200);

    await record.getByRole("button", { name: new RegExp(`Remove ${email}`) }).click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByLabel("Reason").fill("Final operator offboarding");
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(record).toContainText("Inactive");

    const deniedAfterRemoval = await browserApiRequest(addedAdmin, "/api/platform/businesses");
    expect(deniedAfterRemoval.status).toBe(403);

    await expect(record.getByRole("button", { name: new RegExp(`Remove ${email}`) })).toHaveCount(0);
  } finally {
    await admin.close();
    await addedAdmin.close();
  }
});
