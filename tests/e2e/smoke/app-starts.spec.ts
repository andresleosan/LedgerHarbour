import { expect, test } from "@playwright/test";

test("root page starts with LedgerHarbour branding", async ({ request }) => {
  const response = await request.get("/");
  const html = await response.text();

  expect(response.ok()).toBe(true);
  expect(html).toContain("LedgerHarbour");
  expect(html).toContain("Entrar al workspace");
  expect(html).toContain("Crear cuenta");
  expect(html).toContain("OCR");
});
