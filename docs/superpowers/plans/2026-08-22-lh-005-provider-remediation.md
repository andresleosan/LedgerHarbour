# LH-005 Provider Remediation Plan

> **For agentic workers:** Execute each task in order with a read-only checkpoint after every provider mutation. Do not print or commit secrets.

**Goal:** Configure provider cost alerts and replace over-broad runtime credentials without enabling unapproved billable workloads.

**Architecture:** Use the already authenticated official provider dashboards for one-off reversible changes. Keep application secrets in Vercel's encrypted environment store; the operator manually enters generated secret values when a browser handoff is required. No provider API adapter or local secret file is introduced.

**Tech Stack:** Google Cloud Console, Cloudflare R2 Dashboard, Upstash Console, Vercel Dashboard, Playwright MCP, redacted Markdown evidence.

## Global Constraints

- No OCR, billable API request, document upload, object upload, or production data mutation.
- The operator explicitly authorized one disposable Upstash Free Tier canary database; delete it after the ACL test.
- No password, token, access key, secret value, billing account row, address, or private identifier in Git, logs, chat, screenshots, or reports.
- Budgets are alerts only and are not hard spending caps.
- Every credential rotation has create, handoff, verify, and revoke steps with rollback until verification passes.
- Stop if a provider requires creating a new billing account, adding a payment method, or changing a plan beyond the approved scope.
- Do not deploy application code; only provider configuration and encrypted environment values may change.

### Task 1: Cloudflare R2 Budget Alert

- Open the existing R2 account and confirm the `ledgerharbour` bucket and current usage read-only.
- Create one monthly budget alert of `$1` with default owner notifications and thresholds `50%`, `90%`, and `100%`.
- Verify the alert appears in the account UI without changing the R2 plan or bucket.
- Rollback: delete only the newly created alert if the UI reports an incorrect scope or recipient.

### Task 2: Cloudflare R2 Credential Verification

- Inspect the existing R2 S3 token list read-only before creating a token.
- If an active token already has `Object Read & Write` and is scoped only to `ledgerharbour`, keep it; do not rotate a compliant credential without evidence of exposure or a runtime mismatch.
- Never copy the Access Key ID or Secret Access Key into chat, files, shell commands, or logs.
- If no compliant token exists, ask the operator to enter newly generated values manually in Vercel's encrypted Production and Preview environment fields, preserving the old values until verification.
- Verify configuration without printing values; do not perform an object write or read against production.
- Rollback: keep the existing compliant token active. If a replacement is required later, restore the old encrypted values and revoke only after verification.

### Task 3: Upstash ACL and Credential Rotation

- Inspect the non-production Redis target and determine whether it is an isolated disposable database; never use the production rate-limit database as the ACL canary. **Current result:** the console exposes only `ledgerharbour-ratelimit`; `excited-manatee` is its displayed endpoint/region alias, not a second database.
- Derive the command set required by the pinned `@upstash/ratelimit` version from its package source and test the minimum ACL against the isolated target only.
- Scope keys to `ledgerharbour:*` and preserve a temporary rollback token.
- Ask the operator to enter the replacement token manually in the encrypted Vercel fields after the canary passes.
- Verify application configuration without logging the token; revoke the old token only after a successful non-billable health check.
- Rollback: restore the old token and ACL on the isolated target if any command is denied; do not mutate production ACL until the canary is green.
- The operator authorized creation of one disposable Free Tier canary; the Upstash console refused it because the account already has its one Free Tier database and offered payment-method upgrade as the only alternative. No payment-method or plan change was made.
- Source review of `@upstash/ratelimit@2.0.8` for the current fixed-window limiter identified `EVALSHA`, `EVAL`, `GET`, `INCRBY`, and `PEXPIRE` as the minimum command allowlist. This remains a proposed canary ACL only; it was not applied to production.
- Current official Upstash documentation states that custom Redis ACL is available only on paid databases. Do not create an anonymous or second Free database as an ACL canary: it cannot validate this control. A paid isolated canary requires a new cost approval and remains a production-activation gate, not an LH-005 verification step.
- Later production-activation authorization (2026-08-25): the operator approved a separate Pay-as-you-go database only if it receives a `US$1/month` hard budget and the existing Free database remains available for rollback. The console still requires the operator to enter a payment method manually; no paid database, ACL or credential change has occurred yet.

### Task 4: Google Document AI Billing Alert

- Confirm whether an existing Cloud Billing account is available without opening payment details. **Current result:** an existing account is visible, but the LedgerHarbour project remains unlinked.
- If no account exists, stop and report that creating one or adding payment details is outside this plan. If the project UI does not expose a supported link action, use the existing billing-account workflow only; do not create a new billing account or add payment details.
- If an account exists, link only the already approved project and create a project-scoped `alerts-only` monthly budget of `$1` with thresholds `50%`, `90%`, and `100%`.
- Do not enable spend caps, automated billing disablement, Pub/Sub actions, OCR, or any billable request.
- Verify the project billing link and budget alert state read-only.
- Rollback: unlink the project or delete only the newly created budget if the operator requests rollback; do not close a billing account.
- The operator authorized use of the existing billing account; the official `Billing > Projects > Actions > Change billing` flow reached the target project, but Google rejected the association because the account reached its project billing quota. No quota increase or association was made.
- Later production-activation authorization (2026-08-25): the 30-day API method table showed no document-processing request. A request for exactly one additional billing-enabled project was submitted through Google's official quota form and acknowledged for review. The project remains unlinked, so the project-scoped `$1` alerts-only budget and billing association remain pending; no OCR request was made.

### Task 5: Evidence and QA

- Record UTC timestamps, provider state, alert state, quota, scope, remediation and rollback status with redaction.
- Run `git diff --check` and the exact secret-pattern scan against modified documentation.
- Keep every external provider result honestly labeled `verified`, `unverified`, or `blocked`; do not treat a blocked remediation as completed.
- Mark LH-005 `aprobada` when the approved read-only verification scope, redacted evidence, cost review and security review are complete. Billing links, paid plans and credential rotations remain separate production-activation gates and do not expand LH-005 retroactively.
