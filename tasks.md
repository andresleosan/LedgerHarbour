# LedgerHarbour Development Tasks

Updated: 2026-08-26

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
| LH-001 | P0 | desplegada | Fix date hydration in `/admin` | Platform operator | 4.50 |
| LH-002 | P0 | aprobada | Fail E2E on browser console errors | All users | 4.00 |
| LH-003 | P1 | aprobada | Add safe production verification for an ordinary user | Platform operator | 4.25 |
| LH-009 | P1 | aprobada | Close the disposable native PostgreSQL migration gate | Engineering team | 4.25 |
| LH-010 | P0 | aprobada | Recover verified Firebase identities after provider recreation | Authenticated users | 4.75 |
| LH-005 | P2 | aprobada | Verify provider alerts and limits | Platform operator | 4.25 |
| LH-004 | P2 | aprobada | Update repository production-status documentation | Engineering team | 3.75 |
| LH-006 | P2 | aprobada | Remove the Playwright `allowedDevOrigins` warning | Engineering team | 3.50 |
| LH-007 | P3 | aprobada | Consolidate language handling in auth and onboarding | End users | 3.25 |
| LH-008 | P3 | aprobada | Add manual service-expiration dry-run | Platform operator | 3.50 |

## P0: Production Risks

### LH-010: Recover verified Firebase identities after provider recreation

- Priority: `P0`
- State: `revision`
- Primary user: Authenticated users
- Why now: Production login reached `/auth/continue` and PostgreSQL rejected an identity whose email already belonged to a local user with a previous `provider_id`; the live Firebase token was then confirmed as unverified.
- Scope: Resolve a verified Firebase identity to the existing local user without creating duplicates or changing the stored provider link; preserve conflict behavior for unverified identities, clear stale sessions, show actionable verification guidance, and protect concurrent platform claims with a transaction.
- Verification evidence:
  - Focused tenancy, platform-claim, authentication, and security tests: `7 files passed`, `68 tests passed`.
  - Full unit/integration suite: `73 files passed`, `602 tests passed`, `7 skipped`.
  - Lint, TypeScript, and production build: passed; build generated `18/18` pages.
  - Migration CLI and read-only check now report all migrations through `0007_rate_limit_windows`.
  - Commits `5daea22`, `6e586d4`, `28a4e75`, and `6bbdaab` pushed to `origin/main`; Vercel production deployment `ledger-harbour-oq9mplaas-andres-leo-san-s-projects.vercel.app` is `Ready`.
  - Real QA: admin now receives the visible `Verify your email address before signing in.` guidance without a server exception; unauthenticated `/admin` and `/portfolio` redirect to `/login`; `/` loads; browser console errors and Vercel exceptions were absent in the final route check.
  - Local E2E QA rerun after correcting the deterministic Firebase client credential: `corepack pnpm exec playwright test --config=playwright.qa.local.config.ts` with the test-only environment and local Chrome -> `42 tests passed` in `4.2m`; authentication, onboarding, tenancy, documents, invoices, platform, mobile/locale flows, and browser diagnostics passed.
  - Read-only Firebase console review (2026-08-27): project `LedgerHarbour` (`ledgerharbour`) is accessible; Email/Password and Google providers are enabled; four authentication identities are present. No account, permission, provider, or credential was changed.
  - Real Chrome acceptance (2026-08-27): an authorized Google identity completed Firebase login and reached `/admin?locale=en`; `/admin/administrators` loaded; browser error logs remained empty; sign-out returned to `/login`; unauthenticated `/auth/continue?locale=en` returned to `/login?locale=en`. No administrative mutation was executed.
  - Authorized Firebase Admin repair (2026-08-27): the synthetic identity `admin@admin.com` changed from `emailVerified: false` to `emailVerified: true`; the temporary service-account key was deleted in Google Cloud and the downloaded JSON was removed locally. No other account, permission, provider, or credential was changed.
  - Real email/password acceptance (2026-08-28): after the user entered the synthetic account credentials directly in Chrome, production reached `/onboarding?locale=en`; `/auth/continue?locale=en` redirected to the same onboarding destination; the sign-out control was visible and browser error logs remained empty. The password was not read or recorded.
- External acceptance gate: satisfied for the real sign-in flow. Keep this task in `aprobada`; deployment status remains unchanged and no production deployment was performed in this turn.
- Rollback: revert the release commit and redeploy; no data rollback is required.

### LH-001: Fix date hydration in `/admin`

- Priority: `P0`
- State: `desplegada`
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
- Verification evidence:
  - `corepack pnpm vitest run tests/unit/platform/platform-date.test.ts`: 5 passed.
  - `corepack pnpm test`: 63 files passed, 2 skipped; 550 tests passed, 3 skipped.
  - `corepack pnpm lint`, `corepack pnpm exec tsc --noEmit`, and `corepack pnpm build`: passed.
  - `corepack pnpm exec playwright test tests/e2e/platform/admin-panel.spec.ts`: 5 passed; no React `#418`, `console.error`, or `pageerror` in MCP verification.
  - `git diff --check`: no whitespace errors on the LH-001 and tracking files.
  - Security review and final re-review: clean; no new endpoints, secrets, DTO/API, persistence, or authorization changes.
  - Production deployment for commit `2ecafc7`: Vercel completed successfully; `/admin` rendered with stable UTC dates and 0 browser console errors.
- Rollback: revert `2ecafc7` and redeploy; no data rollback is required.

### LH-002: Fail E2E on browser console errors

- Priority: `P0`
- State: `aprobada`
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
- Verification evidence:
  - RED: the expanded diagnostics and cookie-scope tests reported `12 failed, 4 passed` before the round-three fixes.
  - `corepack pnpm vitest run tests/unit/e2e/browser-diagnostics.test.ts tests/unit/e2e/browser-api.test.ts`: 16 passed.
  - `corepack pnpm test`: 65 files passed, 2 skipped; 566 tests passed, 3 skipped.
  - `corepack pnpm lint`, `corepack pnpm exec tsc --noEmit`, and `corepack pnpm build`: passed.
  - `corepack pnpm exec playwright test --config=playwright.verification.config.ts`: 41 passed on isolated port 3110 because port 3100 was occupied by another workspace; the temporary config was removed afterward.
  - Independent quality review: approved with no open findings. Security re-review: `PASS`, with no critical or important findings.
  - The remaining `allowedDevOrigins` warning is tracked separately by `LH-006` and is not allowlisted by the gate.

## P1: Incomplete Functional Flows

### LH-003: Add safe production verification for an ordinary user

- Priority: `P1`
 - State: `aprobada`
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
- Verification evidence:
  - Exact secret scan attempt (failed because `rg` is unavailable; not a passing result): `rg -n -- "-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_live_[A-Za-z0-9]{10,}|(DATABASE_URL|FIREBASE_PRIVATE_KEY)=.{8,}" docs/production-ordinary-user-verification.md`; PowerShell returned command-not-found.
  - Equivalent secret scan executed after the `rg` failure:

    ```powershell
    $path = (Resolve-Path -LiteralPath 'docs/production-ordinary-user-verification.md').Path; $text = [System.IO.File]::ReadAllText($path); $pattern = '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_live_[A-Za-z0-9]{10,}|(DATABASE_URL|FIREBASE_PRIVATE_KEY)=.{8,}'; $matches = [regex]::Matches($text, $pattern); "secret_scan_matches=$($matches.Count)"
    ```

    Result: `secret_scan_matches=0`.
  - Exact placeholder scan attempt (failed because `rg` is unavailable; not a passing result): `rg -n "TODO|TBD|FIXME|<email real>|password real|token real" docs/production-ordinary-user-verification.md`; PowerShell returned command-not-found.
  - Equivalent placeholder scan executed after the `rg` failure:

    ```powershell
    $path = (Resolve-Path -LiteralPath 'docs/production-ordinary-user-verification.md').Path; $text = [System.IO.File]::ReadAllText($path); $pattern = 'TODO|TBD|FIXME|<email real>|password real|token real'; $matches = [regex]::Matches($text, $pattern); "placeholder_scan_matches=$($matches.Count)"
    ```

    Result: `placeholder_scan_matches=0`.
   - The runbook contains only redacted template fields in brackets and uses SQL bind parameter `$1`; no personal identity, email, URL, token, cookie, password, session state, or response body was recorded.
   - Operator-authorized provisioning checkpoint (2026-08-21): a new empty Neon project was created in the existing Free organization, in `AWS Europe West 2 (London)`, with no data copied. The versioned migrations `0001_initial` through `0006_business_request_audit` were applied and verified read-only; no destructive SQL or paid operation was performed.
   - `DATABASE_URL` was updated in Vercel for `Production and Preview` without recording its value. Production redeploy `6frciBMjavvX6NuhZCweEcgfMBUg` completed with status `Ready` from source commit `13eeac2`; `https://ledgerharbour.vercel.app/` loaded successfully with zero browser console errors.
   - A dedicated synthetic email identity was created after operator authorization; its password stayed in browser memory only, was never written to Git or reports, and the session was signed out after verification.
   - Read-only Neon verification for the redacted synthetic identity returned `matching_users=1`, `matching_platform_members=0`, and `matching_memberships=0`.
   - Production login redirected the ordinary identity to `/onboarding` with the expected business-choice screen. Direct `/admin` redirected to `/portfolio`; the page showed no administration panel and no authorized businesses. Production browser console errors: `0`.
   - After sign-out, `/auth/continue?locale=en` redirected to `/login` in the same profile; a newly opened tab also redirected to `/login` and was closed. The Playwright MCP rejected creation of a separate `BrowserContext`, so the required new-profile cleanup boolean remains unconfirmed.
   - Cleanup policy selected: controlled reuse of the dedicated synthetic identity; no credential, cookie, token, storage state, or personal data was persisted.
   - `git diff --check`: exit code 0 with no whitespace errors; PowerShell showed the normal LF/CRLF conversion warning for `tasks.md`.
   - The working tree still contains the pre-existing source/test modifications and untracked `tests/integration/postgres/native-schema.test.ts`; this verification changed only `tasks.md`.
   - No commit was created in this session.
   - Operator-confirmed isolated/incognito profile check (2026-08-21): `/auth/continue?locale=en` redirected to `/login` with empty credentials, confirming no session leakage into a new profile.
   - Production execution is complete for this task: migration, environment update, redeploy, read-only schema/membership checks, dedicated identity creation, onboarding navigation, denied admin navigation, same-profile cleanup, isolated-profile cleanup confirmation, and sign-out were performed under operator authorization.
 - Review gate: `aprobada`; no personal identity, secret, cookie, token, or browser storage state was persisted in Git or reports.

### LH-009: Close the disposable native PostgreSQL migration gate

- Priority: `P1`
- State: `aprobada`
- Primary user: Engineering team
- RICE: `4.25` (`reach 3 / impact 5 / confidence 5 / effort 4`)
- Why now: `db:native-check` points to a long-lived untracked test that still validates only the initial migration, while the canonical sequence now runs through `0006_business_request_audit`. A local PostgreSQL 18 server is available, so the deferred native compatibility gate can be closed without using Neon or production.
- Dependencies: Disposable local PostgreSQL only; no external credentials or provider access.
- Scope: Adopt and update the native-schema contract, require `TEST_DATABASE_URL` for the explicit gate, execute migrations `0001` through `0006` on an empty disposable database, and verify native constraints plus transaction rollback.
- Acceptance:
  - The ordinary test suite skips the native contract honestly when `TEST_DATABASE_URL` is absent.
  - `corepack pnpm db:native-check` fails closed when `TEST_DATABASE_URL` is absent instead of reporting a misleading success.
  - The canonical migration sequence applies and verifies `0001_initial` through `0006_business_request_audit` on PostgreSQL 18.
  - Native schema evidence covers required tables, representative tenant constraints, append-only audit behavior, and rollback of an ordinary SQL transaction.
  - The test uses only an empty disposable local database and removes the temporary cluster after verification.
  - No production database, Neon project, provider, credential, billing setting, migration, deployment, or application data is accessed or changed.
- Evidence required:
  - RED output from the stale native test against the disposable PostgreSQL server.
  - GREEN output from `corepack pnpm db:native-check` against the same class of disposable server.
  - Focused migration tests, full suite, lint, typecheck, build, security review, and `git diff --check`.
  - Advanced QA report covering the migration contract, security-sensitive constraints, transaction rollback, and explicitly excluded load testing.
- Verification evidence:
  - RED on PostgreSQL 18: the stale test failed with `1 failed`; it expected `requiredTableCount=7` while `checkInitialMigration` returned the canonical `10`, and it did not cover migrations `0002` through `0006`.
  - Explicit fail-closed gate without `TEST_DATABASE_URL`: `corepack pnpm db:native-check` exited `1` with `TEST_DATABASE_URL is required for db:native-check` before Vitest execution.
  - Remote-target safety case: a synthetic `example.invalid` PostgreSQL URL was rejected with exit `1` and `Native PostgreSQL gate requires a loopback disposable test database`; no connection attempt was made and the URL was not printed by application code.
  - GREEN on a fresh loopback PostgreSQL 18 database: `corepack pnpm db:native-check` -> `1` file passed, `5` tests passed. The gate applied and checked `0001_initial` through `0006_business_request_audit`, asserted 15 native tables plus representative constraints/indexes/triggers, rolled back and reapplied `0006`, rejected a cross-tenant uploader, enforced append-only audit events, and verified ordinary transaction rollback.
  - Ordinary suite without `TEST_DATABASE_URL`: `corepack pnpm test` -> `71` files passed, `2` skipped; `602` tests passed, `7` skipped. The increased skip count is the honest native-only contract. An earlier parallel run had one unrelated 5-second authorization timeout; its isolated rerun passed `4/4`, and the accepted full rerun was sequential and green.
  - `corepack pnpm lint`, `corepack pnpm exec tsc --noEmit`, `corepack pnpm build`, and `git diff --check`: passed; the build generated `18/18` static pages.
  - `corepack pnpm audit --audit-level high --json`: `0` vulnerabilities at every severity across `556` dependencies.
  - Security self-review found and fixed one important issue: the first implementation accepted any configured test URL. The final gate accepts only PostgreSQL URLs on loopback with an explicitly disposable database name, exposes no supplied URL in its errors, adds no endpoint or dependency, and relies on the existing `.env`/credential ignore rules.
  - Advanced QA: migration contract, rollback/reapply, tenant isolation, append-only audit behavior, and transaction rollback passed on native PostgreSQL. Load testing is not applicable to this one-shot migration gate and was explicitly excluded.
  - The temporary cluster was restricted to `127.0.0.1`, stopped after verification, and its exact validated directory under `%TEMP%` was removed (`temporary_cluster_removed=True`). No external or production database, Neon project, provider, credential, billing setting, deployment, or application data was accessed or changed.
  - Gap check: existing `graphify`, `pragmatic-path-selection`, `advanced-qa-strategy`, `self-critique-loop`, and `security-baseline` instructions covered the work; no capability gap entry was required.
  - At the time of the earlier verification, no commit was created; the adopted native test remained an intentional untracked working-tree file until the controller created a separate commit.
  - Review gate: `aprobada`; implementation, native PostgreSQL execution, security correction, advanced QA, full sequential verification, build, audit, cleanup, and self-critique passed.
 - Post-commit verification (2026-08-26): commit `9234ca0` (`test: add native PostgreSQL migration gate`) contains only `tests/integration/postgres/native-schema.test.ts`; `corepack pnpm test` -> `73` files passed, `2` skipped; `599` tests passed, `7` skipped; `corepack pnpm lint`, `corepack pnpm exec tsc --noEmit`, and `corepack pnpm build` passed with `18/18` static pages; `corepack pnpm audit --audit-level high --json` -> `0` vulnerabilities at every severity across `554` dependencies; `git diff --check` passed and the worktree is clean.

## P2: Operations And Documentation

### LH-005: Verify provider alerts and limits

- Priority: `P2`
- State: `aprobada`
- Primary user: Platform operator
- RICE: `4.25` (`reach 3 / impact 5 / confidence 5 / effort 4`)
- Why now: Document AI can incur usage charges, while R2 and Upstash require explicit quota and credential-scope checks even when operating in free tiers.
- Dependencies: Read-only operator access to provider dashboards; explicit confirmation before any billing or plan change.
- Scope: Record current alerts, quotas, owners, and minimum-privilege status without enabling new spending.
- Acceptance:
  - Document AI, R2, and Upstash each have a documented quota, alert state, and responsible owner.
  - Google Document AI billing-alert status is explicitly verified.
  - Credentials are evaluated against the minimum required scope; any provider limitation is recorded as `blocked` with a non-production exception and a separate activation plan.
  - No paid plan, billing feature, or billable test request is activated without explicit operator approval.
  - Any over-broad credential has an approved rotation plan before replacement.
- Evidence required:
  - Redacted checklist with provider, date, quota, alert state, and owner.
  - No secret values, tokens, account rows, or billing details in Git.
  - Separate operator approval for any remediation that changes billing or credentials.
- Verification evidence:
  - Exact secret scan with `rg` was attempted but unavailable (`CommandNotFoundException`). The equivalent PowerShell .NET scan returned `secret_scan_matches=0`.
  - Exact placeholder scan with `rg` was attempted but unavailable (`CommandNotFoundException`). The equivalent PowerShell .NET scan returned `placeholder_scan_matches=0`.
   - Read-only provider verification was executed on 2026-08-21. Google Document AI showed an enabled Invoice Parser in `us`, visible service quotas, and the minimum Document AI API User IAM role; the project has no linked billing account, so a budget alert is `blocked`.
   - Cloudflare R2 bucket `ledgerharbour` showed Standard storage, public access disabled, 85 B, 10 Class A operations and 20 Class B operations; the account showed an active `R2 Paid` subscription, while quota, alert and user-token scope remain `unverified`.
   - Upstash `ledgerharbour-ratelimit` showed `Free Tier`, 103 commands of 500k monthly, 0 B bandwidth, 0 B storage, cost `$0.00`, TLS enabled, and region Ireland. Its default ACL is `+@all`, recorded as `broader-than-required`; no billing alert was visible.
  - No billing, plan, credential, resource, OCR, external request, alert, scope, rotation, or productive operation was performed.
   - A second read-only verification was executed on 2026-08-22. Document AI remains enabled in `us`; its API quota surface showed 141 entries with current and seven-day >90% usage both at 0, the minimum API User role remained visible, and billing still has no linked account, so the budget alert remains `blocked`.
   - Cloudflare R2 still shows the private Standard bucket with 85 B, 10 Class A operations and 20 Class B operations. Current account usage showed `$0.00`; the account remains on `R2 Paid`, a `$1` monthly budget alert is configured, and an active `Object Read & Write` token is scoped to the `ledgerharbour` bucket.
   - Upstash still shows `Free Tier`, 105 of 500k monthly commands, 0 B bandwidth, 0 B storage and `$0.00` cost. Its default ACL remains `+@all` on `~*`, and no billing alert was visible.
   - The second verification exposed no secrets or tokens in the redacted evidence. No provider, plan, billing setting, alert, credential, ACL, OCR request or resource was modified.
   - Remediation plan remains pending operator approval: do not link Google billing during LH-005; if later approved, use a project-scoped alerts-only budget; retain the compliant R2 token and use create/update/revoke rotation only if a future runtime mismatch or exposure is demonstrated; and validate an Upstash ACL allowlist in an isolated environment before any production token rotation.
   - Cloudflare R2 remediation checkpoint (2026-08-22): a `$1` monthly budget alert was created and the dashboard confirmed `Budget alert saved successfully`; the active `ledgerharbour` token already showed bucket-scoped `Object Read & Write`, so no credential rotation or secret handoff was needed.
   - Upstash remediation checkpoint (2026-08-22): the console exposed only `ledgerharbour-ratelimit`; `excited-manatee` is its displayed endpoint/region alias, not an isolated canary. No production ACL or token mutation was executed.
    - Google billing remediation checkpoint (2026-08-22): an existing billing account was visible, but `LedgerHarbour` remained unlinked. The official `Billing > Projects > Actions > Change billing` flow reached the target project, but Google rejected the association because the account reached its project billing quota; no billing link, budget or OCR request was created.
    - The operator authorized continuation. Upstash refused creation of a second Free Tier database and offered payment-method/plan upgrade; no payment method, upgrade or paid resource was created. Google billing association was not retried through an unsupported route and no quota increase was requested.
    - Follow-up discovery: the official Google `Billing > Projects > Actions > Change billing` flow reached the target project, but Google rejected the association because the account reached its project billing quota. No quota increase was requested.
    - Source review of `@upstash/ratelimit@2.0.8` identified `EVALSHA`, `EVAL`, `GET`, `INCRBY`, and `PEXPIRE` as the proposed minimum command allowlist for the current fixed-window limiter, scoped to `ledgerharbour:*`; it remains unapplied because no isolated canary is available without a payment-method/plan upgrade.
   - Official references used for the plan: Google Cloud budgets, Cloudflare R2 pricing, Cloudflare R2 token permissions, and Cloudflare API permission reference. URLs are recorded in `docs/provider-alerts-limits-checklist.md`.
  - Before the controller's documentation commit, the exact `git status --short` output was:

    ```text
     M tasks.md
    ?? tests/integration/postgres/native-schema.test.ts
    ```

    The checklist was already committed from Task 1; `tests/integration/postgres/native-schema.test.ts` remained outside scope.
  - `git diff --check`: exit code `0`. The only observed output was the normal line-ending warning: `warning: in the working copy of 'tasks.md', LF will be replaced by CRLF the next time Git touches it`.
  - At final head `55a2ea7`, the exact `git status --short` output was:

    ```text
    ?? tests/integration/postgres/native-schema.test.ts
    ```

    The versioned tree was clean; the untracked schema test remained outside scope.
  - The subagent implementation created no commit; the subagent did not execute Git. Documentation provenance after the plan:
    - `9dc375d` (`docs: add provider alerts and limits checklist`): created the provider checklist from Task 1.
    - `870c473` (`docs: record provider verification qa`): recorded the documentary QA evidence and kept LH-005 in `revision`.
    - `55a2ea7` (`docs: clarify provider verification qa`): clarified the provider-verification evidence and final worktree traceability.
  - Cronos scope audit (2026-08-24): the approved design in `docs/superpowers/specs/2026-08-20-lh-005-provider-alerts-limits-design.md` explicitly places billing, plan, alert, credential, scope and resource mutations outside LH-005. It permits a broad credential to remain `blocked` with a documented plan; the later remediation plan had incorrectly turned those external mutations into the task's approval gate.
  - Current official Upstash documentation confirms that custom Redis ACL is available only on paid databases. The Free plan remains `$0`, is limited to one Free database, and provides 500k monthly commands, 256 MB data and 10 GB bandwidth. Therefore a custom-ACL Free canary cannot close the finding without a paid-plan decision; no disposable resource or upgrade was created.
  - Cost review: the accepted current path remains approximately `US$0/month`. Upstash paid ACL and Google billing stay disabled. A future Upstash pay-as-you-go activation starts at usage pricing and a fixed database starts at `US$10/month`; Google Invoice Parser is `US$0.10` per count of up to 10 pages. These are planning estimates, not spending authorization.
  - Security review: PASS for the verification scope. No secret was exposed or changed; Google cannot incur Document AI parsing charges while the project remains unlinked; the Upstash standard token remains a server-only, dedicated-database exception with application keys prefixed by `ledgerharbour:`. The exception is not approval for a paid plan or production ACL rotation.
  - `LH-005` is approved as a completed read-only verification. Google billing/quota remediation and a paid Upstash custom ACL remain explicit, operator-controlled production-activation gates in `docs/production-activation.md`; neither is represented as verified or remediated.
  - Review gate: `aprobada`; scope, evidence, cost and security were reconciled with the approved design without enabling billing, creating a resource, changing a plan or rotating a credential.
  - Separate production-activation continuation (2026-08-25): the operator explicitly approved requesting one additional Google billing-project slot and an isolated Upstash Pay-as-you-go database with a `US$1/month` hard budget. This continuation does not reopen or expand LH-005.
  - Google continuation checkpoint (`2026-08-25T02:39:39Z`): the 30-day Document AI method table showed console/administrative calls only and no `ProcessDocument` or `BatchProcessDocuments` request. The existing active billing account again rejected the `ledgerharbour` association at its project limit. The official request for exactly one additional billing-enabled project was submitted and Google acknowledged receipt with a typical review time of about two business days. The project remains unlinked; no budget or OCR request was created.
  - Upstash continuation checkpoint (`2026-08-25T02:39:39Z`): the existing database remains Free and unchanged. The console requires a payment method before a separate Pay-as-you-go database can be created. The official plan supports a per-database hard budget that rate-limits the database at the cap; the approved `US$1/month` value has not been applied because payment entry remains a manual operator handoff. No paid database, ACL, token rotation or Vercel secret change was performed.
   - Upstash follow-up checkpoint (`2026-08-25T02:53:21Z`): after the operator added the card manually, Upstash automatically changed the existing rate-limit database from Free to Pay-as-you-go. Both the existing database budget editor and the new-database wizard reject `US$1` with `Budget must be at least $20`. The new database wizard was cancelled before creation; no ACL, credential, Vercel or production data change was performed. The paid path is blocked pending an explicit decision to accept a `$20` minimum, remove/suspend the paid setup, or choose another provider.
   - Neon rate-limit continuation (`2026-08-25`): the paid Upstash route was replaced in code by a PostgreSQL/Neon adapter. Migration `0007_rate_limit_windows` adds a reversible table with an atomic fixed-window upsert; keys are HMAC-SHA-256 hashed with `RATE_LIMIT_KEY_SECRET`. Production now requires `RATE_LIMIT_MODE=postgres`, `DATABASE_URL`, the secret, and the migration. Upstash dependencies and runtime variables were removed; no remote migration, Vercel secret change, billing change, or deployment was performed.
   - Neon implementation evidence: `corepack pnpm test` -> `73` files passed, `2` skipped; `599` tests passed, `7` skipped. Focused PostgreSQL limiter integration -> `1` test passed. `corepack pnpm lint` -> exit code `0`; `corepack pnpm exec tsc --noEmit` -> exit code `0`; `corepack pnpm build` -> exit code `0`, `18/18` static pages generated. `git diff --check` -> exit code `0` with only normal LF/CRLF warnings; secret scan clean.
   - Security review: PASS. The adapter validates limits and key size, uses HMAC digests instead of raw identity/IP keys, has no retry loop or logged secrets, and fails closed on missing configuration, missing rows or malformed PostgreSQL results. The migration has a versioned rollback; production application remains blocked until a backup, migration application, secret loading and operator-controlled deployment are completed.
   - Review gate: `aprobada` para la implementación local y documental. No se aplicó `0007` contra Neon remoto, no se cambiaron secretos de Vercel, no se desplegó y no se activó billing.
   - Neon/Vercel activation continuation (2026-08-25): read-only checks on `ledgerharbour-staging` (`production`, project `misty-shape-43761921`) showed Neon Free usage of `0.77/100` CU-hours, `0.03/0.5 GB` storage, `0/5 GB` network, a six-hour restore window, and the existing backup branch. The additive transaction for `0007_rate_limit_windows` was then applied in Neon SQL Editor and verified by `ledgerharbour_schema_migrations`, `public.rate_limit_windows`, and `rate_limit_windows_window_started_at_idx`; no application rows were touched. Rollback remains `src/db/migrations/rollback/0007_rate_limit_windows_down.sql`.
   - Vercel configuration continuation (2026-08-25): generated `RATE_LIMIT_KEY_SECRET` was saved to Production only and `RATE_LIMIT_MODE=postgres` was updated to Production only. Existing Upstash variables remain for rollback and no billing resource was deleted. Vercel reports that a new deployment is required; Production has not been redeployed in this continuation pending explicit operator confirmation.

### LH-004: Update repository production-status documentation

- Priority: `P2`
- State: `aprobada`
- Primary user: Engineering team
- RICE: `3.75` (`reach 2 / impact 3 / confidence 5 / effort 5`)
- Why now: `README.md` y partes de `docs/STACK.md` todavia necesitan alinear su lenguaje con la evidencia del repositorio y distinguir el objetivo operativo de cualquier activacion o despliegue externo no verificado.
- Dependencies: `LH-005` for provider alert statements that must not be guessed.
- Scope: Sincronizar la documentacion con la evidencia del repositorio y los contratos operativos objetivo, conservando las salvedades explicitas de control del operador; el estado externo de los proveedores permanece `unverified`.
- Acceptance:
  - `README.md` distingue desarrollo local, pruebas deterministas y evidencia del repositorio para el objetivo operativo, sin afirmar una operacion productiva actual.
  - `docs/STACK.md` refleja la evidencia del repositorio para Firebase, Neon, Vercel, R2, Upstash y Document AI, y etiqueta la activacion o el estado externo como `operator-controlled` o `unverified` cuando corresponde.
  - `docs/production-activation.md` distingue los pasos de activacion unica objetivo de los controles recurrentes y no implica que esten completados.
  - Historical specs and plans remain unchanged.
  - Every production statement cita evidencia del repositorio o queda etiquetada como `unverified`, `pending` u `operator-controlled`.
- Evidence required:
  - Documentation diff reviewed against production configuration and deployment evidence.
  - Placeholder, contradiction, stale-status, and secret scans.
  - `git diff --check` with no whitespace errors.
- Verification evidence:
  - Rango de implementacion `544a90f..17cc2ef` revisado: `96eda20` clarifica el estado documentado del repositorio, `de3ead9` califica el estado documentado de proveedores y `17cc2ef` separa la activacion unica de los controles recurrentes.
  - Rango de QA/fix `953666a..82bc41f` revisado; el gate final de esta revision fue comprobado contra `82bc41f` y no se usa ningun hash posterior.
  - The three exact `rg` invocations and their real `CommandNotFoundException` outputs are reproduced in `task-4-report.md`, section `Fix round 1/5`, against only `README.md`, `docs/STACK.md`, `docs/production-activation.md`, and `tasks.md`; no `rg` match count is claimed.
  - The exact PowerShell/.NET fallback returned `secret_scan_matches=0` and `placeholder_scan_matches=9`. Breakdown: `docs/production-activation.md:3` has one case-insensitive marker substring inside an ordinary Spanish word; `tasks.md:119` has four documented pattern literals; and `tasks.md:123` repeats those four literals. These are documentary scan text, not operational placeholders. The exact causes are listed in `task-4-report.md`, section `Desglose Del Conteo De Placeholders`. No secret pattern matched under the fallback.
   - Manual review of the in-scope documents found intentional local/prototype, `operator-controlled`, `pending`, `unverified`, and `blocked` labels consistently qualified. Current external provider facts are sourced from the redacted LH-005 checklist and are not presented as activation approval.
   - Current scan against `README.md`, `docs/STACK.md`, `docs/production-activation.md`, and `tasks.md`: `secret_scan_matches=0`, `placeholder_scan_matches=8`; the placeholder matches are the documented scan-pattern literals in `tasks.md`, not unresolved operational placeholders.
  - Gate final del paquete previo contra `82bc41f`: `git diff --check 544a90f 82bc41f` termino sin salida y con exit code `0`; `git diff --name-only 544a90f 82bc41f` listo `README.md`, `docs/STACK.md`, `docs/production-activation.md` y `tasks.md`.
  - `82bc41f` es el head previo. Gate final del working tree, con los cambios no commiteados de `README.md` y `tasks.md`, ejecutado contra `544a90f`; las salidas reales fueron:

    ```text
    git diff --check 544a90f
    warning: in the working copy of 'README.md', LF will be replaced by CRLF the next time Git touches it
    warning: in the working copy of 'tasks.md', LF will be replaced by CRLF the next time Git touches it
    (exit code 0; sin errores de whitespace)

    git diff --name-only 544a90f
    warning: in the working copy of 'README.md', LF will be replaced by CRLF the next time Git touches it
    README.md
    docs/STACK.md
    docs/production-activation.md
    tasks.md
    warning: in the working copy of 'tasks.md', LF will be replaced by CRLF the next time Git touches it

    git status --short
     M README.md
     M tasks.md
    ?? tests/integration/postgres/native-schema.test.ts
    ```

    Los warnings son la conversion normal de line endings de Git. El untracked es ajeno y los cambios de `README.md` y `tasks.md` son los cambios finales de esta ronda; no se registra el hash del commit que hara el controlador. Las salidas tambien estan en `task-4-report.md`, seccion `Final fix`.
   - Current external evidence is documented in `docs/provider-alerts-limits-checklist.md`; no provider dashboard action, billing, plan, credential, scope, OCR request, or resource change was performed.
 - Review gate: `aprobada`; the documents distinguish repository evidence, operator-controlled activation, and current provider observations without claiming commercial activation.

### LH-006: Remove the Playwright `allowedDevOrigins` warning

- Priority: `P2`
- State: `aprobada`
- Primary user: Engineering team
- RICE: `3.50` (`reach 2 / impact 2 / confidence 5 / effort 5`)
- Why now: Next.js warns that future versions will reject the `127.0.0.1` origin used by the Playwright harness unless it is configured explicitly.
- Dependencies: None
- Scope: Permit only the harness development origin without widening production origin policy.
- Acceptance:
  - The complete E2E run no longer emits the `allowedDevOrigins` warning.
  - Production configuration does not add development origins.
  - The allowed development hostname is `127.0.0.1`; the unchanged Playwright harness fixes port `3100`.
  - Existing Firebase same-origin rewrites remain unchanged.
- Evidence required:
  - A focused configuration test proving production excludes the development origin.
  - Full Playwright output without the warning.
  - Production build and configuration review.
- Previous verification evidence (before Fix round 1/5, 2026-08-20):
  - `corepack pnpm vitest run tests/unit/config/next-config.test.ts` -> exit code `0`; `Test Files 1 passed (1)`, `Tests 4 passed (4)`. The test covered exactly `127.0.0.1:3100` in `development` and `test`, production omission, and both Firebase rewrites.
  - `corepack pnpm test` -> exit code `0`; `Test Files 66 passed | 2 skipped (68)`, `Tests 570 passed | 3 skipped (573)`.
  - `corepack pnpm lint` -> exit code `0`; no lint diagnostics.
  - `corepack pnpm exec tsc --noEmit` -> exit code `0`; no output or type errors.
  - `corepack pnpm build` -> exit code `0`; Next.js `15.5.23` compiled successfully, generated `18/18` static pages, and completed route optimization.
  - Complete E2E block from the brief -> the first run reached the shell timeout at `120000 ms` without captured output. The same literal block was rerun with a `300000 ms` shell timeout and exited `1`: `26 failed`, `6 did not run`, `9 passed` in `3.4m`. The captured WebServer output included `Blocked cross-origin request from 127.0.0.1 to /_next/* resource` and the `allowedDevOrigins` guidance, so the warning check failed as required. The failed tests also reported HMR WebSocket diagnostics (`ERR_INVALID_HTTP_RESPONSE`).
  - Boundary review -> focused test passed for the production exclusion; `next.config.ts` contains only `127.0.0.1:3100` for `development` and `test`, no production property, and both Firebase rewrites unchanged. `playwright.config.ts` remains unchanged and targets port `3100`.
  - `git diff --check` -> no output and no whitespace errors. `git status --short` -> only `?? tests/integration/postgres/native-schema.test.ts`; it remained untracked and untouched.
  - No `git add`, `git commit`, `git reset`, `git checkout` or push was executed. No credentials, Firebase real project, dashboards, providers, billing, deployment, migration or other external service was accessed.
- Fix round 1/5 verification evidence (2026-08-20):
  - Root cause confirmed from Next.js `15.5.23`: `allowedDevOrigins` is compared by hostname, not host plus port. After the failed E2E run, the controller created `e1cc536` as an operator-authorized amendment to the spec/plan, documenting this real hostname-only limitation; it was not the code implementation. The separate code implementation commit `721f639` changed the development/test value to exactly `127.0.0.1`; the Playwright harness remains on `127.0.0.1:3100`.
  - `corepack pnpm vitest run tests/unit/config/next-config.test.ts` -> exit code `0`; `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
  - `corepack pnpm test` -> exit code `0`; `Test Files 66 passed | 2 skipped (68)`, `Tests 570 passed | 3 skipped (573)`.
  - `corepack pnpm lint` -> exit code `0`; no lint diagnostics.
  - `corepack pnpm exec tsc --noEmit` -> exit code `0`; no output or type errors.
  - `corepack pnpm build` -> exit code `0`; Next.js `15.5.23` compiled successfully and generated `18/18` static pages.
  - Complete E2E block from the brief with the initial `120000 ms` shell timeout -> shell timeout with no captured output. The same literal block was rerun with a `300000 ms` shell timeout -> exit code `0`; `41 passed (3.9m)`. The captured output contained no `allowedDevOrigins` warning, so the warning check did not throw. The PowerShell wrapper displayed the native `corepack.cmd` diagnostic while capturing stderr, but the Playwright command completed successfully.
  - Current boundary review -> `development` and `test` contain exactly `allowedDevOrigins: ["127.0.0.1"]`; `production` omits the property; Firebase rewrites are unchanged; `playwright.config.ts` remains unchanged and targets port `3100`.
  - `tests/integration/postgres/native-schema.test.ts` remained untracked, excluded and untouched. The code fixer did not modify specs or plans. Before that fix, the controller's operator-authorized amendment `e1cc536` did modify `docs/superpowers/specs/2026-08-20-lh-006-allowed-dev-origins-design.md` and `docs/superpowers/plans/2026-08-20-lh-006-allowed-dev-origins.md` to record Next.js `15.5.23`'s hostname-only limitation; those two documents therefore remain visible in the final range. No additional specs or plans were modified in this round.
  - No credentials, real Firebase project, dashboards, providers, billing, deployment, migration or external service was accessed. The subagent executed no Git write operation and created no commit. The implementation is represented separately by `721f639`; QA/documentation is represented by `b8ffae5` and `5db9e88`.
  - Fresh final verification (2026-08-21): `corepack pnpm vitest run tests/unit/config/next-config.test.ts` -> `1` file and `4` tests passed; `corepack pnpm test` -> `69` files passed, `2` skipped; `585` tests passed, `3` skipped; `corepack pnpm lint` -> exit code `0` without diagnostics; `corepack pnpm exec tsc --noEmit` -> exit code `0`; `corepack pnpm build` -> exit code `0`, `18/18` static pages generated; `corepack pnpm test:e2e` -> `42` tests passed in `3.5m`, with no `allowedDevOrigins` warning in captured output.
  - Independent review after fresh verification: no critical or high findings. The historical spec/plan amendment is explicitly recorded as operator-authorized in `e1cc536`; the current evidence distinguishes the unit-test hostname assertion from the unchanged Playwright harness port. No new endpoint, secret, dependency, authentication, authorization, persistence, migration, deployment or billing change was introduced.
  - `git diff --check` -> exit code `0`; only the pre-existing untracked `tests/integration/postgres/native-schema.test.ts` remains outside scope and untouched.
  - Review gate: `aprobada`; all required focused tests, full suite, lint, TypeScript, build, E2E output, production-boundary review and independent security review passed. No production deployment was performed or required for this configuration-only test-harness change.

## P3: Future Improvements

### LH-007: Consolidate language handling in auth and onboarding

- Priority: `P3`
- State: `aprobada`
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
- Verification evidence:
  - `corepack pnpm vitest run tests/unit/i18n/locale.test.ts tests/unit/auth/post-login-navigation.test.ts`: exit code `0`; `2` files passed, `11` tests passed.
  - `corepack pnpm test`: exit code `0`; `69` files passed, `2` skipped; `585` tests passed, `3` skipped.
  - `corepack pnpm lint`: exit code `0`, without diagnostics.
  - `corepack pnpm exec tsc --noEmit`: exit code `0`, without output.
  - `corepack pnpm build`: exit code `0`; Next.js `15.5.23` compiled and generated `18/18` static pages.
  - `corepack pnpm exec playwright test tests/e2e/auth-onboarding/locale.spec.ts`: exit code `0`; `1` test passed in `43.3s`, with desktop `1280x900` and mobile `390x844` contexts, both `locale=en|es`.
  - `corepack pnpm test:e2e`: exit code `0`; `42` tests passed in `4.7m` with `1` worker and `[chromium]`. The diagnostics fixture kept console and `pageerror` gates empty; no timeout or retry output occurred.
  - `git diff --check`: exit code `0`, without whitespace errors. The unrelated untracked `tests/integration/postgres/native-schema.test.ts` was not modified.
  - Boundary review confirmed one auth/onboarding selector per target screen, locale and functional queries preserved, no locale state in browser storage, and `/auth/continue` authorization behavior unchanged.
- Fix round 1/5 verification evidence (2026-08-20):
  - `corepack pnpm vitest run tests/unit/i18n/locale.test.ts tests/unit/auth/post-login-navigation.test.ts`: exit code `0`; `2` files passed, `11` tests passed. The existing unit evidence for `navigateAfterSuccessfulLogin` remains separate from E2E.
  - `corepack pnpm exec tsc --noEmit`: exit code `0`; no output or type errors.
  - `corepack pnpm lint`: exit code `0`; no diagnostics.
  - `corepack pnpm audit --json`: exit code `0`; `0` info, `0` low, `0` moderate, `0` high, `0` critical; `556` dependencies.
  - The previous `git diff --check` evidence did not cover the untracked `tests/e2e/auth-onboarding/locale.spec.ts`. The current `git diff --check` exits `0` with only the normal `tasks.md` LF/CRLF warning, and the direct untracked-spec check returned `untracked_spec_trailing_whitespace_errors=0`.
  - The deterministic local adapter intentionally remains on `/login` after email submit; authenticated `/auth/continue` is validated E2E only after the session is established. The unit evidence covers the Firebase branch of `navigateAfterSuccessfulLogin`; this local deterministic E2E does not claim to exercise the real Firebase auto-navigation.
  - Independent final rerun: `corepack pnpm test:e2e` exit code `0`; `42` tests passed in `4.5m` on temporary local port `3110`. Port `3100` was intermittently occupied by an unrelated workspace and produced external 404/HMR diagnostics; `playwright.config.ts` and `scripts/playwright-server.ts` were restored to the committed `3100` harness afterward.
   - Final review fix round 2/5: auth Home now uses `hrefFor("/")`, preserving locale and functional queries; the E2E spec asserts that contract.
  - Fix round 2/5 focused E2E: exit code `0`; `1` test passed in `35.8s` on temporary local port `3110`, with the temporary port configuration restored afterward.
  - Fix round 2/5 full E2E after updating the existing Home-link expectation: exit code `0`; `42` tests passed in `3.9m` on temporary local port `3110`, with no console/page errors; the temporary port configuration was restored afterward.
  - Security re-review: clean; only the allowed spec/report/tracking files were changed, with no new endpoint, secret, dependency, authentication, authorization, persistence, migration, deployment, or billing change.
  - Full details and exact outputs are recorded in `.superpowers/sdd/2026-08-20-lh-007-auth-onboarding-locale/task-3-report.md`.
   - Fix round 3/5: independent review found that Firebase success navigation rebuilt `/auth/continue` with only `locale`, dropping functional parameters such as `next`. The fix passes the current `URLSearchParams` from `useUrlLocale` through `AuthForm` into `navigateAfterSuccessfulLogin`, preserves all parameters through `withLocale`, adds coverage for email and Google redirect completion, and declares `searchParams` in the Firebase redirect effect dependencies.
   - Fresh final verification (2026-08-21): focused auth navigation tests -> `2` files passed, `17` tests passed; `corepack pnpm test` -> `69` files passed, `2` skipped; `587` tests passed, `3` skipped; `corepack pnpm lint` -> exit code `0`; `corepack pnpm exec tsc --noEmit` -> exit code `0`; `corepack pnpm build` -> exit code `0`, `18/18` static pages generated; `corepack pnpm test:e2e` -> `42` tests passed in `3.6m`, including the desktop/mobile locale flow and browser console/page-error gate.
   - An earlier parallel gate attempt is not counted as evidence: concurrent build and E2E processes raced on `.next`, and the missing test fixtures exposed by the new required input were corrected before the sequential rerun. The sequential gates above are the accepted results.
   - Independent final re-review: no remaining findings. No new endpoint, secret, dependency, authentication, authorization, persistence, migration, deployment or billing change was introduced; the unrelated untracked `tests/integration/postgres/native-schema.test.ts` remains untouched.
   - Review gate: `aprobada`; focused tests, full suite, lint, TypeScript, build, responsive E2E, console-error gate and independent security review passed.

### LH-008: Define optional service-expiration automation

- Priority: `P3`
- State: `aprobada`
- Primary user: Platform operator
- RICE propuesto: `3.50` (`reach 3 / impact 4 / confidence 4 / effort 3`)
- Why now: `serviceExpiresAt` is currently informational; automatic action could reduce manual work but could also suspend valid customers if temporal and recovery rules are incomplete.
- Dependencies: Product discovery and explicit operator approval of one behavior.
- Scope: Implement the approved manual read-only dry-run while keeping automatic suspension deferred.
- Acceptance:
  - Discovery identifies affected users and a measurable operational outcome.
  - Informational date, notifications, and automatic suspension are compared with trade-offs.
  - Notifications with dry-run/observation are recommended; automatic suspension remains deferred.
  - Timezone, final-day semantics, grace period, eligibility, recipients, notification timing, retries, idempotency, and manual override are addressed.
  - Audit events, rollback/recovery behavior, and provider/job failure modes are specified.
  - The dry-run emits aggregate JSON only, accepts an optional ISO `--as-of`, and has no scheduler, mutation, notification, or billing behavior.
- Evidence required:
  - Brief: `docs/superpowers/specs/2026-08-20-lh-008-service-expiration-discovery-brief.md`.
  - Recommendation: notifications preceded by dry-run/observation; automatic suspension remains out of scope.
  - Alternatives: informational date, notifications, and automatic suspension, with manual-work effect, customer risk, and reversibility.
  - RICE reassessment: proposed `3.50` (`3 + 4 + 4 + 3`) for the notification phase.
  - Static verification: `git diff --check`.
  - Static verification: `git status --short`.
  - Static verification: `git grep -n "LH-008\|serviceExpiresAt\|automatic suspension\|notification" -- docs/superpowers/specs/2026-08-20-lh-008-service-expiration-automation-design.md docs/superpowers/specs/2026-08-20-lh-008-service-expiration-discovery-brief.md tasks.md`.
  - Report: `.superpowers/sdd/2026-08-20-lh-008-service-expiration-discovery/task-4-report.md`.
  - Traceability: the subagent did not execute Git writes because Cronos rules prohibit subagents from doing so. After verifying and reviewing the discovery artifacts, the controller created commit `087bc43` (`docs: record service expiration discovery`), affecting `docs/superpowers/specs/2026-08-20-lh-008-service-expiration-discovery-brief.md` and `tasks.md`; the subagent did not create this commit.
  - Production boundary: no production scheduler, suspension, migration, provider, billing, or external-service action occurred; these prohibitions remain in force.
  - Approved design: `docs/superpowers/specs/2026-08-21-lh-008-service-expiration-dry-run-design.md`.
  - Approved implementation plan: `docs/superpowers/plans/2026-08-21-lh-008-service-expiration-dry-run.md`.
  - Implementation: `src/modules/operations/service-expiration-dry-run.ts`, `scripts/service-expiration-dry-run.ts`, and package command `db:service-expiration-dry-run`; no migration, scheduler, endpoint, provider, billing, notification, suspension, or persistence change.
  - RED evidence: the classifier suite failed with `Cannot find module '../../../src/modules/operations/service-expiration-dry-run'` before production code existed; the CLI suite then failed with missing exported functions before the CLI contract was implemented.
  - Focused final verification: `corepack pnpm exec vitest run tests/unit/operations/service-expiration-dry-run.test.ts tests/unit/operations/service-expiration-dry-run-cli.test.ts` -> `2` files passed, `15` tests passed.
  - Full final verification: `corepack pnpm test` -> `71` files passed, `2` skipped; `602` tests passed, `3` skipped.
  - `corepack pnpm lint` -> exit code `0`; `corepack pnpm exec tsc --noEmit` -> exit code `0`; `corepack pnpm build` -> exit code `0`, `18/18` static pages generated.
  - CLI safety verification: `corepack pnpm db:service-expiration-dry-run --unknown` -> exit code `1`, `Unknown argument`; validation completed before database access.
  - Initial production read-only execution (2026-08-21): `corepack pnpm db:service-expiration-dry-run --as-of=2026-08-21T00:00:00Z` completed with exit code `0`; aggregate result reported `scanned=9`, `eligible=2`, `excluded=7`, `notInWindow=2`, `errors=0`, `deduplicationKeysComputed=2`, `duplicateKeys=0`, and zero pre-expiration, grace, or post-grace records. No identifiers or database values were recorded.
  - TLS/source diagnostic: the `LedgerHarbour Admin` Neon connection reported `businesses=0`, `users=2`, and `memberships=0`; no mutation occurred and that source was not retained in Vercel. The separate `ledgerharbour-staging` Neon project reproduced the original aggregate result with `sslmode=verify-full`, exit code `0`, `scanned=9`, `eligible=2`, `excluded=7`, `notInWindow=2`, `errors=0`, `deduplicationKeysComputed=2`, and `duplicateKeys=0`.
  - Vercel environment correction: `DATABASE_URL` was restored as separate Preview and Production targets from the source that reproduces the original evidence; Production uses `sslmode=verify-full`, Preview retains `sslmode=require`, and both environment API updates returned HTTP `200`. No secret value was recorded.
  - Production redeploy `Axb3tV9CDX6qMirqaV9nbAKkfybD` reached `READY`; `https://ledgerharbour.vercel.app/` loaded with page title `LedgerHarbour | Control financiero por negocio` and `0` browser console errors.
  - Security incident handling: a Vercel UI inspection exposed a database credential in tool output; it was not committed or added to reports, and the affected Neon role password was rotated before continuation. This remains documented for operator review.
  - Security review: no new endpoint, mutation path, external integration, authentication surface, or public abuse surface; output is aggregate JSON and repository errors are sanitized. `corepack pnpm audit --audit-level high --json` reported `0` vulnerabilities at every severity.
  - `git diff --check` -> exit code `0`; only the normal LF/CRLF conversion warnings appeared. All production actions were read-only or configuration/deploy operations; no migration, billing, suspension, scheduler, notification, or application data mutation occurred.
  - Operator confirmation (2026-08-21): `ledgerharbour-staging` is the intentional Neon source for Vercel Production; no credential value was requested or recorded.
  - Review gate: `aprobada`; implementation, source confirmation, production read-only verification, deployment verification, security remediation, and real test evidence passed. Automatic suspension, scheduler, notification, billing, and mutation behavior remain out of scope.

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
