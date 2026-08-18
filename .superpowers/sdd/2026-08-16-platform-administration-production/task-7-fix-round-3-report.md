# Task 7 Fix Round 3 Report

## Findings corregidos

1. Los endpoints R2 y Upstash ahora requieren HTTPS, host permitido exacto y URL sin path, query, hash, puerto ni userinfo. La validación común conserva el rechazo genérico del production gate.
2. Las pruebas de Firebase auth domain y del endpoint construido de Google Document AI cubren sintaxis insegura y valores fuera de los allowlists existentes.
3. La prueba de CI se omite explícitamente con `it.skipIf` si `.github/workflows/ci.yml` no existe; cuando existe, mantiene las aserciones de proveedores de prueba y ausencia de secretos.
4. La E2E no-demo verifica landing, login y register en inglés y español, con clicks reales de ida y vuelta y copy prohibido ausente en ambos estados.
5. `AuthForm` evita también el redirect de resultado Google en el adapter Firebase determinista de tests, alineando ese camino con los otros redirects ya protegidos.

## TDD RED/GREEN

- RED URL gate: `corepack pnpm exec vitest run tests/unit/config/production-gate.test.ts` falló en 6 casos R2/Upstash porque paths, query, userinfo y puertos todavía eran aceptados.
- RED inicial E2E ampliado: `corepack pnpm exec playwright test tests/e2e/production/no-demo-copy.spec.ts --project=chromium` pasó tras ampliar los assertions; no quedó regresión de copy.
- GREEN focal gate: 44/44 tests.
- GREEN focal no-demo: 1/1.

## Verificación final

- `corepack pnpm test`: 511 tests pasaron, 3 omitidos; 59 archivos pasaron y 2 omitidos.
- `corepack pnpm exec playwright test`: 31/31 pasaron en 3.3 minutos.
- `corepack pnpm lint`: pasó.
- `corepack pnpm exec tsc --noEmit`: pasó.
- `corepack pnpm build`: pasó; 18/18 páginas estáticas generadas.
- `corepack pnpm audit --audit-level high`: sin vulnerabilidades conocidas.
- `git diff --check`: sin errores de whitespace.

## Seguridad y límites

- No se leyeron, escribieron ni imprimieron secretos reales.
- La validación sigue fallando cerrada con un mensaje genérico y no cambia autenticación, autorización ni rate limits.
- La autenticidad real de Firebase, Google, R2 y Upstash no se puede probar offline; queda como paso manual durante activación controlada.
- Una corrida inicial concurrente de build y Playwright interfirió sobre `.next`, generando chunks ausentes y errores espurios. Se reprodujo el build aislado, pasó, y la E2E aislada posterior pasó completa.
- Permanece el warning no bloqueante de `allowedDevOrigins` durante `next dev`.
- `tests/integration/postgres/native-schema.test.ts` continúa sin trackear y no fue modificado.
