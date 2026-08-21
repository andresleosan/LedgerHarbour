# LH-007 Auth Onboarding Locale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `locale=en|es` the single source of truth across authentication and onboarding while preserving functional query parameters, accessibility, and responsive behavior.

**Architecture:** A pure locale utility will own validation and query-string preservation. The existing `useUrlLocale` hook will use that utility for client pages, while auth continuation can use the same pure functions on the server. Auth and onboarding will consume the URL contract directly; no cookie, storage, or global provider will be added. Focused unit tests cover pure navigation logic and Playwright tests cover real desktop/mobile flows.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest, Playwright, existing `messages` catalog and `LanguageSwitcher`.

## Global Constraints

- Supported values are `en` and `es`.
- Any missing or unsupported URL value falls back to `en`.
- The URL query parameter is the source of truth after every navigation.
- Locale changes preserve the current pathname and every unrelated query parameter, including functional filters and search values.
- Do not add cookies, `localStorage`, a global locale provider, or a second language state source.
- Do not change authentication providers, API contracts, business behavior, or production configuration.
- Each auth/onboarding screen renders exactly one visible language selector.
- Preserve existing `aria-current`/`aria-pressed`, visible keyboard focus, reduced-motion behavior, and responsive layout constraints.
- Do not modify `tests/integration/postgres/native-schema.test.ts`.
- Keep LH-007 in `revision` until focused tests, full suite, responsive E2E coverage, accessibility checks, and console-error gates pass.

---

### Task 1: Implement the shared URL locale contract and auth flow

**Files:**
- Create: `src/i18n/locale.ts`
- Modify: `src/ui/useUrlLocale.ts`
- Modify: `src/ui/auth/AuthForm.tsx`
- Modify: `src/ui/auth/post-login-navigation.ts`
- Modify: `src/app/(auth)/auth/continue/page.tsx`
- Create: `tests/unit/i18n/locale.test.ts`
- Create: `tests/unit/auth/post-login-navigation.test.ts`

**Interfaces:**
- Produces: `resolveLocale(value: string | null | undefined): SupportedLocale`.
- Produces: `withLocale(path: string, current: URLSearchParams | string, locale: SupportedLocale): string`.
- Produces: `useUrlLocale(fallback?: SupportedLocale)` returning `{ locale, setLocale, hrefFor }`.
- Produces: `navigateAfterSuccessfulLogin(input, replace)` where `input.locale` is a `SupportedLocale` and `replace` accepts a string destination.

- [ ] **Step 1: Write failing pure locale tests**

  Create `tests/unit/i18n/locale.test.ts` covering this exact contract:

  ```ts
  import { describe, expect, it } from "vitest";

  import { resolveLocale, withLocale } from "@/i18n/locale";

  describe("locale URL contract", () => {
    it.each([["en", "en"], ["es", "es"], [undefined, "en"], ["fr", "en"]] as const)(
      "resolves %s to %s",
      (value, expected) => expect(resolveLocale(value)).toBe(expected),
    );

    it("replaces locale without dropping functional parameters", () => {
      expect(withLocale("/login", "locale=en&next=%2Fonboarding&status=pending", "es"))
        .toBe("/login?locale=es&next=%2Fonboarding&status=pending");
    });

    it("adds locale to a destination that has no query", () => {
      expect(withLocale("/auth/continue", "", "es")).toBe("/auth/continue?locale=es");
    });
  });
  ```

- [ ] **Step 2: Run the pure locale tests before implementation**

  Run:

  ```powershell
  corepack pnpm vitest run tests/unit/i18n/locale.test.ts
  ```

  Expected: FAIL because `src/i18n/locale.ts` does not exist yet.

- [ ] **Step 3: Implement the pure locale utility**

  Create `src/i18n/locale.ts` with these signatures and behavior:

  ```ts
  import { defaultLocale, type SupportedLocale } from "./config";

  export function resolveLocale(value: string | null | undefined): SupportedLocale {
    return value === "es" ? "es" : defaultLocale;
  }

  export function withLocale(
    path: string,
    current: URLSearchParams | string,
    locale: SupportedLocale,
  ): string {
    const params = typeof current === "string" ? new URLSearchParams(current) : new URLSearchParams(current.toString());
    params.set("locale", locale);
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  }
  ```

- [ ] **Step 4: Refactor `useUrlLocale` to use the shared utility**

  Keep the existing hook API. Read the current search params, resolve `locale` through `resolveLocale`, implement `hrefFor` with `withLocale`, and make `setLocale` call `router.replace(hrefFor(pathname, candidate))`. Do not discard unrelated query parameters.

- [ ] **Step 5: Make AuthForm URL-driven**

  Replace its local `useState<SupportedLocale>` with `useUrlLocale()`. Use the returned `locale` for message selection, `setLocale` for the single auth selector, and `hrefFor` for the login/register footer link. Keep all auth actions and Firebase behavior unchanged.

- [ ] **Step 6: Carry locale through Firebase continuation**

  Update `navigateAfterSuccessfulLogin` so its input includes `locale: SupportedLocale` and its replace callback accepts `string`. For a successful non-deterministic Firebase login, call `replace(withLocale("/auth/continue", "", input.locale))`; preserve the existing early-return rules for registration, development auth, and deterministic tests.

  Update `src/app/(auth)/auth/continue/page.tsx` to read `searchParams`, resolve its locale, and append that locale to the destination returned by `resolvePostLoginDestination`. Preserve the existing identity check and authorization decision.

- [ ] **Step 7: Add focused auth navigation tests**

  Create `tests/unit/auth/post-login-navigation.test.ts` covering:

  ```ts
  it("keeps locale on successful Firebase login", () => {
    const replace = vi.fn();

    navigateAfterSuccessfulLogin({
      flow: "email",
      mode: "login",
      authMode: "firebase",
      isDeterministicFirebaseTest: false,
      locale: "es",
    }, replace);

    expect(replace).toHaveBeenCalledWith("/auth/continue?locale=es");
  });
  ```

  Also assert that registration, development auth, and deterministic Firebase test flows do not navigate automatically.

- [ ] **Step 8: Run Task 1 focused tests and static checks**

  Run:

  ```powershell
  corepack pnpm vitest run tests/unit/i18n/locale.test.ts tests/unit/auth/post-login-navigation.test.ts
  corepack pnpm exec tsc --noEmit
  ```

  Expected: all focused assertions pass and TypeScript reports no errors.

- [ ] **Step 9: Commit the shared/auth locale change**

  ```powershell
  git add -- src/i18n/locale.ts src/ui/useUrlLocale.ts src/ui/auth/AuthForm.tsx src/ui/auth/post-login-navigation.ts "src/app/(auth)/auth/continue/page.tsx" tests/unit/i18n/locale.test.ts tests/unit/auth/post-login-navigation.test.ts
  git commit -m "feat: preserve locale through auth navigation"
  ```

---

### Task 2: Make onboarding screens URL-driven

**Files:**
- Modify: `src/app/onboarding/page.tsx`
- Modify: `src/app/onboarding/create-business/page.tsx`
- Modify: `src/app/onboarding/join-business/page.tsx`
- Modify: `src/ui/LanguageSwitcher.tsx` only if shared URL behavior requires it

**Interfaces:**
- Consumes: `useUrlLocale`, `resolveLocale`, `withLocale`, and the existing onboarding message catalog.
- Produces: One URL-driven selector per onboarding screen, with locale-preserving links and unchanged form/API behavior.

- [ ] **Step 1: Refactor onboarding landing page**

  Replace local locale state with `useUrlLocale()`. Use `locale` for messages, `setLocale` for the existing selector buttons, and `hrefFor("/onboarding/create-business")` / `hrefFor("/onboarding/join-business")` for the two choices. Keep sign-out behavior and responsive CSS unchanged.

- [ ] **Step 2: Refactor create-business and join-business pages**

  Replace each local locale state with `useUrlLocale()`. Use `hrefFor("/onboarding")` for the back link. Keep form state, API paths, request payloads, result handling, error mapping, loading state, `aria-live`, and existing responsive/reduced-motion CSS unchanged.

- [ ] **Step 3: Verify one selector and accessibility semantics per screen**

  Confirm each page has one `aria-label={copy.languageLabel}` toolbar, buttons retain `aria-pressed`, focus-visible styles remain present, and the locale buttons do not create horizontal overflow at mobile width.

- [ ] **Step 4: Run shared locale checks after onboarding changes**

  Run the shared locale and auth navigation tests from Task 1, then:

  ```powershell
  corepack pnpm vitest run tests/unit/i18n/locale.test.ts tests/unit/auth/post-login-navigation.test.ts
  corepack pnpm exec tsc --noEmit
  corepack pnpm lint
  ```

  Expected: all shared locale assertions pass and static checks exit `0`.

- [ ] **Step 5: Commit the onboarding change**

  ```powershell
  git add -- src/app/onboarding/page.tsx src/app/onboarding/create-business/page.tsx src/app/onboarding/join-business/page.tsx
  git commit -m "feat: preserve locale through onboarding"
  ```

---

### Task 3: Run responsive E2E and record LH-007 evidence

**Files:**
- Modify: `tasks.md:278-297`
- Create: `tests/e2e/auth-onboarding/locale.spec.ts`
- Read: all files changed by Tasks 1-2, existing Playwright auth/onboarding specs, `tests/e2e/critical-path.spec.ts`

**Interfaces:**
- Consumes: URL locale contract, auth continuation, and URL-driven onboarding selectors.
- Produces: LH-007 evidence in `revision` with real focused tests, full suite, static gates, desktop/mobile E2E, accessibility checks, and console diagnostics.

- [ ] **Step 1: Run locale-focused tests and full suite**

  Run:

  ```powershell
  corepack pnpm vitest run tests/unit/i18n/locale.test.ts tests/unit/auth/post-login-navigation.test.ts
  corepack pnpm test
  ```

  Record real counts and exit codes. The unrelated `native-schema.test.ts` remains untracked and outside scope.

- [ ] **Step 2: Run lint, TypeScript, and build**

  ```powershell
  corepack pnpm lint
  corepack pnpm exec tsc --noEmit
  corepack pnpm build
  ```

  Record real results and confirm no warnings are converted into test exceptions.

- [ ] **Step 3: Add desktop and mobile locale E2E coverage**

  Create `tests/e2e/auth-onboarding/locale.spec.ts` using the existing `./../fixtures` diagnostics fixture. Create two browser contexts in the test, one with viewport `{ width: 1280, height: 900 }` and one with `{ width: 390, height: 844 }`, so mobile coverage does not require changing `playwright.config.ts`. For each context, run the same assertions in `locale=es` and `locale=en`:

  - login and registration switch between English and Spanish with exactly one selector;
  - login-to-registration and registration-to-login links retain `locale`;
  - successful Firebase continuation retains locale to onboarding/admin destination;
  - onboarding create/join links and back links retain locale;
  - an unrelated functional query parameter survives a locale change;
  - desktop and mobile have no horizontal overflow;
  - console and `pageerror` diagnostics remain empty.

  Use the deterministic email login pattern already used by `tests/e2e/critical-path.spec.ts`, and close both contexts in `finally`. Navigate with URLs containing an unrelated query parameter such as `next=/onboarding` or `status=pending`, then assert that the parameter remains after changing locale.

- [ ] **Step 4: Run the complete E2E suite**

  ```powershell
  corepack pnpm test:e2e
  ```

  Record the actual test count, desktop/mobile projects, console gate, page errors, and any timeout or retry output. A warning or page error is a failed gate, not an exception to add silently.

- [ ] **Step 5: Review the final locale boundary**

  Confirm by diff and focused tests that no auth/onboarding screen has a second selector, no locale state is stored in cookies or `localStorage`, query parameters are preserved, and `/auth/continue` retains existing authorization behavior.

- [ ] **Step 6: Update LH-007 evidence without approving production**

  Change LH-007 from `pendiente` to `revision`. Record all commands and real outputs, desktop/mobile E2E coverage, accessibility/console results, changed files, and the exclusion of the untracked native-schema test. Keep LH-007 out of `aprobada` until independent review passes.

- [ ] **Step 7: Run the final diff check and commit evidence**

  ```powershell
  git diff --check
  git status --short
  ```

  Expected: no whitespace errors; only intended LH-007 files are changed and `tests/integration/postgres/native-schema.test.ts` remains untouched.

  ```powershell
  git add -- tasks.md
  git commit -m "test: record auth onboarding locale verification"
  ```

## Final Verification Checklist

- [ ] `locale=en|es` is the single source of truth in auth and onboarding.
- [ ] Locale and unrelated query parameters survive all required navigation.
- [ ] `/auth/continue` preserves locale without changing authorization.
- [ ] Exactly one selector is visible on every target screen.
- [ ] English/Spanish labels, keyboard focus, reduced motion, and responsive layout pass.
- [ ] Focused tests, full suite, lint, TypeScript, and build pass.
- [ ] Desktop/mobile Playwright flows pass with no console errors or `pageerror`.
- [ ] LH-007 remains `revision` pending independent review.
