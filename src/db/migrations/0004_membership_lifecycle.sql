BEGIN;

ALTER TABLE memberships
  ADD COLUMN status text NOT NULL DEFAULT 'active';

UPDATE memberships
SET status = CASE WHEN is_active THEN 'active' ELSE 'suspended' END;

ALTER TABLE memberships
  ADD CONSTRAINT memberships_status_check CHECK (status IN ('pending', 'active', 'suspended', 'revoked'));

ALTER TABLE memberships
  ADD CONSTRAINT memberships_status_activity_consistency_check
  CHECK ((status = 'active' AND is_active = true) OR (status <> 'active' AND is_active = false));

CREATE INDEX memberships_status_idx ON memberships (status);

COMMIT;
