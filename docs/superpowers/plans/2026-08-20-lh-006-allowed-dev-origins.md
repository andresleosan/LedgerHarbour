# LH-006 Allowed Dev Origins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Next.js `allowedDevOrigins` warning for the Playwright server while allowing only `127.0.0.1:3100` outside production.

**Architecture:** `next.config.ts` will expose a small `createNextConfig(nodeEnv)` factory. The factory adds the single Playwright origin only for `development` and `test`, omits the property for `production`, and returns the existing headers, body-size setting, and Firebase rewrites unchanged. A focused Vitest test locks the environment boundary and rewrite behavior; the final task records the complete validation gate.

**Tech Stack:** Next.js 15, TypeScript, Vitest, Playwright, PowerShell 5.1.

## Global Constraints

- Modify only `next.config.ts`, `tests/unit/config/next-config.test.ts`, and `tasks.md` during implementation.
- The only allowed development origin is `127.0.0.1:3100`.
- `allowedDevOrigins` is present for `development` and `test`, and absent for `production`.
- Do not modify `playwright.config.ts`; its `baseURL` and web server already use `http://127.0.0.1:3100`.
- Preserve the existing headers, `middlewareClientMaxBodySize`, and Firebase rewrites.
- Do not add localhost aliases, wildcard origins, arbitrary ports, production origins, or schemes.
- Do not add dependencies or change application behavior outside Next configuration.
- Do not access credentials, Firebase, dashboards, providers, billing, or external services.
- Do not modify historical specs/plans or `tests/integration/postgres/native-schema.test.ts`.
- Keep LH-006 in `revision` until focused tests, full tests, lint, TypeScript, build, E2E, and production-config review pass.

---

### Task 1: Add environment-specific Next configuration

**Files:**
- Modify: `next.config.ts:1-29`
- Create: `tests/unit/config/next-config.test.ts`

**Interfaces:**
- Produces: `createNextConfig(nodeEnv: string | undefined): NextConfig` exported from `next.config.ts`.
- Consumes: Existing Next configuration object, `process.env.NODE_ENV`, and the existing Firebase rewrite definitions.

- [ ] **Step 1: Write the focused configuration test**

  Create `tests/unit/config/next-config.test.ts` with this structure:

  ```ts
  import { describe, expect, it } from "vitest";

  import { createNextConfig } from "../../../next.config";

  describe("Next environment configuration", () => {
    it.each(["development", "test"])("allows only the Playwright origin in %s", (nodeEnv) => {
      const config = createNextConfig(nodeEnv);

      expect(config.allowedDevOrigins).toEqual(["127.0.0.1:3100"]);
    });

    it("omits development origins from production", () => {
      const config = createNextConfig("production");

      expect(config).not.toHaveProperty("allowedDevOrigins");
    });

    it("preserves both Firebase rewrites in production", async () => {
      const config = createNextConfig("production");

      await expect(config.rewrites?.()).resolves.toEqual([
        {
          source: "/__/auth/:path*",
          destination: "https://ledgerharbour.firebaseapp.com/__/auth/:path*",
        },
        {
          source: "/__/firebase/:path*",
          destination: "https://ledgerharbour.firebaseapp.com/__/firebase/:path*",
        },
      ]);
    });
  });
  ```

- [ ] **Step 2: Run the focused test before implementation**

  Run:

  ```powershell
  corepack pnpm vitest run tests/unit/config/next-config.test.ts
  ```

  Expected: FAIL because `createNextConfig` is not exported yet. Do not weaken the assertions to make the pre-implementation run pass.

- [ ] **Step 3: Implement the configuration factory**

  Refactor `next.config.ts` to keep the existing config values and add this policy:

  ```ts
  const PLAYWRIGHT_DEV_ORIGIN = "127.0.0.1:3100";

  export function createNextConfig(nodeEnv = process.env.NODE_ENV): NextConfig {
    return {
      ...(nodeEnv === "development" || nodeEnv === "test"
        ? { allowedDevOrigins: [PLAYWRIGHT_DEV_ORIGIN] }
        : {}),
      experimental: {
        middlewareClientMaxBodySize: 12 * 1024 * 1024,
      },
      async headers() {
        return [
          {
            source: "/(.*)",
            headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }],
          },
        ];
      },
      async rewrites() {
        return [
          {
            source: "/__/auth/:path*",
            destination: "https://ledgerharbour.firebaseapp.com/__/auth/:path*",
          },
          {
            source: "/__/firebase/:path*",
            destination: "https://ledgerharbour.firebaseapp.com/__/firebase/:path*",
          },
        ];
      },
    };
  }

  export default createNextConfig();
  ```

  Keep the existing `experimental.middlewareClientMaxBodySize`, `headers`, and two Firebase rewrites exactly as they behave today. Production must not receive an `allowedDevOrigins` property.

- [ ] **Step 4: Run the focused test after implementation**

  Run:

  ```powershell
  corepack pnpm vitest run tests/unit/config/next-config.test.ts
  ```

  Expected: all focused tests pass, including exact origin equality, production omission, and both rewrite pairs.

- [ ] **Step 5: Commit the configuration change**

  ```powershell
  git add -- next.config.ts tests/unit/config/next-config.test.ts
  git commit -m "fix: scope allowed dev origin to test environments"
  ```

---

### Task 2: Run release gates and record LH-006 evidence

**Files:**
- Modify: `tasks.md:235-252`
- Read: `next.config.ts`, `tests/unit/config/next-config.test.ts`, `playwright.config.ts`

**Interfaces:**
- Consumes: `createNextConfig`, the focused config tests, and the unchanged Playwright origin configuration from Task 1.
- Produces: LH-006 evidence in `revision` with real focused-test, suite, lint, TypeScript, build, E2E, and production-config results.

- [ ] **Step 1: Run the focused test and full suite**

  Run:

  ```powershell
  corepack pnpm vitest run tests/unit/config/next-config.test.ts
  corepack pnpm test
  ```

  Record the real counts and exit codes. The focused test must prove production omission and exact origin scope; the full suite must pass without modifying the unrelated native-schema test.

- [ ] **Step 2: Run static and production configuration gates**

  Run:

  ```powershell
  corepack pnpm lint
  corepack pnpm exec tsc --noEmit
  corepack pnpm build
  ```

  Record each command's real exit code. Review the built configuration behavior through the focused production assertion; do not add a development origin to production.

- [ ] **Step 3: Run the complete E2E suite and check the warning**

  Run this PowerShell block from the repository root:

  ```powershell
  $e2eOutput = (& corepack pnpm test:e2e 2>&1 | Out-String)
  $e2eOutput
  if ($e2eOutput -match "allowedDevOrigins") {
    throw "The allowedDevOrigins warning is still present"
  }
  ```

  Expected: the complete Playwright suite passes and the captured output contains no `allowedDevOrigins` warning. Record the actual test count and warning check result.

- [ ] **Step 4: Review the final configuration boundary**

  Confirm from `next.config.ts` and the focused test that:

  - `development` and `test` contain exactly `127.0.0.1:3100`;
  - `production` has no `allowedDevOrigins` property;
  - Firebase rewrites are unchanged;
  - `playwright.config.ts` remains unchanged and still targets port `3100`.

- [ ] **Step 5: Update LH-006 without prematurely approving it**

  Change LH-006 from `pendiente` to `revision`. Record all commands, real outputs, the production exclusion result, the E2E warning absence, and that no credentials, providers, billing, deployment, or production configuration were accessed.

- [ ] **Step 6: Run final diff checks and commit QA evidence**

  Run:

  ```powershell
  git diff --check
  git status --short
  ```

  Expected: no whitespace errors; only the intended LH-006 files are changed, with `tests/integration/postgres/native-schema.test.ts` remaining untracked and untouched.

  Then commit:

  ```powershell
  git add -- tasks.md
  git commit -m "test: record allowed dev origins verification"
  ```

## Final Verification Checklist

- [ ] Focused config test passes.
- [ ] Full `corepack pnpm test` passes.
- [ ] Lint, TypeScript, and build pass.
- [ ] Full E2E passes without `allowedDevOrigins` in output.
- [ ] Production config omits `allowedDevOrigins`.
- [ ] Development/test config allows only `127.0.0.1:3100`.
- [ ] Firebase rewrites remain unchanged.
- [ ] No application, provider, credential, billing, deployment, or migration operation occurred.
- [ ] LH-006 remains `revision` until all evidence is independently reviewed.
