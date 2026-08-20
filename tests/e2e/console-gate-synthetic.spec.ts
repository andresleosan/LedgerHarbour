import { expect, test } from "./fixtures";

test.describe("browser console gate", () => {
  test("fails on a synthetic console.error", async ({ browserWithDiagnostics }) => {
    test.fail();
    const page = await browserWithDiagnostics.newPage();
    await page.goto("/login");
    await page.evaluate(() => console.error("LH-002 synthetic console error"));
  });

  test("fails on a synthetic pageerror", async ({ browserWithDiagnostics }) => {
    test.fail();
    const page = await browserWithDiagnostics.newPage();
    await page.goto("/login");
    const pageError = page.waitForEvent("pageerror");
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("LH-002 synthetic page error");
      }, 0);
    });
    await expect(pageError).resolves.toMatchObject({ message: "LH-002 synthetic page error" });
  });

  test("fails on a console.error from the auto page fixture", async ({ page }) => {
    test.fail();
    await page.goto("/login");
    await page.evaluate(() => console.error("LH-002 auto page fixture error"));
  });

  test("fails on a pageerror from a page created by the auto context fixture", async ({ context }) => {
    test.fail();
    const page = await context.newPage();
    await page.goto("/login");
    const pageError = page.waitForEvent("pageerror");
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("LH-002 auto context fixture error");
      }, 0);
    });
    await expect(pageError).resolves.toMatchObject({ message: "LH-002 auto context fixture error" });
  });

  test("fails on a console.error from a page created by browserWithDiagnostics.newContext", async ({ browserWithDiagnostics }) => {
    test.fail();
    const context = await browserWithDiagnostics.newContext();
    const page = await context.newPage();
    await page.goto("/login");
    await page.evaluate(() => console.error("LH-002 wrapper context console error"));
  });
});
