# Task 3 Report

## Estado

`aprobada`

Task 3 implementada directamente sobre `main`, sin worktree, rama ni delegación.

## Commit

`feat: gate businesses behind platform approval`

## Implementado

- Estados de negocio exactos: `pending`, `active`, `suspended`, `rejected`.
- `createBusinessRequest` crea solicitudes pendientes sin membresía operativa.
- Aprobación atómica: `owner_admin`, fechas manuales y audit event global.
- Rechazo, suspensión con `reason`, reactivación y deny gate server-side.
- Autorización global exclusivamente mediante `platform_members`.
- Repositorios in-memory/Postgres y migración reversible `0003_business_lifecycle`.
- APIs globales de listado, aprobación, rechazo, suspensión y reactivación.
- Onboarding actualizado para informar solicitud pendiente.
- DTOs de API sin `createdBy`, claves privadas ni payloads internos.

## Fix Round 1

- `createBusiness` mantiene el contrato público pero solo crea solicitudes `pending`; los fixtures operativos usan aprobación explícita.
- La autorización platform normaliza `user_id`; el email solo participa en el claim explícito one-time y requiere email verificado.
- Lifecycle legacy de tenancy bloqueado con `PLATFORM_ADMIN_REQUIRED`; los cambios globales pasan por platform.
- `serviceExpiresAt` obligatorio y futuro en aprobación; transiciones y razón de suspensión validadas en memoria/Postgres.
- Rollback de `0003_business_lifecycle` elimina primero su registro del ledger; el test database aplica migraciones en orden.
- El repositorio platform en memoria comparte singleton entre bundles de Next durante test/dev, preservando el claim entre rutas.
- Helpers unitarios, integración, Postgres y E2E fueron migrados a solicitud + aprobación real.

## Fix Round 2

- Claim atómico: memory conserva el primer vínculo; Postgres usa `UPDATE ... WHERE id = ? AND user_id IS NULL` y devuelve conflicto si no afecta filas.
- Añadidas pruebas de segundo claim y claims concurrentes en memory/Postgres; el vínculo ganador permanece.
- Eliminado `src/app/api/platform/claim/route.ts` y retiradas sus llamadas E2E. El claim queda como operación interna del servicio.
- `OnboardingRepository.createBusiness` ya no acepta `status`, `isActive` ni campos de lifecycle; ambos repositorios fuerzan `pending` y rechazan payloads runtime con esos campos.
- Fechas de fixtures y pruebas derivadas dinámicamente de `Date.now()`.
- El bootstrap platform de E2E usa miembros presembrados por IDs locales; no reintroduce un endpoint público ni fallback de autorización por email.

## Pruebas

- Fix Round 1 baseline: **47 files passed, 1 skipped; 397 passed, 2 skipped**.
- Fix Round 2 RED: **4 tests failed** en los casos nuevos de claim/creación activa.
- Fix Round 2 GREEN focalizado: **2 files passed; 16 passed**.
- `corepack pnpm exec vitest run`: **47 files passed, 1 skipped; 403 passed, 2 skipped**.
- `corepack pnpm exec playwright test --workers=1`: **25 passed**.
- `corepack pnpm lint`: **passed**.
- `corepack pnpm exec tsc --noEmit`: **passed**.
- `corepack pnpm build`: **passed**.
- `corepack pnpm audit --prod`: **no known vulnerabilities**.
- `git diff --check`: **passed**.

## Concerns

- No se aplicaron migraciones contra producción; `0003_business_lifecycle` requiere el flujo operativo existente de migración y rollback.
- Proyectos, panel global completo y aprobación interna de administradores quedan fuera de Task 3.
- `tasks.md` no existe en el repositorio, por lo que el estado se registra en este reporte.
- Playwright muestra el warning preexistente de `allowedDevOrigins` durante `next dev`; no afectó la prueba.
- `tests/integration/postgres/native-schema.test.ts` estaba untracked antes de esta tarea y quedó fuera del commit.
