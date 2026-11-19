BEGIN;

CREATE TABLE financial_years (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_years_business_id_unique UNIQUE (business_id, id),
  CONSTRAINT financial_years_business_start_unique UNIQUE (business_id, start_date),
  CONSTRAINT financial_years_dates_check CHECK (end_date > start_date),
  CONSTRAINT financial_years_status_check CHECK (status IN ('open', 'closed'))
);
CREATE UNIQUE INDEX financial_years_one_open_per_business ON financial_years (business_id) WHERE status = 'open';

CREATE TABLE money_accounts (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id),
  name text NOT NULL,
  kind text NOT NULL,
  sheet_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT money_accounts_business_id_unique UNIQUE (business_id, id),
  CONSTRAINT money_accounts_name_check CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT money_accounts_kind_check CHECK (kind IN ('bank', 'cash')),
  CONSTRAINT money_accounts_sheet_name_check CHECK (char_length(sheet_name) BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX money_accounts_active_name_unique ON money_accounts (business_id, lower(name)) WHERE is_active;
CREATE UNIQUE INDEX money_accounts_active_sheet_unique ON money_accounts (business_id, sheet_name) WHERE is_active;

CREATE TABLE money_account_openings (
  business_id text NOT NULL,
  money_account_id text NOT NULL,
  financial_year_id text NOT NULL,
  opening_balance numeric(14,2) NOT NULL,
  CONSTRAINT money_account_openings_pkey PRIMARY KEY (business_id, money_account_id, financial_year_id),
  CONSTRAINT money_account_openings_account_fk FOREIGN KEY (business_id, money_account_id)
    REFERENCES money_accounts (business_id, id),
  CONSTRAINT money_account_openings_year_fk FOREIGN KEY (business_id, financial_year_id)
    REFERENCES financial_years (business_id, id)
);

CREATE TABLE movements (
  id text PRIMARY KEY,
  created_seq bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  business_id text NOT NULL REFERENCES businesses(id),
  financial_year_id text NOT NULL,
  money_account_id text NOT NULL,
  movement_date date NOT NULL,
  narrative text NOT NULL,
  heading_id text,
  amount numeric(14,2) NOT NULL,
  origin text NOT NULL,
  source_invoice_id text,
  source_ref text,
  transfer_group_id text,
  deleted_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT movements_year_fk FOREIGN KEY (business_id, financial_year_id)
    REFERENCES financial_years (business_id, id),
  CONSTRAINT movements_account_fk FOREIGN KEY (business_id, money_account_id)
    REFERENCES money_accounts (business_id, id),
  CONSTRAINT movements_heading_fk FOREIGN KEY (business_id, heading_id)
    REFERENCES account_headings (business_id, id),
  CONSTRAINT movements_source_invoice_fk FOREIGN KEY (business_id, source_invoice_id)
    REFERENCES invoices (business_id, id),
  CONSTRAINT movements_creator_business_fk FOREIGN KEY (created_by, business_id)
    REFERENCES memberships (user_id, business_id),
  CONSTRAINT movements_narrative_check CHECK (char_length(narrative) BETWEEN 1 AND 200),
  CONSTRAINT movements_amount_check CHECK (amount <> 0),
  CONSTRAINT movements_origin_check CHECK (origin IN ('invoice', 'manual', 'statement')),
  CONSTRAINT movements_heading_check CHECK (heading_id IS NOT NULL OR origin = 'statement'),
  CONSTRAINT movements_source_invoice_check CHECK ((source_invoice_id IS NOT NULL) = (origin = 'invoice'))
);
CREATE INDEX movements_listing_idx ON movements (business_id, financial_year_id, money_account_id, movement_date, created_seq);
CREATE INDEX movements_source_invoice_idx ON movements (business_id, source_invoice_id) WHERE source_invoice_id IS NOT NULL;

REVOKE DELETE, TRUNCATE ON financial_years, money_accounts, money_account_openings, movements FROM PUBLIC;

COMMIT;
