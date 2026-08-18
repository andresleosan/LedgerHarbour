# Task 7 Fix Round 2 Report

## Findings corregidos

1. Playwright ahora ejecuta `scripts/playwright-server.ts`. El wrapper hace el unico `spawn` de Next y construye un env allowlistado: `PATH` cuando existe, modos test, Firebase public test config, adapter determinista, admins de fixture y el marcador de harness. No usa `...process.env`, no imprime el entorno y no pasa secretos.
2. El production gate rechaza marcadores sinteticos obvios, URLs fuera de host permitido, R2 distinto de `https://<account>.r2.cloudflarestorage.com`, Upstash fuera de `.upstash.io`, service accounts JSON incompletos y proyectos/configuracion Firebase/Google inconsistentes. Los errores siguen siendo genericos.
3. Vitest usa `AUTH_MODE=firebase` por defecto y los cinco integration suites de rutas usan sesiones Firebase deterministas. `setCurrentIdentity` tiene un camino exclusivo `NODE_ENV=test && AUTH_MODE=firebase`; el token de fixture conserva `providerUserId` explicito. Los unit tests de `DevAuthProvider` siguen marcando development solo donde prueban ese provider.
4. El rate limit ampliado existe solo con `NODE_ENV=test`, `RATE_LIMIT_MODE=memory` y `LEDGERHARBOUR_PLAYWRIGHT_HARNESS=true`; los tests Vitest conservan el limite de 10 y produccion no cambia.
5. AuthForm conserva el feedback de login solo con `NEXT_PUBLIC_FIREBASE_TEST_ADAPTER=true`, evitando una carrera entre status y redirect en E2E. Firebase real mantiene redirect a onboarding.
6. La E2E no-demo cambia idioma mediante clicks reales: enlace `ES` en landing y boton `Espanol` en login/register, y valida copy espanol sin frases demo.
7. `docs/production-activation.md` y `docs/google-document-ai.md` distinguen validacion estructural offline de autenticidad real, IAM, existencia de processor y cuota, que se verifican manualmente durante activacion.

## TDD RED/GREEN

- RED wrapper/session: `corepack pnpm exec vitest run tests/unit/config/production-gate.test.ts tests/unit/auth/firebase-test-adapter.test.ts` fallo por modulo wrapper inexistente y session fixture `null` bajo Firebase.
- RED gate/browser: las nuevas pruebas de synthetic values, exact R2 host y locale interactivo fallaron contra el comportamiento anterior.
- RED rate harness: `corepack pnpm exec vitest run tests/unit/rate-limit.test.ts` fallo en el intento 11/20 con el limite compartido de 10.
- GREEN focal gate/Firebase: 30/30 tests.
- GREEN focal rate: 7/7 tests.
- GREEN integrations: 73/73 tests de rutas.
- GREEN E2E no-demo: 1/1.

## Verificacion final

- `corepack pnpm test`: 494 tests pasaron, 3 omitidos; 59 archivos pasaron y 2 omitidos.
- `corepack pnpm exec playwright test`: 31/31 pasaron.
- `corepack pnpm lint`: paso.
- `corepack pnpm exec tsc --noEmit`: paso.
- `corepack pnpm build`: paso.
- `corepack pnpm audit --json`: 0 vulnerabilidades conocidas en 556 dependencias.

## Seguridad y limites

- No se leyeron, escribieron ni imprimieron secretos reales.
- No se desplego, activo billing, aplico migraciones ni ejecuto OCR pago.
- La autenticidad real de Firebase, Google, R2 y Upstash no se puede probar offline; queda como paso manual del operador durante activacion controlada.
- Permanece el warning no bloqueante de `allowedDevOrigins` durante `next dev`.
- `tests/integration/postgres/native-schema.test.ts` continua sin trackear y no fue modificado.
