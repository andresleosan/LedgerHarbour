# LH-006: allowedDevOrigins design

## Goal

Remove the Next.js development warning for the Playwright server while allowing
only the harness origin `127.0.0.1:3100` outside production. Production
configuration must omit `allowedDevOrigins` entirely.

## Scope

Modify only:

- `next.config.ts`
- `tests/unit/config/next-config.test.ts`
- `tasks.md` for LH-006 status and evidence

Do not modify `playwright.config.ts`; its `baseURL` and web server already use
`http://127.0.0.1:3100`. Keep the existing Firebase rewrites and all application
behavior unchanged.

## Configuration design

Export a testable `createNextConfig(nodeEnv)` factory from `next.config.ts`.
The factory must:

- include `allowedDevOrigins: ["127.0.0.1:3100"]` when `nodeEnv` is
  `development` or `test`;
- omit `allowedDevOrigins` when `nodeEnv` is `production`;
- preserve the existing headers, middleware body-size setting, and Firebase
  rewrites in every environment.

The default export must be created from `process.env.NODE_ENV` through this
factory so Next.js receives the correct environment-specific configuration.
No other development origin, wildcard, scheme, host, or port may be added.

## Test design

Create `tests/unit/config/next-config.test.ts` with focused assertions:

1. `createNextConfig("test").allowedDevOrigins` equals exactly
   `["127.0.0.1:3100"]`.
2. `createNextConfig("development").allowedDevOrigins` equals exactly
   `["127.0.0.1:3100"]`.
3. `createNextConfig("production")` does not contain the
   `allowedDevOrigins` property.
4. The production config retains both Firebase rewrite source/destination
   pairs.

The test must not start a server, access Firebase, use credentials, or inspect
external services.

## Security and compatibility

- Production must not receive a development origin policy.
- The origin is limited to the exact Playwright host and port.
- Existing Firebase same-origin rewrites remain byte-for-byte equivalent in
  behavior.
- No secrets, credentials, network calls, or provider configuration changes are
  introduced.

## Verification

Run the focused config test, then the full unit suite, lint, TypeScript, build,
and complete Playwright E2E suite. The E2E output must no longer contain the
`allowedDevOrigins` warning. Record the real commands and outputs in `tasks.md`.

LH-006 remains `revision` until the focused test, full test suite, lint,
TypeScript, build, E2E output, and production configuration review all pass.

## Non-goals

- Allowing `localhost`, wildcard subdomains, arbitrary ports, or production
  origins.
- Changing Playwright base URLs or server commands.
- Changing Firebase rewrites, authentication, middleware, or application code.
- Suppressing unrelated Next.js warnings.
