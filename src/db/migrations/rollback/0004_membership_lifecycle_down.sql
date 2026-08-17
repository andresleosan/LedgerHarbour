BEGIN;

DELETE FROM ledgerharbour_schema_migrations WHERE version = '0004_membership_lifecycle';
DROP INDEX IF EXISTS memberships_status_idx;
ALTER TABLE memberships
  DROP CONSTRAINT IF EXISTS memberships_status_activity_consistency_check,
  DROP CONSTRAINT IF EXISTS memberships_status_check,
  DROP COLUMN IF EXISTS status;

COMMIT;
