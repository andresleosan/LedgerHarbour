import { expect, test } from "@playwright/test";

const forbiddenCopy = /open demo|demo account|development simulation|simulated google|fake ocr/i;

test("public landing and auth pages contain no demo copy", async ({ page }) => {
  for (const path of ["/", "/login", "/register"]) {
    await page.goto(path);
    await expect(page.locator("body")).not.toContainText(forbiddenCopy);
  }
});
