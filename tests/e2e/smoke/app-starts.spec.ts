import { expect, test } from "@playwright/test";

test("root page starts with LedgerHarbour branding", async ({ request }) => {
  const response = await request.get("/");

  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain("LedgerHarbour");
});
