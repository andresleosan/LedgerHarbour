# Staging Production Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Prepare a private staging environment that uses durable PostgreSQL, Firebase Auth, private R2 storage, shared rate limiting, real Google Document AI OCR, and reproducible CI without changing local development behavior.

**Architecture:** Keep the modular Next.js monolith and replace provider doubles only through the existing `AuthProvider`, `StorageAdapter`, `OcrProvider`, and repository contracts. Staging selects external adapters through explicit environment configuration and fails closed when required variables are missing; local mode keeps HMAC development auth, in-memory repositories, local storage, and Fake OCR.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM, Neon PostgreSQL, Firebase Admin/Web SDK, Cloudflare R2 S3 API, Upstash Redis, Google Document AI Invoice Parser, GitHub Actions, pnpm 11.21.0, Vitest, Playwright.

## Global Constraints

- Staging is private; no public production deployment is part of this plan.
- No provider account, billing activation, card, credential, or real invoice is created or stored by the implementation.
- The R2 bucket is private; object keys are generated server-side and the application does not require a physical folder.
- `PERSISTENCE_MODE=memory|postgres` remains explicit with no silent fallback.
- `AUTH_MODE=development|firebase` remains explicit; HMAC development cookies are rejected outside development mode.
- Upstash failures return `429`/fail-closed on sensitive mutations and never fall back to process memory for staging protection.
- Document AI has one bounded retry with backoff, a timeout, a size/page limit, and a visible failed state.
- Every database change has a tested rollback or a documented snapshot restore procedure.
- Use `corepack pnpm` for all install, test, lint, typecheck, build, and E2E commands.
- Do not log tokens, cookies, service-account JSON, document bytes, or complete OCR text.

---

### Task 1: Stabilize dependency and CI gates

**Files:**
- Modify: `package.json` to add only the required provider SDKs and safe dependency overrides after audit evidence.
- Modify: `pnpm-lock.yaml` through pnpm only.
- Create: `.github/workflows/ci.yml`.
- Modify: `README.md` and `docs/STACK.md` with staging gates and cost status.

**Interfaces:**
- Produces a single CI command contract: frozen pnpm install, lint, typecheck, unit/integration tests, build, and E2E.

- [ ] **Step 1: Capture the dependency chain and baseline**

Run:

```powershell
corepack pnpm audit --audit-level high
corepack pnpm why sharp
corepack pnpm why postcss
```

Record the direct dependency path and candidate patched versions before changing `package.json`.

- [ ] **Step 2: Apply the smallest compatible dependency fix**

Prefer a patched transitive override when the installed Next.js major supports it. If the audit requires a Next.js major upgrade, create a separate upgrade commit and run the complete suite before accepting it. Do not use an untested `--force` upgrade.

- [ ] **Step 3: Add CI using pnpm**

Create `.github/workflows/ci.yml` with Node 24, Corepack, `corepack pnpm install --frozen-lockfile`, lint, typecheck, Vitest, build, and E2E. E2E must set `AUTH_MODE=development` and the disposable test secret; no production secrets are available to pull requests.

- [ ] **Step 4: Verify the dependency and CI contract**

Run:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm audit --audit-level high
corepack pnpm lint
corepack pnpm exec tsc --noEmit
corepack pnpm test
corepack pnpm build
```

Expected: no high vulnerabilities remain without an explicitly documented exception, and all commands exit 0.

### Task 2: Verify and operate durable PostgreSQL

**Files:**
- Create: `scripts/db/migrate.ts` for explicit migration execution.
- Create: `scripts/db/rollback.md` with snapshot restore and abort criteria.
- Modify: `package.json` with `db:migrate` and `db:check` scripts.
- Modify: `src/db/migrations/0001_initial.sql` only if native PostgreSQL verification proves a compatibility issue.
- Create: `tests/integration/postgres/native-schema.test.ts` for a disposable native PostgreSQL contract when `TEST_DATABASE_URL` is available.
- Modify: `docs/verification/ledgerharbour-postgresql-migration.md` with native-server evidence.

**Interfaces:**
- Consumes: `DATABASE_URL`, `PERSISTENCE_MODE=postgres`, and the existing SQL migration.
- Produces: a migration command that is never called by a web request and a tested restore procedure.

- [ ] **Step 1: Define migration metadata and preflight checks**

The migration runner must refuse to run without `DATABASE_URL`, connect with a bounded timeout, report the migration version, and stop before any write when the database is unreachable. It must not accept a production URL from a generic local command without an explicit `ALLOW_STAGING_MIGRATION=true` gate.

- [ ] **Step 2: Verify the initial SQL on disposable native PostgreSQL**

Run the migration against `TEST_DATABASE_URL`, then assert users/businesses/memberships, tenant foreign keys, unique constraints, invoice/document relations, audit append-only behavior, and transaction rollback. Use PGlite only as a fast unit contract; native PostgreSQL is the staging gate.

- [ ] **Step 3: Document rollback before applying staging**

The procedure must capture a provider snapshot, record the schema version, run the migration, verify row counts and constraints, and restore the snapshot if any check fails. No `DROP`, `TRUNCATE`, or destructive type conversion is allowed.

- [ ] **Step 4: Verify both modes**

Run:

```powershell
$env:PERSISTENCE_MODE='memory'; corepack pnpm test
$env:PERSISTENCE_MODE='postgres'; $env:DATABASE_URL=$env:TEST_DATABASE_URL; corepack pnpm test
```

Expected: local mode remains unchanged and PostgreSQL mode fails closed if the URL is absent or invalid.

### Task 3: Integrate Firebase Auth without mixing sessions

**Files:**
- Create: `src/modules/auth/firebase-auth-provider.ts` for server token verification and identity mapping.
- Create: `src/modules/auth/firebase-client.ts` for browser sign-in and ID-token acquisition.
- Modify: `src/modules/auth/auth-provider.ts` only to expose the minimal token/session boundary required by both providers.
- Modify: `src/modules/auth/session.ts` to keep development HMAC isolated from Firebase sessions.
- Modify: `src/app/(auth)/login/page.tsx` and `src/ui/auth/AuthForm.tsx` for Firebase email/Google actions.
- Modify: `.env.example` with names only, never values.
- Create: `tests/unit/auth/firebase-auth-provider.test.ts`.
- Create: `tests/integration/auth/firebase-session.test.ts` using signed synthetic tokens or the Firebase emulator, never a real user token.

**Interfaces:**
- Consumes: Firebase client config in public browser variables and Firebase Admin credentials only on the server.
- Produces: the existing `AuthIdentity` shape with `providerUserId`, verified email, display name, and `emailVerified`.

- [ ] **Step 1: Write token and session contract tests**

Cover valid token, expired token, wrong issuer, wrong audience, missing email, unverified email policy, and provider outage. Assert that no local user is created for invalid tokens and that errors are stable `401` responses.

- [ ] **Step 2: Implement server verification**

Use Firebase Admin with credentials loaded from protected environment variables. Verify signature, issuer, audience, expiration, and UID. Map the verified UID to the local user repository through the existing onboarding boundary.

- [ ] **Step 3: Implement browser actions**

Use Firebase Web Auth for email and Google sign-in. Send the ID token to a server action or route that establishes the server session. Do not send Admin credentials to the browser and do not log tokens.

- [ ] **Step 4: Verify mode separation**

Run local E2E with `AUTH_MODE=development` and Firebase contract tests with `AUTH_MODE=firebase`. Confirm the development provider is unavailable in Firebase mode and Firebase is unavailable in development mode.

### Task 4: Move private document storage to R2

**Files:**
- Create: `src/modules/documents/r2-private-storage.ts` implementing `StorageAdapter` with the S3-compatible R2 client.
- Modify: `src/modules/persistence/repository-factory.ts` or storage resolver to select local/R2 explicitly by `STORAGE_MODE`.
- Modify: `.env.example` with `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` names only.
- Create: `tests/unit/documents/r2-private-storage.test.ts` with a fake S3 client.
- Create: `tests/integration/documents/r2-contract.test.ts` for a disposable staging bucket when credentials are supplied.
- Modify: `docs/STACK.md` with private bucket, retention, and deletion policy.

**Interfaces:**
- Consumes and produces the existing `StorageAdapter`; object keys remain `business/<businessId>/documents/<documentId>-<uuid>`.

- [ ] **Step 1: Write adapter contract tests**

Cover put/get/delete, content length, duplicate key behavior, invalid key rejection, provider timeout, and failed cleanup after repository failure.

- [ ] **Step 2: Implement the R2 adapter**

Use server-only credentials, a private bucket, bounded request timeouts, and no public URL generation. Translate provider failures to the existing stable document errors.

- [ ] **Step 3: Wire explicit storage selection**

Local tests continue with `STORAGE_MODE=local`; staging uses `STORAGE_MODE=r2`. Missing R2 variables fail closed instead of silently writing to local disk.

- [ ] **Step 4: Verify authorized downloads**

Run upload/download E2E against a staging bucket with synthetic documents and assert unauthorized cross-tenant downloads return `403` without exposing object keys or bytes.

### Task 5: Add shared Upstash rate limiting

**Files:**
- Create: `src/modules/security/rate-limit.ts` with the provider-neutral limiter contract.
- Create: `src/modules/security/upstash-rate-limit.ts` implementing the contract.
- Create: `src/app/api/health/route.ts` without exposing secrets or provider internals.
- Modify: sensitive API routes for login, upload, OCR processing, and public mutations.
- Modify: `.env.example` with `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` names only.
- Create: `tests/unit/security/rate-limit.test.ts`.
- Create: `tests/integration/security/upstash-rate-limit.test.ts` using a fake or disposable namespace.

**Interfaces:**
- Produces `allow`, `retryAfterSeconds`, and stable `429` response metadata without revealing account existence.

- [ ] **Step 1: Define limits and tests**

Use separate keys for IP, authenticated identity, business, and document. Test allow, deny, `Retry-After`, Redis timeout, and fail-closed behavior for mutation routes.

- [ ] **Step 2: Implement the Upstash adapter**

Use fixed/sliding windows with bounded command timeouts. Never retry a rate-limit command indefinitely. Do not use a process-local map in staging.

- [ ] **Step 3: Add route protection**

Apply limits to login attempts, upload, OCR enqueue, and public mutation endpoints before business work begins. Keep public static pages available when Redis is unavailable.

- [ ] **Step 4: Verify abuse behavior**

Run security tests for repeated login, oversized upload attempts, OCR enqueue bursts, and cross-tenant key separation. Assert `429` and no sensitive response differences.

### Task 6: Integrate Google Document AI Invoice Parser

**Files:**
- Create: `src/modules/invoices/google-document-ai-provider.ts` implementing `OcrProvider`.
- Modify: `src/modules/invoices/ocr-provider.ts` only for explicit provider configuration if required.
- Modify: `src/modules/jobs/ocr-worker.ts` to enforce timeout, one retry/backoff, and failed terminal state.
- Modify: `.env.example` with Google project, location, processor, and server credential names only.
- Create: `tests/unit/invoices/google-document-ai-provider.test.ts`.
- Create: `tests/integration/invoices/document-ai-contract.test.ts` using a fake client and redacted synthetic fixture.
- Modify: `docs/adr/ADR-006-fake-ocr-inicial.md` with the accepted staging provider and fallback boundary.

**Interfaces:**
- Consumes validated private document bytes and returns the existing invoice extraction contract; it never approves invoices or bypasses authorization.

- [ ] **Step 1: Write provider failure tests**

Cover timeout, one transient retry, permanent provider failure, malformed response, missing confidence, and quota/rate-limit response. Assert no infinite retry and a visible `failed` job.

- [ ] **Step 2: Implement the Google client**

Use a server-only service account credential, bounded timeout, one exponential-backoff retry, processor location, and page/byte limits. Redact provider responses before logging.

- [ ] **Step 3: Wire explicit OCR mode**

Local uses `OCR_PROVIDER=fake`; staging uses `OCR_PROVIDER=google-document-ai`; unknown or missing values fail closed for OCR jobs.

- [ ] **Step 4: Verify the invoice contract**

Run the fake provider suite, then the staging contract with a synthetic invoice fixture. Assert supplier, total, currency, field confidence, review state, and failure transitions.

### Task 7: Build private staging operations and release evidence

**Files:**
- Create: `.github/workflows/staging.yml` with protected environment gates.
- Create: `docs/operations/staging-runbook.md`.
- Create: `docs/operations/rollback-runbook.md`.
- Modify: `next.config.ts` and health route for safe runtime checks.
- Modify: `docs/STACK.md` with current cost estimates, alerts, and unresolved audit exceptions.
- Create: `tests/e2e/staging/critical-path.spec.ts`.
- Create: `tests/performance/staging-baseline.ps1` or an equivalent pnpm runner.

**Interfaces:**
- Consumes all staging adapters and emits release evidence: health, smoke, security, performance, cost, and rollback results.

- [ ] **Step 1: Add protected staging CI**

Run frozen pnpm install, audit, lint, typecheck, unit/integration tests, build, and E2E. Require a protected environment for deploy secrets and keep production secrets unavailable.

- [ ] **Step 2: Add operational runbooks**

Document secret rotation, provider outage behavior, database snapshot/restore, R2 object retention, rate-limit emergency tightening, OCR quota exhaustion, and rollback to the previous Vercel deployment.

- [ ] **Step 3: Run advanced QA**

Run contract tests for every provider boundary, tenant/security cases, a bounded load baseline for login/upload/OCR, and p95 latency collection. Record limits and observed bottlenecks before increasing traffic.

- [ ] **Step 4: Run staging acceptance**

Use synthetic data to execute Firebase login, business creation, R2 upload/download, Google OCR, review/approval, rate-limit `429`, tenant isolation, health check, and rollback rehearsal. Mark staging ready only after all evidence is attached.
