import { expect, test } from "../fixtures";

test.use({ viewport: { width: 390, height: 844 } });

test("keeps the Spanish platform panel usable on mobile", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Espanol" }).click();
  await page.getByLabel("Correo de trabajo").fill("platform-admin-mobile@example.com");
  await page.getByRole("button", { name: "Continuar con correo" }).click();
  await expect(page.getByRole("status")).toContainText("Sesión iniciada");
  await page.goto("/admin?locale=es");

  await expect(page.getByRole("heading", { name: "Administración de plataforma" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Negocios" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Proyectos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Administradores" })).toBeVisible();
  await page.getByRole("link", { name: "Negocios", exact: true }).focus();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).not.toBe("none");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
