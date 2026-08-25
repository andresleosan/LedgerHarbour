BEGIN;

DROP TABLE IF EXISTS rate_limit_windows;
DELETE FROM ledgerharbour_schema_migrations WHERE version = '0007_rate_limit_windows';

COMMIT;
