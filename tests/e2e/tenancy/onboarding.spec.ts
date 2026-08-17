import { expect, test, type Locator } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

async function expectVisibleFocusRing(locator: Locator) {
  await expect(locator).toBeFocused();
  const focusRing = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) };
  });
  expect(focusRing.outlineStyle).toBe("solid");
  expect(focusRing.outlineWidth).toBeGreaterThanOrEqual(3);
}

async function expectLightModeContrast(page: import("@playwright/test").Page) {
  const samples = await page.locator("body, .flow-card, .description, label, input, button[type='submit'], .back").evaluateAll((elements) => {
    const colorParts = (value: string) => value.match(/[\d.]+/g)?.map(Number) ?? [];
    const solidColor = (element: Element) => {
      let current: Element | null = element;
      while (current) {
        const background = getComputedStyle(current).backgroundColor;
        const parts = colorParts(background);
        if (parts.length >= 3 && (parts[3] ?? 1) > 0) return parts.slice(0, 3);
        current = current.parentElement;
      }
      return [255, 255, 255];
    };
    const linearChannel = (channel: number) => {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (rgb: number[]) => {
      const [red, green, blue] = rgb;
      return linearChannel(red) * 0.2126 + linearChannel(green) * 0.7152 + linearChannel(blue) * 0.0722;
    };
    return elements.map((element) => {
      const foreground = colorParts(getComputedStyle(element).color).slice(0, 3);
      const background = solidColor(element);
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
    });
  });
  for (const ratio of samples) expect(ratio).toBeGreaterThanOrEqual(4.5);
}

test("creates a business from onboarding and shows its identity", async ({ page }) => {
  await signIn(page, "owner-onboarding@example.com");
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Set up your business" })).toBeVisible();
  await page.getByRole("link", { name: "Create a new business" }).click();
  await page.getByLabel("Business name").fill("E2E Harbour Books");
  await page.getByRole("button", { name: "Create business" }).click();
  await expect(page.getByRole("status")).toContainText("E2E Harbour Books");
  await expect(page.getByRole("status")).toContainText("Business ID");
});

test("searches, requests access, approves, rejects, and reapplies", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await signIn(owner, "owner-workflow@example.com");
  await owner.goto("/onboarding/create-business");
  await owner.getByLabel("Business name").fill("E2E Request Harbour");
  await owner.getByRole("button", { name: "Create business" }).click();
  const status = owner.getByRole("status");
  await expect(status).toBeVisible();
  const text = await status.textContent();
  const businessId = text?.match(/business-[\w-]+/)?.[0];
  expect(businessId).toBeTruthy();

  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await signIn(member, "member-workflow@example.com");
  await member.goto("/onboarding/join-business");
  await member.getByLabel("Search by business name").fill("request harbour");
  await member.getByRole("button", { name: "Search businesses" }).click();
  await member.getByRole("button", { name: "Request to join" }).click();
  await expect(member.getByRole("status")).toContainText("Request submitted");

  await signIn(owner, "owner-workflow@example.com");
  await owner.goto(`/business/${businessId}/members`);
  await expect(owner.getByText(/Request from user-/)).toBeVisible();
  await owner.getByRole("button", { name: "Reject request" }).click();
  await expect(owner.getByRole("status")).toContainText("Request rejected");

  await signIn(member, "member-workflow@example.com");
  await member.goto("/onboarding/join-business");
  await member.getByLabel("Search by business name").fill("request harbour");
  await member.getByRole("button", { name: "Search businesses" }).click();
  await expect(member.getByText("Request rejected.")).toBeVisible();
  await member.getByRole("button", { name: "Reapply for Administrator access" }).click();
  await expect(member.getByRole("status")).toContainText("Request submitted");

  await signIn(owner, "owner-workflow@example.com");
  await owner.goto(`/business/${businessId}/members`);
  await owner.getByRole("button", { name: "Approve request" }).click();
  await expect(owner.getByRole("status")).toContainText("Request approved");

  await signIn(member, "member-workflow@example.com");
  await member.goto(`/business/${businessId}/members`);
  await expect(member.getByText(/permission to review/)).toBeVisible();

  await ownerContext.close();
  await memberContext.close();
});

test("keeps onboarding accessible and language switchable on mobile", async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "mobile-onboarding@example.com");
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Set up your business" })).toBeVisible();
  await page.getByRole("button", { name: "Espanol" }).click();
  await expect(page.getByRole("heading", { name: "Configura tu negocio" })).toBeVisible();
  await expect(page.locator("html")).toHaveJSProperty(
    "scrollWidth",
    await page.evaluate(() => document.documentElement.clientWidth),
  );

  await page.goto("/onboarding/join-business");
  await page.getByRole("button", { name: "Espanol" }).click();
  await page.getByRole("button", { name: "Buscar negocios" }).click();
  await expect(page.getByText("Introduce un nombre de negocio para buscar.")).toBeVisible();
  await expect(page.locator("html")).toHaveJSProperty(
    "scrollWidth",
    await page.evaluate(() => document.documentElement.clientWidth),
  );

   await page.goto("/onboarding/create-business");
   await page.getByRole("button", { name: "Espanol" }).click();
   await page.keyboard.press("Shift+Tab");
   await expectVisibleFocusRing(page.getByRole("button", { name: "English" }));
    await page.keyboard.press("Tab");
    await expectVisibleFocusRing(page.getByRole("button", { name: "Espanol" }));
    await page.keyboard.press("Tab");
    await expectVisibleFocusRing(page.getByRole("button", { name: "Cerrar sesión" }));
    await page.keyboard.press("Tab");
    await expectVisibleFocusRing(page.getByRole("link").first());
   await page.keyboard.press("Tab");
   await expectVisibleFocusRing(page.getByLabel("Nombre del negocio"));
   await expect(page.locator("html")).toHaveJSProperty(
     "scrollWidth",
     await page.evaluate(() => document.documentElement.clientWidth),
   );
   await expectLightModeContrast(page);
   await page.getByLabel("Nombre del negocio").fill("Mobile Harbour Books");
   await page.keyboard.press("Tab");
   await expectVisibleFocusRing(page.getByRole("button", { name: "Crear negocio" }));
   await page.keyboard.press("Enter");
  const createdStatus = page.getByRole("status");
  await expect(createdStatus).toContainText("Mobile Harbour Books");
  const businessId = (await createdStatus.textContent())?.match(/business-[\w-]+/)?.[0];
  expect(businessId).toBeTruthy();

  await page.goto("/onboarding/join-business");
   await page.getByRole("button", { name: "Espanol" }).click();
  const abortHistory = (url: URL) => url.pathname.endsWith("/join-requests") && url.searchParams.get("mine") === "true";
  await page.route(abortHistory, (route) => route.abort());
  await page.getByLabel("Buscar por nombre del negocio").fill("mobile harbour");
  await page.getByRole("button", { name: "Buscar negocios" }).click();
  await expect(page.locator("p.result-state").filter({ hasText: "Estado de solicitud no disponible." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Estado de solicitud no disponible." })).toBeDisabled();
  await page.unroute(abortHistory);

  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await signIn(member, "mobile-member@example.com");
  await member.goto("/onboarding/join-business");
  await member.getByLabel("Search by business name").fill("mobile harbour");
  await member.getByRole("button", { name: "Search businesses" }).click();
  await member.getByRole("button", { name: "Request to join" }).click();
  await expect(member.getByRole("status")).toContainText("Request submitted");
  await memberContext.close();

  await page.goto(`/business/${businessId}/members`);
   await page.getByRole("link", { name: "Español" }).click();
   await expect(page.getByRole("heading", { name: "Solicitudes de membresía" })).toBeVisible();
   const approve = page.getByRole("button", { name: "Aprobar solicitud" });
   await expect(approve).toBeVisible();
     await page.getByRole("button", { name: "Aprobar solicitud" }).focus();
     await page.keyboard.press("Tab");
     await page.keyboard.press("Shift+Tab");
     await expectVisibleFocusRing(approve);
  const normalDuration = await approve.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration));
  expect(normalDuration).toBeGreaterThan(0.1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedDuration = await approve.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration));
  expect(reducedDuration).toBeLessThan(0.1);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Solicitud aprobada.");
  await expect(page.locator("html")).toHaveJSProperty(
    "scrollWidth",
    await page.evaluate(() => document.documentElement.clientWidth),
  );
   await page.route("**/api/businesses/*/join-requests", (route) => route.abort());
   await page.reload();
   await expect(page.getByText("No pudimos conectar con LedgerHarbour. Comprueba tu conexión e inténtalo de nuevo.")).toBeVisible();
   await page.getByRole("link", { name: "English" }).click();
   await expect(page.getByText("We could not reach LedgerHarbour. Check your connection and try again.")).toBeVisible();
});
