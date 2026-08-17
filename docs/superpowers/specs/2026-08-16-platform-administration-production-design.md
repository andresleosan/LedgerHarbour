# Platform Administration and Production Mode

## Goal

Convert LedgerHarbour from a local/demo-oriented application into a production-oriented multi-tenant platform with a global administration control plane. The control plane must let the platform administrators approve access, control business and project availability, and manually manage service activation for monthly subscriptions.

This specification also covers the approved logout action and removal of visible/runtime demo behavior.

## Roles

### Platform administrator

`platform_admin` is a global role. All platform administrators have equal permissions:

- View every business, project, administrator, status, activation date, and service expiration date.
- Approve or reject business creation requests.
- Approve or reject project creation requests.
- Approve, revoke, or suspend business administrators.
- Activate, suspend, and reactivate businesses manually.
- Suspend or reactivate projects.
- Add or remove platform administrators.
- View the audit trail for global actions.

The initial platform administrators are created through a controlled database bootstrap. The bootstrap must not depend on an application-code email allowlist. Firebase verified identity is linked to the seeded platform administrator record at first login.

### Business owner administrator

When a platform administrator approves a business, its requester becomes `owner_admin` for that business. The owner administrator can:

- Manage the business profile.
- Register business administrators and allies.
- Approve or reject internal administrator requests.
- Create project requests.
- Operate only while both the business and its projects are enabled.

### Business administrator

Business administrators have the same business-scoped operational permissions already defined by the application. They can register and approve other administrators for their business and create project requests, but cannot approve the business or project globally.

### Regular account

Anyone may create a Firebase account and submit a business request. A regular account has no business access until the platform approves the requested business and assigns the requester as `owner_admin`.

## Lifecycle

### Business

Allowed statuses:

- `pending`: submitted and waiting for platform approval.
- `active`: approved and service access enabled.
- `suspended`: manually disabled, normally because the monthly service is unpaid or the platform administrator chose to pause it.
- `rejected`: denied by a platform administrator.

The business stores `activatedAt`, `serviceExpiresAt`, `suspendedAt`, and a generic `suspensionReason`. `serviceExpiresAt` is displayed for manual subscription control; passing the date does not create a separate `expired` status. A platform administrator explicitly changes the business to `suspended` or `active`.

Suspending a business immediately blocks all business routes and APIs, and cascades effective access suspension to its projects, memberships, and administrators without deleting historical data.

### Project

Allowed statuses:

- `pending`: requested by a business administrator and waiting for platform approval.
- `active`: approved and available to the business.
- `rejected`: denied by a platform administrator.
- `suspended`: manually paused or inherited from a suspended business.

A pending project may be visible to the business administrators as a request/draft, but no operational user may use it until global approval. A suspended business overrides every project status for authorization purposes.

## Administration Panel

The authenticated platform area will provide three primary views:

- **Businesses**: pending requests, active/suspended businesses, requester, owner administrator, projects count, activation date, service expiration date, and actions.
- **Projects**: pending/active/rejected/suspended projects, owning business, requester, dates, and actions.
- **Administrators**: platform administrators and business administrators, linked business, status, approval date, and revoke/suspend actions.

The panel must use server-side authorization for every read and mutation. Hiding a button is not an authorization boundary.

## Persistence Model

The data model will add explicit, tenant-aware records rather than infer global privileges from email addresses:

- `platform_members`: Firebase-linked user, normalized email for bootstrap/audit display, `platform_admin` role, active status, timestamps.
- Business lifecycle fields on the existing business record or a dedicated lifecycle record.
- `business_administrator_requests`: requester, business, requested role, status, reviewer, reviewed timestamp, and reason.
- `projects`: business ownership, requester, lifecycle status, reviewer, approval/rejection timestamps, and service access fields.
- `project_memberships`: user-to-project access, governed by effective business/project status.
- `platform_audit_events`: actor, action, target type/id, before/after status, reason, and timestamp. Secrets, tokens, and document bytes are never stored.

All schema changes require a reversible migration and a tested rollback plan. No production migration is authorized by this specification alone.

## Authentication and Production Rules

- Firebase Authentication is mandatory at runtime; development email/Google simulation is removed from user-facing flows and rejected by production configuration.
- Google Document AI is mandatory for runtime OCR; `fake` remains available only as an injected test double, never as a production/default provider.
- The application must fail closed if production authentication, OCR, database, storage, or rate-limit configuration is incomplete.
- The landing page must not contain `Open demo`, demo account instructions, simulated provider copy, or other demo CTA language.
- Logout is available from onboarding and the authenticated application shell. It clears the Firebase client session and server session, then redirects to `/login`.

## Security Rules

- Platform authorization is checked server-side using `platform_members`.
- Business authorization requires active membership and an active business.
- Project authorization requires active project membership, an active business, and an active project.
- Suspension is a deny-all gate for affected business resources, including direct API calls.
- Approval and suspension mutations require a reason where appropriate and create an audit event.
- Platform administrator records are not created by arbitrary client input; adding a platform administrator requires an authenticated platform administrator action.
- All list and search APIs remain tenant-safe and return safe DTOs without private storage keys or provider credentials.

## Verification

The implementation must include:

- Unit tests for platform permission matrix and effective access under each lifecycle status.
- Integration tests for business approval, project approval, manual suspension/reactivation, and cascading access denial.
- Tests proving non-platform users cannot call global administration APIs.
- Tests proving a pending business/project cannot access operational APIs.
- E2E flow for platform approval, business administrator approval, project approval, suspension, and reactivation.
- E2E logout from onboarding and the authenticated shell.
- Production configuration tests proving development auth, demo OCR, and incomplete required settings fail closed.
- Full unit, lint, typecheck, build, dependency audit, and browser verification before release.

## Out Of Scope

- Payment gateway integration, automatic recurring billing, invoices for subscriptions, or webhooks.
- Automatic suspension based solely on the expiration date; the first version uses manual platform actions.
- Deployment, production secret configuration, enabling billing, real Google OCR requests, or destructive migrations without explicit operator confirmation.
