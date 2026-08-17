import { expect, type Browser, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

export async function createApprovedBusiness(browser: Browser, page: Page, name: string) {
  await page.goto("/onboarding/create-business");
  await page.getByLabel("Business name").fill(name);
  await page.getByRole("button", { name: "Submit request" }).click();
  const status = page.getByRole("status");
  await expect(status).toContainText(name);
  const businessId = (await status.textContent())?.match(/business-[\w-]+/)?.[0];
  expect(businessId).toBeTruthy();

  await withPlatformAdmin(browser, async (admin) => {
    const claim = await admin.request.post("/api/platform/claim");
    expect(claim.status()).toBe(200);
    const approval = await admin.request.post(`/api/platform/businesses/${businessId}/approve`, {
      data: { serviceExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() },
    });
    expect(approval.status(), await approval.text()).toBe(200);
  });

  return businessId as string;
}

export async function withPlatformAdmin<T>(browser: Browser, callback: (page: Page) => Promise<T>) {
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  try {
    await signIn(admin, "platform-admin@example.com");
    return await callback(admin);
  } finally {
    await adminContext.close();
  }
}
