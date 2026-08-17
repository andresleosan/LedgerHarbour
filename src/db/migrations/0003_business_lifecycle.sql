BEGIN;

ALTER TABLE businesses
  ADD COLUMN created_by text,
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN activated_at timestamptz,
  ADD COLUMN service_expires_at timestamptz,
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN suspension_reason text;

UPDATE businesses
SET created_by = source.actor_id
FROM (
  SELECT DISTINCT ON (business_id) business_id, actor_id
  FROM audit_events
  WHERE action = 'business_created' AND actor_id IS NOT NULL
  ORDER BY business_id, created_at ASC
) AS source
WHERE businesses.id = source.business_id AND businesses.created_by IS NULL;

ALTER TABLE businesses
  ADD CONSTRAINT businesses_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id),
  ADD CONSTRAINT businesses_status_check CHECK (status IN ('pending', 'active', 'suspended', 'rejected'));

UPDATE businesses
SET status = CASE WHEN is_active THEN 'active' ELSE 'suspended' END,
    activated_at = CASE WHEN is_active THEN created_at ELSE NULL END,
    suspended_at = CASE WHEN is_active THEN NULL ELSE updated_at END,
    suspension_reason = CASE WHEN is_active THEN NULL ELSE 'Migrated from inactive business' END;

DROP TRIGGER IF EXISTS memberships_exactly_one_active_owner ON memberships;
DROP TRIGGER IF EXISTS businesses_exactly_one_active_owner ON businesses;
DROP FUNCTION IF EXISTS enforce_exactly_one_active_owner();

CREATE FUNCTION enforce_exactly_one_active_owner() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_business_id text;
  target_status text;
  active_owner_count integer;
BEGIN
  IF TG_TABLE_NAME = 'businesses' THEN
    target_business_id := NEW.id;
  ELSE
    IF TG_OP = 'DELETE' THEN
      target_business_id := OLD.business_id;
    ELSE
      target_business_id := NEW.business_id;
    END IF;
  END IF;

  SELECT status INTO target_status FROM businesses WHERE id = target_business_id;
  IF target_status IS DISTINCT FROM 'active' THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO active_owner_count FROM memberships
  WHERE business_id = target_business_id AND role = 'owner_admin' AND is_active = true;
  IF active_owner_count <> 1 THEN
    RAISE EXCEPTION 'active business must have exactly one active Owner Admin';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER memberships_exactly_one_active_owner
  AFTER INSERT OR DELETE OR UPDATE OF user_id, business_id, role, is_active ON memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_exactly_one_active_owner();
CREATE CONSTRAINT TRIGGER businesses_exactly_one_active_owner
  AFTER INSERT OR UPDATE OF status, is_active ON businesses
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_exactly_one_active_owner();

CREATE INDEX businesses_status_idx ON businesses (status);

COMMIT;
