BEGIN;

CREATE TYPE verification_state AS ENUM ('unverified', 'verified');
CREATE TYPE membership_role AS ENUM ('owner_admin', 'general_admin', 'administrator');
CREATE TYPE join_request_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE document_status AS ENUM ('uploaded', 'processing', 'needs_review', 'approved', 'failed');
CREATE TYPE invoice_review_state AS ENUM ('draft', 'needs_review', 'approved');
CREATE TYPE job_status AS ENUM ('queued', 'processing', 'completed', 'failed');
CREATE TYPE audit_actor_type AS ENUM ('user', 'system');
CREATE TYPE base_currency_kind AS ENUM ('standard', 'custom');

CREATE TABLE users (
  id text PRIMARY KEY,
  provider_id text NOT NULL,
  email text NOT NULL,
  normalized_email text NOT NULL,
  display_name text NOT NULL,
  verification_state verification_state NOT NULL DEFAULT 'unverified',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_provider_id_unique ON users (provider_id);
CREATE UNIQUE INDEX users_normalized_email_unique ON users (normalized_email);

CREATE TABLE businesses (
  id text PRIMARY KEY,
  name text NOT NULL,
  normalized_search_name text NOT NULL,
  base_currency_kind base_currency_kind NOT NULL DEFAULT 'standard',
  base_currency_code text DEFAULT 'GBP',
  base_currency_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT businesses_base_currency_reference_check CHECK (
    (base_currency_kind = 'standard' AND base_currency_code IS NOT NULL AND base_currency_id IS NULL)
    OR (base_currency_kind = 'custom' AND base_currency_code IS NULL AND base_currency_id IS NOT NULL)
  )
);
CREATE INDEX businesses_normalized_search_name_idx ON businesses (normalized_search_name);

CREATE TABLE memberships (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  business_id text NOT NULL REFERENCES businesses(id),
  role membership_role NOT NULL DEFAULT 'administrator',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_user_business_unique UNIQUE (user_id, business_id)
);
CREATE UNIQUE INDEX memberships_one_active_owner_per_business
  ON memberships (business_id) WHERE role = 'owner_admin' AND is_active = true;
CREATE INDEX memberships_business_active_idx ON memberships (business_id, is_active);
CREATE FUNCTION enforce_exactly_one_active_owner() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_business_id text;
  active_owner_count integer;
BEGIN
  IF TG_TABLE_NAME = 'businesses' THEN
    IF TG_OP = 'DELETE' THEN
      target_business_id := OLD.id;
    ELSE
      target_business_id := NEW.id;
    END IF;
  ELSIF TG_TABLE_NAME = 'memberships' THEN
    IF TG_OP = 'DELETE' THEN
      target_business_id := OLD.business_id;
    ELSE
      target_business_id := NEW.business_id;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.business_id IS DISTINCT FROM NEW.business_id THEN
      SELECT COUNT(*) INTO active_owner_count FROM memberships WHERE business_id = OLD.business_id
        AND role = 'owner_admin' AND is_active = true;
      IF active_owner_count <> 1 THEN
        RAISE EXCEPTION 'business must have exactly one active Owner Admin';
      END IF;
    END IF;
  END IF;
  SELECT COUNT(*) INTO active_owner_count FROM memberships WHERE business_id = target_business_id
    AND role = 'owner_admin' AND is_active = true;
  IF active_owner_count <> 1 THEN
    RAISE EXCEPTION 'business must have exactly one active Owner Admin';
  END IF;
  RETURN NULL;
END;
$$;
-- Owner replacement must deactivate the current owner before activating the replacement in one transaction.
CREATE CONSTRAINT TRIGGER memberships_exactly_one_active_owner
  AFTER INSERT OR DELETE OR UPDATE OF user_id, business_id, role, is_active ON memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_exactly_one_active_owner();
CREATE CONSTRAINT TRIGGER businesses_exactly_one_active_owner
  AFTER INSERT OR UPDATE OF is_active ON businesses
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_exactly_one_active_owner();

CREATE TABLE join_requests (
  id text PRIMARY KEY,
  requester_id text NOT NULL REFERENCES users(id),
  business_id text NOT NULL REFERENCES businesses(id),
  requested_role membership_role NOT NULL DEFAULT 'administrator',
  status join_request_status NOT NULL DEFAULT 'pending',
  reviewed_by text REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX join_requests_business_status_idx ON join_requests (business_id, status);
CREATE UNIQUE INDEX join_requests_one_pending_per_requester_business
  ON join_requests (requester_id, business_id) WHERE status = 'pending';
ALTER TABLE join_requests
  ADD CONSTRAINT join_requests_reviewer_business_fk
  FOREIGN KEY (reviewed_by, business_id) REFERENCES memberships (user_id, business_id);

CREATE TABLE documents (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id),
  uploader_id text NOT NULL,
  private_object_key text NOT NULL,
  original_file_name text NOT NULL,
  original_mime_type text NOT NULL,
  original_size_bytes bigint NOT NULL,
  checksum text,
  status document_status NOT NULL DEFAULT 'uploaded',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_business_id_unique UNIQUE (business_id, id),
  CONSTRAINT documents_uploader_business_fk FOREIGN KEY (uploader_id, business_id)
    REFERENCES memberships (user_id, business_id)
);
CREATE INDEX documents_business_status_idx ON documents (business_id, status);
CREATE UNIQUE INDEX documents_business_object_key_unique ON documents (business_id, private_object_key);
CREATE FUNCTION enforce_active_document_uploader() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = NEW.uploader_id
      AND business_id = NEW.business_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'document uploader must have an active business membership';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER documents_uploader_active_membership
  BEFORE INSERT OR UPDATE OF uploader_id, business_id ON documents
  FOR EACH ROW EXECUTE FUNCTION enforce_active_document_uploader();

CREATE TABLE categories (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categories_business_id_unique UNIQUE (business_id, id),
  CONSTRAINT categories_business_name_unique UNIQUE (business_id, name)
);
CREATE INDEX categories_business_active_idx ON categories (business_id, is_active);

CREATE TABLE currencies (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id),
  name text NOT NULL,
  iso_code text,
  symbol text NOT NULL,
  decimal_count integer NOT NULL DEFAULT 2,
  is_standard boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT currencies_business_id_unique UNIQUE (business_id, id),
  CONSTRAINT currencies_decimal_count_check CHECK (decimal_count BETWEEN 0 AND 6),
  CONSTRAINT currencies_business_iso_code_unique UNIQUE (business_id, iso_code)
);
CREATE INDEX currencies_business_active_idx ON currencies (business_id, is_active);
ALTER TABLE businesses
  ADD CONSTRAINT businesses_base_currency_custom_fk
  FOREIGN KEY (id, base_currency_id) REFERENCES currencies (business_id, id);

CREATE TABLE invoices (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id),
  document_id text NOT NULL UNIQUE,
  supplier text,
  invoice_number text,
  invoice_date date,
  due_date date,
  subtotal numeric(14,2),
  tax_amount numeric(14,2),
  total numeric(14,2),
  currency_id text,
  category_id text,
  confidence_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  review_state invoice_review_state NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_business_id_unique UNIQUE (business_id, id),
  CONSTRAINT invoices_business_document_fk FOREIGN KEY (business_id, document_id)
    REFERENCES documents (business_id, id),
  CONSTRAINT invoices_business_currency_fk FOREIGN KEY (business_id, currency_id)
    REFERENCES currencies (business_id, id),
  CONSTRAINT invoices_business_category_fk FOREIGN KEY (business_id, category_id)
    REFERENCES categories (business_id, id)
);
CREATE INDEX invoices_business_invoice_number_idx ON invoices (business_id, invoice_number);

CREATE TABLE audit_events (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id),
  actor_type audit_actor_type NOT NULL DEFAULT 'user',
  actor_id text REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_actor_type_check CHECK (
    (actor_type = 'system' AND actor_id IS NULL)
    OR (actor_type = 'user' AND actor_id IS NOT NULL)
  ),
  CONSTRAINT audit_events_user_actor_business_fk FOREIGN KEY (actor_id, business_id)
    REFERENCES memberships (user_id, business_id)
);
CREATE INDEX audit_events_business_created_at_idx ON audit_events (business_id, created_at);
CREATE FUNCTION enforce_active_audit_actor() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.actor_type = 'system' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = NEW.actor_id
      AND business_id = NEW.business_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'audit user actor must have an active business membership';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_events_user_actor_active_membership
  BEFORE INSERT OR UPDATE OF actor_type, actor_id, business_id ON audit_events
  FOR EACH ROW EXECUTE FUNCTION enforce_active_audit_actor();
CREATE FUNCTION prevent_audit_event_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only';
END;
$$;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

CREATE TABLE jobs (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id),
  document_id text NOT NULL,
  requested_by text NOT NULL,
  job_type text NOT NULL DEFAULT 'ocr',
  status job_status NOT NULL DEFAULT 'queued',
  retry_count integer NOT NULL DEFAULT 0,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_business_document_fk FOREIGN KEY (business_id, document_id)
    REFERENCES documents (business_id, id)
);
CREATE INDEX jobs_business_status_idx ON jobs (business_id, status);
CREATE UNIQUE INDEX jobs_business_document_type_unique ON jobs (business_id, document_id, job_type);
ALTER TABLE jobs
  ADD CONSTRAINT jobs_requested_by_business_fk
  FOREIGN KEY (requested_by, business_id) REFERENCES memberships (user_id, business_id);
CREATE UNIQUE INDEX documents_business_checksum_unique
  ON documents (business_id, checksum) WHERE checksum IS NOT NULL;
REVOKE DELETE, TRUNCATE ON documents, invoices, categories, currencies, audit_events, jobs FROM PUBLIC;
COMMIT;
