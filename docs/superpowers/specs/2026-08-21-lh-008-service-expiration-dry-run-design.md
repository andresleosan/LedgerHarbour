# LH-008: Service Expiration Dry-Run Design

## Status

Design approved by the operator for review before implementation planning.
This phase observes expiration candidates only. It does not send notifications,
change lifecycle state, write audit rows, select a provider, or schedule work in
production.

## Goal

Provide a repeatable manual command that classifies current service expirations
using the existing PostgreSQL tenancy repository and emits safe aggregate JSON.
The command must make the future notification phase measurable without creating
customer impact or a new operational dependency.

## Decisions

- Canonical timezone: UTC.
- Expiration semantics: `serviceExpiresAt` represents the inclusive end of the
  final service day at `23:59:59.999Z`; the classifier does not add another day
  to the stored timestamp.
- Pre-expiration windows: `14`, `7`, and `1` day before expiration.
- Window semantics: exact UTC calendar-day matches only; a record is classified in
  the `14`, `7`, or `1` window only when that exact number of UTC calendar days
  remains. The windows do not represent ranges and cannot overlap.
- Post-expiration grace period: `3` days.
- Eligible records: `status = active`, `isActive = true`, and a valid
  `serviceExpiresAt`.
- Excluded records: `pending`, `rejected`, `suspended`, inactive records, and
  records with a null expiration date. A non-null value that cannot be parsed as
  a timestamp is an error, not an exclusion.
- Recipient class classified by the observation: platform administrators only.
- Delivery: no provider and no channel are selected; no message is generated or
  sent.
- Execution: manual CLI command, not a scheduler or HTTP endpoint.
- Persistence: no database writes, audit writes, deduplication reservations, or
  report files.
- Clock: optional `--as-of=2026-08-21T00:00:00Z` in ISO UTC; current UTC time is
  the default.
- Concurrent runs: independent execution with an ephemeral `runId`.
- Record errors: continue processing other records, count errors, and exit with
  status `1` if any record error occurred.

## Architecture

### Pure classifier

Create `src/modules/operations/service-expiration-dry-run.ts` with a pure
classification function. It receives normalized business records, an `asOf`
instant, and the fixed policy. It returns classifications and aggregate data
without importing PostgreSQL, process APIs, logging, or provider clients.

The classifier must calculate a stable deduplication key using:

```text
businessId|expirationEvent|windowId|serviceExpiresAt
```

The key is calculated for determinism and diagnostics only. It is never persisted
or reserved. The classifier must distinguish at least these outcomes:

- `pre_expiration_14`
- `pre_expiration_7`
- `pre_expiration_1`
- `grace_period`
- `expired_after_grace`
- `not_in_window`
- `excluded`
- `error`

Boundary comparisons must be explicit and covered by tests. A valid record is
classified from its current expiration value on every run; no stale result can be
reused because the phase has no stored result.

### CLI adapter

Create `scripts/service-expiration-dry-run.ts`. The adapter must:

1. Parse and validate `--as-of=2026-08-21T00:00:00Z` when supplied.
2. Load the existing runtime configuration without printing secret values.
3. Require a PostgreSQL connection through the existing `DATABASE_URL` contract.
4. Read businesses through the existing tenancy repository contract.
5. Pass normalized records to the pure classifier.
6. Emit one JSON document to stdout.
7. Exit `0` when the run has no record errors and `1` otherwise.

Connection or configuration failures also exit `1` with a sanitized diagnostic
on stderr. The command must never print the connection URL, credentials, email
addresses, message content, or complete business identifiers.

## Output Contract

The aggregate output has this shape:

```json
{
  "runId": "ephemeral",
  "asOf": "2026-08-21T00:00:00.000Z",
  "timezone": "UTC",
  "policy": {
    "preExpirationWindowsDays": [14, 7, 1],
    "gracePeriodDays": 3,
    "eligibleStatuses": ["active"],
    "recipientClass": "platform_admin"
  },
  "counts": {
    "scanned": 0,
    "eligible": 0,
    "preExpiration14": 0,
    "preExpiration7": 0,
    "preExpiration1": 0,
    "gracePeriod": 0,
    "expiredAfterGrace": 0,
    "notInWindow": 0,
    "excluded": 0,
    "errors": 0,
    "deduplicationKeysComputed": 0,
    "duplicateKeys": 0
  },
  "errorCodes": []
}
```

The exact `runId` is generated at runtime and is not persisted. Counts are the
only business-level output. `errorCodes` contains stable sanitized categories,
not database errors, SQL, contacts, or record contents.

## Error Handling

- Invalid `--as-of`: fail before opening the database and exit `1`.
- Missing or invalid database configuration: emit a generic configuration error
  and exit `1`.
- Database connection or read failure: emit a generic read error and exit `1`.
- Null expiration date on an otherwise excluded record: count `excluded`.
- Non-null expiration data that cannot be parsed: count `error`, add a stable
  error code, and continue with other records.
- Duplicate or concurrent command: do not lock or mutate; each run emits its own
  aggregate result.
- No eligible records: valid successful result with zero counts and exit `0`.

## Security And Operational Boundaries

- The command is manual and has no public route.
- The command performs reads only and has no transaction writes.
- No provider, email service, queue, scheduler, billing account, credential, or
  new dependency is introduced.
- No business status, membership, `isActive`, `serviceExpiresAt`, suspension field,
  or audit row is changed.
- Output is aggregate-only and safe for an operator terminal when configuration
  errors are sanitized.
- Automatic suspension, access revocation, notification delivery, and recovery
  actions remain outside this phase.

## Testing

### Classifier tests

- Exact `14`, `7`, and `1` day boundaries.
- Non-matching days between exact windows remain `not_in_window`.
- Final-day inclusive boundary at `23:59:59.999Z`.
- Grace day `0` and grace day `3` boundaries.
- First instant after grace.
- UTC behavior across calendar-day boundaries.
- `--as-of` determinism and stable classification.
- Eligible and excluded status combinations.
- Inactive businesses and missing or invalid dates.
- Stable deduplication keys and duplicate-key counting.
- No lifecycle mutation through the classifier.

### CLI tests

- Valid aggregate JSON with no business identifiers.
- Exit `0` for a clean run.
- Exit `1` after record-level errors while processing remaining records.
- Exit `1` for invalid arguments and unavailable configuration.
- Repository instrumentation proving no write method is called.
- Sanitized stderr for configuration, connection, and read failures.

## Acceptance Criteria

- The command uses the existing PostgreSQL repository and accepts optional
  `--as-of=2026-08-21T00:00:00Z` in ISO UTC format.
- The classifier implements the approved UTC, final-day, windows, grace, and
  eligibility policy.
- Output is aggregate JSON only and contains no sensitive record data.
- No write, notification, provider, scheduler, migration, or public endpoint is
  introduced.
- Unit and CLI tests cover all boundaries and error paths above.
- `git diff --check`, lint, typecheck, focused tests, full tests, and build pass.
- The implementation is not a production deployment approval and does not
  authorize the later notification-delivery phase.
