import { randomUUID } from "node:crypto";

import { relayFetches } from "../documents/relay-fetch";
import { expect, test } from "../fixtures";
import { browserApiRequest } from "../helpers/browser-api";

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

test("submits a business request and requires platform approval before operation", async ({ browserWithDiagnostics: browser }) => {
  const attemptId = randomUUID();
  const ownerEmail = `approval-${attemptId}@example.com`;
  const businessName = `E2E Approval Harbour ${attemptId}`;
  const requester = await browser.newPage();
  await signIn(requester, ownerEmail);
  const submissions = await relayFetches(requester, /^\/api\/businesses$/);
  const submissionStatuses = () => submissions.map(({ status }) => status);
  await requester.goto("/onboarding/create-business");
  await requester.getByLabel("Business name").fill(businessName);
  await requester.getByRole("button", { name: "Submit request" }).click();
  await expect.poll(submissionStatuses, { timeout: 15_000, message: "Original business registration response status" })
    .toEqual([201]);
  const requestStatus = requester.getByRole("status");
  await expect(requestStatus).toContainText("awaiting platform approval");
  const businessId = (await requestStatus.textContent())?.match(/business-[\w-]+/)?.[0];
  expect(businessId).toBeTruthy();

  await requester.getByLabel("Business name").fill(` e2e  approval harbour ${attemptId} `);
  await requester.getByRole("button", { name: "Submit request" }).click();
  await expect.poll(submissionStatuses, { timeout: 15_000, message: "Original and duplicate registration response statuses" })
    .toEqual([201, 409]);
  await expect(requester.getByRole("alert").filter({ hasText: "You already requested a business with this name." }))
    .toBeVisible();

  const beforeApproval = await browserApiRequest(requester, `/api/businesses/${businessId}/documents`, {
    method: "POST",
    multipart: {
      file: {
        name: "pending.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF\n"),
      },
    },
  });
  expect(beforeApproval.status).toBe(403);

  const admin = await browser.newPage();
  await signIn(admin, "platform-admin@example.com");
  const pending = await admin.evaluate(async () => {
    const response = await fetch("/api/platform/businesses");
    return { status: response.status, body: await response.json() } as { status: number; body: { businesses?: Array<{ id: string; name: string; status: string }> } };
  });
  expect(pending.status, JSON.stringify(pending.body)).toBe(200);
  expect(pending.body.businesses?.filter((business) => business.name.toLowerCase() === businessName.toLowerCase())).toEqual([
    expect.objectContaining({ id: businessId, status: "pending" }),
  ]);

  const approval = await admin.evaluate(async (id) => {
    const response = await fetch(`/api/platform/businesses/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), reason: "E2E business approval" }),
    });
    return { status: response.status, body: await response.json() };
  }, businessId);
  expect(approval.status).toBe(200);
  expect(approval.body.business.status).toBe("active");

  await requester.close();

  const returningOwner = await browser.newPage();
  await signIn(returningOwner, ownerEmail);
  // The test adapter stays on /login. Enter the same continuation route as Google sign-in.
  await returningOwner.goto("/auth/continue");
  await expect(returningOwner).toHaveURL(/\/portfolio(?:[?#]|$)/);
  await expect(returningOwner.getByRole("heading", { name: businessName, exact: true })).toBeVisible();
  await returningOwner.close();
  await admin.close();
});
