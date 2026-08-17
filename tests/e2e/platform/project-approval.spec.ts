import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

test("creates a pending project, approves it globally, and applies parent suspension", async ({ browser }) => {
  const requester = await browser.newPage();
  await signIn(requester, "task5-requester@example.com");
  const businessResponse = await requester.evaluate(async () => {
    const response = await fetch("/api/businesses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "E2E Project Harbour" }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(businessResponse.status).toBe(201);
  const businessId = businessResponse.body.id as string;

  const admin = await browser.newPage();
  await signIn(admin, "platform-admin@example.com");
  const businessApproval = await admin.evaluate(async (id) => {
    const response = await fetch(`/api/platform/businesses/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() }),
    });
    return { status: response.status, body: await response.json() };
  }, businessId);
  expect(businessApproval.status).toBe(200);

  const request = await requester.evaluate(async (id) => {
    const response = await fetch(`/api/businesses/${id}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "E2E Pending Project" }),
    });
    return { status: response.status, body: await response.json() };
  }, businessId);
  expect(request.status).toBe(201);
  expect(request.body.status).toBe("pending");

  const rejectedRequest = await requester.evaluate(async (id) => {
    const response = await fetch(`/api/businesses/${id}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "E2E Rejected Project" }),
    });
    return { status: response.status, body: await response.json() };
  }, businessId);
  expect(rejectedRequest.status).toBe(201);

  await admin.goto("/admin/projects");
  const rejectedRow = admin.locator("li").filter({ hasText: "E2E Rejected Project" });
  await rejectedRow.getByLabel("Reason to reject E2E Rejected Project").fill("E2E rejection reason");
  await rejectedRow.getByRole("button", { name: "Reject E2E Rejected Project" }).click();
  await expect(rejectedRow).toContainText("rejected");

  const pendingRow = admin.locator("li").filter({ hasText: "E2E Pending Project" });
  await pendingRow.getByRole("button", { name: "Approve E2E Pending Project" }).click();
  await expect(pendingRow).toContainText("active");

  const lifecycleRequest = await requester.evaluate(async (id) => {
    const response = await fetch(`/api/businesses/${id}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "E2E Lifecycle Project" }),
    });
    return { status: response.status, body: await response.json() };
  }, businessId);
  expect(lifecycleRequest.status).toBe(201);

  await admin.goto("/admin/projects");
  const lifecycleRow = admin.locator("li").filter({ hasText: "E2E Lifecycle Project" });
  await lifecycleRow.getByRole("button", { name: "Approve E2E Lifecycle Project" }).click();
  await expect(lifecycleRow).toContainText("active");
  await lifecycleRow.getByLabel("Reason to suspend E2E Lifecycle Project").fill("E2E suspension reason");
  await lifecycleRow.getByRole("button", { name: "Suspend E2E Lifecycle Project" }).click();
  await expect(lifecycleRow).toContainText("suspended");
  await lifecycleRow.getByLabel("Reason to reactivate E2E Lifecycle Project").fill("E2E reactivation reason");
  await lifecycleRow.getByRole("button", { name: "Reactivate E2E Lifecycle Project" }).click();
  await expect(lifecycleRow).toContainText("active");

  const suspension = await admin.evaluate(async (id) => {
    const response = await fetch(`/api/platform/businesses/${id}/suspend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "E2E parent suspension" }),
    });
    return response.status;
  }, businessId);
  expect(suspension).toBe(200);

  const access = await requester.evaluate(async (id) => {
    const response = await fetch(`/api/businesses/${id}/projects`);
    return response.status;
  }, businessId);
  expect(access).toBe(403);
  await requester.close();
  await admin.close();
});
