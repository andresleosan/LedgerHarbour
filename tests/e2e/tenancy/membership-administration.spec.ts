import { expect, test } from "@playwright/test";
import { withPlatformAdmin } from "../helpers/business";
import { browserApiRequest } from "../helpers/browser-api";

test.describe.configure({ mode: "serial" });

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

type E2EMember = { membershipId: string; userId: string; role: string; capabilities: string[] };

async function readMembers(page: import("@playwright/test").Page, businessId: string): Promise<E2EMember[]> {
  const response = await browserApiRequest(page, `/api/businesses/${businessId}/members/list`);
  expect(response.status).toBe(200);
  return JSON.parse(response.body) as E2EMember[];
}

test("owner and General Admin manage roles, transfer ownership, and localize member settings", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await signIn(owner, "task6-owner@example.com");
  await owner.goto("/onboarding/create-business");
  await owner.getByLabel("Business name").fill("Task Six Harbour");
  await owner.getByRole("button", { name: "Submit request" }).click();
  const businessId = (await owner.getByRole("status").textContent())?.match(/business-[\w-]+/)?.[0];
  if (!businessId) throw new Error("Business creation did not return an id");
  await withPlatformAdmin(browser, async (admin) => {
    const approval = await browserApiRequest(admin, `/api/platform/businesses/${businessId}/approve`, {
      method: "POST",
      data: { serviceExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), reason: "E2E membership setup" },
    });
    expect(approval.status).toBe(200);
  }, "platform-admin-membership@example.com");

  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await signIn(member, "task6-member@example.com");
  await member.goto("/onboarding/join-business");
  await member.getByLabel("Search by business name").fill("Task Six Harbour");
  await member.getByRole("button", { name: "Search businesses" }).click();
  await member.getByRole("button", { name: "Request to join" }).click();
  await expect(member.getByRole("status")).toContainText("Request submitted");
  const secondMemberContext = await browser.newContext();
  const secondMember = await secondMemberContext.newPage();
  await signIn(secondMember, "task6-second-member@example.com");
  await secondMember.goto("/onboarding/join-business");
  await secondMember.getByLabel("Search by business name").fill("Task Six Harbour");
  await secondMember.getByRole("button", { name: "Search businesses" }).click();
  await secondMember.getByRole("button", { name: "Request to join" }).click();
  await expect(secondMember.getByRole("status")).toContainText("Request submitted");
  const thirdMemberContext = await browser.newContext();
  const thirdMember = await thirdMemberContext.newPage();
  await signIn(thirdMember, "task6-third-member@example.com");
  await thirdMember.goto("/onboarding/join-business");
  await thirdMember.getByLabel("Search by business name").fill("Task Six Harbour");
  await thirdMember.getByRole("button", { name: "Search businesses" }).click();
  await thirdMember.getByRole("button", { name: "Request to join" }).click();
  await expect(thirdMember.getByRole("status")).toContainText("Request submitted");
  await owner.goto(`/business/${businessId}/members`);
  await owner.getByRole("button", { name: "Approve request" }).first().click();
  await expect(owner.getByRole("button", { name: "Approve request" })).toHaveCount(2);
  await owner.getByRole("button", { name: "Approve request" }).first().click();
  await expect(owner.getByRole("button", { name: "Approve request" })).toHaveCount(1);
  await owner.getByRole("button", { name: "Approve request" }).click();

  await owner.goto(`/business/${businessId}/settings/members`);
  await expect(owner.getByRole("heading", { name: "Manage members" })).toBeVisible();
  const membersBeforeRoleChanges = await readMembers(owner, businessId);
  const administratorIds = membersBeforeRoleChanges
    .filter((candidate) => candidate.role === "administrator")
    .map((candidate) => candidate.userId);
  expect(administratorIds).toHaveLength(3);
  const memberCard = owner.locator("article").filter({ hasText: administratorIds[0] });
  const secondMemberCard = owner.locator("article").filter({ hasText: administratorIds[1] });
  await memberCard.getByRole("button", { name: "Make General Admin" }).click();
  await expect(owner.getByText("General Admin", { exact: true })).toBeVisible();
  await memberCard.getByRole("button", { name: "Remove General Admin" }).click();
  await expect(owner.getByText("General Admin", { exact: true })).toHaveCount(0);
  await secondMemberCard.getByRole("button", { name: "Make General Admin" }).click();
  await expect(owner.getByText("General Admin", { exact: true })).toBeVisible();
  await owner.setViewportSize({ width: 375, height: 812 });
  await owner.emulateMedia({ reducedMotion: "reduce" });
  expect(await owner.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await owner.getByRole("link", { name: "English" }).focus();
  await owner.keyboard.press("Tab");
  expect(await owner.evaluate(() => {
    const element = document.activeElement;
    return element ? getComputedStyle(element).outlineStyle : "none";
  })).toBe("solid");
  expect(await owner.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await owner.evaluate(() => document.documentElement.clientWidth),
  );
  const ownerViewAfterRoleChanges = await readMembers(owner, businessId);
  const transferTargetId = ownerViewAfterRoleChanges.find((candidate) => candidate.role === "general_admin")?.userId;
  if (!transferTargetId) throw new Error("General Admin target was not returned by the safe member DTO");
  const staleTransfer = await browserApiRequest(owner, `/api/businesses/${businessId}/ownership/transfer`, {
    method: "POST",
    data: {
      targetMembershipId: transferTargetId,
      confirmationName: "Task Six Harbour",
      reauthenticatedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    },
  });
  expect(staleTransfer.status).toBe(400);
  expect(JSON.parse(staleTransfer.body)).toMatchObject({ error: { code: "CONFIRMATION_REQUIRED" } });

  await secondMember.goto(`/business/${businessId}/settings/members`);
  await expect(secondMember.getByRole("button", { name: "Transfer ownership" })).toHaveCount(0);
  await expect(secondMember.getByRole("button", { name: "Remove General Admin" })).toHaveCount(0);
  await expect(secondMember.getByRole("button", { name: "Remove Administrator" })).toHaveCount(1);
  const generalAdminMembers = await readMembers(secondMember, businessId);
  const ownerMember = generalAdminMembers.find((candidate) => candidate.role === "owner_admin");
  const generalAdmin = generalAdminMembers.find((candidate) => candidate.role === "general_admin");
  if (!ownerMember || !generalAdmin) throw new Error("Expected Owner and General Admin memberships");
  const blockedOwnerChange = await browserApiRequest(secondMember, `/api/businesses/${businessId}/members/${ownerMember.membershipId}`, {
    method: "PATCH",
    data: { action: "remove_administrator" },
  });
  expect(blockedOwnerChange.status).toBe(400);
  expect(JSON.parse(blockedOwnerChange.body)).toMatchObject({ error: { code: "OWNER_PROTECTED" } });
  const blockedGeneralAdminChange = await browserApiRequest(secondMember, `/api/businesses/${businessId}/members/${generalAdmin.membershipId}`, {
    method: "PATCH",
    data: { action: "remove_general_admin" },
  });
  expect(blockedGeneralAdminChange.status).toBe(403);
  expect(JSON.parse(blockedGeneralAdminChange.body)).toMatchObject({ error: { code: "INSUFFICIENT_CAPABILITY" } });
  await secondMember.getByRole("button", { name: "Remove Administrator" }).click();
  await expect(secondMember.getByText("Administrator", { exact: true })).toHaveCount(0);

  await owner.goto(`/business/${businessId}/settings/members`);
  await expect(owner.getByRole("button", { name: "Transfer ownership" })).toHaveCount(1);
  await owner.getByRole("button", { name: "Transfer ownership" }).click();
  await owner.getByLabel("Business name confirmation").fill("wrong");
  await owner.getByRole("button", { name: "Confirm transfer" }).click();
  await expect(owner.getByText(/exact current business name/)).toBeVisible();
  await owner.getByRole("link", { name: "Español" }).click();
  await owner.getByRole("button", { name: "Confirmar transferencia" }).click();
  await expect(owner.getByText(/Introduce el nombre actual exacto/)).toBeVisible();
  await owner.getByRole("link", { name: "English" }).click();
  await owner.getByLabel("Business name confirmation").fill("Task Six Harbour");
  await owner.getByRole("button", { name: "Confirm transfer" }).click();
  await expect(owner.getByRole("status")).toContainText("Ownership transferred.");

  const transferredMembers = await readMembers(secondMember, businessId);
  expect(transferredMembers.find((candidate) => candidate.userId === ownerMember.userId)?.role).toBe("administrator");
  expect(transferredMembers.find((candidate) => candidate.userId === transferTargetId)?.role).toBe("owner_admin");

  await owner.getByRole("link", { name: "Español" }).click();
  await expect(owner.getByRole("heading", { name: "Gestionar miembros" })).toBeVisible();
  await expect(owner.locator("html")).toHaveJSProperty("scrollWidth", await owner.evaluate(() => document.documentElement.clientWidth));

  await ownerContext.close();
  await memberContext.close();
  await secondMemberContext.close();
  await thirdMemberContext.close();
});

test("inactive business blocks join and review operations and preserves member state", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const page = await ownerContext.newPage();
  await signIn(page, "task6-lifecycle@example.com");
  await page.goto("/onboarding/create-business");
  await page.getByLabel("Business name").fill("Task Six Lifecycle");
  await page.getByRole("button", { name: "Submit request" }).click();
  const businessId = (await page.getByRole("status").textContent())?.match(/business-[\w-]+/)?.[0];
  if (!businessId) throw new Error("Business creation did not return an id");
  await withPlatformAdmin(browser, async (admin) => {
    const approval = await browserApiRequest(admin, `/api/platform/businesses/${businessId}/approve`, {
      method: "POST",
      data: { serviceExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), reason: "E2E lifecycle setup" },
    });
    expect(approval.status).toBe(200);
  }, "platform-admin-membership-lifecycle@example.com");

  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await signIn(member, "task6-lifecycle-member@example.com");
  await member.goto("/onboarding/join-business");
  await member.getByLabel("Search by business name").fill("Task Six Lifecycle");
  await member.getByRole("button", { name: "Search businesses" }).click();
  await member.getByRole("button", { name: "Request to join" }).click();
  await expect(member.getByRole("status")).toContainText("Request submitted");
  await page.goto(`/business/${businessId}/members`);
  await page.getByRole("button", { name: "Approve request" }).click();

  const pendingContext = await browser.newContext();
  const pendingPage = await pendingContext.newPage();
  await signIn(pendingPage, "task6-pending-member@example.com");
  const pendingResponse = await browserApiRequest(pendingPage, `/api/businesses/${businessId}/join-requests`, {
    method: "POST",
    data: { requestedRole: "administrator" },
  });
  expect(pendingResponse.status).toBe(201);
  const pending = JSON.parse(pendingResponse.body) as { id: string };

  const suspended = await withPlatformAdmin(browser, (admin) => browserApiRequest(admin, `/api/platform/businesses/${businessId}/suspend`, {
    method: "POST",
    data: { reason: "E2E inactive business coverage" },
  }), "platform-admin-membership-lifecycle@example.com");
  expect(suspended.status).toBe(200);

  const blockedContext = await browser.newContext();
  const blockedPage = await blockedContext.newPage();
  await signIn(blockedPage, "task6-inactive-new@example.com");
  const blockedJoin = await browserApiRequest(blockedPage, `/api/businesses/${businessId}/join-requests`, {
    method: "POST",
    data: { requestedRole: "administrator" },
  });
  const blockedJoinPayload = JSON.parse(blockedJoin.body);
  expect(blockedJoinPayload).toMatchObject({ error: { code: "INACTIVE_BUSINESS" } });
  expect(blockedJoin.status).toBe(400);
  const blockedReview = await browserApiRequest(page, `/api/businesses/${businessId}/join-requests`);
  expect(blockedReview.status).toBe(403);
  expect(JSON.parse(blockedReview.body)).toMatchObject({ error: { code: "INSUFFICIENT_CAPABILITY" } });
  const blockedReviewMutation = await browserApiRequest(page, `/api/businesses/${businessId}/join-requests`, {
    method: "PATCH",
    data: { joinRequestId: pending.id, decision: "approved" },
  });
  expect(blockedReviewMutation.status).toBe(403);

  const reactivated = await withPlatformAdmin(browser, (admin) => browserApiRequest(admin, `/api/platform/businesses/${businessId}/reactivate`, {
    method: "POST",
    data: { reason: "E2E lifecycle restoration" },
  }), "platform-admin-membership-lifecycle@example.com");
  expect(reactivated.status).toBe(200);
  const preservedMembers = await readMembers(page, businessId);
  expect(preservedMembers).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: "owner_admin" }),
    expect.objectContaining({ role: "administrator" }),
  ]));
  const reviewed = await browserApiRequest(page, `/api/businesses/${businessId}/join-requests`, {
    method: "PATCH",
    data: { joinRequestId: pending.id, decision: "approved" },
  });
  expect(reviewed.status).toBe(200);

  await ownerContext.close();
  await memberContext.close();
  await pendingContext.close();
  await blockedContext.close();
});
