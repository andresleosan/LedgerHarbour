BEGIN;

ALTER TABLE audit_events
  DROP CONSTRAINT IF EXISTS audit_events_user_actor_business_fk;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_user_actor_fk FOREIGN KEY (actor_id) REFERENCES users(id);

CREATE OR REPLACE FUNCTION enforce_active_audit_actor() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.actor_type = 'system' THEN
    RETURN NEW;
  END IF;
  IF NEW.action = 'business_requested' THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.actor_id) THEN
      RAISE EXCEPTION 'audit request actor must exist';
    END IF;
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

COMMIT;
