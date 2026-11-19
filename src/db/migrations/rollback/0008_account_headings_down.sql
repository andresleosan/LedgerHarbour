BEGIN;

DROP INDEX IF EXISTS account_headings_business_sort_order_idx;
DROP TABLE IF EXISTS account_headings;
DELETE FROM ledgerharbour_schema_migrations WHERE version = '0008_account_headings';

COMMIT;
