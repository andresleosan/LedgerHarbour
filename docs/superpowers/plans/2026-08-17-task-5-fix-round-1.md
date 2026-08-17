# Task 5 Fix Round 1 Implementation Plan

> **For agentic workers:** Execute inline task-by-task with TDD and verify every checkpoint before continuing.

**Goal:** Close the six Task 5 review findings without changing the project status model or expanding the global administration panel beyond the existing bounded queue.

**Architecture:** The canonical migration scripts will run and verify the ordered 0001 through 0005 chain, with the runner exposing one shared sequence for tests. Business project writes will use separate authenticated rate-limit scopes before parsing request bodies. In-memory project state will receive tenancy reference resolvers and effective access will read business, project, and membership inside nested repository transactions that map to one PostgreSQL transaction through the existing AsyncLocalStorage scope.

**Tech Stack:** TypeScript, Next.js, Zod, Vitest, PGlite, PostgreSQL/`pg`, Playwright, pnpm.

## Global Constraints

- Preserve project statuses `pending|active|rejected|suspended`.
- Business administrators create pending projects only.
- Platform transitions remain platform-only, CAS-protected, audited, and reasoned where required.
- Effective access requires active project membership, active project, and active business.
- Do not modify the pre-existing untracked `tests/integration/postgres/native-schema.test.ts`.
- Do not deploy, apply production migrations, add billing/secrets, or implement the Task 6 full panel.

---

### Task 1: Canonical 0005 Migration Sequence

**Files:**
- Modify: `src/db/migration-runner.ts`
- Modify: `scripts/db/migrate.ts`
- Modify: `scripts/db/check.ts`
- Modify: `tests/unit/db/migration-runner.test.ts`
- Modify: `tests/integration/postgres/test-database-migrations.test.ts`

- [x] **Step 1: Write RED tests** for the canonical apply/check sequence, required-project assertion, rollback, and reapply.
- [x] **Step 2: Run migration-focused tests and verify failure** because canonical scripts/checks omit `0005`.
- [x] **Step 3: Implement the ordered runner helpers** and wire both scripts to `0001 -> 0002 -> 0003 -> 0004 -> 0005`.
- [x] **Step 4: Run migration tests and verify GREEN** including project tables, ledger record, rollback, and reapply.

### Task 2: Business Project POST Rate Limits

**Files:**
- Modify: `src/modules/security/authenticated-rate-limit.ts`
- Modify: `src/modules/platform/platform-route-security.ts`
- Modify: `src/modules/security/rate-limit.ts`
- Modify: `src/app/api/businesses/[businessId]/projects/route.ts`
- Modify: `src/app/api/businesses/[businessId]/projects/[projectId]/members/route.ts`
- Test: `tests/integration/projects/project-rate-limit.test.ts`
- Test: `tests/unit/rate-limit.test.ts`

- [x] **Step 1: Write RED HTTP tests** proving project and membership POST requests return generic `429`/`503` before body parsing.
- [x] **Step 2: Run the tests and verify failure** because the routes currently parse JSON without a limiter.
- [x] **Step 3: Add separate `project-request` and `project-membership` scopes** and invoke the shared response mapper before `request.json()`.
- [x] **Step 4: Run HTTP and rate-limit tests and verify GREEN** for abuse and unavailable cases.

### Task 3: Memory Reference Parity

**Files:**
- Modify: `src/modules/projects/project-repository.ts`
- Modify: `src/modules/projects/project-service.ts`
- Test: `tests/unit/projects/project-repository.test.ts`

- [x] **Step 1: Write RED parity tests** for unknown business/project/user, mismatched project/business membership, and duplicate membership.
- [x] **Step 2: Run the repository tests and verify failure** because Memory currently accepts orphan records.
- [x] **Step 3: Add tenancy-backed reference resolvers** to Memory and enforce all foreign-key-equivalent checks before mutation.
- [x] **Step 4: Run repository and project-service tests and verify GREEN** without changing Postgres behavior.

### Task 4: Consistent Effective Access Snapshot

**Files:**
- Modify: `src/modules/projects/project-service.ts`
- Test: `tests/unit/projects/project-service.test.ts`

- [x] **Step 1: Write a RED concurrency test** that coordinates a business suspension with effective-access reads.
- [x] **Step 2: Run it and verify failure** because business/project/membership reads currently occur outside one transaction.
- [x] **Step 3: Read all three states under nested tenancy/project transactions** so Memory serializes snapshots and PostgreSQL reuses one DB transaction.
- [x] **Step 4: Run concurrency and full project tests and verify GREEN** with no access result based on a mixed snapshot.

### Task 5: Tracked Native Project Schema Test

**Files:**
- Create: `tests/integration/postgres/native-project-schema.test.ts`

- [x] **Step 1: Write the skipped-by-default native test** that applies 0001 through 0005 only when `TEST_DATABASE_URL` is configured.
- [x] **Step 2: Run it without the variable and verify the honest skip.**
- [x] **Step 3: Verify the test checks the 0005 ledger entry, project tables, constraints, and indexes when a native database is available.**

### Task 6: Focused E2E Lifecycle Coverage

**Files:**
- Modify: `src/app/(platform)/admin/projects/project-queue.tsx`
- Modify: `tests/e2e/platform/project-approval.spec.ts`

- [x] **Step 1: Extend the E2E RED scenario** to use queue actions for reject, approve, suspend, and reactivate with reasons.
- [x] **Step 2: Run the E2E test and verify failure** for the missing lifecycle interaction coverage.
- [x] **Step 3: Add only the inline controls and optional reactivation reason**; do not build the full Task 6 panel.
- [x] **Step 4: Run the focused E2E and verify GREEN.**

### Task 7: Final QA, Report, and Commit

**Files:**
- Modify: `.superpowers/sdd/2026-08-16-platform-administration-production/task-5-report.md`

- [x] **Step 1: Run focused RED/GREEN evidence, full suite, E2E, typecheck, lint, build, audit, and native skip checks.**
- [x] **Step 2: Apply the security and advanced-QA review to the changed code.**
- [x] **Step 3: Record Fix Round 1 results and concerns in the report.**
- [x] **Step 4: Stage only intended files, keep the pre-existing native test untracked, and commit the fix round.**
