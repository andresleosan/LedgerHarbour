# LH-007: auth and onboarding locale design

## Goal

Consolidate language handling in authentication and onboarding so the URL
parameter `locale=en|es` is the single source of truth and survives login,
registration, onboarding navigation, and functional query parameters.

## Scope

Modify only the auth/onboarding locale boundary, its tests, and LH-007 evidence:

- `src/ui/useUrlLocale.ts`
- `src/ui/LanguageSwitcher.tsx` when shared behavior needs adjustment
- `src/ui/auth/AuthForm.tsx`
- `src/ui/auth/post-login-navigation.ts`
- `src/app/(auth)/auth/continue/page.tsx`
- `src/app/(auth)/login/page.tsx` and `src/app/(auth)/register/page.tsx` when
  query locale must be passed into the client boundary
- `src/app/onboarding/page.tsx`
- `src/app/onboarding/create-business/page.tsx`
- `src/app/onboarding/join-business/page.tsx`
- focused locale tests and relevant E2E tests
- `tasks.md` for LH-007 status and evidence

Do not add cookies, `localStorage`, a global locale provider, or a second
language state source. Do not change authentication providers, API contracts,
business behavior, or production configuration.

## Locale contract

- Supported values are `en` and `es`.
- Any missing or unsupported URL value falls back to `en`.
- The URL query parameter is the source of truth after every navigation.
- Locale changes preserve the current pathname and every unrelated query
  parameter, including functional filters and search values.
- Links between login, registration, onboarding, create-business, and
  join-business preserve the current locale.
- Firebase login continuation carries locale through `/auth/continue` to the
  resolved onboarding or admin destination.

## Component behavior

### URL locale helper

Reuse `useUrlLocale` as the client-side boundary. It must read `locale`, retain
all current search parameters when changing locale, and expose links for a
candidate locale without dropping unrelated parameters. Keep its fallback
behavior deterministic.

### Auth

`AuthForm` must use the URL locale instead of local-only state. Its selector
must be the only visible language selector on login and registration. The
login/register footer link must preserve all current query parameters. Successful
Firebase navigation must pass locale to `/auth/continue`; registration must
preserve locale when returning to login.

### Onboarding

The onboarding landing page, create-business page, and join-business page must
use the URL locale. Their selectors must be the only visible language controls
on each page. Links back to onboarding and between flows must preserve locale;
form submissions must not reset the selected language when the URL remains the
same.

### Auth continuation

`/auth/continue` must read and validate `searchParams.locale`, append the valid
locale to its resolved destination, and retain the existing identity and
authorization decisions. An invalid or absent locale uses `en`.

## Accessibility and responsive behavior

- English and Spanish selector labels remain accurate in both languages.
- Active locale uses the existing `aria-current` or `aria-pressed` semantics.
- Keyboard focus remains visible and navigation remains operable without a
  pointer.
- Existing `prefers-reduced-motion` behavior remains intact.
- Desktop and mobile layouts have no horizontal overflow.
- Each auth/onboarding screen renders exactly one visible language selector.

## Tests and verification

- Add focused unit coverage for locale parsing, query preservation, and
  post-login destination locale propagation.
- Add or update browser coverage for login, registration, onboarding, create,
  and join flows in English and Spanish, including a functional query parameter.
- Verify exactly one visible language selector per target screen.
- Verify desktop and mobile viewport behavior and no horizontal overflow.
- Verify browser console and `pageerror` output remain clean.
- Run the focused tests, full test suite, lint, TypeScript, build, and relevant
  Playwright coverage. Record real commands and results in `tasks.md`.

LH-007 remains `revision` until the focused tests, full suite, responsive E2E
coverage, accessibility checks, and console-error gate pass.

## Non-goals

- Persisting locale across unrelated future visits with cookies or storage.
- Adding a new translation system or changing message catalogs beyond missing
  labels required by the existing selector contract.
- Redesigning the auth or onboarding visual language.
- Changing authenticated-shell locale behavior already provided by
  `LanguageSwitcher` and `AppShell` except where the shared URL contract
  requires compatibility.
