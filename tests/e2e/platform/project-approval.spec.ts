import { expect, test } from "../fixtures";
import { browserApiRequest } from "../helpers/browser-api";

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

async function createProjectFromTenantView(page: import("@playwright/test").Page, businessId: string, name: string) {
  await page.goto(`/business/${businessId}/projects`);
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Submit request" }).click();
  const projectCard = page.locator("li.project-row").filter({ hasText: name });
  await expect(projectCard.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(projectCard.locator(".project-status")).toHaveText("Pending approval");
}

test("creates a pending project, approves it globally, and applies parent suspension", async ({ browserWithDiagnostics: browser }) => {
  const requester = await browser.newPage();
  await signIn(requester, "task5-requester@example.com");
  await requester.goto("/onboarding/create-business");
  await requester.getByLabel("Business name").fill("E2E Project Harbour");
  await requester.getByRole("button", { name: "Submit request" }).click();
  const businessCreated = await requester.getByRole("status").textContent();
  const businessId = businessCreated?.match(/Business ID: ([^\s.]+)/)?.[1];
  expect(businessId).toBeTruthy();
  if (!businessId) throw new Error("Business creation did not return a business ID");

  const admin = await browser.newPage();
  await signIn(admin, "platform-admin@example.com");
  const businessApproval = await admin.evaluate(async (id) => {
    const response = await fetch(`/api/platform/businesses/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), reason: "E2E project setup" }),
    });
    return { status: response.status, body: await response.json() };
  }, businessId);
  expect(businessApproval.status).toBe(200);

  await createProjectFromTenantView(requester, businessId, "E2E Pending Project");
  await createProjectFromTenantView(requester, businessId, "E2E Rejected Project");

  await admin.goto("/admin/projects");
  const rejectedRow = admin.getByRole("row").filter({ hasText: "E2E Rejected Project" });
  await rejectedRow.getByRole("button", { name: "Reject E2E Rejected Project" }).click();
  await admin.getByRole("dialog").getByLabel("Reason").fill("E2E rejection reason");
  await admin.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(rejectedRow).toContainText("Rejected");

  const pendingRow = admin.getByRole("row").filter({ hasText: "E2E Pending Project" });
  await pendingRow.getByRole("button", { name: "Approve E2E Pending Project" }).click();
  await admin.getByRole("dialog").getByLabel("Reason").fill("E2E pending approval reason");
  await admin.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(pendingRow).toContainText("Active");

  await createProjectFromTenantView(requester, businessId, "E2E Lifecycle Project");

  await admin.goto("/admin/projects");
  const lifecycleRow = admin.getByRole("row").filter({ hasText: "E2E Lifecycle Project" });
  await lifecycleRow.getByRole("button", { name: "Approve E2E Lifecycle Project" }).click();
  await admin.getByRole("dialog").getByLabel("Reason").fill("E2E lifecycle approval reason");
  await admin.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(lifecycleRow).toContainText("Active");
  await lifecycleRow.getByRole("button", { name: "Suspend E2E Lifecycle Project" }).click();
  await admin.getByRole("dialog").getByLabel("Reason").fill("E2E suspension reason");
  await admin.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(lifecycleRow).toContainText("Suspended");
  await lifecycleRow.getByRole("button", { name: "Reactivate E2E Lifecycle Project" }).click();
  await admin.getByRole("dialog").getByLabel("Reason").fill("E2E reactivation reason");
  await admin.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(lifecycleRow).toContainText("Active");

  const suspension = await admin.evaluate(async (id) => {
    const response = await fetch(`/api/platform/businesses/${id}/suspend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "E2E parent suspension" }),
    });
    return response.status;
  }, businessId);
  expect(suspension).toBe(200);

  const access = await browserApiRequest(requester, `/api/businesses/${businessId}/projects`);
  expect(access.status).toBe(403);
  await requester.close();
  await admin.close();
});
