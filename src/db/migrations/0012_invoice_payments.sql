BEGIN;

ALTER TABLE invoices
  ADD COLUMN kind text NOT NULL DEFAULT 'invoice',
  ADD COLUMN payment_status text,
  ADD COLUMN paid_account_id text,
  ADD COLUMN paid_on date,
  ADD COLUMN amount_debited numeric(14,2),
  ADD COLUMN voided_at timestamptz;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_kind_check CHECK (kind IN ('invoice', 'credit_note')),
  ADD CONSTRAINT invoices_payment_status_check CHECK (payment_status IN ('paid', 'unpaid', 'paid_privately')),
  ADD CONSTRAINT invoices_amount_debited_check CHECK (amount_debited > 0),
  -- Paid exactly when the account, the date and the amount are all there; otherwise none of them is.
  ADD CONSTRAINT invoices_payment_details_check CHECK (
    (payment_status = 'paid' AND paid_account_id IS NOT NULL AND paid_on IS NOT NULL AND amount_debited IS NOT NULL)
    OR (payment_status IS DISTINCT FROM 'paid' AND paid_account_id IS NULL AND paid_on IS NULL AND amount_debited IS NULL)
  ),
  ADD CONSTRAINT invoices_paid_account_fk FOREIGN KEY (business_id, paid_account_id)
    REFERENCES money_accounts (business_id, id);

COMMIT;
