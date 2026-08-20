# LH-001 Platform Date Hydration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate React hydration error `#418` from `/admin` by formatting platform dates in UTC on both server and browser renders.

**Architecture:** Extract platform date presentation into a pure `formatPlatformDate()` module with an explicit UTC contract. Test the formatter under an `America/Bogota` process timezone, then make `PlatformAdminPanel` consume it without changing DTOs, stored timestamps, lifecycle behavior, or component state.

**Tech Stack:** TypeScript, React 19, Next.js 15 App Router, `Intl.DateTimeFormat`, Vitest, Playwright MCP.

## Global Constraints

- Platform dates use `timeZone: "UTC"`; do not bind the global panel to an operator location.
- Keep locale mapping exactly `en -> en-GB` and `es -> es-ES`.
- Preserve `null` as `"\u2014"` and preserve the current `RangeError` for invalid dates.
- Do not change DTOs, repositories, database values, APIs, `serviceExpiresAt`, or lifecycle rules.
- Do not implement the global browser-console gate from `LH-002` in this task.
- Follow TDD: run the focused test red before creating the formatter module.
- Update `LH-001` in both the active summary and detailed task state as work progresses.
- Do not modify or stage the unrelated `tests/integration/postgres/native-schema.test.ts` file.
- Do not commit or deploy without separate operator authorization.

## File Structure

- Create `src/ui/platform/platform-date.ts`: pure UTC date formatter for the global platform UI.
- Modify `src/ui/platform/PlatformAdminPanel.tsx:6-33,256,273`: replace the implicit-zone helper with the pure formatter.
- Create `tests/unit/platform/platform-date.test.ts`: locale, null, invalid-date, and timezone-boundary behavior.
- Modify `tasks.md:21,32-50`: track `LH-001` through implementation and verification states.

---

### Task 1: Deterministic Platform Date Formatting

**Files:**
- Create: `src/ui/platform/platform-date.ts`
- Modify: `src/ui/platform/PlatformAdminPanel.tsx:6-33,256,273`
- Create: `tests/unit/platform/platform-date.test.ts`
- Modify: `tasks.md:21,32-50`

**Interfaces:**
- Consumes: ISO timestamp strings or `null`, plus `SupportedLocale` from `src/i18n/config.ts`.
- Produces: `formatPlatformDate(value: string | null, locale: SupportedLocale): string`.

- [ ] **Step 1: Mark LH-001 in progress**

In `tasks.md`, change only the summary row and detailed state for `LH-001`:

```markdown
| LH-001 | P0 | en progreso | Fix date hydration in `/admin` | Platform operator | 4.50 |
```

```markdown
- State: `en progreso`
```

- [ ] **Step 2: Write the failing formatter tests**

Create `tests/unit/platform/platform-date.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatPlatformDate } from "../../../src/ui/platform/platform-date";

const TIMEZONE_BOUNDARY = "2026-08-16T01:53:13.139Z";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("platform date formatting", () => {
  it("renders the UTC day in English when the process timezone is America/Bogota", () => {
    vi.stubEnv("TZ", "America/Bogota");

    expect(formatPlatformDate(TIMEZONE_BOUNDARY, "en")).toBe("16 Aug 2026");
  });

  it("renders the UTC day in Spanish when the process timezone is America/Bogota", () => {
    vi.stubEnv("TZ", "America/Bogota");

    expect(formatPlatformDate(TIMEZONE_BOUNDARY, "es")).toBe("16 ago 2026");
  });

  it("renders a missing date as an em dash", () => {
    expect(formatPlatformDate(null, "en")).toBe("\u2014");
  });

  it("does not hide invalid platform dates", () => {
    expect(() => formatPlatformDate("not-a-date", "en")).toThrow(RangeError);
  });
});
```

The realistic mutation this suite catches is removing `timeZone: "UTC"`: with `TZ=America/Bogota`, the first expectation becomes `15 Aug 2026`.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
corepack pnpm vitest run tests/unit/platform/platform-date.test.ts
```

Expected: FAIL because `src/ui/platform/platform-date.ts` does not exist. Confirm the failure is for the missing formatter module, not a typo in the test path.

- [ ] **Step 4: Implement the minimal UTC formatter**

Create `src/ui/platform/platform-date.ts`:

```ts
import type { SupportedLocale } from "@/i18n/config";

export function formatPlatformDate(value: string | null, locale: SupportedLocale): string {
  if (!value) return "\u2014";

  return new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-GB", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```powershell
corepack pnpm vitest run tests/unit/platform/platform-date.test.ts
```

Expected: 4 tests pass with no warnings.

- [ ] **Step 6: Integrate the formatter into PlatformAdminPanel**

Add this import beside the other UI imports in `src/ui/platform/PlatformAdminPanel.tsx`:

```ts
import { formatPlatformDate } from "@/ui/platform/platform-date";
```

Delete the local `dateFor` function at lines 31-33. Replace all five calls in the business and project date cells:

```tsx
formatPlatformDate(business.activatedAt, locale)
formatPlatformDate(business.serviceExpiresAt, locale)
formatPlatformDate(project.createdAt, locale)
formatPlatformDate(project.activatedAt, locale)
formatPlatformDate(project.reviewedAt, locale)
```

The project row contains three calls and the business row contains two. Do not alter labels, DTO fields, or markup.

- [ ] **Step 7: Run focused platform and auth tests**

Run:

```powershell
corepack pnpm vitest run tests/unit/platform tests/unit/auth
```

Expected: all focused tests pass. If a pre-existing test is skipped, report it separately instead of counting it as passed.

- [ ] **Step 8: Mark LH-001 in review**

In `tasks.md`, change the summary row and detailed state from `en progreso` to `revision`. Do not mark the task `aprobada` before the self-critique and full gates finish.

- [ ] **Step 9: Run the complete local quality gate**

Run these commands independently and record each result:

```text
corepack pnpm test
corepack pnpm lint
corepack pnpm exec tsc --noEmit
corepack pnpm build
corepack pnpm exec playwright test tests/e2e/platform/admin-panel.spec.ts
```

Expected: unit/integration tests, lint, typecheck, build, and scoped browser tests pass.

- [ ] **Step 10: Verify the local browser behavior**

Start the deterministic Playwright server and open `/admin` with Playwright MCP. Authenticate only with the local harness. Verify:

```text
- Platform administration heading is visible.
- Browser console contains no React #418.
- Browser reports no console.error or pageerror.
```

The pure unit test from Step 2 is the deterministic UTC/Bogota boundary proof; local fixture timestamps are not rewritten to manufacture the same boundary. Use Playwright MCP only for observable browser health. Do not use production credentials locally. After an explicitly authorized deployment, repeat the console check against Vercel, whose server runs in UTC, from the verified `America/Bogota` browser context.

- [ ] **Step 11: Run security and scope self-review**

Confirm from the final diff:

```text
- no stored timestamp or DTO changed
- no user, business, or provider timezone was inferred
- no identity, token, cookie, or business data was added to logs
- no external request, dependency, environment contract, or rate-limit surface was added
- only LH-001 files and approved tracking/spec/plan files changed
```

- [ ] **Step 12: Mark LH-001 approved and inspect the final diff**

Only after Steps 9-11 pass, change the summary row and detailed state from `revision` to `aprobada`. Add an evidence block under `LH-001` with the actual focused/full test counts, build result, and browser result.

Run:

```powershell
git diff --check
```

Expected: no whitespace errors; the unrelated native-schema test remains unstaged and untouched. Do not commit, push, deploy, or mark `desplegada` without explicit operator authorization.
