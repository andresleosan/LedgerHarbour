BEGIN;

DROP TABLE IF EXISTS movements;
DROP TABLE IF EXISTS money_account_openings;
DROP TABLE IF EXISTS money_accounts;
DROP TABLE IF EXISTS financial_years;
DELETE FROM ledgerharbour_schema_migrations WHERE version = '0010_money_movements';

COMMIT;
