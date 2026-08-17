# Task 1 Report

## Estado

`revisión`

## Commit

`feat: remove demo runtime and add shared logout`

## Implementación

- Se extrajo `signOutAction()` a `src/app/onboarding/actions.ts` y se reutiliza en AppShell y onboarding.
- Logout limpia la sesión server-side, intenta limpiar Firebase client cuando existe configuración y redirige a `/login`.
- Firebase queda como proveedor runtime fuera del harness determinista; el provider de desarrollo solo se habilita con configuración explícita de test.
- Google Document AI queda como único proveedor OCR runtime; `fake` se limita al test harness explícito.
- Se eliminaron CTA/copy demo, cuentas demo y texto de simulación de Google.
- Playwright conserva proveedores deterministas mediante `AUTH_MODE=development`, `OCR_PROVIDER=fake` y `LEDGERHARBOUR_TEST_MODE=true` en su `webServer`.
- No se implementaron platform admins, `platform_members`, negocios pending ni proyectos.

## Pruebas

RED inicial:

- `corepack pnpm exec vitest run tests/unit/auth/production-auth-config.test.ts tests/unit/invoices/ocr-provider-factory.test.ts` -> falló con 3 aserciones esperadas.
- `corepack pnpm exec playwright test tests/e2e/auth/login.spec.ts tests/e2e/onboarding/logout.spec.ts` -> falló con copy demo y logout inexistente.

GREEN y regresión:

- `corepack pnpm exec vitest run tests/unit/auth/production-auth-config.test.ts tests/unit/invoices/ocr-provider-factory.test.ts` -> 16/16.
- `corepack pnpm exec vitest run` -> 367 passed, 1 skipped.
- `corepack pnpm exec playwright test tests/e2e/auth/login.spec.ts tests/e2e/onboarding/logout.spec.ts` -> 4/4.
- `corepack pnpm exec playwright test tests/e2e/tenancy/onboarding.spec.ts` -> 3/3.
- `corepack pnpm lint` -> OK.
- `corepack pnpm exec tsc --noEmit` -> OK.
- `corepack pnpm build` -> OK.
- `corepack pnpm audit --prod` -> no known vulnerabilities.

## Concerns

- Next normaliza `NODE_ENV` al ejecutar `next dev`; por eso Playwright usa además `LEDGERHARBOUR_TEST_MODE=true`. El guard sigue rechazando cualquier entorno productivo y el marker no se acepta cuando `NODE_ENV=production`.
- Las credenciales reales de Firebase y Google Document AI no se ejercitaron, conforme al alcance de la tarea y sin activar servicios externos.
- `tests/integration/postgres/native-schema.test.ts` ya estaba sin trackear y quedó fuera del commit por no pertenecer a Task 1.

## Fix Round 1

### Estado

`revisión`

### Cambios

- La configuración Firebase de onboarding ahora se deriva en `src/app/onboarding/layout.tsx` y llega al cliente mediante `OnboardingFirebaseConfigProvider`; no se lee `process.env` desde `OnboardingSignOut`.
- AppShell y onboarding comparten `getFirebaseClientConfig`, que devuelve `undefined` si falta cualquier valor público requerido.
- Se añadió regresión para limpiar Firebase sin app/config y para resolver config completa o ausente.
- Se añadieron guards explícitos que rechazan auth development y OCR fake con `NODE_ENV=production` aunque `LEDGERHARBOUR_TEST_MODE=true`.

### RED

- `corepack pnpm exec vitest run tests/unit/firebase-client.test.ts tests/unit/auth/production-auth-config.test.ts tests/unit/invoices/ocr-provider-factory.test.ts` -> la nueva suite falló porque `firebase-config` aún no existía; los guards de producción pasaron sobre la implementación existente.

### GREEN y regresión

- `corepack pnpm exec vitest run tests/unit/firebase-client.test.ts tests/unit/auth/production-auth-config.test.ts tests/unit/invoices/ocr-provider-factory.test.ts` -> 26/26.
- `corepack pnpm exec playwright test tests/e2e/onboarding/logout.spec.ts` -> 1/1 con config Firebase pública disponible en el web server de test.
- `corepack pnpm exec vitest run` -> 372 passed, 1 skipped.
- `corepack pnpm exec playwright test tests/e2e/auth/login.spec.ts tests/e2e/onboarding/logout.spec.ts` -> 4/4.
- `corepack pnpm lint` -> OK.
- `corepack pnpm exec tsc --noEmit` -> OK.
- `corepack pnpm build` -> OK.

### Concerns

- La config Firebase de E2E usa valores públicos sintéticos; no se realizan llamadas reales a Firebase.
- El marker de test continúa bloqueado cuando `NODE_ENV=production`; los casos explícitos de auth y OCR lo verifican.
