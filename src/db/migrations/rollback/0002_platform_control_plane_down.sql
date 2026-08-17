BEGIN;

DROP TRIGGER IF EXISTS platform_audit_events_append_only ON platform_audit_events;
DROP FUNCTION IF EXISTS prevent_platform_audit_event_mutation();
DROP TABLE IF EXISTS platform_audit_events;
DROP TABLE IF EXISTS platform_members;
DROP TYPE IF EXISTS platform_role;

COMMIT;
