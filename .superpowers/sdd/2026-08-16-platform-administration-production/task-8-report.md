# Task 8 - Informe de verificacion de release

Fecha: 2026-08-17
Proyecto: LedgerHarbour
Estado: revision completada con warnings operativos; sin activacion de produccion

## Alcance verificado

- Harness Playwright local con `NODE_ENV=test`, Firebase determinista, `OCR_PROVIDER=fake`, `PERSISTENCE_MODE=memory`, `STORAGE_MODE=local` y `RATE_LIMIT_MODE=memory`.
- Flujo completo: business pendiente, aprobacion platform, proyecto pendiente, aprobacion global, solicitud y aprobacion interna de administrador, suspension manual, denegacion de accesos vinculados, reactivacion y logout desde onboarding/AppShell.
- No se usaron credenciales de produccion, Firebase real, OCR pago, secretos, billing, deploy ni migraciones productivas.

## Comandos y evidencia

| Comando | Resultado exacto |
|---|---|
| `corepack pnpm test` | Exit 0; `59` archivos pasaron, `2` skipped; `511` tests pasaron, `3` skipped. |
| `corepack pnpm lint` | Exit 0; sin errores. |
| `corepack pnpm exec tsc --noEmit` | Exit 0; sin salida de errores. |
| `corepack pnpm build` | Exit 0; Next.js compilo correctamente, genero `18/18` paginas estaticas y las rutas dinamicas. |
| `corepack pnpm audit --json` | Exit 0; `0` info, `0` low, `0` moderate, `0` high, `0` critical; `556` dependencias totales. |
| `corepack pnpm test:e2e` | Exit 0; `32/32` pruebas pasan en aproximadamente `3.5m`. |
| `corepack pnpm exec playwright test tests/e2e/platform/full-administration.spec.ts` | Exit 0; `1/1` pasa en `38.4s`. |
| `corepack pnpm exec vitest run tests/security tests/integration/tenancy/business-approval.test.ts tests/integration/tenancy/administrator-approval.test.ts tests/integration/projects/project-approval.test.ts tests/integration/projects/project-routes.test.ts tests/integration/platform/administrator-routes.test.ts tests/integration/platform/administration-panel-routes.test.ts tests/integration/postgres/test-database-migrations.test.ts tests/integration/postgres/schema-execution.test.ts` | Exit 0; `14` archivos y `61` tests pasan. |
| `corepack pnpm exec vitest run tests/integration/postgres/test-database-migrations.test.ts` | Exit 0; `4/4` pasan: apply/check, rollback y reapply de PGlite. |
| `if ([string]::IsNullOrWhiteSpace($env:TEST_DATABASE_URL)) { Write-Output 'SKIP: TEST_DATABASE_URL is not configured; native PostgreSQL migration validation was not run.'; exit 0 }; corepack pnpm db:native-check` | Skip honesto: `TEST_DATABASE_URL` no esta configurado; no se ejecuto PostgreSQL nativo. |

## Findings y controles

- Autorizacion platform: las rutas globales exigen identidad Firebase verificada y miembro `platform_admin` activo enlazado por `user_id`; no se autoriza por email aislado ni por UI.
- Aislamiento tenant: las pruebas de seguridad e integracion cubren business/project cross-tenant y membresias con business padre incorrecto.
- Gates de estado: business pendiente devuelve `403` para operaciones; project pendiente no concede acceso operativo; business suspendido niega project, join request, members y administracion vinculada; reactivacion restaura el acceso valido.
- Auditoria: la prueba E2E confirma eventos `business_approved`, `project_approved`, `business_suspended` y `business_reactivated`; DTOs revisados no contienen `password`, `token`, `secret`, `privateObjectKey`, `documentBytes` ni `credential`. La suite PGlite verifica rollback/reapply y los contratos append-only existentes.
- Rate limit: las suites focalizadas cubren limites autenticados por identidad/direccion, buckets agregados, respuestas genericas `429/503` y fail-closed de configuracion.
- Configuracion fail closed: las pruebas de production gate exigen Firebase, Google Document AI, PostgreSQL, R2, Upstash y variables requeridas; development auth, fake OCR, memoria y storage local no son configuracion de produccion.
- No-demo: E2E de login, register, landing y `no-demo-copy` pasan; el servidor Playwright fija los proveedores de test explicitamente.

## Warnings

- La consulta de join requests `GET /api/businesses/:businessId/join-requests?mine=true` devuelve `400 INACTIVE_BUSINESS` durante suspension, mientras otros endpoints devuelven `403` o `409`. El acceso queda denegado y no se observo bypass; se conserva como inconsistencia de contrato fuera del alcance de Task 8.
- Next.js muestra el warning conocido de desarrollo sobre `allowedDevOrigins` para recursos `/_next/*` desde `127.0.0.1`; no fallo ninguna prueba.
- Una corrida concurrente de `next build` y Playwright produjo una carrera sobre `.next` (`PageNotFoundError /_document` y modulo webpack incompleto); se repitio secuencialmente y ambos comandos pasaron.
- PostgreSQL nativo, Firebase/Google/R2/Upstash reales, IAM, alertas de billing y activacion de produccion no fueron verificados localmente y permanecen operator-controlled.
- El worktree ya contenia el untracked preexistente `tests/integration/postgres/native-schema.test.ts`; no fue modificado.

## Pasos manuales exactos antes de produccion

1. Configurar un proyecto Firebase real con Email/Password y Google habilitados; verificar dominios, usuarios, claims y reglas de acceso.
2. Configurar PostgreSQL staging con `TEST_DATABASE_URL`, aplicar las migraciones en una base descartable, ejecutar check, rollback y reapply, y conservar evidencia del backup y rollback.
3. Ejecutar `corepack pnpm db:native-check` con `TEST_DATABASE_URL` apuntando solo a una base descartable de staging.
4. Configurar `AUTH_MODE=firebase`, `OCR_PROVIDER=google-document-ai`, `PERSISTENCE_MODE=postgres`, `STORAGE_MODE=r2` y `RATE_LIMIT_MODE=upstash` junto con todas las variables privadas/publicas requeridas, sin imprimir valores.
5. Configurar IAM minimo para Google Document AI y R2 privado; comprobar que las claves de objetos no se exponen en DTOs ni logs.
6. Configurar Upstash/Redis y validar limites por identidad y por direccion desde el edge que sobrescribe `x-vercel-forwarded-for`.
7. Configurar alertas de billing de Google Document AI, R2, Upstash, Neon/Vercel y limites de cuota; confirmar el gasto con el operador.
8. Ejecutar el bootstrap de platform admins mediante la lista explicita controlada, enlazar cada cuenta despues de login Firebase verificado y comprobar que no existe allowlist en codigo.
9. Aplicar migraciones de produccion solo con backup reciente verificado y confirmacion explicita del operador; no ejecutar `deploy`, billing ni OCR pago como parte de esta tarea.
10. Repetir `corepack pnpm test`, `corepack pnpm lint`, `corepack pnpm exec tsc --noEmit`, `corepack pnpm build`, `corepack pnpm audit --json` y `corepack pnpm test:e2e` en el pipeline aprobado antes de cualquier activacion.

## Estado de commit

Cambios de Task 8: prueba E2E integral y este informe. No se hizo deploy, migracion productiva, billing, OCR pago, lectura/escritura de secretos ni push.
