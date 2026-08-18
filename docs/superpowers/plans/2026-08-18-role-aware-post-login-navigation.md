# Role-aware Post-login Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route authenticated global platform administrators to `/admin` after login while ordinary authenticated users continue to `/onboarding`.

**Architecture:** Add a pure server-side destination resolver around the existing `requirePlatformMember()` authorization boundary, then expose it through a server-rendered `/auth/continue` page. Successful production Firebase login navigates to that page; the protected `/admin` layout remains the final authorization boundary.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Firebase Authentication, Drizzle repository contracts, Vitest, Playwright.

## Global Constraints

- Keep registration, logout, session creation, and platform authorization contracts unchanged.
- Do not authorize from client state, an email allowlist, or a value returned to the browser.
- Only `PLATFORM_ACCESS_DENIED` maps to `/onboarding`; repository conflicts and unexpected failures must be rethrown.
- Missing or invalid sessions redirect to `/login`.
- No role, membership ID, Firebase token, or session cookie is exposed to the client.
- Do not commit or deploy unless the operator explicitly authorizes that separate action.

## File Structure

- Create `src/modules/auth/post-login-destination.ts`: resolve `/admin` versus `/onboarding` using existing repositories and platform authorization.
- Create `src/app/(auth)/auth/continue/page.tsx`: read the server session and redirect using the resolver.
- Modify `src/ui/auth/AuthForm.tsx`: send successful production Firebase login to `/auth/continue`.
- Create `tests/unit/auth/post-login-destination.test.ts`: cover linked admin, one-time claim, ordinary user, and conflict propagation.
- Modify `tests/unit/auth/production-auth-config.test.ts`: verify production login wiring and continuation route presence.
- Modify `tests/e2e/platform/admin-panel.spec.ts`: verify role-aware continuation with the deterministic browser harness.

---

### Task 1: Server-side Destination Resolver

**Files:**
- Create: `src/modules/auth/post-login-destination.ts`
- Create: `tests/unit/auth/post-login-destination.test.ts`

**Interfaces:**
- Consumes: `AuthIdentity`, `OnboardingRepository`, `PlatformRepository`, and `requirePlatformMember(actor, tenancy, platform)`.
- Produces: `resolvePostLoginDestination(identity, dependencies): Promise<"/admin" | "/onboarding">`.

- [ ] **Step 1: Write the failing resolver tests**

```ts
import { describe, expect, it } from "vitest";

import { resolvePostLoginDestination } from "../../../src/modules/auth/post-login-destination";
import { createInMemoryPlatformRepository, PLATFORM_ERROR_CODES } from "../../../src/modules/platform/platform-service";
import { createInMemoryOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import type { UserId } from "../../../src/modules/tenancy/types";

const identity = (email: string, providerUserId = email) => ({
  provider: "firebase" as const,
  providerUserId,
  email,
  displayName: email.split("@", 1)[0] ?? "User",
  emailVerified: true,
});

describe("post-login destination", () => {
  it("routes a linked active platform administrator to admin", async () => {
    const tenancyRepository = createInMemoryOnboardingRepository();
    const platformRepository = createInMemoryPlatformRepository();
    const actor = identity("linked@example.com");
    const userId = await tenancyRepository.upsertUser(actor);
    platformRepository.addMember({ id: "platform-linked", userId, normalizedEmail: actor.email });

    await expect(resolvePostLoginDestination(actor, { tenancyRepository, platformRepository }))
      .resolves.toBe("/admin");
  });

  it("claims a verified seeded administrator and routes to admin", async () => {
    const tenancyRepository = createInMemoryOnboardingRepository();
    const platformRepository = createInMemoryPlatformRepository();
    const actor = identity("claim@example.com");
    platformRepository.addMember({ id: "platform-claim", userId: null, normalizedEmail: actor.email });

    await expect(resolvePostLoginDestination(actor, { tenancyRepository, platformRepository }))
      .resolves.toBe("/admin");
    expect(platformRepository.platformMembers[0]?.userId).toMatch(/^user-/);
  });

  it("routes an ordinary authenticated user to onboarding", async () => {
    const tenancyRepository = createInMemoryOnboardingRepository();
    const platformRepository = createInMemoryPlatformRepository();

    await expect(resolvePostLoginDestination(identity("ordinary@example.com"), {
      tenancyRepository,
      platformRepository,
    })).resolves.toBe("/onboarding");
  });

  it("does not hide a conflicting platform claim", async () => {
    const tenancyRepository = createInMemoryOnboardingRepository();
    const platformRepository = createInMemoryPlatformRepository();
    platformRepository.addMember({
      id: "platform-conflict",
      userId: "already-linked" as UserId,
      normalizedEmail: "conflict@example.com",
    });

    await expect(resolvePostLoginDestination(identity("conflict@example.com"), {
      tenancyRepository,
      platformRepository,
    })).rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.REPOSITORY_CONFLICT });
  });

  it("rethrows unexpected repository failures", async () => {
    const tenancyRepository = createInMemoryOnboardingRepository();
    const platformRepository = createInMemoryPlatformRepository();
    const databaseError = new Error("database unavailable");
    platformRepository.findActiveMemberByUserId = async () => { throw databaseError; };

    await expect(resolvePostLoginDestination(identity("failure@example.com"), {
      tenancyRepository,
      platformRepository,
    })).rejects.toBe(databaseError);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `corepack pnpm vitest run tests/unit/auth/post-login-destination.test.ts`

Expected: FAIL because `src/modules/auth/post-login-destination.ts` does not exist.

- [ ] **Step 3: Implement the minimal resolver**

```ts
import type { AuthIdentity } from "./auth-provider";
import {
  PlatformError,
  PLATFORM_ERROR_CODES,
  requirePlatformMember,
  type PlatformRepository,
} from "../platform/platform-service";
import type { OnboardingRepository } from "../tenancy/business-service";

export interface PostLoginDestinationDependencies {
  tenancyRepository: OnboardingRepository;
  platformRepository: PlatformRepository;
}

export async function resolvePostLoginDestination(
  identity: AuthIdentity,
  dependencies: PostLoginDestinationDependencies,
): Promise<"/admin" | "/onboarding"> {
  try {
    await requirePlatformMember(
      identity,
      dependencies.tenancyRepository,
      dependencies.platformRepository,
    );
    return "/admin";
  } catch (error) {
    if (error instanceof PlatformError && error.code === PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED) {
      return "/onboarding";
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `corepack pnpm vitest run tests/unit/auth/post-login-destination.test.ts`

Expected: 5 tests pass.

- [ ] **Step 5: Review the task diff without committing**

Run: `git diff --check -- src/modules/auth/post-login-destination.ts tests/unit/auth/post-login-destination.test.ts`

Expected: no whitespace errors. Do not commit without explicit operator authorization.

---

### Task 2: Continuation Route and Login Wiring

**Files:**
- Create: `src/app/(auth)/auth/continue/page.tsx`
- Modify: `src/ui/auth/AuthForm.tsx:53-81,88-131`
- Modify: `tests/unit/auth/production-auth-config.test.ts`
- Modify: `tests/e2e/platform/admin-panel.spec.ts`

**Interfaces:**
- Consumes: `resolvePostLoginDestination(identity, dependencies)` from Task 1.
- Produces: server route `/auth/continue`; successful production Firebase login target `/auth/continue`.

- [ ] **Step 1: Add failing production wiring assertions**

Change the first import in `tests/unit/auth/production-auth-config.test.ts` to:

```ts
import { existsSync, readFileSync } from "node:fs";
```

Then append this test:

```ts
it("routes successful production login through the server continuation boundary", () => {
  const authForm = source("ui/auth/AuthForm.tsx");
  const continuationUrl = new URL("../../../src/app/(auth)/auth/continue/page.tsx", import.meta.url);

  expect(authForm).toContain('router.replace("/auth/continue")');
  expect(existsSync(continuationUrl)).toBe(true);
  if (!existsSync(continuationUrl)) return;

  const continuation = readFileSync(continuationUrl, "utf8");
  expect(continuation).toContain("getCurrentIdentity");
  expect(continuation).toContain("resolvePostLoginDestination");
  expect(continuation).toContain('redirect("/login")');
});
```

- [ ] **Step 2: Run the wiring test and verify RED**

Run: `corepack pnpm vitest run tests/unit/auth/production-auth-config.test.ts`

Expected: FAIL because the continuation page does not exist and `AuthForm` still targets `/onboarding`.

- [ ] **Step 3: Create the continuation page**

```tsx
import { redirect } from "next/navigation";

import { getCurrentIdentity } from "@/modules/auth/session";
import { resolvePostLoginDestination } from "@/modules/auth/post-login-destination";
import { getPersistenceContext } from "@/modules/persistence/repository-factory";

export const dynamic = "force-dynamic";

export default async function PostLoginContinuationPage() {
  const identity = await getCurrentIdentity();
  if (!identity) redirect("/login");

  const persistence = getPersistenceContext();
  const destination = await resolvePostLoginDestination(identity, {
    tenancyRepository: persistence.tenancyRepository,
    platformRepository: persistence.platformRepository,
  });
  redirect(destination);
}
```

- [ ] **Step 4: Wire successful production Firebase login to the continuation page**

In `src/ui/auth/AuthForm.tsx`, replace both production login destinations:

```ts
if (!isDeterministicFirebaseTest) router.replace("/auth/continue");
```

Apply this to the Google redirect completion path and the email login path. Preserve the deterministic test-adapter guard and registration behavior.

- [ ] **Step 5: Run focused unit tests and verify GREEN**

Run: `corepack pnpm vitest run tests/unit/auth/post-login-destination.test.ts tests/unit/auth/production-auth-config.test.ts tests/unit/firebase-client.test.ts`

Expected: all focused tests pass.

- [ ] **Step 6: Add browser coverage for both destinations**

Add this test to `tests/e2e/platform/admin-panel.spec.ts`:

```ts
test("continues platform administrators to admin and ordinary users to onboarding", async ({ browser }) => {
  const admin = await browser.newPage();
  await signIn(admin, "platform-admin-panel@example.com");
  await admin.goto("/auth/continue");
  await expect(admin).toHaveURL(/\/admin(?:\?|$)/);
  await expect(admin.getByRole("heading", { name: "Platform administration" })).toBeVisible();
  await admin.close();

  const ordinary = await browser.newPage();
  await signIn(ordinary, "post-login-ordinary@example.com");
  await ordinary.goto("/auth/continue");
  await expect(ordinary).toHaveURL(/\/onboarding(?:\?|$)/);
  await ordinary.close();
});
```

- [ ] **Step 7: Run focused E2E**

Run: `corepack pnpm exec playwright test tests/e2e/platform/admin-panel.spec.ts`

Expected: all tests in `admin-panel.spec.ts` pass with no open browser-console errors caused by this change.

- [ ] **Step 8: Run the full quality gate**

Run these commands independently:

```text
corepack pnpm test
corepack pnpm lint
corepack pnpm exec tsc --noEmit
corepack pnpm build
corepack pnpm test:e2e
corepack pnpm audit --json
```

Expected: tests, lint, TypeScript, build, and E2E pass; audit reports zero known vulnerabilities.

- [ ] **Step 9: Security self-review**

Verify from the final diff that:

```text
- no email allowlist was added to application code
- only PLATFORM_ACCESS_DENIED maps to onboarding
- /admin still performs independent server-side authorization
- no token, cookie, role, or membership ID is returned to client code
- deterministic test-only behavior remains gated by NEXT_PUBLIC_FIREBASE_TEST_ADAPTER
```

- [ ] **Step 10: Review the final diff without committing or deploying**

Run: `git diff --check` and `git status --short`.

Expected: only intended files plus pre-existing unrelated work are present. Do not commit, push, or deploy without explicit operator authorization.
