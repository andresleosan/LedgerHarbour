BEGIN;

CREATE TABLE invoice_codings (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id),
  invoice_id text NOT NULL,
  heading_id text NOT NULL,
  amount numeric(14,2) NOT NULL,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_codings_invoice_fk FOREIGN KEY (business_id, invoice_id)
    REFERENCES invoices (business_id, id),
  CONSTRAINT invoice_codings_heading_fk FOREIGN KEY (business_id, heading_id)
    REFERENCES account_headings (business_id, id),
  CONSTRAINT invoice_codings_invoice_sort_unique UNIQUE (invoice_id, sort_order),
  CONSTRAINT invoice_codings_invoice_heading_unique UNIQUE (invoice_id, heading_id),
  CONSTRAINT invoice_codings_amount_check CHECK (amount > 0)
);
CREATE INDEX invoice_codings_business_invoice_idx ON invoice_codings (business_id, invoice_id);

COMMIT;
