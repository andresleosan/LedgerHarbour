import { expect, test } from "@playwright/test";

test("root page starts in English with a locale switcher", async ({ request }) => {
  const response = await request.get("/");
  const html = await response.text();

  expect(response.ok()).toBe(true);
  expect(html).toContain("LedgerHarbour");
  expect(html).toContain("Less inbox. More control.");
  expect(html).toContain("Enter workspace");
  expect(html).toContain("Create account");
  expect(html).toContain("OCR");
  expect(html).toContain('href="/?locale=es"');
});

test("root page renders Spanish when requested", async ({ request }) => {
  const response = await request.get("/?locale=es");
  const html = await response.text();

  expect(response.ok()).toBe(true);
  expect(html).toContain("Menos bandeja de entrada. Mas control.");
  expect(html).toContain("Entrar al workspace");
  expect(html).toContain('href="/?locale=en"');
  expect(html).toContain('href="/login?locale=es"');
});
