BEGIN;

DROP TABLE IF EXISTS business_templates;
DELETE FROM ledgerharbour_schema_migrations WHERE version = '0009_business_templates';

COMMIT;
