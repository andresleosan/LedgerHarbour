# PostgreSQL Staging Rollback

## Preconditions

- Confirm the target is staging and `ALLOW_STAGING_MIGRATION=true` is set only
  for the migration command.
- Capture a Neon snapshot and verify that its restore operation is available.
- Record the current deployment SHA and the value reported by
  `ledgerharbour_schema_migrations`.

## Apply

```powershell
$env:PERSISTENCE_MODE='postgres'
$env:ALLOW_STAGING_MIGRATION='true'
corepack pnpm db:migrate
corepack pnpm db:check
```

The runner refuses an absent `DATABASE_URL`, refuses to run without the
explicit staging flag, uses a 10-second connection timeout and a 30-second
statement timeout, and aborts if schema tables exist without a migration
record.

## Abort criteria

Stop and restore the snapshot if migration execution fails, required table
counts differ, constraints are missing, or the staging smoke test cannot create
and isolate a synthetic tenant.

## Restore

1. Stop staging traffic or disable the staging deployment.
2. Restore the captured Neon snapshot into the staging database.
3. Run `corepack pnpm db:check` with the restored `DATABASE_URL`.
4. Redeploy the previous verified application SHA.
5. Run the staging smoke and tenant-isolation tests before reopening access.

This procedure never runs against production and never uses `DROP` or
`TRUNCATE`.
