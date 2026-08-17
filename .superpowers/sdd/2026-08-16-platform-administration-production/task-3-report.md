# Task 3 Report

## Estado

`revisión`

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

## Pruebas

- `corepack pnpm exec vitest run tests/unit/platform/business-approval.test.ts tests/security/platform-authorization.test.ts tests/integration/tenancy/business-approval.test.ts`: **11 passed**.
- `corepack pnpm test`: **45 files passed, 1 skipped; 393 passed, 2 skipped**.
- `corepack pnpm exec playwright test tests/e2e/platform/business-approval.spec.ts`: **1 passed**.
- `corepack pnpm lint`: **passed**.
- `corepack pnpm exec tsc --noEmit`: **passed**.
- `corepack pnpm build`: **passed**.
- `corepack pnpm audit --json`: **0 vulnerabilities**.
- `git diff --check`: **passed**.

## Concerns

- No se aplicaron migraciones contra producción; `0003_business_lifecycle` requiere el flujo operativo existente de migración y rollback.
- Proyectos, panel global completo y aprobación interna de administradores quedan fuera de Task 3.
- `tasks.md` no existe en el repositorio, por lo que el estado se registra en este reporte.
- Playwright muestra el warning preexistente de `allowedDevOrigins` durante `next dev`; no afectó la prueba.
- `tests/integration/postgres/native-schema.test.ts` estaba untracked antes de esta tarea y quedó fuera del commit.
