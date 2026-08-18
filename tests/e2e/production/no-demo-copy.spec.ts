import { expect, test } from "@playwright/test";

const forbiddenCopy = /open demo|demo account|development simulation|simulated google|fake ocr/i;

test("public landing and auth pages contain no demo copy", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Less inbox. More control." })).toBeVisible();
  await page.getByRole("link", { name: "ES", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Menos bandeja de entrada. Mas control." })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(forbiddenCopy);

  await page.goto("/login");
  await page.getByRole("button", { name: "Espanol" }).click();
  await expect(page.getByRole("heading", { name: "Claridad para cada libro contable." })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(forbiddenCopy);

  await page.goto("/register");
  await page.getByRole("button", { name: "Espanol" }).click();
  await expect(page.getByRole("heading", { name: "Empieza con un espacio claro." })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(forbiddenCopy);
});
