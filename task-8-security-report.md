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
- Se añadió la infraestructura autenticada reutilizando `RateLimiter`: upload `10/5 min` y OCR process `5/5 min`, buckets independientes y clave por `AuthIdentity.providerUserId` más la dirección del edge.
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
| E2E crítico con `AUTH_MODE=development` y `OCR_PROVIDER=fake` | `corepack pnpm exec playwright test tests/e2e/critical-path.spec.ts` - 1/1 pasa en 28.2 s. Una corrida sin `OCR_PROVIDER=fake` falló antes con el `502` esperado por configuración OCR ausente. |

## Concerns abiertos

- Upstash no se ejercitó contra Redis real en esta ronda; sí se verificó el fail-closed de producción y el comportamiento memory aislado para test.
- La dirección añadida al rate-limit depende de que el edge sobrescriba `x-vercel-forwarded-for`, `x-forwarded-for` y `x-real-ip`; esa configuración operativa no se puede probar desde este entorno local.
- El resultado de `corepack pnpm audit --json` puede conservar findings transitivos existentes de Next.js; se reportará sin aplicar upgrades mayores ni `audit fix --force`.
- No se ejecutó deploy, migración, billing, lectura/escritura de secretos, commit ni push.
- Este informe no declara aprobación final; el estado queda sujeto a regresión, lint, build y audit reales.

## Fix Round 2

### Findings corregidos

- **Crítico, sesión:** `isDevelopmentMode()` ahora exige `AUTH_MODE=development` y `NODE_ENV !== production`; las lecturas síncrona/asíncrona y la limpieza rechazan cookies de desarrollo después de un cambio a production. Firebase mantiene su branch independiente.
- **Alto, upload chunked:** upload exige `Content-Length` decimal, entero y seguro antes de `formData()`. El máximo de cuerpo es `10 MiB + 64 KiB` (`MAX_UPLOAD_REQUEST_BODY_BYTES`); falta/inválido devuelve `411` y exceso `413`, ambos con mensaje genérico. `value.size` permanece como defensa posterior.
- **Alto, rate limit:** la clave conserva identidad y agrega dirección con precedencia `x-vercel-forwarded-for`, `x-forwarded-for`, `x-real-ip`; el contrato documenta que el edge debe sobrescribirlos. `AuthenticatedRateLimitError` produce `429`; `AuthenticatedRateLimitUnavailableError` produce `503`, sin detalles internos.
- **Bajo, credenciales:** `.gitignore` ahora cubre `*-credentials.json`, `*-service-account.json` y `client_secret*.json`.

### Evidencia Round 2

- RED ejecutado antes de producción: cookie de desarrollo aceptada en production, clave sin dirección, clases 503 ausentes y guards de upload ausentes reprodujeron los findings.
- GREEN focalizado: `corepack pnpm exec vitest run tests/unit/auth/dev-auth-provider.test.ts tests/unit/authenticated-rate-limit.test.ts tests/security/upload-security.spec.ts tests/security/ocr-process-security.spec.ts tests/integration/documents/private-storage.test.ts` - 5 archivos, 59 tests pasan.
- Regresión completa: `corepack pnpm test` - 39 archivos pasan, 1 skipped; 357 tests pasan, 1 skipped.
- Lint: `corepack pnpm lint` - exit 0, sin errores.
- Build: `corepack pnpm build` - exit 0, compilación Next.js y type-check completados.
- Audit: `corepack pnpm audit --json` - 0 info, 0 low, 0 moderate, 0 high, 0 critical; 556 dependencias totales.
- E2E: `corepack pnpm exec playwright test tests/e2e/critical-path.spec.ts` con fixtures locales - 1/1 pasa en 28.2 s.

## Verificacion final

- `corepack pnpm test` - 39 archivos pasan, 1 skipped; `362` tests pasan, `1` skipped.
- `corepack pnpm lint` - exit 0.
- `corepack pnpm build` - exit 0; Next genera `14/14` paginas.
- `corepack pnpm audit --json` - 0 info, 0 low, 0 moderate, 0 high, 0 critical.
- `$env:OCR_PROVIDER='fake'; corepack pnpm exec playwright test` - `23/23` E2E pasan.
- La suite E2E muestra los `AuthError` esperados de los casos negativos; no son fallos de test.

## Fix Round 3

### Finding corregido

- **Alto, bypass multi-identidad por dirección:** cada upload y OCR process ahora consulta simultáneamente el bucket individual y un bucket agregado por dirección. Los límites agregados son upload `20/5 min` y OCR `10/5 min`; sus claves no contienen identidad.
- **Alto, confianza en headers:** en production sólo se considera `x-vercel-forwarded-for`; si falta se usa `edge-unknown`. Test/desarrollo mantiene los fallbacks para pruebas locales. La operación debe configurar Vercel/edge para sobrescribir el header.
- **Medio, contrato OCR:** OCR distingue `AuthenticatedRateLimitError` y `AuthenticatedRateLimitUnavailableError` también por sus códigos exportados, devolviendo sólo `429` o `503` genéricos.

### Evidencia Round 3

- RED ejecutado antes de producción: no existía factory agregada, sólo se invocaba el bucket individual, production aceptaba `x-forwarded-for` y OCR mapeaba un código compatible a `503`.
- GREEN focalizado: `corepack pnpm exec vitest run tests/unit/authenticated-rate-limit.test.ts tests/unit/rate-limit.test.ts tests/security/ocr-process-security.spec.ts` - 3 archivos, 16 tests pasan.
- Regresión completa: `corepack pnpm test` - 39 archivos pasan, 1 skipped; 362 tests pasan, 1 skipped.
- Lint: `corepack pnpm lint` - exit 0, sin errores.
- Build: `corepack pnpm build` - exit 0, compilación Next.js y type-check completados.
- Audit: `corepack pnpm audit --json` - 0 info, 0 low, 0 moderate, 0 high, 0 critical; 556 dependencias totales.
- E2E crítico: `$env:AUTH_MODE='development'; $env:OCR_PROVIDER='fake'; corepack pnpm exec playwright test tests/e2e/critical-path.spec.ts` - 1/1 pasa en 28.4 s.

### Concerns Round 3

- Upstash/Redis real no se ejercitó en este entorno; sí se verificaron ambos buckets memory y el fail-closed de production.
- La garantía de que `x-vercel-forwarded-for` sea sobrescrito por Vercel/edge requiere configuración operativa fuera del repositorio y no puede probarse localmente.

### Cierre de Fix Round 3: autenticación Firebase determinista y claim de plataforma

#### Findings corregidos

- **Crítico, claim global:** el claim interno ahora exige `provider: "firebase"` y `emailVerified`; `DevAuthProvider` (`provider: "development"`) y `LEDGERHARBOUR_TEST_MODE` quedan denegados.
- **Alto, harness de test:** Playwright usa `AUTH_MODE=firebase`, un adapter determinista exclusivo del harness y bootstrap por email; se eliminaron `PLATFORM_ADMIN_USER_IDS`, rangos de IDs y el endpoint público de claim.
- **Alto, carrera de enlace:** el enlace del bootstrap se realiza con `UPDATE ... WHERE user_id IS NULL RETURNING` en PostgreSQL y operación equivalente serializada en memoria; la autorización posterior sólo usa `user_id` enlazado.
- **Medio, identidad duplicada:** memoria y PostgreSQL aplican unicidad de `normalized_email`.

#### Evidencia

- RED/GREEN focalizado: `corepack pnpm exec vitest run tests/unit/auth tests/unit/platform tests/unit/tenancy/business-service.test.ts tests/security/platform-authorization.test.ts tests/integration/tenancy/business-approval.test.ts tests/integration/postgres/tenancy-repository.test.ts` - 12 archivos, 94 tests pasan.
- Regresión completa: `corepack pnpm test` - 48 archivos pasan, 1 skipped; 409 tests pasan, 2 skipped.
- E2E focalizado: `corepack pnpm exec playwright test tests/e2e/auth/login.spec.ts tests/e2e/platform/business-approval.spec.ts` - 4/4 pasan.
- E2E completo: `corepack pnpm exec playwright test` - 25/25 pasan en 2.3 minutos.
- Typecheck: `corepack pnpm exec tsc --noEmit` - exit 0.
- Lint: `corepack pnpm lint` - exit 0, sin errores.
- Build: `corepack pnpm build` - exit 0; Next genera 10 páginas estáticas y las rutas dinámicas.
- Audit: `corepack pnpm audit --json` - 0 info, 0 low, 0 moderate, 0 high, 0 critical; 556 dependencias.

#### Pruebas avanzadas

- Contrato: tests unitarios, integración PostgreSQL/PGlite y E2E ejercitan el mismo flujo Firebase -> usuario local -> claim -> autorización.
- Concurrencia: claims simultáneos de memoria y PostgreSQL conservan un único ganador.
- Casos límite de seguridad: provider development, provider ausente, email Firebase no verificado, flag legacy y usuario/email ya enlazado son rechazados sin fallback por email o ID.

## Task 8 - Verificacion final

La evidencia detallada queda en `.superpowers/sdd/2026-08-16-platform-administration-production/task-8-report.md`.

- Suite local final: `corepack pnpm test` - `59` archivos pasan, `2` skipped; `511` tests pasan, `3` skipped.
- E2E final: `corepack pnpm test:e2e` - `32/32` pasan; el flujo integral de administracion pasa `1/1` en `38.4s`.
- Static/build/audit: lint, typecheck y build exit `0`; build genera `18/18` paginas estaticas; audit reporta `0` vulnerabilidades y `556` dependencias.
- Seguridad/integracion focalizadas: `14` archivos y `61` tests pasan; PGlite migration apply/check/rollback/reapply `4/4` pasan.
- PostgreSQL nativo: skip honesto porque `TEST_DATABASE_URL` no esta configurado.
- Warning no bloqueante: `?mine=true` devuelve `400 INACTIVE_BUSINESS` bajo suspension, aunque el acceso queda denegado; se conserva fuera de alcance.

## Fix Wave final - findings de revisión global

Fecha: 2026-08-17
Alcance: gate de membresías de proyecto, administración autenticada de `platform_admin`, y auditoría de solicitudes/aprobaciones.

### Correcciones

- **P1, project members gate:** `GET/POST /api/businesses/[businessId]/projects/[projectId]/members` ahora exige negocio activo y proyecto `active`/`isActive` dentro de una transacción. Proyectos `pending`, `rejected` y `suspended`, y negocios `pending`, `rejected` y `suspended`, devuelven 403 sin listar ni crear membresías. La fila del proyecto queda bloqueada durante el gate PostgreSQL; conflictos de repositorio/duplicados devuelven 409.
- **P1, platform administrator management:** `POST /api/platform/administrators` agrega un registro `platform_admin` activo y no enlazado después de autorización server-side de un administrador activo. `DELETE /api/platform/administrators/[membershipId]` desactiva mediante CAS, exige motivo, bloquea los administradores activos durante la operación y rechaza retirar el último administrador activo. El email se valida y normaliza sólo al alta; el claim posterior sigue requiriendo Firebase verificado y enlaza una sola vez. Los permisos continúan basados en `user_id` enlazado y todos los `platform_admin` comparten la misma capacidad.
- **Administrators UI:** la sección muestra operadores globales, permite alta con email/motivo y permite desactivación con diálogo y motivo. Los DTOs no contienen secretos ni credenciales.
- **Auditoría:** la creación de una solicitud emite `business_requested` con el requester. La aprobación emite `business_approved` con el actor `platform_admin`; se eliminó el `business_created` atribuido al requester durante aprobación. La migración reversible `0006_business_request_audit` permite auditar la solicitud antes de que exista membresía, sin aplicarla en producción.

### Tests añadidos/modificados

- Unit: `tests/unit/projects/project-service.test.ts`, `tests/unit/platform/platform-admin-management.test.ts`, `tests/unit/platform/business-approval.test.ts`.
- Integración/HTTP: `tests/integration/projects/project-routes.test.ts`, `tests/integration/platform/administrator-routes.test.ts`, `tests/integration/tenancy/business-approval.test.ts`, `tests/integration/postgres/tenancy-repository.test.ts`.
- Seguridad: `tests/security/project-isolation.test.ts`, `tests/security/platform-admin-management.test.ts`.
- E2E: `tests/e2e/platform/platform-administrator-management.spec.ts`.

### Evidencia Fix Wave final

| Verificación | Resultado |
|---|---|
| RED focalizado | Ejecutado antes de implementar: 15 tests fallaron por métodos/rutas ausentes, gates omitidos y auditoría no registrada. |
| GREEN focalizado | `corepack pnpm exec vitest run tests/unit/projects/project-service.test.ts tests/security/project-isolation.test.ts tests/unit/platform/platform-admin-management.test.ts tests/security/platform-admin-management.test.ts tests/integration/projects/project-routes.test.ts tests/integration/platform/administrator-routes.test.ts tests/integration/tenancy/business-approval.test.ts` - 7 archivos, 38 tests pasan. |
| Suite completa | `corepack pnpm test` - 61 archivos pasan, 2 skipped; 528 tests pasan, 3 skipped. |
| E2E focalizado | `corepack pnpm exec playwright test tests/e2e/platform/platform-administrator-management.spec.ts` - 1/1 pasa. |
| E2E completo | `corepack pnpm test:e2e` - 33/33 pasan. |
| Typecheck | `corepack pnpm exec tsc --noEmit` - exit 0. |
| Lint | `corepack pnpm lint` - exit 0, sin errores. |
| Build | `corepack pnpm build` - exit 0; Next genera 18/18 páginas estáticas y las rutas dinámicas. |
| Audit de dependencias | `corepack pnpm audit --json` - 0 info, 0 low, 0 moderate, 0 high, 0 critical; 556 dependencias. |

### Concerns Fix Wave final

- `TEST_DATABASE_URL` sigue sin configurarse, por lo que la prueba PostgreSQL nativa permanece skipped; PGlite aplica y verifica la secuencia hasta `0006_business_request_audit` y sus rollback SQL sólo se prueban localmente.
- No se aplicó `0006_business_request_audit` ni ninguna migración en producción, no se hizo deploy, no se activó billing/OCR pago y no se leyeron ni escribieron secretos.
- Upstash/Redis real y la configuración operativa del header de edge continúan siendo concerns heredados del reporte anterior.
