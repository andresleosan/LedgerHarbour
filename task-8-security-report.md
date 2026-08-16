# Task 8 - Informe de hardening de seguridad

Fecha: 2026-08-16  
Proyecto: LedgerHarbour  
Alcance: autenticación, upload, OCR process, review financiero y controles de abuso

## Findings de la auditoría

| Severidad | Finding | Causa raíz |
|---|---|---|
| Crítica | `AUTH_MODE=development` podía crear `DevAuthProvider` con `NODE_ENV=production`. | La factory y el constructor sólo comprobaban `AUTH_MODE`. |
| Alta | Upload y OCR process no tenían rate limit por identidad antes de leer el body. | Sólo existía el limiter de login y la configuración usaba un bucket compartido de auth. |
| Alta | Upload podía materializar multipart antes de revisar `Content-Length`; metadata aceptaba nombres arbitrariamente largos. | La ruta llamaba `formData()` primero y `validateUpload` no imponía longitud de nombre. |
| Media | Review PATCH aceptaba strings y JSON sobredimensionados. | El schema no tenía máximo por campo y la ruta usaba `request.json()` sin guardia de tamaño. |
| Media | GET de review financiero no declaraba respuesta privada/no cacheable. | La respuesta no establecía `Cache-Control`. |
| Baja | Patrones comunes de credenciales no estaban cubiertos por `.gitignore`. | El ignore sólo cubría variables `.env`. |

## Correcciones

- Auth de desarrollo falla cerrado en `NODE_ENV=production`; sólo Firebase conserva el camino productivo mediante `AUTH_MODE=firebase`.
- Se añadió la infraestructura autenticada reutilizando `RateLimiter`: upload `10/5 min` y OCR process `5/5 min`, buckets independientes y clave únicamente por `AuthIdentity.providerUserId`.
- Production exige `RATE_LIMIT_MODE=upstash`; memoria sólo queda disponible en test/desarrollo.
- Upload aplica el límite antes de `formData()`, rechaza `Content-Length` mayor a 10 MiB antes de materializar multipart y rechaza nombres de archivo de más de 255 caracteres.
- OCR process aplica el límite antes de `request.json()` y devuelve `429` genérico sin propagar input ni errores del backend de rate limit.
- Review PATCH limita cada campo string a 2000 caracteres y limita el cuerpo a 64 KiB antes de parsear JSON; GET usa `Cache-Control: private, no-store`, incluidos errores autenticados.
- `.gitignore` cubre `graphify-out/`, `*.pem`, `*.key`, `*.p12`, `*.pfx` y nombres comunes de credenciales. No se eliminaron ni modificaron los untracked existentes.

## Evidencia

| Verificación | Resultado |
|---|---|
| Tests RED focalizados antes del código de producción | Ejecutados; fallaron 10 assertions por las protecciones ausentes y 1 suite por el módulo aún inexistente. |
| Tests GREEN focalizados | `corepack pnpm exec vitest run tests/unit/auth/dev-auth-provider.test.ts tests/unit/authenticated-rate-limit.test.ts tests/unit/rate-limit.test.ts tests/unit/documents/file-validation.test.ts tests/security/upload-security.spec.ts tests/security/ocr-process-security.spec.ts tests/integration/invoices/review.test.ts` - 7 archivos, 92 tests pasan. |
| Regresión completa | `corepack pnpm test` - 39 archivos pasan, 1 skipped preexistente; 351 tests pasan, 1 skipped. |
| Lint | `corepack pnpm lint` - exit 0, sin errores. |
| Build | `corepack pnpm build` - exit 0, compilación Next.js y type-check completados. |
| Audit de dependencias | `corepack pnpm audit --json` - 0 info, 0 low, 0 moderate, 0 high, 0 critical; 556 dependencias totales. |
| E2E crítico con `AUTH_MODE=development` y `OCR_PROVIDER=fake` | No pasa: auth/upload/OCR/review avanzan; falla por timeout del locator UI `button[name="English"]` en `tests/e2e/critical-path.spec.ts:119`. Una corrida sin `OCR_PROVIDER=fake` falló antes con el `502` esperado por configuración OCR ausente. |

## Concerns abiertos

- Upstash no se ejercitó contra Redis real en esta ronda; sí se verificó el fail-closed de producción y el comportamiento memory aislado para test.
- El E2E crítico no queda verde por un locator/UI timeout preexistente fuera del alcance; la primera ejecución además requiere declarar `OCR_PROVIDER=fake` para el fixture local porque el provider desconocido falla cerrado.
- El resultado de `corepack pnpm audit --json` puede conservar findings transitivos existentes de Next.js; se reportará sin aplicar upgrades mayores ni `audit fix --force`.
- No se ejecutó deploy, migración, billing, lectura/escritura de secretos, commit ni push.
- Este informe no declara aprobación final; el estado queda sujeto a regresión, lint, build y audit reales.
