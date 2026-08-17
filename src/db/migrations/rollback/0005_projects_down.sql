BEGIN;

DELETE FROM ledgerharbour_schema_migrations WHERE version = '0005_projects';
DROP INDEX IF EXISTS project_memberships_project_active_idx;
DROP INDEX IF EXISTS project_memberships_project_user_unique;
DROP TABLE IF EXISTS project_memberships;
DROP INDEX IF EXISTS projects_created_by_idx;
DROP INDEX IF EXISTS projects_business_status_idx;
DROP INDEX IF EXISTS projects_business_normalized_name_unique;
DROP TABLE IF EXISTS projects;

COMMIT;
