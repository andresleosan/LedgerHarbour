BEGIN;

DELETE FROM ledgerharbour_schema_migrations
WHERE version = '0002_platform_control_plane';

DROP TRIGGER IF EXISTS platform_audit_events_append_only ON platform_audit_events;
DROP TRIGGER IF EXISTS platform_audit_events_truncate_append_only ON platform_audit_events;
DROP FUNCTION IF EXISTS prevent_platform_audit_event_mutation();
DROP TABLE IF EXISTS platform_audit_events;
DROP TABLE IF EXISTS platform_members;
DROP TYPE IF EXISTS platform_role;

COMMIT;
