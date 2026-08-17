# Task 4 Report

## Estado

Implementado directamente sobre `main`. No se crearon ramas ni worktrees.

## Cambios

- Se agregaron `platform_admin` y capacidades globales de aprobar, suspender y revocar administradores.
- Se implementó `effectiveBusinessAccess` con denegaciones diferenciadas para `pending`, `rejected`, `suspended` y memberships inactivas. El lifecycle se evalúa antes de capacidades.
- Las mutaciones de memberships internas usan el gate efectivo antes de autorizar capacidades.
- Se agregaron:
  - `GET /api/platform/administrators`
  - `POST /api/platform/administrators/[membershipId]/approve`
  - `POST /api/platform/administrators/[membershipId]/suspend`
- `suspend` exige `action` explícita (`suspend` o `revoke`) y `reason`; todas las acciones globales generan auditoría append-only.
- Los DTOs globales no exponen email normalizado, repositorios ni datos internos.
- La suspensión de negocio conserva memberships y datos, pero el gate bloquea acceso efectivo en APIs tenant.
- Se añadió rate limiting autenticado para endpoints globales: 30 solicitudes/5 minutos por identidad y 60/5 minutos por dirección; producción exige Upstash.

## Verificación

- RED focal previo a implementación: 5 fallos esperados por servicios inexistentes.
- `corepack pnpm exec vitest run tests/unit/platform/administrator-approval.test.ts tests/integration/tenancy/administrator-approval.test.ts tests/security/platform-authorization.test.ts`: 13 passed.
- `corepack pnpm test`: 420 passed, 2 skipped.
- `corepack pnpm exec playwright test tests/e2e/platform/administrator-approval.spec.ts`: 1 passed.
- `corepack pnpm exec tsc --noEmit`: passed.
- `corepack pnpm lint`: passed.
- `corepack pnpm build`: passed.
- `corepack pnpm audit`: no known vulnerabilities.
- `git diff --check`: passed.

## Seguridad

- Autenticación requerida en las tres rutas.
- Autorización global resuelta únicamente por `platform_members.user_id` y `role = platform_admin`; no se usa email como autorización.
- Validación Zod estricta y límites de longitud para input externo.
- Errores de autorización y fallos inesperados mantienen mensajes genéricos.
- Denegación cross-business cubierta por tests de integración y seguridad.

## Concerns

- El repositorio ya tenía un archivo no rastreado `tests/integration/postgres/native-schema.test.ts`; no fue modificado ni incluido en el commit.
- No se implementaron proyectos ni panel global, según el alcance de Task 4.

## Fix Round 1

### Correcciones

- Se preservó el claim inicial por email sólo para una identidad Firebase verificada. El claim es one-time y queda vinculado a `platform_members.user_id`; las solicitudes posteriores autorizan por `user_id`, incluso si cambia el email de la identidad.
- Se agregó estado explícito persistente de membership: `pending`, `active`, `suspended`, `revoked`. `approveAdministrator` sólo transiciona `pending -> active`; no puede reactivar suspendidas ni revocadas.
- `suspend` y `revoke` sólo aceptan `active -> suspended/revoked`, conservan la fila revocada y auditan una única transición.
- Se agregó migración reversible `0004_membership_lifecycle.sql` y rollback `0004_membership_lifecycle_down.sql`. No se aplicó ninguna migración de producción.
- Las claves de rate limit ahora separan `identity:<user>` y `address:<ip>`. Todos los endpoints `/api/platform/businesses/**` y `/api/platform/administrators/**` usan los buckets globales con respuestas genéricas 429/503.
- Join-request y membership mutations revalidan acceso efectivo dentro de la transacción antes de escribir.
- Las transiciones de negocio y membership usan predicados CAS sobre el estado anterior en Memory y Postgres; los conflictos no generan auditorías contradictorias.
- `listUserBusinesses` excluye negocios `pending`, `suspended` y `rejected` de la vista operativa.
- El E2E ejecuta el claim Firebase real a través de `/api/platform/businesses`, sin pre-vincular `user_id`, y verifica 403 después de suspender la membership real.

### RED/GREEN

- RED Fix Round 1: 10 regresiones reproducidas (reactivación, CAS/auditoría, rate-limit, TOCTOU y portfolio).
- GREEN focal: 66 passed.
- Postgres focal: 13 passed, 1 skipped.
- Suite completa: 432 passed, 2 skipped.
- E2E plataforma relevante: 2 passed.
- HTTP contracts: 401, 403, success, revoke/audit, 429 y 503 cubiertos.
- `corepack pnpm exec tsc --noEmit`: passed.
- `corepack pnpm lint`: passed.
- `corepack pnpm build`: passed en ejecución secuencial.
- `corepack pnpm audit`: no known vulnerabilities.
- `git diff --check`: passed.

### Nota De Verificación

- Una corrida inicial paralela de build y E2E corrompió temporalmente el `.next` compartido y produjo errores de React Client Manifest. Al repetir secuencialmente, build y los 2 E2E pasaron; no quedó un fallo funcional reproducible.
