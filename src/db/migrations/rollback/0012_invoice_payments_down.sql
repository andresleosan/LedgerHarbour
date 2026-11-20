BEGIN;

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_paid_account_fk,
  DROP CONSTRAINT IF EXISTS invoices_payment_details_check,
  DROP CONSTRAINT IF EXISTS invoices_amount_debited_check,
  DROP CONSTRAINT IF EXISTS invoices_payment_status_check,
  DROP CONSTRAINT IF EXISTS invoices_kind_check,
  DROP COLUMN IF EXISTS voided_at,
  DROP COLUMN IF EXISTS amount_debited,
  DROP COLUMN IF EXISTS paid_on,
  DROP COLUMN IF EXISTS paid_account_id,
  DROP COLUMN IF EXISTS payment_status,
  DROP COLUMN IF EXISTS kind;
DELETE FROM ledgerharbour_schema_migrations WHERE version = '0012_invoice_payments';

COMMIT;
