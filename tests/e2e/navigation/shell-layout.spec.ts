import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures";
import { createApprovedBusiness } from "../helpers/business";

const firstCompile = { timeout: 90_000 };

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test("workspace navigation is a sidebar on desktop and a bottom tab bar on the phone", async ({ page, browserWithDiagnostics: browser }) => {
  const suffix = Date.now().toString();
  await signIn(page, `shell-${suffix}@example.com`);
  const businessId = await createApprovedBusiness(browser, page, `Shell Books ${suffix}`);
  const workspace = page.getByRole("navigation", { name: "Workspace" });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/business/${businessId}?locale=en`);
  await expect(page.getByRole("heading", { level: 1, name: `Shell Books ${suffix}` })).toBeVisible(firstCompile);
  const sidebar = await workspace.boundingBox();
  const main = await page.getByRole("main").boundingBox();
  expect(sidebar && main && sidebar.x + sidebar.width <= main.x).toBe(true);
  await expect(page.locator(".business-switcher").getByRole("link", { name: `Shell Books ${suffix}` })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Nothing here yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add invoice photos" })).toHaveAttribute("href", `/business/${businessId}/upload?locale=en`);
  await expectNoHorizontalOverflow(page);

  await page.goto(`/business/${businessId}/settings/workbook?locale=en`);
  const settings = page.getByRole("navigation", { name: "Settings" });
  await expect(settings.getByRole("link")).toHaveCount(6, firstCompile);
  await expect(settings.getByRole("link", { name: "Workbook" })).toHaveAttribute("aria-current", "page");
  await expect(workspace.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  await settings.getByRole("link", { name: "Currencies" }).click();
  await expect(page).toHaveURL(`/business/${businessId}/settings/currencies?locale=en`, firstCompile);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/business/${businessId}/movements?locale=en`);
  await expect(page.getByRole("heading", { level: 1, name: "Movements" })).toBeVisible(firstCompile);
  const bar = await workspace.boundingBox();
  expect(bar && Math.round(bar.y + bar.height)).toBe(844);
  for (const name of ["Upload", "Invoices / review", "Documents", "Movements", "Year", "Settings"]) {
    await expect(workspace.getByRole("link", { name, exact: true })).toBeInViewport();
  }
  await expect(workspace.getByRole("link", { name: "Movements", exact: true })).toHaveAttribute("aria-current", "page");
  await expectNoHorizontalOverflow(page);
  await workspace.getByRole("link", { name: "Year", exact: true }).click();
  await expect(page).toHaveURL(`/business/${businessId}/year?locale=en`, firstCompile);
  await expectNoHorizontalOverflow(page);
});
