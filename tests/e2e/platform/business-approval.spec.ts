import { expect, test } from "../fixtures";
import { browserApiRequest } from "../helpers/browser-api";

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

test("submits a business request and requires platform approval before operation", async ({ browserWithDiagnostics: browser }) => {
  const requester = await browser.newPage();
  await signIn(requester, "task3-requester@example.com");
  await requester.goto("/onboarding/create-business");
  await requester.getByLabel("Business name").fill("E2E Approval Harbour");
  await requester.getByRole("button", { name: "Submit request" }).click();
  const requestStatus = requester.getByRole("status");
  await expect(requestStatus).toContainText("awaiting platform approval");
  const businessId = (await requestStatus.textContent())?.match(/business-[\w-]+/)?.[0];
  expect(businessId).toBeTruthy();

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
    return { status: response.status, body: await response.json() } as { status: number; body: { businesses?: Array<{ id: string; status: string }> } };
  });
  expect(pending.status, JSON.stringify(pending.body)).toBe(200);
  expect(pending.body.businesses).toContainEqual(expect.objectContaining({ id: businessId, status: "pending" }));

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

  await requester.goto("/portfolio");
  await expect(requester.getByRole("heading", { name: "E2E Approval Harbour" })).toBeVisible();
  await requester.close();
  await admin.close();
});
