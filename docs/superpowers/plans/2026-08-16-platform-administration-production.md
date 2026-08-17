# Platform Administration and Production Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement global platform administration, approval-gated businesses/projects, manual subscription suspension, production-only runtime behavior, and logout from onboarding and authenticated areas.

**Architecture:** Add a global control-plane module beside the existing tenant-scoped tenancy services. Persist platform members, business/project lifecycle state, requests, and append-only platform audit events; enforce the resulting effective-access policy in server services and routes. Reuse the existing Firebase session boundary and AppShell patterns, with test-only injected providers kept outside production runtime selection.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Drizzle ORM, PostgreSQL/PGlite, Zod, Vitest, Playwright, Firebase Authentication, Google Document AI.

## Global Constraints

- `platform_admin` is a global role and all platform administrators have equal permissions.
- `andres.san1404@gmail.com` and partners are bootstrapped through controlled database data, never an application-code email allowlist.
- Any account may request a business, but a business remains `pending` until a platform administrator approves it.
- The approved business requester becomes `owner_admin` only after business approval.
- Projects remain `pending` until a platform administrator approves them.
- Business statuses are exactly `pending|active|suspended|rejected`; do not add `expired`.
- Project statuses are exactly `pending|active|rejected|suspended`.
- Subscription activation and suspension are manual in this version; payment gateway integration is out of scope.
- Suspending a business denies access to its projects, memberships, administrators, and APIs without deleting historical data.
- Firebase Authentication is mandatory for runtime; development auth and demo copy are not production behavior.
- Google Document AI is mandatory for runtime OCR; fake OCR may exist only as an injected test double.
- Do not deploy, enable billing, run paid OCR, apply production migrations, or write production secrets without explicit operator confirmation.

---

## File Map

- Create `src/modules/platform/types.ts` for global roles, lifecycle states, requests, and DTO contracts.
- Create `src/modules/platform/platform-service.ts` for platform authorization, approval, suspension, and bootstrap operations.
- Create `src/modules/platform/platform-repository.ts` for repository interfaces and in-memory implementation used by unit/integration tests.
- Create `src/modules/platform/platform-audit-service.ts` for append-only global audit events.
- Create `src/modules/projects/project-service.ts` and `src/modules/projects/project-repository.ts` for project requests, approvals, memberships, and effective access.
- Create `src/db/schema/platform-members.ts`, `src/db/schema/platform-audit-events.ts`, `src/db/schema/projects.ts`, `src/db/schema/project-memberships.ts` and update `src/db/schema/index.ts`.
- Create `src/db/migrations/0002_platform_control_plane.sql` with a reversible down script under `src/db/migrations/rollback/0002_platform_control_plane_down.sql`.
- Create `src/app/(platform)/layout.tsx`, `src/app/(platform)/admin/page.tsx`, `src/app/(platform)/admin/businesses/page.tsx`, `src/app/(platform)/admin/projects/page.tsx`, and `src/app/(platform)/admin/administrators/page.tsx`.
- Create platform API routes under `src/app/api/platform/**`.
- Modify existing business creation, join-request, membership, and lifecycle services/routes to enforce approval states.
- Modify `src/app/onboarding/page.tsx`, `src/app/onboarding/create-business/page.tsx`, and `src/app/onboarding/join-business/page.tsx` for pending feedback and logout.
- Modify `src/app/(app)/layout.tsx`, `src/ui/AppShell.tsx`, `src/app/page.tsx`, `src/ui/auth/AuthForm.tsx`, and auth provider selection for production behavior.
- Create focused unit, integration, security, and E2E tests under matching existing `tests/` directories.

---

### Task 1: Add Production Runtime Boundary and Shared Logout

**Files:**
- Create: `src/app/onboarding/actions.ts`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/ui/AppShell.tsx`
- Modify: `src/app/onboarding/page.tsx`
- Modify: `src/app/onboarding/create-business/page.tsx`
- Modify: `src/app/onboarding/join-business/page.tsx`
- Modify: `src/app/page.tsx`, `src/ui/auth/AuthForm.tsx`
- Modify: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/register/page.tsx`
- Modify: `src/modules/auth/dev-auth-provider.ts`, `src/modules/invoices/ocr-provider-factory.ts`, `.env.example`
- Test: `tests/unit/auth/production-auth-config.test.ts`, `tests/unit/invoices/ocr-provider-factory.test.ts`, `tests/e2e/auth/login.spec.ts`, `tests/e2e/onboarding/logout.spec.ts`

**Interfaces:**
- Produce `signOutAction(): Promise<never>` that clears the server session and redirects to `/login`.
- Produce runtime selection that accepts Firebase/Google production providers only outside test harnesses.

- [ ] **Step 1: Write failing tests**

Assert that the production auth boundary rejects development auth, runtime OCR rejects `fake` outside tests, the landing page contains no `Open demo`, and a form action logout redirects to `/login` and removes the session.

- [ ] **Step 2: Run the focused tests and verify RED**

Run `corepack pnpm exec vitest run tests/unit/auth/production-auth-config.test.ts tests/unit/invoices/ocr-provider-factory.test.ts` and `corepack pnpm exec playwright test tests/e2e/auth/login.spec.ts tests/e2e/onboarding/logout.spec.ts`.

Expected: production configuration and logout assertions fail against the current development/demo behavior.

- [ ] **Step 3: Implement the shared logout action**

Move the existing server-side clear-and-redirect behavior from `(app)/layout.tsx` into `src/app/onboarding/actions.ts` or a shared server action module. Reuse it from AppShell and onboarding. Keep Firebase client sign-out before the server action when Firebase configuration is present.

- [ ] **Step 4: Remove demo runtime and copy**

Make login/register instantiate Firebase only in runtime mode, remove simulated Google/demo-account copy, remove `Open demo` from the landing page, and make Playwright set a test-only provider explicitly through its test web server environment rather than production defaults. Keep deterministic test doubles injectable only under `NODE_ENV=test`.

- [ ] **Step 5: Run GREEN and static checks**

Run `corepack pnpm exec vitest run tests/unit/auth/production-auth-config.test.ts tests/unit/invoices/ocr-provider-factory.test.ts`, `corepack pnpm exec playwright test tests/e2e/auth/login.spec.ts tests/e2e/onboarding/logout.spec.ts`, and `corepack pnpm exec tsc --noEmit`.

- [ ] **Step 6: Commit**

Run `git add src/app/onboarding/actions.ts src/app/(app)/layout.tsx src/ui/AppShell.tsx src/app/onboarding src/app/page.tsx src/ui/auth/AuthForm.tsx src/app/(auth) src/modules/auth src/modules/invoices/ocr-provider-factory.ts .env.example tests/unit/auth/production-auth-config.test.ts tests/unit/invoices/ocr-provider-factory.test.ts tests/e2e/auth/login.spec.ts tests/e2e/onboarding/logout.spec.ts` and commit `feat: remove demo runtime and add shared logout`.

---

### Task 2: Add Platform Control-Plane Schema and Bootstrap

**Files:**
- Create: `src/db/schema/platform-members.ts`, `src/db/schema/platform-audit-events.ts`
- Create: `src/db/migrations/0002_platform_control_plane.sql`
- Create: `src/db/migrations/rollback/0002_platform_control_plane_down.sql`
- Create: `scripts/db/bootstrap-platform-admins.ts`
- Modify: `src/db/schema/index.ts`, `src/db/migration-runner.ts`, `docs/STACK.md`
- Test: `tests/unit/platform/platform-schema.test.ts`, `tests/integration/postgres/platform-schema.test.ts`

**Interfaces:**
- `platform_members`: `id`, nullable linked `user_id`, normalized email, role `platform_admin`, active flag, created/updated timestamps.
- `platform_audit_events`: actor, action, target type/id, before/after status, reason, timestamp; append-only.
- Bootstrap command accepts an explicit list of verified operator emails and is never called by request handlers.

- [ ] **Step 1: Write failing schema and bootstrap tests**

Test unique normalized platform email, active-role constraints, append-only audit behavior, migration table creation, and bootstrap idempotence for `andres.san1404@gmail.com` plus partner emails supplied by the command.

- [ ] **Step 2: Run RED**

Run `corepack pnpm exec vitest run tests/unit/platform/platform-schema.test.ts tests/integration/postgres/platform-schema.test.ts`.

Expected: the new tables and repository contracts do not exist.

- [ ] **Step 3: Implement Drizzle schema and SQL migration**

Add explicit enums/checks/indexes, link platform users to existing `users` when available, and ensure audit events cannot be updated or deleted. Provide the rollback SQL without executing it against production.

- [ ] **Step 4: Implement controlled bootstrap**

Create an idempotent script that receives operator emails from an explicit command argument or non-production bootstrap environment, normalizes them, and creates active `platform_admin` records. Do not place those emails in application authorization code.

- [ ] **Step 5: Run GREEN and migration checks**

Run `corepack pnpm exec vitest run tests/unit/platform/platform-schema.test.ts tests/integration/postgres/platform-schema.test.ts`, `corepack pnpm db:native-check`, and `corepack pnpm exec tsc --noEmit`.

- [ ] **Step 6: Commit**

Commit as `feat: add platform control plane persistence`.

---

### Task 3: Gate Business Creation and Platform Approval

**Files:**
- Modify: `src/modules/tenancy/types.ts`, `src/modules/tenancy/business-service.ts`, `src/modules/tenancy/postgres-tenancy-repository.ts`, `src/modules/persistence/repository-factory.ts`, `src/app/api/businesses/route.ts`
- Create: `src/modules/platform/platform-service.ts`, `src/modules/platform/platform-repository.ts`
- Create: `src/app/api/platform/businesses/route.ts`, `src/app/api/platform/businesses/[businessId]/approve/route.ts`, `src/app/api/platform/businesses/[businessId]/reject/route.ts`, `src/app/api/platform/businesses/[businessId]/suspend/route.ts`, `src/app/api/platform/businesses/[businessId]/reactivate/route.ts`
- Modify: `src/app/onboarding/create-business/page.tsx`, `src/app/(app)/layout.tsx`
- Test: `tests/unit/platform/business-approval.test.ts`, `tests/integration/tenancy/business-approval.test.ts`, `tests/security/platform-authorization.test.ts`, `tests/e2e/platform/business-approval.spec.ts`

**Interfaces:**
- `BusinessStatus = "pending" | "active" | "suspended" | "rejected"`.
- `createBusinessRequest(input, requester)` creates a pending business with no active membership.
- `approveBusiness(businessId, actor, input)` atomically activates the business, creates the requester membership as `owner_admin`, records activation/subscription dates, and appends an audit event.
- `suspendBusiness` and `reactivateBusiness` update manual service fields and effective access.

- [ ] **Step 1: Write failing approval tests**

Cover pending creation, no operational access before approval, platform admin approval, requester becoming `owner_admin`, rejection, suspension/reactivation, and non-platform denial.

- [ ] **Step 2: Run RED**

Run `corepack pnpm exec vitest run tests/unit/platform/business-approval.test.ts tests/security/platform-authorization.test.ts tests/integration/tenancy/business-approval.test.ts`.

- [ ] **Step 3: Implement the state machine and transaction**

Change business creation from active to pending, remove the automatic active owner membership, enforce valid transitions, and execute approval/rejection/suspension in one repository transaction with audit event creation.

- [ ] **Step 4: Enforce effective access**

Update `getCurrentIdentity`-based layouts, business listing, search, join-request, upload, OCR, review, settings, and lifecycle routes so pending/rejected/suspended businesses cannot use operational APIs. Pending request status remains visible only to the requester/platform panel.

- [ ] **Step 5: Update onboarding copy and E2E**

Replace immediate “Business created” copy with “Request submitted and awaiting platform approval”, add status polling/refresh where needed, and make the platform approval E2E approve the request before entering the business.

- [ ] **Step 6: Run GREEN and commit**

Run the focused Vitest/security/integration tests and `corepack pnpm exec playwright test tests/e2e/platform/business-approval.spec.ts`; commit `feat: gate businesses behind platform approval`.

---

### Task 4: Add Business Administrator Approval and Cascading Suspension

**Files:**
- Modify: `src/modules/tenancy/join-request-service.ts`, `src/modules/tenancy/membership-service.ts`, `src/app/api/businesses/[businessId]/join-requests/route.ts`, `src/app/api/businesses/[businessId]/members/[membershipId]/route.ts`
- Create: `src/app/api/platform/administrators/route.ts`, `src/app/api/platform/administrators/[membershipId]/approve/route.ts`, `src/app/api/platform/administrators/[membershipId]/suspend/route.ts`
- Modify: `src/modules/permissions/roles.ts`, `src/modules/permissions/authorize.ts`, `src/modules/tenancy/tenant-context.ts`
- Test: `tests/unit/platform/administrator-approval.test.ts`, `tests/integration/tenancy/administrator-approval.test.ts`, `tests/security/platform-authorization.test.ts`, `tests/e2e/platform/administrator-approval.spec.ts`

**Interfaces:**
- Platform administrator actions use global authorization and do not rely on business membership.
- Business administrators retain business-scoped approval of internal administrator requests.
- `effectiveBusinessAccess(businessId, userId)` returns a denial reason for pending, rejected, or suspended business state before membership capabilities are evaluated.

- [ ] **Step 1: Write failing tests**

Test platform approval/revocation, business-admin approval of allies, cross-business denial, and suspension cascading to every linked membership/project/API.

- [ ] **Step 2: Run RED**

Run `corepack pnpm exec vitest run tests/unit/platform/administrator-approval.test.ts tests/integration/tenancy/administrator-approval.test.ts tests/security/platform-authorization.test.ts`.

- [ ] **Step 3: Implement authorization boundaries**

Add platform capability checks, preserve existing business capabilities, and make every business-scoped mutation call effective access before changing state.

- [ ] **Step 4: Implement global administrator endpoints**

Return safe administrator DTOs only. Require explicit action and reason for suspend/revoke operations, write audit events, and return generic errors for unauthorized callers.

- [ ] **Step 5: Run GREEN and browser flow**

Run focused tests and `corepack pnpm exec playwright test tests/e2e/platform/administrator-approval.spec.ts`; commit `feat: control business administrators globally`.

---

### Task 5: Add Projects and Global Project Approval

**Files:**
- Create: `src/modules/projects/project-service.ts`, `src/modules/projects/project-repository.ts`, `src/modules/projects/types.ts`
- Create: `src/db/schema/projects.ts`, `src/db/schema/project-memberships.ts`
- Create: `src/db/migrations/0003_projects.sql`, `src/db/migrations/rollback/0003_projects_down.sql`
- Modify: `src/db/schema/index.ts`, `src/db/migration-runner.ts`
- Create: `src/app/api/businesses/[businessId]/projects/route.ts`, `src/app/api/businesses/[businessId]/projects/[projectId]/members/route.ts`
- Create: `src/app/api/platform/projects/route.ts`, `src/app/api/platform/projects/[projectId]/approve/route.ts`, `src/app/api/platform/projects/[projectId]/reject/route.ts`, `src/app/api/platform/projects/[projectId]/suspend/route.ts`, `src/app/api/platform/projects/[projectId]/reactivate/route.ts`
- Create: `src/app/(app)/business/[businessId]/projects/page.tsx`, `src/app/(platform)/admin/projects/page.tsx`
- Test: `tests/unit/projects/project-service.test.ts`, `tests/integration/projects/project-approval.test.ts`, `tests/security/project-isolation.test.ts`, `tests/e2e/platform/project-approval.spec.ts`

**Interfaces:**
- `ProjectStatus = "pending" | "active" | "rejected" | "suspended"`.
- Business admin `createProjectRequest` creates pending projects only.
- Platform `approveProject`, `rejectProject`, `suspendProject`, and `reactivateProject` enforce global role and audit changes.
- `getEffectiveProjectAccess` denies access unless project and parent business are active.

- [ ] **Step 1: Write failing service and access tests**

Cover pending project creation, platform approval, rejection, project suspension, parent-business suspension, project membership isolation, and non-platform API denial.

- [ ] **Step 2: Run RED and implement schema**

Run `corepack pnpm exec vitest run tests/unit/projects/project-service.test.ts tests/integration/projects/project-approval.test.ts tests/security/project-isolation.test.ts`; add schema and reversible migration only after the tests express the contract.

- [ ] **Step 3: Implement project services and routes**

Validate names and membership inputs with Zod, use tenant-aware repository methods, and return pending DTOs without granting operational access.

- [ ] **Step 4: Implement project UI**

Add a business administrator project request screen and global admin project queue with status filters and approval/rejection/suspension actions.

- [ ] **Step 5: Run GREEN and E2E**

Run focused tests and `corepack pnpm exec playwright test tests/e2e/platform/project-approval.spec.ts`; commit `feat: add approval-gated projects`.

---

### Task 6: Build the Global Administration Panel

**Files:**
- Create: `src/app/(platform)/layout.tsx`, `src/app/(platform)/admin/page.tsx`, `src/app/(platform)/admin/businesses/page.tsx`, `src/app/(platform)/admin/administrators/page.tsx`
- Create: `src/ui/platform/PlatformShell.tsx`, `src/ui/platform/StatusBadge.tsx`, `src/ui/platform/ActionDialog.tsx`
- Create: `src/app/api/platform/summary/route.ts`, `src/app/api/platform/audit-events/route.ts`
- Modify: `src/ui/AppShell.tsx`, `src/i18n/messages/en.json`, `src/i18n/messages/es.json`
- Test: `tests/e2e/platform/admin-panel.spec.ts`, `tests/e2e/platform/admin-mobile.spec.ts`

**Interfaces:**
- Platform layout redirects non-platform users to `/portfolio` and loads only platform-admin safe DTOs.
- Panel navigation exposes **Businesses**, **Projects**, and **Administrators**.
- Every destructive/status action requires a confirmation and reason, then refreshes the table from the server.

- [ ] **Step 1: Write failing browser assertions**

Assert the three panel sections, pending queues, business/project/admin columns, activation and service expiration dates, status actions, platform-only access, Spanish copy, keyboard focus, and no mobile overflow.

- [ ] **Step 2: Run RED**

Run `corepack pnpm exec playwright test tests/e2e/platform/admin-panel.spec.ts tests/e2e/platform/admin-mobile.spec.ts`.

- [ ] **Step 3: Implement platform layout and summary API**

Load the Firebase identity, resolve the linked `platform_members` record, enforce active `platform_admin`, and return aggregate counts plus safe records. Never authorize from UI state or email text.

- [ ] **Step 4: Implement the three panel views**

Use the approved visual language, one global language control, status badges, responsive tables/cards, explicit dates, and action feedback. Keep all labels in English/Spanish message catalogs.

- [ ] **Step 5: Run GREEN and E2E**

Run the focused browser tests, `corepack pnpm lint`, and `corepack pnpm exec tsc --noEmit`; commit `feat: add platform administration panel`.

---

### Task 7: Production Configuration, Documentation, and Migration Gate

**Files:**
- Modify: `.env.example`, `docs/STACK.md`, `docs/google-document-ai.md`, `docs/rate-limiting.md`
- Create: `docs/platform-administration.md`, `docs/production-activation.md`
- Modify: `playwright.config.ts`, `.github/workflows/*` if present
- Test: `tests/unit/config/production-gate.test.ts`, `tests/e2e/production/no-demo-copy.spec.ts`

**Interfaces:**
- Production gate requires `AUTH_MODE=firebase`, `OCR_PROVIDER=google-document-ai`, `PERSISTENCE_MODE=postgres`, `STORAGE_MODE=r2`, `RATE_LIMIT_MODE=upstash`, and all referenced private/public Firebase, R2, Upstash, database, and Google variables.
- Playwright test web server explicitly uses only test-safe providers; it must never make a paid OCR request.

- [ ] **Step 1: Write failing production gate tests**

Assert incomplete production configuration fails with generic errors, development auth/fake OCR are rejected outside tests, landing/login/register contain no demo copy, and test web server defaults are explicit.

- [ ] **Step 2: Run RED**

Run `corepack pnpm exec vitest run tests/unit/config/production-gate.test.ts` and `corepack pnpm exec playwright test tests/e2e/production/no-demo-copy.spec.ts`.

- [ ] **Step 3: Implement the gate and docs**

Centralize environment validation without logging secret values. Document manual platform bootstrap, Firebase verification, Google processor setup, R2 privacy, Upstash requirements, subscription status operation, rollback, and the exact operator-controlled activation procedure.

- [ ] **Step 4: Run GREEN and static verification**

Run `corepack pnpm exec vitest run tests/unit/config/production-gate.test.ts`, `corepack pnpm lint`, `corepack pnpm exec tsc --noEmit`, `corepack pnpm build`, and `corepack pnpm audit --json`; commit `docs: define production activation gate`.

---

### Task 8: Full Security and Browser Release Verification

**Files:**
- Modify: `task-8-security-report.md`
- Create: `tests/e2e/platform/full-administration.spec.ts`

- [ ] **Step 1: Run the complete local suite**

Run `corepack pnpm test`, `corepack pnpm lint`, `corepack pnpm exec tsc --noEmit`, `corepack pnpm build`, and `corepack pnpm audit --json`.

- [ ] **Step 2: Run the full browser flow**

With test-only auth/OCR fixtures, create a pending business, approve it as a platform admin, create and approve a project, add/approve an administrator, suspend the business, verify all linked access is denied, reactivate it, and exercise logout from onboarding and the authenticated shell.

- [ ] **Step 3: Run the security review**

Verify server-side platform authorization, tenant isolation, pending/suspended deny gates, no secrets in DTOs/logs, append-only audit events, rate limits, production config fail-closed behavior, and no demo UI/runtime path.

- [ ] **Step 4: Record evidence and stop before production activation**

Update `task-8-security-report.md` with exact command output, counts, known warnings, migration rollback evidence, and the remaining manual operator steps. Do not deploy, enable billing, configure real secrets, or run paid OCR in this task.

- [ ] **Step 5: Commit**

Commit `test: verify platform administration release gate` only after all checks pass.
