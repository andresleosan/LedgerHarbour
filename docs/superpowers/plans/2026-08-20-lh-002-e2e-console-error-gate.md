# LH-002 E2E Console Error Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the complete Playwright suite fail when any page emits `console.error` or `pageerror`, with safe diagnostics for URL and message.

**Architecture:** Add a test-only diagnostics tracker and a custom Playwright fixture named `browserWithDiagnostics`. The fixture wraps `browser.newPage()` and `browser.newContext()`, attaches listeners to every resulting page, and asserts at teardown. Migrate all E2E specs to import `test` and `expect` from the fixture while aliasing `browserWithDiagnostics` back to `browser` inside existing test bodies.

**Tech Stack:** Playwright Test 1.62, TypeScript, Vitest, Node URL parsing, existing `tests/e2e` harness.

## Global Constraints

- Apply the gate to the entire suite under `tests/e2e`.
- Capture only `console.error` and `pageerror`; do not fail on logs, info, warnings, HTTP requests, or network events.
- Do not add exceptions initially; every captured `console.error` or `pageerror` fails the test.
- Diagnostics include only URL path, event kind, and sanitized/truncated message.
- Do not serialize cookies, headers, storage state, HTML, tokens, request bodies, environment variables, or secrets.
- Do not change application code, APIs, providers, business behavior, or production configuration.
- Do not resolve the `allowedDevOrigins` warning; that belongs to `LH-006`.
- Keep the unrelated `tests/integration/postgres/native-schema.test.ts` unmodified and unstaged.
- Do not commit or deploy without explicit operator authorization.

## File Structure

- Create `tests/e2e/fixtures/browser-diagnostics.ts`: pure diagnostic data type, sanitization, tracker, and page listener attachment.
- Create `tests/e2e/fixtures.ts`: custom Playwright `test` fixture exposing `browserWithDiagnostics` and re-exporting `expect`.
- Create `tests/unit/e2e/browser-diagnostics.test.ts`: unit coverage for clean, console error, page error, truncation, and redaction behavior.
- Create `tests/e2e/console-gate-synthetic.spec.ts`: permanent expected-failure proof that the fixture catches browser console and page errors.
- Modify all 18 E2E spec files that import `test` from `@playwright/test` to import `test` and `expect` from the local fixture; preserve type-only imports from Playwright.
- Modify `tests/e2e/helpers/business.ts`: accept the diagnostic browser interface instead of the concrete Playwright `Browser` type.
- Modify `tasks.md:22,61-71`: track LH-002 state and final evidence.

The exact migrated specs are:

```text
tests/e2e/auth/login.spec.ts
tests/e2e/branding/logo-assets.spec.ts
tests/e2e/critical-path.spec.ts
tests/e2e/documents/upload.spec.ts
tests/e2e/invoices/review.spec.ts
tests/e2e/navigation/business-switcher.spec.ts
tests/e2e/onboarding/logout.spec.ts
tests/e2e/platform/admin-mobile.spec.ts
tests/e2e/platform/admin-panel.spec.ts
tests/e2e/platform/administrator-approval.spec.ts
tests/e2e/platform/business-approval.spec.ts
tests/e2e/platform/full-administration.spec.ts
tests/e2e/platform/platform-administrator-management.spec.ts
tests/e2e/platform/project-approval.spec.ts
tests/e2e/production/no-demo-copy.spec.ts
tests/e2e/smoke/app-starts.spec.ts
tests/e2e/tenancy/membership-administration.spec.ts
tests/e2e/tenancy/onboarding.spec.ts
```

## Interfaces

`tests/e2e/fixtures/browser-diagnostics.ts` exports:

```ts
export interface BrowserDiagnostic {
  kind: "console.error" | "pageerror";
  url: string;
  message: string;
}

export interface BrowserDiagnostics {
  recordConsoleError(url: string, message: string): void;
  recordPageError(url: string, message: string): void;
  assertClean(): void;
}

export function createBrowserDiagnostics(): BrowserDiagnostics;
export function attachPageDiagnostics(page: Pick<Page, "on" | "url">, diagnostics: BrowserDiagnostics): void;
```

`tests/e2e/fixtures.ts` exports:

```ts
export interface DiagnosticBrowser {
  newPage(options?: BrowserContextOptions): Promise<Page>;
  newContext(options?: BrowserContextOptions): Promise<BrowserContext>;
}

export const test: TestType<{ browserWithDiagnostics: DiagnosticBrowser }, PlaywrightTestArgs & PlaywrightTestOptions & PlaywrightWorkerArgs & PlaywrightWorkerOptions>;
export { expect } from "@playwright/test";
```

---

### Task 1: Global Browser Diagnostics Fixture

**Files:**
- Create: `tests/e2e/fixtures/browser-diagnostics.ts`
- Create: `tests/e2e/fixtures.ts`
- Create: `tests/unit/e2e/browser-diagnostics.test.ts`
- Create: `tests/e2e/console-gate-synthetic.spec.ts`
- Modify: the 18 E2E specs listed above
- Modify: `tests/e2e/helpers/business.ts`
- Modify: `tasks.md:22,61-71`

**Interfaces:**
- Consumes: Playwright `Browser`, `BrowserContext`, `Page`, `BrowserContextOptions`, and existing test callbacks.
- Produces: `browserWithDiagnostics` fixture, `createBrowserDiagnostics()`, `attachPageDiagnostics()`, and a suite-wide console/page-error gate.

- [ ] **Step 1: Mark LH-002 in progress**

Change only the LH-002 summary row and detailed state in `tasks.md`:

```markdown
| LH-002 | P0 | en progreso | Fail E2E on browser console errors | All users | 4.00 |
```

```markdown
- State: `en progreso`
```

- [ ] **Step 2: Write failing unit tests for the diagnostics tracker**

Create `tests/unit/e2e/browser-diagnostics.test.ts` before the production test helper:

```ts
import { describe, expect, it } from "vitest";

import { createBrowserDiagnostics } from "../../../tests/e2e/fixtures/browser-diagnostics";

describe("browser diagnostics", () => {
  it("does not throw when no browser errors were recorded", () => {
    expect(() => createBrowserDiagnostics().assertClean()).not.toThrow();
  });

  it("throws for a console error with its safe path and message", () => {
    const diagnostics = createBrowserDiagnostics();
    diagnostics.recordConsoleError("https://example.test/admin?token=secret", "render failed");

    expect(() => diagnostics.assertClean()).toThrow(/console\.error.*\/admin.*render failed/s);
    expect(() => diagnostics.assertClean()).not.toThrow(/secret/);
  });

  it("throws for a page error", () => {
    const diagnostics = createBrowserDiagnostics();
    diagnostics.recordPageError("https://example.test/login", "uncaught failure");

    expect(() => diagnostics.assertClean()).toThrow(/pageerror.*\/login.*uncaught failure/s);
  });

  it("redacts sensitive key-value data and truncates long messages", () => {
    const diagnostics = createBrowserDiagnostics();
    diagnostics.recordConsoleError(
      "https://example.test/admin",
      `password=secret token=abc ${"x".repeat(600)}`,
    );

    expect(() => diagnostics.assertClean()).toThrow(/password=\[REDACTED\]/);
    expect(() => diagnostics.assertClean()).toThrow(/token=\[REDACTED\]/);
    expect(() => diagnostics.assertClean()).toThrow(/\[truncated\]/);
    expect(() => diagnostics.assertClean()).not.toThrow(/secret/);
  });
});
```

- [ ] **Step 3: Run the unit test and verify RED**

Run:

```powershell
corepack pnpm vitest run tests/unit/e2e/browser-diagnostics.test.ts
```

Expected: FAIL because `tests/e2e/fixtures/browser-diagnostics.ts` does not exist. Confirm the failure is the missing module, not an assertion typo.

- [ ] **Step 4: Implement the pure tracker and safe diagnostics**

Create `tests/e2e/fixtures/browser-diagnostics.ts` with this behavior:

```ts
import type { Page } from "@playwright/test";

const MAX_MESSAGE_LENGTH = 500;

export interface BrowserDiagnostic {
  kind: "console.error" | "pageerror";
  url: string;
  message: string;
}

export interface BrowserDiagnostics {
  recordConsoleError(url: string, message: string): void;
  recordPageError(url: string, message: string): void;
  assertClean(): void;
}

function safePath(value: string): string {
  try {
    return new URL(value).pathname || "/";
  } catch {
    return "/[invalid-url]";
  }
}

function safeMessage(value: string): string {
  const redacted = value.replace(
    /((?:password|token|secret|cookie)\s*[=:]\s*)[^\s&]+/gi,
    "$1[REDACTED]",
  );
  return redacted.length > MAX_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_MESSAGE_LENGTH)} [truncated]`
    : redacted;
}

export function createBrowserDiagnostics(): BrowserDiagnostics {
  const errors: BrowserDiagnostic[] = [];
  const record = (kind: BrowserDiagnostic["kind"], url: string, message: string) => {
    errors.push({ kind, url: safePath(url), message: safeMessage(message) });
  };

  return {
    recordConsoleError: (url, message) => record("console.error", url, message),
    recordPageError: (url, message) => record("pageerror", url, message),
    assertClean() {
      if (errors.length === 0) return;
      throw new Error(`Browser diagnostics detected:\n${errors.map((error) => `- ${error.kind} ${error.url}: ${error.message}`).join("\n")}`);
    },
  };
}

export function attachPageDiagnostics(
  page: Pick<Page, "on" | "url">,
  diagnostics: BrowserDiagnostics,
): void {
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.recordConsoleError(page.url(), message.text());
  });
  page.on("pageerror", (error) => diagnostics.recordPageError(page.url(), error.message));
}
```

- [ ] **Step 5: Run unit tests and verify GREEN**

Run:

```powershell
corepack pnpm vitest run tests/unit/e2e/browser-diagnostics.test.ts
```

Expected: 4 tests pass with no warnings. The test must prove that query secrets are absent from the reported path and sensitive values are redacted.

- [ ] **Step 6: Add the custom diagnostic browser fixture**

Create `tests/e2e/fixtures.ts`:

```ts
import { test as base, expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";

import { attachPageDiagnostics, createBrowserDiagnostics } from "./fixtures/browser-diagnostics";

export interface DiagnosticBrowser {
  newPage(options?: BrowserContextOptions): Promise<Page>;
  newContext(options?: BrowserContextOptions): Promise<BrowserContext>;
}

export const test = base.extend<{ browserWithDiagnostics: DiagnosticBrowser }>({
  browserWithDiagnostics: async ({ browser }, use) => {
    const diagnostics = createBrowserDiagnostics();
    const attachContext = (context: BrowserContext) => {
      context.on("page", (page) => attachPageDiagnostics(page, diagnostics));
      return context;
    };

    const diagnosticBrowser: DiagnosticBrowser = {
      async newPage(options) {
        const page = await browser.newPage(options);
        attachPageDiagnostics(page, diagnostics);
        return page;
      },
      async newContext(options) {
        return attachContext(await browser.newContext(options));
      },
    };

    await use(diagnosticBrowser);
    diagnostics.assertClean();
  },
});

export { expect };
```

- [ ] **Step 7: Add expected-failure fixture coverage for real browser events**

Create `tests/e2e/console-gate-synthetic.spec.ts`:

```ts
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
    await expect(page.evaluate(() => { throw new Error("LH-002 synthetic page error"); })).rejects.toThrow();
  });
});
```

`test.fail()` makes these tests pass only when the fixture actually fails during teardown. If listener wiring regresses, Playwright reports an unexpected pass and fails the suite.

- [ ] **Step 8: Migrate every E2E spec to the fixture**

For each of the 18 listed specs:

1. Replace `import { expect, test } from "@playwright/test";` with `import { expect, test } from "../fixtures";`, `../../fixtures`, or `./fixtures` according to directory depth.
2. Preserve any type-only imports from `@playwright/test` on the same line or a separate import.
3. Replace each test callback parameter `{ browser }` with `{ browserWithDiagnostics: browser }` so existing bodies remain unchanged.

For `tests/e2e/helpers/business.ts`, replace the `Browser` type-only import with `DiagnosticBrowser` from `../fixtures`, keep the existing `Page` type import, and change the first parameter type of both `createApprovedBusiness` and `withPlatformAdmin` from `Browser` to `DiagnosticBrowser`. Their function bodies remain byte-for-byte unchanged.

- [ ] **Step 9: Run fixture-focused tests and migrated critical specs**

Run:

```powershell
corepack pnpm vitest run tests/unit/e2e/browser-diagnostics.test.ts
corepack pnpm exec playwright test tests/e2e/auth/login.spec.ts tests/e2e/platform/admin-panel.spec.ts tests/e2e/critical-path.spec.ts
```

Expected: tracker unit tests pass; all migrated critical specs pass; synthetic expected-failure tests report expected failures only when run explicitly.

- [ ] **Step 10: Mark LH-002 in review**

Change only the LH-002 summary row and detailed state in `tasks.md` from `en progreso` to `revision`. Do not mark it approved before all gates pass.

- [ ] **Step 11: Run the complete quality gate**

Run independently:

```text
corepack pnpm test
corepack pnpm lint
corepack pnpm exec tsc --noEmit
corepack pnpm build
corepack pnpm test:e2e
```

Expected: all tests and build checks pass. The known `allowedDevOrigins` warning remains a separate LH-006 item and must not be silently added to an exception list.

- [ ] **Step 12: Run security and scope self-review**

Verify:

```text
- no application source file changed
- no cookies, tokens, storage state, headers, HTML, request bodies, or environment values enter diagnostics
- URLs are reduced to pathname before reporting
- messages are redacted and capped at 500 characters
- only console.error and pageerror fail tests
- every E2E spec imports the custom fixture
- tests/integration/postgres/native-schema.test.ts remains untouched and unstaged
```

- [ ] **Step 13: Mark LH-002 approved with evidence**

Only after Steps 11-12 pass, change the summary row and detailed state to `aprobada`. Add actual counts for unit, full suite, build, and E2E results, plus the synthetic expected-failure result and security review.

Run:

```powershell
git diff --check
```

Expected: no whitespace errors and only intended files plus the unrelated native-schema test outside staging. Do not commit, push, or deploy without operator authorization.
