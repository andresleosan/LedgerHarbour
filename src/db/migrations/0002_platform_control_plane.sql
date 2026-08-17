BEGIN;

CREATE TYPE platform_role AS ENUM ('platform_admin');

CREATE TABLE platform_members (
  id text PRIMARY KEY,
  user_id text,
  normalized_email text NOT NULL,
  role platform_role NOT NULL DEFAULT 'platform_admin',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_members_role_check CHECK (role = 'platform_admin'),
  CONSTRAINT platform_members_normalized_email_check CHECK (
    normalized_email = lower(btrim(normalized_email))
    AND length(normalized_email) > 3
  ),
  CONSTRAINT platform_members_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE UNIQUE INDEX platform_members_normalized_email_unique ON platform_members (normalized_email);
CREATE UNIQUE INDEX platform_members_user_id_unique ON platform_members (user_id);
CREATE INDEX platform_members_active_idx ON platform_members (is_active);

CREATE TABLE platform_audit_events (
  id text PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  before_status text,
  after_status text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_audit_events_actor_fk FOREIGN KEY (actor_id) REFERENCES platform_members(id)
);
CREATE INDEX platform_audit_events_target_idx
  ON platform_audit_events (target_type, target_id, created_at);
CREATE INDEX platform_audit_events_actor_idx
  ON platform_audit_events (actor_id, created_at);

CREATE FUNCTION prevent_platform_audit_event_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'platform audit events are append-only';
END;
$$;
CREATE TRIGGER platform_audit_events_append_only
  BEFORE UPDATE OR DELETE ON platform_audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_platform_audit_event_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON platform_audit_events FROM PUBLIC;
REVOKE DELETE, TRUNCATE ON platform_members FROM PUBLIC;

COMMIT;
