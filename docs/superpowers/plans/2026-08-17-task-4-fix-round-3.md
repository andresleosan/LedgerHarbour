# Task 4 Fix Round 3 Implementation Plan

> **For agentic workers:** Execute inline task-by-task with TDD and verify every checkpoint before continuing.

**Goal:** Remove implicit active-membership fallbacks, prove migration 0004 apply/rollback/reapply through an injectable runner on PGlite, and normalize the E2E administrator email comparison.

**Architecture:** Authorization gates will use an explicit `status === "active" && isActive === true` predicate. The migration runner will accept an injectable database client adapter so production keeps `pg.Client` while PGlite tests execute the same 0004 runner path without manually inserting ledger state. Existing one-time Firebase claim and platform DTO boundaries remain unchanged.

**Tech Stack:** TypeScript, Vitest, PGlite, PostgreSQL/`pg`, Next.js, Playwright, pnpm.

## Global Constraints

- No projects or global panel implementation.
- Firebase platform claim remains one-time and normal authorization remains `platform_members.user_id` based.
- Do not relax authorization for omitted or legacy membership status.
- Do not apply migrations to production.
- Preserve the pre-existing untracked `tests/integration/postgres/native-schema.test.ts` outside the commit.

---

### Task 1: Explicit Membership Lifecycle Gates

**Files:**
- Modify: `src/modules/tenancy/tenant-context.ts`
- Modify: `src/modules/permissions/authorize.ts`
- Modify: document/job services found by the status fallback search
- Modify: legacy fixtures and direct membership test data
- Test: tenancy, permission, document, and job tests covering the gates

- [x] **Step 1: Add RED tests for omitted status and inconsistent status.**
- [x] **Step 2: Run the focused tests and verify they fail because omitted status is accepted.**
- [x] **Step 3: Remove every authorization fallback that treats missing status as active.**
- [x] **Step 4: Update valid fixtures to include `status: "active"`.**
- [x] **Step 5: Run the focused tests and verify GREEN.**

### Task 2: Injectable Migration Runner Coverage

**Files:**
- Modify: `src/db/migration-runner.ts`
- Modify: `tests/integration/postgres/test-database-migrations.test.ts`
- Modify: `tests/unit/db/migration-runner.test.ts`
- Test: PGlite apply, ledger, schema constraints, rollback, and reapply

- [x] **Step 1: Add a RED test using a fresh PGlite database and the real membership runner path.**
- [x] **Step 2: Verify the test fails because the runner is hard-wired to `pg.Client`.**
- [x] **Step 3: Add the minimal injectable client/factory boundary while preserving production configuration.**
- [x] **Step 4: Execute 0004 through the runner, verify ledger/column/constraints, execute rollback, and reapply.**
- [x] **Step 5: Run migration-focused tests and verify GREEN.**

### Task 3: Normalized E2E Identity Assertion

**Files:**
- Modify: `tests/e2e/platform/administrator-approval.spec.ts`

- [x] **Step 1: Change the target lookup to `item.email?.toLowerCase() === "task4-member@example.com"`.**
- [x] **Step 2: Run the focused E2E and verify the exact member is selected.**

### Task 4: Final QA and Report

**Files:**
- Modify: `.superpowers/sdd/2026-08-16-platform-administration-production/task-4-report.md`

- [x] **Step 1: Run focused RED/GREEN evidence, full suite, E2E, typecheck, lint, build, audit, and diff checks sequentially.**
- [x] **Step 2: Record Fix Round 3 results and honest native Postgres skip status.**
- [x] **Step 3: Review staged files, excluding the pre-existing native schema test.**
- [x] **Step 4: Commit with a concise Fix Round 3 message.**
