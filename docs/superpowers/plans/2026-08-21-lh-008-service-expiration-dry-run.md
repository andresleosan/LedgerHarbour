# LH-008 Service Expiration Dry-Run Implementation Plan

> **Execution note:** Implement this plan task by task. Use the repository's existing TypeScript, Vitest, `tsx`, Drizzle, and `pg` conventions. Do not add a migration, scheduler, API route, notification provider, persistence, or production configuration. Do not create a Git commit unless the operator explicitly requests one.

## Scope and Contract

The feature is a manually invoked, read-only observation of business service-expiration state. It reads from PostgreSQL, classifies eligible records, and writes one aggregate JSON document to stdout. It never writes to the database and never sends notifications.

The classifier uses UTC calendar dates:

- `active` and `isActive=true` are required for eligibility.
- A missing `serviceExpiresAt` excludes the record without classification.
- A non-null invalid timestamp increments the error count, does not make the record eligible, and does not stop the remaining records.
- The expiration date itself is inclusive and is grace day `0`; the next three UTC calendar dates are grace days `-1` through `-3`.
- Exact pre-expiration windows are `daysRemaining=14`, `7`, and `1`; days between them are not in a pre-expiration window.
- Dates after the grace period are `expired`.
- `--as-of=2026-08-21T00:00:00Z` overrides the clock; without it, the current time is used.

The JSON result contains only the specified aggregate data: `runId`, `asOf`, `timezone`, policy values, scanned/classification/error counts, deduplication diagnostics, and sanitized error codes. It contains no business IDs, names, emails, database URLs, stack traces, or row payloads.

## Task 1: Add the Pure Classifier With Boundary Tests

**Files:**

- Create `tests/unit/operations/service-expiration-dry-run.test.ts`.
- Create `src/modules/operations/service-expiration-dry-run.ts`.

### Step 1: Write the failing tests

Add focused tests for the exported classifier and policy contract before implementing it:

- An active, active-flagged record with a timestamp exactly 14, 7, or 1 UTC calendar days after `asOf` is counted in the matching pre-expiration window.
- A record with 13, 6, or 2 days remaining is not counted in any pre-expiration window.
- A record expiring on the `asOf` UTC date is counted as grace day `0`, including a timestamp at `23:59:59.999Z`.
- Records one, two, and three UTC calendar dates after expiration are counted as grace-period records.
- A record four UTC calendar dates after expiration is counted as expired.
- Pending, suspended, rejected, and inactive records are excluded before classification.
- Records with no expiration timestamp are excluded.
- An invalid expiration timestamp increments the error count while valid records continue to classify.
- The classifier returns only aggregate fields and no input identifiers.

Run the new test file and confirm it fails because the classifier module does not exist yet:

```text
pnpm exec vitest run tests/unit/operations/service-expiration-dry-run.test.ts
```

### Step 2: Implement the smallest pure contract

Export these contracts from `src/modules/operations/service-expiration-dry-run.ts`:

- `SERVICE_EXPIRATION_DRY_RUN_POLICY` with `preExpirationWindowsDays: [14, 7, 1]`, `gracePeriodDays: 3`, `eligibleStatuses: ["active"]`, and `recipientClass: "platform_admin"`.
- `ServiceExpirationDryRunRecord`, containing only `id`, `status`, `isActive`, and `serviceExpiresAt` fields needed by the classifier.
- `ServiceExpirationDryRunCounts`, containing `scanned`, `eligible`, exact `preExpiration14`, `preExpiration7`, and `preExpiration1` counts, `gracePeriod`, `expiredAfterGrace`, `notInWindow`, `excluded`, `errors`, `deduplicationKeysComputed`, and `duplicateKeys`.
- `ServiceExpirationDryRunResult`, containing `runId`, ISO `asOf`, top-level `timezone: "UTC"`, the fixed policy metadata, counts, and sanitized `errorCodes`.
- `classifyServiceExpirationDryRun(input)` accepting records, a `Date` as-of value, and a run ID.

Use UTC date-only arithmetic rather than local-time arithmetic. Convert both `asOf` and valid expiration timestamps to their ISO UTC date components, calculate signed calendar-day difference, and apply the exact classification rules above. Do not include IDs in errors or results. Keep the function deterministic for fixed inputs and avoid all database or side-effect imports.

### Step 3: Run the focused tests

```text
pnpm exec vitest run tests/unit/operations/service-expiration-dry-run.test.ts
```

The focused suite must pass before proceeding.

## Task 2: Add Testable CLI Argument and Output Handling

**Files:**

- Modify `src/modules/operations/service-expiration-dry-run.ts`.
- Create `tests/unit/operations/service-expiration-dry-run-cli.test.ts`.

### Step 1: Write failing CLI tests

Test a separately exported execution function so the CLI can be verified without a live database:

- `--as-of=...` is parsed as an ISO instant and is reflected in the JSON result.
- No `--as-of` uses the injected clock.
- Missing `DATABASE_URL` returns exit code `1` with the exact safe configuration error and no JSON result.
- An invalid `--as-of` returns exit code `1` with a safe argument error.
- An unknown argument returns exit code `1` rather than being silently ignored.
- A successful injected repository call emits exactly one parseable aggregate JSON document.
- Repository failures return exit code `1` with a sanitized message and do not expose connection details or stack traces.
- The injected repository exposes only `listBusinesses`; the execution path has no update, insert, delete, suspension, notification, or audit dependency.
- The repository close function is called after both successful and failed reads.

Run the CLI test file and confirm it fails before implementation:

```text
pnpm exec vitest run tests/unit/operations/service-expiration-dry-run-cli.test.ts
```

### Step 2: Implement argument parsing and execution

Add these testable contracts:

- `parseServiceExpirationDryRunArgs(args)` returns either `{ asOf: Date | undefined }` or a safe validation error. Accept only the optional `--as-of=<ISO UTC instant ending in Z>` form and reject all other arguments.
- `ServiceExpirationDryRunRepository` is `Pick<OnboardingRepository, "listBusinesses">` so the dry-run cannot accidentally depend on mutating repository methods.
- `ServiceExpirationDryRunCliDependencies` injects `openRepository(databaseUrl)`, `now()`, and `createRunId()`. `openRepository` returns the read-only repository plus `close()`.
- `executeServiceExpirationDryRun(args, env, dependencies)` returns `{ exitCode, stdout, stderr }`, where success emits one JSON document on stdout and configuration/read failures emit sanitized diagnostics on stderr.

For a successful run, resolve `asOf` from the argument or injected clock, call only `listBusinesses`, map the returned business fields into the classifier record shape, classify, and serialize the result once with `JSON.stringify`. Return exit code `1` when the aggregate contains record errors. For configuration/read failures, return exit code `1` and sanitize diagnostics such as `DATABASE_URL is required for service expiration dry-run`, `Invalid --as-of value`, or `Service expiration dry-run read failed` on stderr; never print the original database URL or stack.

### Step 3: Run the focused CLI tests

```text
pnpm exec vitest run tests/unit/operations/service-expiration-dry-run-cli.test.ts
```

Both unit suites must pass.

## Task 3: Connect the CLI to the Existing PostgreSQL Repository

**Files:**

- Modify `src/modules/operations/service-expiration-dry-run.ts` only if the default dependency factory belongs there.
- Create `scripts/service-expiration-dry-run.ts`.
- Modify `package.json` to add `db:service-expiration-dry-run` mapped to `tsx scripts/service-expiration-dry-run.ts`.

### Step 1: Add the production adapter

Follow `scripts/db/bootstrap-platform-admins.ts` for the executable guard, `DATABASE_URL` validation, `Pool` lifecycle, and `createDbClient` usage. The default dependency factory must:

- Create `new Pool({ connectionString: databaseUrl })`.
- Wrap it with `createDbClient(pool)`.
- Create `createPostgresOnboardingRepository(database)`.
- Expose only `listBusinesses` to the execution function.
- Close the pool in `finally` through the injected `close()` function.

Do not duplicate SQL. Reuse `OnboardingRepository.listBusinesses()` and the existing `Business` fields. Do not call `db:migrate` or alter schema.

### Step 2: Add the executable entry point

The script must call the testable execution function with `process.argv.slice(2)` and the `DATABASE_URL` environment value, print stdout only to stdout and stderr only to stderr, and set `process.exitCode` to the returned exit code. Use the existing `pathToFileURL(resolve(process.argv[1])).href === import.meta.url` pattern so importing the script in tests has no side effect.

### Step 3: Verify the CLI wiring without production execution

Run TypeScript checking and inspect the generated command help behavior through invalid input only; do not invoke it with production credentials:

```text
pnpm exec tsc --noEmit
pnpm db:service-expiration-dry-run --unknown
```

The invalid invocation must fail safely with exit code `1` and must not open a database connection before argument validation.

## Task 4: Add Regression Coverage and Documentation Evidence

**Files:**

- Modify `README.md` only if the repository's operational command list documents database scripts there.
- Modify `docs/STACK.md` only if the new manual command needs to be recorded in the operational tooling section.
- Modify `tasks.md` to record LH-008 implementation status and test evidence after all verification passes.

### Step 1: Add command-level documentation only where required

Document the command as a manual, read-only preview and include the safe example:

```text
pnpm db:service-expiration-dry-run --as-of=2026-08-21T00:00:00Z
```

State that it requires `DATABASE_URL`, emits aggregate JSON to stdout, has no scheduler, and performs no mutation or notification. Do not add production deployment instructions or claim automatic enforcement.

### Step 2: Run the complete verification set

Run each command and retain the real output for the task evidence:

```text
pnpm exec vitest run tests/unit/operations/service-expiration-dry-run.test.ts tests/unit/operations/service-expiration-dry-run-cli.test.ts
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm exec git diff --check
```

If the full suite exposes an unrelated pre-existing failure, record the exact command and failure in `tasks.md`; do not mark LH-008 approved based only on focused tests.

## Self-Review Checklist

Before marking LH-008 complete, verify the implementation against the approved design:

- All exact UTC window and inclusive expiration boundaries have tests.
- Missing, invalid, and ineligible records follow the documented count behavior.
- Aggregate output contains no identifiers, names, emails, secrets, stack traces, or connection strings.
- Argument validation happens before opening a pool.
- The execution path calls only `listBusinesses` and always closes the pool.
- No SQL writes, repository mutation methods, notifications, scheduler, API route, migration, or billing action were added.
- Configuration and repository failures produce non-zero exit status and sanitized output.
- Focused tests, full tests, lint, TypeScript checking, and diff checks have actual passing evidence.
- `LH-008` remains a manual dry-run and does not claim automatic suspension or enforcement.
