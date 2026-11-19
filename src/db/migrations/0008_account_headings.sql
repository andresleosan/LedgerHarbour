BEGIN;

CREATE TABLE account_headings (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id),
  position integer NOT NULL,
  template_value text NOT NULL,
  value_type text NOT NULL,
  heading_group text NOT NULL,
  sort_order integer NOT NULL,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  blocked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_headings_business_id_unique UNIQUE (business_id, id),
  CONSTRAINT account_headings_business_position_unique UNIQUE (business_id, position),
  CONSTRAINT account_headings_position_check CHECK (position > 0),
  CONSTRAINT account_headings_value_type_check CHECK (value_type IN ('text', 'number')),
  CONSTRAINT account_headings_heading_group_check CHECK (
    heading_group IN ('income', 'cost_of_sales', 'expenses', 'assets', 'liabilities', 'equity')
  ),
  CONSTRAINT account_headings_display_name_check CHECK (char_length(display_name) BETWEEN 1 AND 100),
  CONSTRAINT account_headings_blocked_reason_check CHECK (
    blocked_reason IS NULL OR blocked_reason IN (
      'blank_heading', 'marked_do_not_use', 'total_not_read', 'total_read_twice', 'truncated_formula', 'missing_from_template'
    )
  ),
  CONSTRAINT account_headings_blocked_inactive_check CHECK (blocked_reason IS NULL OR is_active = false)
);
CREATE INDEX account_headings_business_sort_order_idx ON account_headings (business_id, sort_order);

REVOKE DELETE, TRUNCATE ON account_headings FROM PUBLIC;

COMMIT;
