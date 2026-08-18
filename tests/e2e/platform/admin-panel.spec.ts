import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

test("allows only active platform administrators into the global panel", async ({ browser }) => {
  const ordinary = await browser.newPage();
  await signIn(ordinary, "task6-ordinary@example.com");
  await ordinary.goto("/admin");
  await expect(ordinary).toHaveURL(/\/portfolio/);
  await ordinary.close();

  const platformAdmin = await browser.newPage();
  await signIn(platformAdmin, "platform-admin-panel@example.com");
  await platformAdmin.goto("/admin");

  await expect(platformAdmin.getByRole("heading", { name: "Platform administration" })).toBeVisible();
  await expect(platformAdmin.getByRole("link", { name: "Businesses", exact: true })).toBeVisible();
  await expect(platformAdmin.getByRole("link", { name: "Projects", exact: true })).toBeVisible();
  await expect(platformAdmin.getByRole("link", { name: "Administrators", exact: true })).toBeVisible();
  await expect(platformAdmin.getByRole("heading", { name: "Businesses" })).toBeVisible();
  await expect(platformAdmin.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(platformAdmin.getByRole("heading", { name: "Administrators" })).toBeVisible();
  await expect(platformAdmin.getByRole("table", { name: "Businesses" })).toBeVisible();
  await expect(platformAdmin.getByRole("table", { name: "Projects" })).toBeVisible();
  await expect(platformAdmin.getByRole("table", { name: "Administrators" })).toBeVisible();
  await platformAdmin.close();
});

test("redirects an anonymous continuation request to login", async ({ browser }) => {
  const anonymous = await browser.newPage();

  await anonymous.goto("/auth/continue");

  await expect(anonymous).toHaveURL(/\/login(?:\?|$)/);
  await anonymous.close();
});

test("rejects an invalid Firebase session cookie and redirects continuation to login", async ({ browser }) => {
  const invalidSession = await browser.newPage();
  await invalidSession.context().addCookies([{
    name: "ledgerharbour_firebase_session",
    value: "invalid-firebase-session",
    url: "http://127.0.0.1:3100",
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await expect.poll(async () => (
    await invalidSession.context().cookies()
  ).find(({ name }) => name === "ledgerharbour_firebase_session")?.value).toBe("invalid-firebase-session");

  await invalidSession.goto("/auth/continue");

  await expect(invalidSession).toHaveURL(/\/login(?:\?|$)/);
  await invalidSession.close();
});

test("continues platform administrators to admin and ordinary users to onboarding", async ({ browser }) => {
  const admin = await browser.newPage();
  await signIn(admin, "platform-admin-panel@example.com");
  await admin.goto("/auth/continue");
  await expect(admin).toHaveURL(/\/admin(?:\?|$)/);
  await expect(admin.getByRole("heading", { name: "Platform administration" })).toBeVisible();
  await admin.close();

  const ordinary = await browser.newPage();
  await signIn(ordinary, "post-login-ordinary@example.com");
  await ordinary.goto("/auth/continue");
  await expect(ordinary).toHaveURL(/\/onboarding(?:\?|$)/);
  await ordinary.close();
});

test("confirms a business status action and refreshes the safe server DTO", async ({ browser }) => {
  const requester = await browser.newPage();
  await signIn(requester, "task6-requester@example.com");
  await requester.goto("/onboarding/create-business");
  await requester.getByLabel("Business name").fill("E2E Platform Panel Harbour");
  await requester.getByRole("button", { name: "Submit request" }).click();
  const requestStatus = requester.getByRole("status");
  const businessId = (await requestStatus.textContent())?.match(/business-[\w-]+/)?.[0];
  expect(businessId).toBeTruthy();
  if (!businessId) throw new Error("Business creation did not return a business ID");

  const platformAdmin = await browser.newPage();
  await signIn(platformAdmin, "platform-admin-action@example.com");
  await platformAdmin.goto("/admin/businesses");
  const businessCard = platformAdmin.locator("[data-testid='business-record']").filter({ hasText: "E2E Platform Panel Harbour" });
  await expect(businessCard).toBeVisible();
  await businessCard.getByRole("button", { name: /Approve/ }).click();
  const dialog = platformAdmin.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/service expiration/i)).toBeVisible();
  await expect(dialog.getByLabel(/service expiration/i)).toBeFocused();
  await platformAdmin.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: /Confirm/ })).toBeFocused();
  await platformAdmin.keyboard.press("Escape");
  await expect(businessCard.getByRole("button", { name: /Approve/ })).toBeFocused();
  await businessCard.getByRole("button", { name: /Approve/ }).click();
  await expect(dialog.getByLabel(/service expiration/i)).toBeFocused();
  await dialog.getByLabel(/service expiration/i).fill("2030-01-01");
  await dialog.getByLabel("Reason").fill("Initial approval review");
  let requestCount = 0;
  let requestSeen!: () => void;
  let releaseRequest!: () => void;
  const requestStarted = new Promise<void>((resolve) => { requestSeen = resolve; });
  const requestRelease = new Promise<void>((resolve) => { releaseRequest = resolve; });
  await platformAdmin.route("**/api/platform/businesses/*/approve", async (route) => {
    requestCount += 1;
    requestSeen();
    await requestRelease;
    await route.continue();
  });
  await dialog.getByRole("button", { name: /Confirm/ }).click();
  await requestStarted;
  await platformAdmin.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(requestCount).toBe(1);
  releaseRequest();
  await expect(businessCard).toContainText("Active");
  await expect(businessCard).toContainText("Requester");
  await requester.close();
  await platformAdmin.close();
});
