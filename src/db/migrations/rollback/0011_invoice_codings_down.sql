BEGIN;

DROP TABLE IF EXISTS invoice_codings;
DELETE FROM ledgerharbour_schema_migrations WHERE version = '0011_invoice_codings';

COMMIT;
