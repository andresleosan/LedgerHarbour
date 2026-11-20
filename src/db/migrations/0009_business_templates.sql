BEGIN;

CREATE TABLE business_templates (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id),
  private_object_key text NOT NULL,
  original_file_name text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum text NOT NULL,
  profile jsonb NOT NULL,
  uploaded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_templates_business_unique UNIQUE (business_id),
  CONSTRAINT business_templates_business_id_unique UNIQUE (business_id, id),
  CONSTRAINT business_templates_file_name_check CHECK (char_length(original_file_name) BETWEEN 1 AND 255),
  CONSTRAINT business_templates_size_check CHECK (size_bytes > 0),
  CONSTRAINT business_templates_checksum_check CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT business_templates_uploader_business_fk FOREIGN KEY (uploaded_by, business_id)
    REFERENCES memberships (user_id, business_id)
);

REVOKE DELETE, TRUNCATE ON business_templates FROM PUBLIC;

COMMIT;
