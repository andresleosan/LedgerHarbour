import { expect, test } from "../fixtures";

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const locales = ["en", "es"] as const;
type Locale = (typeof locales)[number];

const copy = {
  en: {
    language: "Language",
    english: "English",
    spanish: "Espanol",
    emailLabel: "Work email",
    emailAction: "Continue with email",
    registerAction: "Create an account",
    loginAction: "Sign in",
    loginTitle: "Bring clarity to every ledger.",
    registerTitle: "Start with a clear workspace.",
    onboardingTitle: "Set up your business",
    createTitle: "Create your business",
    joinTitle: "Join an existing business",
    createAction: "Create a new business",
    joinAction: "Request to join an existing business",
    backSuffix: "Set up your business",
  },
  es: {
    language: "Idioma",
    english: "English",
    spanish: "Espanol",
    emailLabel: "Correo de trabajo",
    emailAction: "Continuar con correo",
    registerAction: "Crear una cuenta",
    loginAction: "Iniciar sesión",
    loginTitle: "Claridad para cada libro contable.",
    registerTitle: "Empieza con un espacio claro.",
    onboardingTitle: "Configura tu negocio",
    createTitle: "Crea tu negocio",
    joinTitle: "Únete a un negocio existente",
    createAction: "Crear un negocio nuevo",
    joinAction: "Solicitar unirse a un negocio existente",
    backSuffix: "Configura tu negocio",
  },
} satisfies Record<Locale, Record<string, string>>;

const query = new URLSearchParams({ next: "/onboarding", status: "pending" }).toString();

function localeUrl(path: string, locale: Locale): string {
  return `${path}?locale=${locale}&${query}`;
}

async function expectSingleSelector(page: import("@playwright/test").Page, selectorClass: "auth-toolbar" | "toolbar", locale: Locale) {
  const selector = page.locator(`.${selectorClass}`);
  await expect(selector).toHaveCount(1);
  await expect(selector).toBeVisible();
  await expect(selector).toHaveAttribute("aria-label", copy[locale].language);
  const buttons = selector.locator(".locale-button");
  await expect(buttons).toHaveCount(2);
  await expect(buttons.nth(0)).toBeVisible();
  await expect(buttons.nth(1)).toBeVisible();
  await expect(selector.locator("[aria-pressed]")).toHaveCount(2);
  await expect(selector.getByRole("button", { name: copy[locale].english, exact: true }))
    .toHaveAttribute("aria-pressed", String(locale === "en"));
  await expect(selector.getByRole("button", { name: copy[locale].spanish, exact: true }))
    .toHaveAttribute("aria-pressed", String(locale === "es"));
}

async function expectNoOverflowAndClientStateIsLocaleFree(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  const clientState = await page.evaluate(() => ({
    localStorage: Object.entries(window.localStorage),
    cookies: document.cookie,
  }));
  expect(clientState.localStorage.filter(([key, value]) => /locale/i.test(`${key}=${value}`))).toEqual([]);
  expect(clientState.cookies).not.toMatch(/locale/i);
  expect((await context.cookies()).filter(({ name }) => /locale/i.test(name))).toEqual([]);
}

async function expectAccessibleLocaleControl(page: import("@playwright/test").Page, locale: Locale) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(async () => page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);

  const reducedMotionDurations = await page.evaluate(() => {
    const values = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .flatMap((element) => {
        const styles = window.getComputedStyle(element);
        return [styles.transitionDuration, styles.animationDuration];
      })
      .flatMap((value) => value.split(",").map((duration) => Number.parseFloat(duration) * 1000))
      .filter(Number.isFinite);

    return Math.max(0, ...values);
  });
  expect(reducedMotionDurations).toBeLessThanOrEqual(10);

  const english = page.getByRole("button", { name: copy[locale].english, exact: true });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await english.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(english).toBeFocused();
  await expect(english).toHaveCSS("outline-style", "solid");
}

async function expectAuthLocaleFlow(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
  locale: Locale,
) {
  const text = copy[locale];
  await page.goto(localeUrl("/login", locale));
  await expect(page.getByRole("heading", { name: text.loginTitle })).toBeVisible();
  await expectSingleSelector(page, "auth-toolbar", locale);
  await expectNoOverflowAndClientStateIsLocaleFree(page, context);
  await expectAccessibleLocaleControl(page, locale);

  const localeButton = page.getByRole("button", { name: locale === "en" ? text.spanish : text.english, exact: true });
  await localeButton.click();
  const switchedLocale = locale === "en" ? "es" : "en";
  await expect(page).toHaveURL(localeUrl("/login", switchedLocale));
  await expect(page.getByRole("heading", { name: copy[switchedLocale].loginTitle })).toBeVisible();
  await expectSingleSelector(page, "auth-toolbar", switchedLocale);

  await page.goto(localeUrl("/login", locale));
  const registerLink = page.getByRole("link", { name: text.registerAction });
  await expect(registerLink).toHaveCount(1);
  await expect(registerLink).toHaveAttribute("href", localeUrl("/register", locale));
  await registerLink.click();
  await expect(page).toHaveURL(localeUrl("/register", locale));
  await expect(page.getByRole("heading", { name: text.registerTitle })).toBeVisible();
  await expectSingleSelector(page, "auth-toolbar", locale);
  await expect(page.getByRole("link", { name: text.loginAction })).toHaveAttribute("href", localeUrl("/login", locale));
  await expectNoOverflowAndClientStateIsLocaleFree(page, context);
  await expectAccessibleLocaleControl(page, locale);

  const registerLocaleButton = page.getByRole("button", { name: locale === "en" ? text.spanish : text.english, exact: true });
  await registerLocaleButton.click();
  await expect(page).toHaveURL(localeUrl("/register", switchedLocale));
  await expect(page.getByRole("heading", { name: copy[switchedLocale].registerTitle })).toBeVisible();
  await expectSingleSelector(page, "auth-toolbar", switchedLocale);

  await page.goto(localeUrl("/login", locale));
  await page.getByLabel(text.emailLabel).fill(`task3-locale-${locale}@example.com`);
  await page.getByRole("button", { name: text.emailAction }).click();
  // The deterministic local adapter intentionally stays on /login after email sign-in.
  await expect(page.getByRole("status")).toContainText("task3-locale");
  await expect(page).toHaveURL(localeUrl("/login", locale));
}

async function expectOnboardingLocaleFlow(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
  locale: Locale,
) {
  const text = copy[locale];
  await page.goto(localeUrl("/auth/continue", locale));
  await expect(page).toHaveURL(localeUrl("/onboarding", locale));
  await expect(page.getByRole("heading", { name: text.onboardingTitle })).toBeVisible();
  await expectSingleSelector(page, "toolbar", locale);
  await expect(page.getByRole("link", { name: text.createAction })).toHaveAttribute("href", localeUrl("/onboarding/create-business", locale));
  await expect(page.getByRole("link", { name: text.joinAction })).toHaveAttribute("href", localeUrl("/onboarding/join-business", locale));
  await expectNoOverflowAndClientStateIsLocaleFree(page, context);
  await expectAccessibleLocaleControl(page, locale);

  const localeButton = page.getByRole("button", { name: locale === "en" ? text.spanish : text.english, exact: true });
  await localeButton.click();
  const switchedLocale = locale === "en" ? "es" : "en";
  await expect(page).toHaveURL(localeUrl("/onboarding", switchedLocale));
  await expect(page.getByRole("heading", { name: copy[switchedLocale].onboardingTitle })).toBeVisible();

  await page.goto(localeUrl("/onboarding/create-business", locale));
  await expect(page.getByRole("heading", { name: text.createTitle })).toBeVisible();
  await expectSingleSelector(page, "toolbar", locale);
  await expect(page.getByRole("link", { name: new RegExp(`${text.backSuffix}$`) })).toHaveAttribute("href", localeUrl("/onboarding", locale));
  await expectNoOverflowAndClientStateIsLocaleFree(page, context);
  await expectAccessibleLocaleControl(page, locale);

  await page.goto(localeUrl("/onboarding/join-business", locale));
  await expect(page.getByRole("heading", { name: text.joinTitle })).toBeVisible();
  await expectSingleSelector(page, "toolbar", locale);
  await expect(page.getByRole("link", { name: new RegExp(`${text.backSuffix}$`) })).toHaveAttribute("href", localeUrl("/onboarding", locale));
  await expectNoOverflowAndClientStateIsLocaleFree(page, context);
  await expectAccessibleLocaleControl(page, locale);
}

async function expectAnonymousContinuation(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
  locale: Locale,
) {
  // This cleanup is intentionally limited to the anonymous branch; authenticated cookies are preserved elsewhere.
  await context.clearCookies();
  await page.goto(localeUrl("/login", locale));
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(localeUrl("/auth/continue", locale));
  await expect(page).toHaveURL(localeUrl("/login", locale));
  await expect(page.getByRole("heading", { name: copy[locale].loginTitle })).toBeVisible();
  await expectSingleSelector(page, "auth-toolbar", locale);
  await expectNoOverflowAndClientStateIsLocaleFree(page, context);
  await expectAccessibleLocaleControl(page, locale);
}

async function expectAdminContinuation(page: import("@playwright/test").Page, locale: Locale) {
  const text = copy[locale];
  await page.goto(localeUrl("/login", locale));
  await page.getByLabel(text.emailLabel).fill("platform-admin@example.com");
  await page.getByRole("button", { name: text.emailAction }).click();
  await expect(page.getByRole("status")).toContainText("platform-admin@example.com");
  await page.goto(localeUrl("/auth/continue", locale));
  await expect(page).toHaveURL(localeUrl("/admin", locale));
}

test("keeps auth and onboarding locale navigation consistent on desktop and mobile", async ({ browserWithDiagnostics: browser }) => {
  const contexts = await Promise.all(viewports.map(({ width, height }) => browser.newContext({ viewport: { width, height } })));

  try {
    for (const [index, context] of contexts.entries()) {
      const anonymousContext = await browser.newContext({ viewport: viewports[index] });
      try {
        const anonymousPage = await anonymousContext.newPage();
        for (const locale of locales) {
          await expectAnonymousContinuation(anonymousPage, anonymousContext, locale);
        }
      } finally {
        await anonymousContext.close();
      }

      const page = await context.newPage();
      for (const locale of locales) {
        await expectAuthLocaleFlow(page, context, locale);
        await expectOnboardingLocaleFlow(page, context, locale);
        await expectAdminContinuation(page, locale);
      }
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
