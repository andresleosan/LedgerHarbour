import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

test("platform approval and suspension gates business administrator access", async ({ browser }) => {
  const owner = await browser.newPage();
  await signIn(owner, "task4-owner@example.com");
  await owner.goto("/onboarding/create-business");
  await owner.getByLabel("Business name").fill("E2E Administrator Harbour");
  await owner.getByRole("button", { name: "Submit request" }).click();
  const status = owner.getByRole("status");
  await expect(status).toContainText("awaiting platform approval");
  const businessId = (await status.textContent())?.match(/business-[\w-]+/)?.[0];
  expect(businessId).toBeTruthy();

  const platformAdmin = await browser.newPage();
  await signIn(platformAdmin, "platform-admin@example.com");
  const claim = await platformAdmin.evaluate(async () => (await fetch("/api/platform/businesses")).status);
  expect(claim).toBe(200);
  const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const approval = await platformAdmin.evaluate(async ({ id, expiry }) => {
    const response = await fetch(`/api/platform/businesses/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceExpiresAt: expiry }),
    });
    return response.status;
  }, { id: businessId, expiry });
  expect(approval).toBe(200);

  const member = await browser.newPage();
  await signIn(member, "task4-member@example.com");
  const request = await member.evaluate(async (id) => {
    const response = await fetch(`/api/businesses/${id}/join-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedRole: "administrator" }),
    });
    return { status: response.status, body: await response.json() };
  }, businessId);
  expect(request.status).toBe(201);

  const review = await owner.evaluate(async ({ id, requestId }) => {
    const response = await fetch(`/api/businesses/${id}/join-requests`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joinRequestId: requestId, decision: "approved" }),
    });
    return response.status;
  }, { id: businessId, requestId: request.body.id });
  expect(review).toBe(200);

  const administrators = await platformAdmin.evaluate(async () => {
    const response = await fetch("/api/platform/administrators");
    return { status: response.status, body: await response.json() } as { status: number; body: { administrators: Array<{ membershipId: string; userId: string; email: string | null }> } };
  });
  expect(administrators.status).toBe(200);
  const target = administrators.body.administrators.find((item) => item.email === "task4-member@example.com");
  expect(target).toBeTruthy();

  const suspended = await platformAdmin.evaluate(async (membershipId) => {
    const response = await fetch(`/api/platform/administrators/${membershipId}/suspend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "suspend", reason: "E2E access review" }),
    });
    return response.status;
  }, target?.membershipId);
  expect(suspended).toBe(200);

  const denied = await member.evaluate(async ({ id, membershipId }) => (await fetch(`/api/businesses/${id}/members/${membershipId}`)).status, {
    id: businessId,
    membershipId: target?.membershipId,
  });
  expect(denied).toBe(403);

  await owner.close();
  await member.close();
  await platformAdmin.close();
});
