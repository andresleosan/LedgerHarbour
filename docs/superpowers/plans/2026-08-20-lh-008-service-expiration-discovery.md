# LH-008 Service Expiration Discovery Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an evidence-based product brief for reducing manual service-expiration follow-up with notifications first, without changing production behavior.

**Architecture:** This is a documentation-only discovery. It will describe a future read-only expiration evaluator and notification boundary, but will not create a scheduler, worker, provider integration, lifecycle mutation, or database migration. Automatic suspension remains a separate decision after measurement and explicit operator approval.

**Tech Stack:** Markdown documentation, existing TypeScript/Next.js domain contracts, Drizzle schema inspection, Git diff checks.

## Global Constraints

- Primary users are platform operators and business administrators.
- The measurable outcome is reduced manual expiration follow-up.
- Compare informational dates, notifications, and automatic suspension.
- Recommend notifications with a dry-run/observation phase before delivery.
- Do not add schedulers, workers, cron routes, notification providers, dependencies, migrations, deployments, billing changes, or production mutations.
- Do not access credentials, customer data exports, external services, or provider dashboards.
- Preserve the existing `serviceExpiresAt` field and business lifecycle behavior.
- LH-008 remains `revision`; it cannot become `aprobada` until a later implementation decision is explicitly approved.

---

### Task 1: Establish Current Expiration Semantics

**Files:**
- Read: `src/db/schema/businesses.ts`
- Read: `src/modules/platform/platform-service.ts`
- Read: `src/app/api/platform/businesses/[businessId]/approve/route.ts`
- Read: `src/ui/platform/PlatformAdminPanel.tsx`
- Read: `src/ui/platform/ActionDialog.tsx`
- Read: `src/modules/tenancy/business-service.ts`
- Read: `src/modules/tenancy/postgres-tenancy-repository.ts`
- Create: `docs/superpowers/specs/2026-08-20-lh-008-service-expiration-discovery-brief.md`

**Interfaces:**
- Consumes: the existing `serviceExpiresAt`, business status, lifecycle transition, and audit-event contracts.
- Produces: a documented baseline of current date semantics, eligible lifecycle states, existing authorization boundaries, and unresolved operational decisions.

- [ ] **Step 1: Inspect the current data and lifecycle contract**

  Read the listed files and record only facts supported by source:

  - `businesses.serviceExpiresAt` is a timezone-aware timestamp.
  - Approval accepts a required date string and converts it before lifecycle update.
  - Approval writes `status`, `activatedAt`, `serviceExpiresAt`, and audit data.
  - The UI displays the expiration date and does not currently run expiration actions.
  - Existing statuses include `pending`, `active`, `suspended`, and `rejected`.

- [ ] **Step 2: Record baseline and evidence in the brief**

  Add a `Current State` section to the brief with source paths and line ranges.
  State that the discovery does not infer a business timezone from the current
  UTC conversion and that the final-day interpretation must be decided before
  automation.

- [ ] **Step 3: Check the brief for unsupported assumptions**

  Run:

  ```powershell
  git diff --check -- docs/superpowers/specs/2026-08-20-lh-008-service-expiration-discovery-brief.md
  ```

  Confirm the output has no whitespace errors and that no credential, customer
  record, or provider response was copied into the document.

- [ ] **Step 4: Commit the baseline**

  ```powershell
  git add -- docs/superpowers/specs/2026-08-20-lh-008-service-expiration-discovery-brief.md
  git commit -m "docs: capture service expiration baseline"
  ```

### Task 2: Compare Product Alternatives and RICE

**Files:**
- Modify: `docs/superpowers/specs/2026-08-20-lh-008-service-expiration-discovery-brief.md`
- Read: `tasks.md:323-341`
- Read: `docs/superpowers/specs/2026-08-20-lh-008-service-expiration-automation-design.md`

**Interfaces:**
- Consumes: Task 1 current-state baseline and the approved discovery direction.
- Produces: an alternatives matrix, recommendation, outcome metric, and updated RICE rationale.

- [ ] **Step 1: Add the alternatives matrix**

  Document these exact alternatives:

  | Alternative | Manual-work effect | Customer risk | Reversibility | Decision |
  |---|---|---|---|---|
  | Informational date | Low improvement | Lowest | Immediate | Keep only as fallback |
  | Notifications | Direct improvement | Low if read-only | High | Recommend |
  | Automatic suspension | Highest potential improvement | Highest | Requires recovery | Defer |

  State why notifications are the recommended next phase and why suspension is
  not authorized by this task.

- [ ] **Step 2: Define the measurement plan**

  Add a primary metric for hours spent on manual expiration follow-up and the
  following secondary measures: eligible records identified before the window,
  delivery/retry success, duplicate alerts, stale alerts after renewal, time to
  resolution, and manual overrides/support incidents.

  Describe a low-cost baseline method using aggregate counts or an operator log;
  do not request customer exports or connect to an external analytics service.

- [ ] **Step 3: Reassess RICE explicitly**

  Recalculate the proposed notification phase using the repository's four-part
  RICE model and show reach, impact, confidence, effort, and the resulting
  score. Explain whether the current `2.75` backlog score should change and why.

- [ ] **Step 4: Verify the recommendation is internally consistent**

  Confirm that the brief recommends notification dry-run, does not recommend
  automatic suspension in the current task, and ties the recommendation to the
  manual-work metric rather than visual polish.

- [ ] **Step 5: Commit the alternatives**

  ```powershell
  git add -- docs/superpowers/specs/2026-08-20-lh-008-service-expiration-discovery-brief.md
  git commit -m "docs: compare service expiration options"
  ```

### Task 3: Define Operational and Security Gates

**Files:**
- Modify: `docs/superpowers/specs/2026-08-20-lh-008-service-expiration-discovery-brief.md`
- Read: `src/db/schema/audit-events.ts`
- Read: `src/modules/tenancy/postgres-tenancy-repository.ts`
- Read: `src/modules/platform/platform-service.ts`
- Read: `src/modules/security/auth-rate-limit.ts`

**Interfaces:**
- Consumes: the recommended notification phase and existing audit/authorization boundaries.
- Produces: an implementation gate checklist covering time, eligibility, recipients, delivery, retries, idempotency, audit, rollback, and failure modes.

- [ ] **Step 1: Specify time and eligibility rules**

  Add explicit decision fields for canonical timezone, final-day interpretation,
  pre-expiration windows, post-expiration grace period, eligible statuses, and
  renewal/date-edit invalidation. Do not choose a timezone or grace period by
  assumption; identify the operator decision required before implementation.

- [ ] **Step 2: Specify notification behavior**

  Define recipient classes, locale/content requirements, a provider-neutral
  delivery boundary, rate limits, retry/backoff limits, failure visibility, and
  a stable deduplication key composed of business, expiration event, window, and
  current expiration value.

- [ ] **Step 3: Specify audit and recovery behavior**

  Require auditable evaluation, notification attempt, delivery result, and
  operator action. For any future lifecycle mutation, require before/after state,
  reason, actor or job identity, expiration value, correlation ID, compare-and-set
  guard, and an authorized manual recovery path.

- [ ] **Step 4: Add security review and non-goals**

  Record that notification data is sensitive operational data, logs must avoid
  unnecessary message content, existing authorization remains mandatory, and a
  provider outage or duplicate job must not mutate lifecycle state.

- [ ] **Step 5: Commit the operational gates**

  ```powershell
  git add -- docs/superpowers/specs/2026-08-20-lh-008-service-expiration-discovery-brief.md
  git commit -m "docs: define expiration automation safety gates"
  ```

### Task 4: Record Discovery Completion Without Approving Implementation

**Files:**
- Modify: `docs/superpowers/specs/2026-08-20-lh-008-service-expiration-discovery-brief.md`
- Modify: `tasks.md:323-341`

**Interfaces:**
- Consumes: the completed brief and its review checklist.
- Produces: LH-008 evidence in `revision`, with no implementation authorization.

- [ ] **Step 1: Complete the acceptance checklist in the brief**

  Verify that the brief contains affected users, the manual-work outcome, all
  alternatives, recommendation, timing rules, recipients, retries,
  idempotency, audit, rollback, provider failure behavior, measurement, RICE,
  and explicit implementation approval gates.

- [ ] **Step 2: Update the LH-008 ledger entry**

  Add the brief path, recommendation, alternatives, RICE reassessment, and
  exact static verification commands to the `LH-008` entry. Keep its state as
  `revision`; do not write `aprobada`, `desplegada`, or a production claim.

- [ ] **Step 3: Run documentation-only verification**

  ```powershell
  git diff --check
  git status --short
  git grep -n "LH-008\|serviceExpiresAt\|automatic suspension\|notification" -- docs/superpowers/specs/2026-08-20-lh-008-service-expiration-automation-design.md docs/superpowers/specs/2026-08-20-lh-008-service-expiration-discovery-brief.md tasks.md
  ```

  Expected: no whitespace errors; only the intended brief and `tasks.md` are
  changed; the unrelated untracked native-schema test remains untouched.

- [ ] **Step 4: Commit the discovery evidence**

  ```powershell
  git add -- docs/superpowers/specs/2026-08-20-lh-008-service-expiration-discovery-brief.md tasks.md
  git commit -m "docs: record service expiration discovery"
  ```

## Final Verification Checklist

- [ ] The discovery is documentation-only and leaves production behavior unchanged.
- [ ] Informational, notification, and automatic-suspension alternatives are compared.
- [ ] Notifications with dry-run are recommended; suspension remains deferred.
- [ ] Timezone, final-day semantics, grace period, eligibility, recipients,
  retries, idempotency, audit, rollback, and provider failures are addressed.
- [ ] Manual-work measurement and RICE reassessment are recorded.
- [ ] LH-008 remains `revision` and no production, billing, migration, or
  external-provider action occurred.
