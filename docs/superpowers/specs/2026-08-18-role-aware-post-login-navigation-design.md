# Role-aware post-login navigation

## Goal

Send an authenticated global platform administrator to `/admin` after login while ordinary authenticated users continue to `/onboarding`.

## Scope

- Add a server-rendered continuation route at `/auth/continue`.
- Route successful Firebase email and Google logins through that continuation route.
- Keep registration, logout, session creation, and platform authorization contracts unchanged.
- Do not authorize from client state, an email allowlist, or a value returned to the browser.

## Architecture

`AuthForm` remains responsible only for completing Firebase login and creating the server session through the existing provider action. After a successful production login it navigates to `/auth/continue` instead of choosing a workspace itself.

The continuation page reads the server session with `getCurrentIdentity()`. A small `resolvePostLoginDestination()` function receives the identity and repositories, checks the existing `platform_members` authorization boundary through `requirePlatformMember()`, and returns only an internal path:

- Active, linked `platform_admin`, or a verified Firebase identity that successfully performs the existing one-time claim: redirect to `/admin`.
- Authenticated identity without platform access: redirect to `/onboarding`.
- Missing or invalid session: redirect to `/login`.
- Repository, configuration, or claim-conflict failures: propagate the error instead of silently treating them as ordinary users.

The `/admin` layout remains the final authorization boundary. The continuation route improves navigation but does not replace route-level authorization.

## Data Flow

1. Firebase completes email or Google authentication in the browser.
2. The existing server action verifies the Firebase ID token and sets the HTTP-only session cookie.
3. `AuthForm` navigates to `/auth/continue`.
4. The server reads the session identity.
5. The server checks or performs the existing one-time `platform_members` claim.
6. The server redirects to `/admin` or `/onboarding`.

No role, membership identifier, Firebase token, or session cookie is added to the client response.

## Error Handling

- Only `PLATFORM_ACCESS_DENIED` maps to the ordinary-user destination.
- A missing session maps to `/login`.
- `REPOSITORY_CONFLICT`, database failures, and unexpected errors remain visible to the application error boundary and logs without exposing secrets to the browser.
- Redirect decisions remain deterministic and do not retry external services.

## Testing

- Unit test the destination resolver with an active linked platform administrator.
- Unit test the verified one-time platform claim path.
- Unit test an authenticated ordinary user returning `/onboarding`.
- Unit test that repository conflicts and unexpected failures are rethrown.
- Verify that successful production Firebase login paths target `/auth/continue` while registration and the deterministic browser harness preserve their current behavior.
- Run the focused auth/platform tests, the full unit/integration suite, lint, TypeScript/build, and Playwright E2E.
- Verify in production only after deployment approval: the seeded administrator lands on `/admin`, an ordinary test identity does not gain platform access, and protected `/admin` routes still enforce authorization.

## Security Notes

- `platform_members.user_id` remains the normal authorization source after the one-time verified Firebase claim.
- Email is used only by the existing claim mechanism; there is no hardcoded administrator email in application code.
- The client cannot select or override the destination role.
- Ordinary users cannot gain access by navigating directly to `/auth/continue` or `/admin`.

## Rollback

Revert `AuthForm` to navigate successful logins directly to `/onboarding` and remove `/auth/continue`. No schema or data rollback is required for this navigation change.
