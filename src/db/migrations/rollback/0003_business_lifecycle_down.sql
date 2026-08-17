BEGIN;

DELETE FROM ledgerharbour_schema_migrations WHERE version = '0003_business_lifecycle';

DROP TRIGGER IF EXISTS memberships_exactly_one_active_owner ON memberships;
DROP TRIGGER IF EXISTS businesses_exactly_one_active_owner ON businesses;
DROP FUNCTION IF EXISTS enforce_exactly_one_active_owner();

ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS businesses_status_check,
  DROP CONSTRAINT IF EXISTS businesses_created_by_fk,
  DROP COLUMN IF EXISTS suspension_reason,
  DROP COLUMN IF EXISTS suspended_at,
  DROP COLUMN IF EXISTS service_expires_at,
  DROP COLUMN IF EXISTS activated_at,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS created_by;

CREATE FUNCTION enforce_exactly_one_active_owner() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_business_id text;
  active_owner_count integer;
BEGIN
  IF TG_TABLE_NAME = 'businesses' THEN
    target_business_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_business_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.business_id ELSE NEW.business_id END;
  END IF;
  SELECT COUNT(*) INTO active_owner_count FROM memberships
  WHERE business_id = target_business_id AND role = 'owner_admin' AND is_active = true;
  IF active_owner_count <> 1 THEN
    RAISE EXCEPTION 'business must have exactly one active Owner Admin';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER memberships_exactly_one_active_owner
  AFTER INSERT OR DELETE OR UPDATE OF user_id, business_id, role, is_active ON memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_exactly_one_active_owner();
CREATE CONSTRAINT TRIGGER businesses_exactly_one_active_owner
  AFTER INSERT OR UPDATE OF is_active ON businesses
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_exactly_one_active_owner();

DROP INDEX IF EXISTS businesses_status_idx;

COMMIT;
