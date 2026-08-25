# LedgerHarbour Stack

## Estado

Prototipo local/no comercial. El objetivo de la siguiente fase es una prueba desplegable de bajo consumo, no una release comercial.

## Aplicacion

- Next.js 15 App Router
- TypeScript
- React 19
- Drizzle ORM
- Zod
- Vitest
- Playwright
- Playwright MCP: habilitado globalmente en OpenCode con `@playwright/mcp@0.0.79` y navegador Chrome.
- Monolito modular; no se separan servicios hasta que una necesidad medida lo justifique.

## Arquitectura de prototipo desplegable

- Hosting: Vercel Hobby.
- PostgreSQL objetivo: Neon Free; adapter PostgreSQL y migraciones versionadas. Existe una base Neon operativa con `0001` a `0006` verificadas read-only; el backup productivo y la retencion operativa siguen `operator-controlled`.
- Auth: Firebase Authentication; adapter email/password + Google implementado, activacion operator-controlled pendiente.
- Storage privado: Cloudflare R2 Standard.
- OCR: adapter Google Document AI Invoice Parser implementado; el processor Invoice Parser esta habilitado en `us` y el rol IAM minimo fue observado. La alerta de billing esta bloqueada porque el proyecto no tiene cuenta de billing vinculada. Fake OCR se conserva solo para desarrollo y pruebas deterministas.
- Rate limiting: adapter PostgreSQL distribuido sobre Neon; la memoria local queda limitada a desarrollo y pruebas.

### Estado documentado

La siguiente matriz separa evidencia del repositorio, controles bajo responsabilidad del operador y
hechos externos que no fueron verificados. El gate de activacion es un runbook y no prueba que un
proveedor este activo; ver [docs/production-activation.md](production-activation.md) y el checklist
read-only de [docs/provider-alerts-limits-checklist.md](provider-alerts-limits-checklist.md).

| Proveedor | Implementacion | Evidencia local/documental | Gate del operador | Hechos externos no verificados |
|---|---|---|---|---|
| Firebase | Adapter de autenticacion email/password + Google. | Contrato y documentacion local. | Activacion `operator-controlled`. | Boundary de identidad y estado externo `unverified`. |
| Neon | Adapter PostgreSQL y migraciones versionadas. | PGlite y verificacion read-only de Neon. | Backup y retencion requieren control operativo. | Conexion y migracion verificadas; backup `operator-controlled`. |
| Vercel | Hosting objetivo. | Deployment Production `Ready` y verificacion browser. | Despliegue `operator-controlled`. | Cuenta y plan actuales `unverified`. |
| Cloudflare R2 | Adapter de storage privado. | Bucket observado read-only; acceso publico deshabilitado; alerta mensual de `$1` y token bucket-scoped verificados. | Activacion `operator-controlled`. | Plan `R2 Paid`; uso y facturacion futura dependen del operador. |
| Neon rate limiting | Tabla `rate_limit_windows` y `UPSERT` atómico con claves HMAC. | Migración `0007_rate_limit_windows`, adapter, pruebas locales y verificación remota de tabla/índice en `ledgerharbour-staging`. | Producción requiere despliegue explícitamente aprobado; `RATE_LIMIT_KEY_SECRET` y `RATE_LIMIT_MODE=postgres` ya están cargados en Vercel Production. | Cuota Free compartida con la persistencia; limpiar ventanas antiguas como mantenimiento. |
| Google Document AI | Adapter Invoice Parser. | Processor habilitado en `us`; IAM API User observado. | Activacion runtime y billing requieren control del operador. | Cuotas visibles; alerta de billing `blocked` sin cuenta vinculada. |

## Costo

Objetivo inicial: `US$0/mes` mientras el proyecto sea un prototipo no comercial y permanezca dentro de las cuotas gratuitas.

Los precios y cuotas de la tabla combinan referencias de planificacion con las revisiones read-only
redactadas del 2026-08-21 y 2026-08-22. No constituyen un spending limit ni autorizan cambios de plan, billing o
credenciales.

| Servicio | Cuota/no-cost observada | Costo inicial estimado | Limite o alerta |
|---|---|---:|---|
| Neon Free | 0.5 GB/proyecto, 100 CU-horas, 5 GB egress | US$0 | Revisar cuotas; el plan Free no ofrece spending limit de pago |
| Firebase Auth Spark | Hasta 50.000 MAU para auth no telefonica | US$0 | Phone Auth cobra por SMS; revisar cuotas y billing antes de activar Blaze |
| Cloudflare R2 Paid | Standard: 10 GB-month, 1M Class A y 10M Class B gratis/mes; 85 B, 10 Class A y 20 Class B observados | US$0 observado; después del tier gratis: US$0.015/GB-month, US$4.50/M Class A y US$0.36/M Class B | R2 Paid activo; alerta mensual de US$1 configurada; token activo `Object Read & Write` limitado al bucket |
| Neon Free rate limiting | Comparte 0.5 GB/proyecto, 100 CU-horas y 5 GB egress con la persistencia | US$0 incremental | Vigilar cuotas de cómputo, almacenamiento y egress; no existe spending limit de pago en el plan Free |
| Vercel Hobby | Cuotas gratuitas de requests, funciones y transferencia | US$0 | Solo prototipo/no comercial; revisar limites y suspension antes de publicar |
| Google Document AI Invoice Parser | Processor habilitado; precio de referencia US$0.10 por hasta 10 paginas | No facturando mientras el proyecto siga sin cuenta vinculada; la cuenta existente rechazo el enlace por cuota de proyectos | Alerta bloqueada; solicitar aumento de cuota solo con aprobacion separada |

Las cuotas y precios cambian. Antes de crear cuentas o activar billing se debe volver a verificar la pagina oficial del proveedor y obtener confirmacion del operador. Referencia R2: <https://developers.cloudflare.com/r2/pricing/>.

## Datos y persistencia

La aplicacion dispone del selector reversible `PERSISTENCE_MODE=memory|postgres`, con `memory` como valor por defecto. `memory` conserva los repositorios in-memory y es el rollback operativo inmediato. `postgres` requiere `DATABASE_URL` en runtime, falla cerrado si falta y usa adaptadores Drizzle; en pruebas puede recibir una base PGlite inyectada.

El estado local verificado cubre selección de modo, fail-closed sin fallback, cache del contexto runtime, aislamiento tenant-aware y wiring explícito de las rutas API. La evidencia usa PGlite y la migración SQL versionada; no se usó Neon, PostgreSQL remoto ni se aplicaron migraciones productivas.

El esquema relacional versionado en `src/db/schema` y `src/db/migrations` es la fuente de persistencia. `0001_initial.sql` crea el dominio existente, `0002_platform_control_plane.sql` agrega `platform_members` y `platform_audit_events`, `0003_business_lifecycle.sql` agrega los estados y fechas manuales del negocio, `0006_business_request_audit.sql` permite auditar `business_requested` con el requester antes de que exista membresía, y `0007_rate_limit_windows.sql` agrega las ventanas distribuidas del limitador; el runner exige aplicar las migraciones en orden.

El bootstrap de administradores globales vive en `scripts/db/bootstrap-platform-admins.ts`. Solo acepta una lista explícita mediante `--emails` en producción; el fallback por `PLATFORM_ADMIN_EMAILS` requiere `PLATFORM_ADMIN_BOOTSTRAP=true` y un `NODE_ENV` controlado (`development`, `test` o `staging`), y no se permite en producción. Las direcciones se normalizan y se guardan sin allowlist de autorización en código; el enlace a `users` queda nullable para el primer login verificado.

La vista manual de expiración vive en `scripts/service-expiration-dry-run.ts` y se ejecuta con
`pnpm db:service-expiration-dry-run --as-of=2026-08-21T00:00:00Z`. Requiere `DATABASE_URL`, lee
`businesses` mediante `listBusinesses()`, usa días exactos UTC `14/7/1`, y emite solo un JSON
agregado. Es una observación manual sin scheduler, mutaciones, suspensión, auditoría de cambios ni
notificaciones; `automatic suspension` permanece fuera de alcance.

`platform_audit_events` es append-only mediante trigger y privilegios revocados. Solo conserva actor, acción, target, estados, motivo y timestamp; nunca secretos, tokens ni bytes de documentos. El rollback manual está en `src/db/migrations/rollback/0002_platform_control_plane_down.sql` y no se ejecutó contra producción.

El storage de documentos dispone de `STORAGE_MODE=local|r2`. `local` es el valor por defecto para desarrollo; `r2` requiere las cuatro variables privadas del proveedor y usa un bucket privado observado con acceso publico deshabilitado. Las claves de objetos permanecen privadas y nunca forman parte de DTOs publicos. Ver `docs/r2-private-storage.md`.

## Seguridad y produccion

- Firebase reemplaza el provider de desarrollo mediante `AUTH_MODE=firebase`; requiere probar el boundary de identidad y configurar Email/Password + Google en el proyecto.
- Rate limiting sigue siendo obligatorio antes de exposición pública; activar `RATE_LIMIT_MODE=postgres` en staging con la migración `0007_rate_limit_windows` aplicada y `RATE_LIMIT_KEY_SECRET` server-only.
- Las migraciones productivas requieren backup verificado, rollback probado y confirmacion explicita.
- R2/Firebase/Neon tienen adapters implementados y pruebas locales; Neon además tiene `0007_rate_limit_windows` aplicado y verificado en el branch `production` de staging. El runtime productivo no se considera activado hasta completar el despliegue aprobado en `docs/production-activation.md`. El OCR real requiere configuración runtime, IAM y alerta de billing verificada.
- El production gate en `src/modules/config/production-gate.ts` exige `AUTH_MODE=firebase`, `OCR_PROVIDER=google-document-ai`, `PERSISTENCE_MODE=postgres`, `STORAGE_MODE=r2`, `RATE_LIMIT_MODE=postgres`, `DATABASE_URL`, `RATE_LIMIT_KEY_SECRET` y las demás variables privadas/públicas documentadas. Dev auth, fake OCR, memoria y storage local no son defaults de producción.
- `corepack pnpm audit --json` queda en cero vulnerabilidades conocidas tras fijar `sharp@0.35.0` y `postcss@8.5.23` bajo Next; debe repetirse en cada release.
- Este documento no autoriza despliegue, migraciones, billing, OCR pago ni gasto.

## Decisiones de arquitectura

- Monolito modular: ver ADR-001.
- PostgreSQL gestionado: ver ADR-002.
- Firebase Auth: ver ADR-003.
- R2: ver ADR-004.
- Vercel Hobby: ver ADR-005.
- Fake OCR inicial: ver ADR-006.
