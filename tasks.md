# LedgerHarbour Development Tasks

Updated: 2026-08-19

This file is the canonical source for development status. Specs and plans provide detail but do not override the state recorded here.

## Workflow

- Priorities: P0 production risk, P1 incomplete product flow, P2 operations/documentation, P3 future improvement.
- States: `pendiente`, `en progreso`, `revision`, `aprobada`, `desplegada`, `bloqueada`.
- Keep at most one coordinator task `en progreso`.
- Approval requires recorded security review and real test evidence.
- Deployment requires commit, successful deployment, and production verification when applicable.
- Critical security findings move a task to `bloqueada`.
- Production, billing, migrations, destructive operations, and new spending require explicit operator confirmation.

## Active Summary

| ID | Priority | State | Task | Primary user | RICE |
|---|---|---|---|---|---:|
| LH-001 | P0 | pendiente | Fix date hydration in `/admin` | Platform operator | 4.50 |
| LH-002 | P0 | pendiente | Fail E2E on browser console errors | All users | 4.00 |
| LH-003 | P1 | pendiente | Add safe production verification for an ordinary user | Platform operator | 4.25 |
| LH-005 | P2 | pendiente | Verify provider alerts and limits | Platform operator | 4.25 |
| LH-004 | P2 | pendiente | Update repository production-status documentation | Engineering team | 3.75 |
| LH-006 | P2 | pendiente | Remove the Playwright `allowedDevOrigins` warning | Engineering team | 3.50 |
| LH-007 | P3 | pendiente | Consolidate language handling in auth and onboarding | End users | 3.25 |
| LH-008 | P3 | pendiente | Define optional service-expiration automation | Platform operator | 2.75 |

## P0: Production Risks

### LH-001: Fix date hydration in `/admin`

- Priority: `P0`
- State: `pendiente`
- Primary user: Platform operator
- RICE: `4.50` (`reach 4 / impact 4 / confidence 5 / effort 5`)
- Why now: Production emits React error `#418` because Vercel renders dates in UTC while verified browsers can render them in `America/Bogota`, producing different calendar days during hydration.
- Dependencies: None
- Scope: Make platform date formatting deterministic without changing stored timestamps or lifecycle rules.
- Acceptance:
  - Server and client render the same calendar day for each ISO timestamp.
  - The chosen timezone is explicit and documented in the formatter contract.
  - A regression test covers a timestamp that changes day between UTC and `America/Bogota`.
  - `/admin` records no hydration errors in local production mode or production.
- Evidence required:
  - Failing test before the fix and passing test after it.
  - Focused platform tests, full unit/integration suite, lint, typecheck, and build.
  - Browser evidence from `/admin` with zero `console.error` and `pageerror` events.
  - Production verification only after explicit deployment approval.

### LH-002: Fail E2E on browser console errors

- Priority: `P0`
- State: `pendiente`
- Primary user: All users
- RICE: `4.00` (`reach 4 / impact 4 / confidence 4 / effort 4`)
- Why now: Current browser tests can pass while React or runtime errors are present in the browser console.
- Dependencies: `LH-001`, so the gate starts from a clean known baseline.
- Scope: Add reusable Playwright capture for `console.error` and `pageerror` to critical browser flows.
- Acceptance:
  - Login, onboarding, authenticated shell, and platform administration capture browser errors.
  - A synthetic browser error proves that the gate fails.
  - Any exception list is explicit, minimal, and justified by an external dependency.
  - Failure output includes the route and safe error message without tokens, cookies, credentials, or personal data.
- Evidence required:
  - Red/green test demonstrating the synthetic failure.
  - Focused browser tests and the complete Playwright suite.
  - Security review of captured output and persisted test artifacts.

## P1: Incomplete Functional Flows

### LH-003: Add safe production verification for an ordinary user

- Priority: `P1`
- State: `pendiente`
- Primary user: Platform operator
- RICE: `4.25` (`reach 3 / impact 5 / confidence 5 / effort 4`)
- Why now: Production verifies the global administrator and anonymous boundaries, but lacks a dedicated authenticated ordinary identity proving the negative role path.
- Dependencies: Operator-approved production test identity and a reversible credential-handling procedure.
- Scope: Establish a non-personal identity and repeatable runbook that verifies ordinary navigation and authorization without granting global membership.
- Acceptance:
  - The identity is dedicated to testing and is not a personal account.
  - The identity has no active `platform_members` record and cannot claim one.
  - Successful login continues to `/onboarding`.
  - Direct `/admin` access is denied without exposing authorization details.
  - Cookies, tokens, passwords, and storage state are never stored in Git or reports.
  - The runbook defines controlled account reuse or cleanup.
- Evidence required:
  - Redacted production browser report showing `/onboarding` and denied `/admin`.
  - Read-only membership verification for the test identity.
  - Operator confirmation before creating or changing the production identity.

## P2: Operations And Documentation

### LH-005: Verify provider alerts and limits

- Priority: `P2`
- State: `pendiente`
- Primary user: Platform operator
- RICE: `4.25` (`reach 3 / impact 5 / confidence 5 / effort 4`)
- Why now: Document AI can incur usage charges, while R2 and Upstash require explicit quota and credential-scope checks even when operating in free tiers.
- Dependencies: Read-only operator access to provider dashboards; explicit confirmation before any billing or plan change.
- Scope: Record current alerts, quotas, owners, and minimum-privilege status without enabling new spending.
- Acceptance:
  - Document AI, R2, and Upstash each have a documented quota, alert state, and responsible owner.
  - Google Document AI billing-alert status is explicitly verified.
  - Credentials are confirmed to use the minimum required scope.
  - No paid plan, billing feature, or billable test request is activated without explicit operator approval.
  - Any over-broad credential has an approved rotation plan before replacement.
- Evidence required:
  - Redacted checklist with provider, date, quota, alert state, and owner.
  - No secret values, tokens, account rows, or billing details in Git.
  - Separate operator approval for any remediation that changes billing or credentials.

### LH-004: Update repository production-status documentation

- Priority: `P2`
- State: `pendiente`
- Primary user: Engineering team
- RICE: `3.75` (`reach 2 / impact 3 / confidence 5 / effort 5`)
- Why now: `README.md` and parts of `docs/STACK.md` still describe an exclusively local MVP or providers as pending after production activation and deployment.
- Dependencies: `LH-005` for provider alert statements that must not be guessed.
- Scope: Synchronize repository documentation with verified production reality while retaining explicit operational caveats.
- Acceptance:
  - `README.md` distinguishes local development, deterministic testing, and current production operation.
  - `docs/STACK.md` reflects verified Firebase, Neon, Vercel, R2, Upstash, and Document AI status without overstating readiness.
  - `docs/production-activation.md` distinguishes completed activation steps from recurring controls.
  - Historical specs and plans remain unchanged.
  - Every production statement cites current evidence or is labeled unverified.
- Evidence required:
  - Documentation diff reviewed against production configuration and deployment evidence.
  - Placeholder, contradiction, stale-status, and secret scans.
  - `git diff --check` with no whitespace errors.

### LH-006: Remove the Playwright `allowedDevOrigins` warning

- Priority: `P2`
- State: `pendiente`
- Primary user: Engineering team
- RICE: `3.50` (`reach 2 / impact 2 / confidence 5 / effort 5`)
- Why now: Next.js warns that future versions will reject the `127.0.0.1` origin used by the Playwright harness unless it is configured explicitly.
- Dependencies: None
- Scope: Permit only the harness development origin without widening production origin policy.
- Acceptance:
  - The complete E2E run no longer emits the `allowedDevOrigins` warning.
  - Production configuration does not add development origins.
  - The allowed value is limited to the host and port used by the test server.
  - Existing Firebase same-origin rewrites remain unchanged.
- Evidence required:
  - A focused configuration test proving production excludes the development origin.
  - Full Playwright output without the warning.
  - Production build and configuration review.

## P3: Future Improvements

### LH-007: Consolidate language handling in auth and onboarding

- Priority: `P3`
- State: `pendiente`
- Primary user: End users
- RICE: `3.25` (`reach 4 / impact 2 / confidence 4 / effort 3`)
- Why now: Auth and onboarding were intentionally excluded from the first authenticated-shell language consolidation and still maintain separate controls.
- Dependencies: Approved UX design for the shared public/onboarding language boundary.
- Scope: Provide one visible language selector per screen while preserving locale through login, registration, and onboarding navigation.
- Acceptance:
  - Only one language selector is visible on each auth or onboarding screen.
  - Locale survives login, registration, navigation, and functional query parameters.
  - English and Spanish accessible labels remain correct.
  - Desktop and mobile have no horizontal overflow.
  - Reduced-motion behavior and keyboard focus remain accessible.
  - Browser tests record no console errors.
- Evidence required:
  - Approved design spec before implementation.
  - Unit or integration coverage for locale preservation.
  - Desktop and mobile Playwright evidence in both languages.

### LH-008: Define optional service-expiration automation

- Priority: `P3`
- State: `pendiente`
- Primary user: Platform operator
- RICE: `2.75` (`reach 3 / impact 3 / confidence 3 / effort 2`)
- Why now: `serviceExpiresAt` is currently informational; automatic action could reduce manual work but could also suspend valid customers if temporal and recovery rules are incomplete.
- Dependencies: Product discovery and explicit operator approval of one behavior.
- Scope: Compare keeping the date informational, sending alerts, and automatic suspension before implementing any automation.
- Acceptance:
  - Discovery identifies affected users and a measurable operational outcome.
  - The proposal defines timezone, grace period, notification timing, retries, idempotency, and manual override.
  - Audit events and rollback behavior are specified.
  - Failure modes for unavailable providers or delayed jobs are documented.
  - The operator approves one alternative before an implementation plan is created.
- Evidence required:
  - Product brief with alternatives and simplified RICE reassessment.
  - Architecture and security review for any scheduled or automated action.
  - No production scheduler, suspension, or billing change during discovery.

## Recently Completed

### LH-000: Role-aware post-login navigation

- Priority: `P0`
- State: `desplegada`
- Commit: `4f2f325`
- Result: `/auth/continue` sends active global administrators to `/admin`, ordinary authenticated users to `/onboarding`, and missing sessions to `/login`.
- Evidence: Local tests, build, audit, and Playwright passed; GitHub Actions and Vercel completed successfully; production administrator and anonymous boundaries were verified.
- Rollback: Revert `4f2f325` and redeploy; no data rollback is required.

## Maintenance Rules

- Assign the next unused `LH-NNN` ID; never reuse archived IDs.
- Recalculate or justify RICE whenever priority changes.
- Record commands, results, commits, and deployment URLs as evidence; do not write unverified success claims.
- Split work before starting when one task spans independent subsystems.
- Keep ideas without acceptance criteria outside the active backlog until discovery is approved.
- Move older deployed entries to a compact archive when this file becomes difficult to scan.
