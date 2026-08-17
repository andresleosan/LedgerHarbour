BEGIN;

CREATE TABLE projects (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id),
  name text NOT NULL,
  normalized_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  is_active boolean NOT NULL DEFAULT false,
  created_by text NOT NULL REFERENCES users(id),
  reviewed_by text REFERENCES platform_members(id),
  reviewed_at timestamptz,
  activated_at timestamptz,
  rejected_at timestamptz,
  suspended_at timestamptz,
  status_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_status_check CHECK (status IN ('pending', 'active', 'rejected', 'suspended')),
  CONSTRAINT projects_status_activity_consistency_check CHECK (
    (status = 'active' AND is_active = true) OR (status <> 'active' AND is_active = false)
  )
);
CREATE UNIQUE INDEX projects_business_normalized_name_unique ON projects (business_id, normalized_name);
CREATE INDEX projects_business_status_idx ON projects (business_id, status);
CREATE INDEX projects_created_by_idx ON projects (created_by);

CREATE TABLE project_memberships (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL DEFAULT 'member',
  is_active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_memberships_role_check CHECK (role IN ('owner', 'member')),
  CONSTRAINT project_memberships_status_check CHECK (status IN ('pending', 'active', 'suspended', 'revoked')),
  CONSTRAINT project_memberships_status_activity_consistency_check CHECK (
    (status = 'active' AND is_active = true) OR (status <> 'active' AND is_active = false)
  )
);
CREATE UNIQUE INDEX project_memberships_project_user_unique ON project_memberships (project_id, user_id);
CREATE INDEX project_memberships_project_active_idx ON project_memberships (project_id, is_active);

COMMIT;
