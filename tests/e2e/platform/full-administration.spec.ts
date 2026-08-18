import { expect, test, type Page } from "@playwright/test";

type ApiResult = { status: number; body: unknown };

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

async function api(page: Page, path: string, options: { method?: string; body?: unknown } = {}): Promise<ApiResult> {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let responseBody: unknown = null;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }
    return { status: response.status, body: responseBody };
  }, { path, method: options.method, body: options.body });
}

function expectSafeDto(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(/password|token|secret|privateObjectKey|documentBytes|credential/i);
}

test("runs the complete platform administration lifecycle with test-only providers", async ({ browser }) => {
  const owner = await browser.newPage();
  const platformAdmin = await browser.newPage();
  const administrator = await browser.newPage();

  try {
    await signIn(owner, "task8-owner@example.com");
    await owner.goto("/onboarding/create-business");
    await owner.getByLabel("Business name").fill("Task 8 Full Administration Harbour");
    await owner.getByRole("button", { name: "Submit request" }).click();

    const requestStatus = owner.getByRole("status");
    await expect(requestStatus).toContainText("awaiting platform approval");
    const businessId = (await requestStatus.textContent())?.match(/business-[\w-]+/)?.[0];
    expect(businessId).toBeTruthy();
    if (!businessId) throw new Error("Business request did not return a business ID");

    const pendingProjects = await api(owner, `/api/businesses/${businessId}/projects`);
    expect(pendingProjects.status).toBe(403);

    await signIn(platformAdmin, "platform-admin@example.com");
    const businessApproval = await api(platformAdmin, `/api/platform/businesses/${businessId}/approve`, {
      method: "POST",
      body: {
        serviceExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        reason: "Task 8 release verification business approval",
      },
    });
    expect(businessApproval.status).toBe(200);
    expect(businessApproval.body).toMatchObject({ business: { id: businessId, status: "active" } });
    expectSafeDto(businessApproval.body);

    const projectRequest = await api(owner, `/api/businesses/${businessId}/projects`, {
      method: "POST",
      body: { name: "Task 8 Approved Project" },
    });
    expect(projectRequest.status).toBe(201);
    expect(projectRequest.body).toMatchObject({ businessId, status: "pending", isActive: false });
    expectSafeDto(projectRequest.body);
    const projectId = (projectRequest.body as { id?: string }).id;
    expect(projectId).toBeTruthy();
    if (!projectId) throw new Error("Project request did not return a project ID");

    const projectApproval = await api(platformAdmin, `/api/platform/projects/${projectId}/approve`, {
      method: "POST",
      body: { reason: "Task 8 release verification project approval" },
    });
    expect(projectApproval.status).toBe(200);
    expect(projectApproval.body).toMatchObject({ project: { id: projectId, status: "active", isActive: true } });
    expectSafeDto(projectApproval.body);

    await signIn(administrator, "task8-administrator@example.com");
    const joinRequest = await api(administrator, `/api/businesses/${businessId}/join-requests`, {
      method: "POST",
      body: { requestedRole: "administrator" },
    });
    expect(joinRequest.status).toBe(201);
    expect(joinRequest.body).toMatchObject({ businessId, status: "pending", requestedRole: "administrator" });
    const joinRequestId = (joinRequest.body as { id?: string }).id;
    expect(joinRequestId).toBeTruthy();
    if (!joinRequestId) throw new Error("Administrator request did not return a request ID");

    const internalApproval = await api(owner, `/api/businesses/${businessId}/join-requests`, {
      method: "PATCH",
      body: { joinRequestId, decision: "approved" },
    });
    expect(internalApproval.status).toBe(200);
    expect(internalApproval.body).toMatchObject({ id: joinRequestId, status: "approved" });

    const administratorQueue = await api(platformAdmin, "/api/platform/administrators");
    expect(administratorQueue.status).toBe(200);
    const administratorEntry = (administratorQueue.body as { administrators?: Array<{ membershipId: string; userId: string; email: string | null; status: string; isActive: boolean }> }).administrators?.find(
      (entry) => entry.email === "task8-administrator@example.com",
    );
    expect(administratorEntry).toMatchObject({ status: "active", isActive: true });
    expectSafeDto(administratorQueue.body);

    const projectMembership = await api(owner, `/api/businesses/${businessId}/projects/${projectId}/members`, {
      method: "POST",
      body: { userId: administratorEntry?.userId, role: "member" },
    });
    expect(projectMembership.status).toBe(201);
    expectSafeDto(projectMembership.body);

    const auditBeforeSuspension = await api(platformAdmin, "/api/platform/audit-events");
    expect(auditBeforeSuspension.status).toBe(200);
    expect(auditBeforeSuspension.body).toMatchObject({ events: expect.arrayContaining([
      expect.objectContaining({ action: "business_approved", targetId: businessId }),
      expect.objectContaining({ action: "project_approved", targetId: projectId }),
    ]) });
    expectSafeDto(auditBeforeSuspension.body);

    const suspension = await api(platformAdmin, `/api/platform/businesses/${businessId}/suspend`, {
      method: "POST",
      body: { reason: "Task 8 release verification manual suspension" },
    });
    expect(suspension.status).toBe(200);
    expect(suspension.body).toMatchObject({ business: { id: businessId, status: "suspended" } });
    expectSafeDto(suspension.body);

    const deniedAccess = await Promise.all([
      api(owner, `/api/businesses/${businessId}/projects`),
      api(administrator, `/api/businesses/${businessId}/projects`),
      api(administrator, `/api/businesses/${businessId}/join-requests?mine=true`),
      api(owner, `/api/businesses/${businessId}/projects/${projectId}/members`),
      api(owner, `/api/businesses/${businessId}/members/${administratorEntry?.membershipId}`),
    ]);
    expect(deniedAccess.map(({ status }) => status)).toEqual([403, 403, 400, 403, 409]);
    expect(deniedAccess[2].body).toMatchObject({ error: { code: "INACTIVE_BUSINESS" } });

    const reactivation = await api(platformAdmin, `/api/platform/businesses/${businessId}/reactivate`, {
      method: "POST",
      body: { reason: "Task 8 release verification reactivation" },
    });
    expect(reactivation.status).toBe(200);
    expect(reactivation.body).toMatchObject({ business: { id: businessId, status: "active" } });
    expectSafeDto(reactivation.body);

    const restoredOwnerAccess = await api(owner, `/api/businesses/${businessId}/projects`);
    expect(restoredOwnerAccess.status).toBe(200);
    expect(restoredOwnerAccess.body).toMatchObject({ projects: expect.arrayContaining([
      expect.objectContaining({ id: projectId, status: "active", isActive: true }),
    ]) });
    const restoredAdministratorAccess = await api(administrator, `/api/businesses/${businessId}/join-requests?mine=true`);
    expect(restoredAdministratorAccess.status).toBe(200);
    expect(restoredAdministratorAccess.body).toEqual([{ status: "approved" }]);

    const auditAfterReactivation = await api(platformAdmin, "/api/platform/audit-events");
    expect(auditAfterReactivation.body).toMatchObject({ events: expect.arrayContaining([
      expect.objectContaining({ action: "business_suspended", targetId: businessId, reason: "Task 8 release verification manual suspension" }),
      expect.objectContaining({ action: "business_reactivated", targetId: businessId, reason: "Task 8 release verification reactivation" }),
    ]) });
    expectSafeDto(auditAfterReactivation.body);

    const onboardingLogout = await browser.newPage();
    try {
      await signIn(onboardingLogout, "task8-onboarding-logout@example.com");
      await onboardingLogout.goto("/onboarding");
      await onboardingLogout.getByRole("button", { name: "Sign out" }).click();
      await expect(onboardingLogout).toHaveURL(/\/login(?:\?|$)/);
      await expect.poll(async () => (await onboardingLogout.context().cookies()).some(({ name }) => name === "ledgerharbour_firebase_session")).toBe(false);
    } finally {
      await onboardingLogout.close();
    }

    await owner.goto("/portfolio");
    await expect(owner.getByRole("button", { name: "Sign out" })).toBeVisible();
    await owner.getByRole("button", { name: "Sign out" }).click();
    await expect(owner).toHaveURL(/\/login(?:\?|$)/);
    await expect.poll(async () => (await owner.context().cookies()).some(({ name }) => name === "ledgerharbour_firebase_session")).toBe(false);
  } finally {
    await owner.close();
    await platformAdmin.close();
    await administrator.close();
  }
});
