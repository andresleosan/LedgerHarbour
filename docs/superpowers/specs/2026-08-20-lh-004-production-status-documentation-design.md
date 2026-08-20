# LH-004: Production-status documentation design

## Goal

Synchronize the repository's operational documentation with the evidence that is
actually present in Git. The documentation must distinguish local development,
deterministic tests, implemented adapters, operator-controlled activation, and
external facts that remain unverified.

This task does not activate providers, inspect dashboards, use credentials,
enable billing, deploy, migrate, or change application behavior.

## Scope

Only these files may be changed during implementation:

- `README.md`
- `docs/STACK.md`
- `docs/production-activation.md`
- `tasks.md` for LH-004 status and evidence

Historical specifications and plans remain unchanged. The untracked
`tests/integration/postgres/native-schema.test.ts` file is unrelated and remains
outside the task.

## Evidence policy

Use the following hierarchy when writing a status statement:

1. Local automated evidence proves local or deterministic behavior only.
2. Configuration and runbooks prove intended contracts and operator steps, not
   external activation.
3. The LH-005 checklist is the source for the required read-only verification of
   Google Document AI, Cloudflare R2, and Upstash Redis; until that verification
   is performed, quotas, alerts, and scopes remain `unverified`.
4. Any unsupported production fact must be labeled `unverified`, `pending`, or
   `operator-controlled` rather than presented as current reality.

No secret, token, private account identifier, row-level production data, or
billing detail may be added.

## Document changes

### README.md

Replace the contradictory local-only status header with a status model that
separates:

- verified local development and deterministic test behavior;
- repository implementation and configuration contracts;
- production activation and provider state that still require operator evidence.

Keep the synthetic development account and local demo instructions explicitly
limited to development. Keep the production limitations visible.

### docs/STACK.md

Add a concise status matrix for Firebase, Neon, Vercel, Cloudflare R2, Upstash,
and Google Document AI. Each row must distinguish implementation, local
evidence, operator-controlled gates, and external facts that are not verified.

Preserve existing technical details where accurate, but remove wording that
implies adapters or configuration are equivalent to production activation. Link
provider-specific operational checks to the activation gate and LH-005 checklist.

### docs/production-activation.md

Separate one-time activation work from recurring controls. One-time work covers
provider setup, secret loading, identity configuration, initial database
readiness, gate validation, and explicit deployment approval. Recurring controls
cover quotas, billing alerts, credential scopes, backups, health checks, and
manual suspension/recovery.

State clearly that this document is a runbook and does not itself prove that any
external step has been completed.

### tasks.md

Keep LH-004 in `revision` after implementation until the documentation QA is
complete. Record the commands and results for placeholder, contradiction,
stale-status, and secret scans, plus `git diff --check`. Do not mark production
facts verified based only on this repository.

## QA and acceptance

- `README.md` distinguishes local development, deterministic testing, and
  production status without declaring production ready without evidence.
- `docs/STACK.md` covers Firebase, Neon, Vercel, R2, Upstash, and Document AI
  without overstating readiness.
- `docs/production-activation.md` distinguishes activation steps from recurring
  controls and retains explicit operator approval gates.
- Historical specs and plans are unchanged.
- Placeholder, contradiction, stale-status, and secret scans are run and their
  real results are recorded.
- `git diff --check` exits successfully without whitespace errors.
- No provider, billing, deployment, migration, credential, or application-code
  operation is performed.
- An independent review confirms all production statements have evidence or an
  explicit unverified label.

## Non-goals

- Verifying current provider dashboards, quotas, alerts, scopes, billing, or
  deployment state.
- Updating prices or quota values without current external evidence.
- Changing application code, runtime configuration, secrets, migrations, or
  historical design records.
