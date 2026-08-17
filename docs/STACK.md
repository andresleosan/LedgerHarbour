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
- PostgreSQL objetivo: Neon Free; migracion inicial verificada remotamente con 11 tablas requeridas.
- Auth: Firebase Authentication Spark; adapter email/password + Google implementado, activacion de staging pendiente.
- Storage privado: Cloudflare R2 Standard.
- OCR: adapter Google Document AI Invoice Parser implementado; configuracion runtime y alerta de billing pendientes. Fake OCR se conserva para desarrollo y pruebas.
- Rate limiting: memoria local por defecto; adapter Upstash preparado para staging.

## Costo

Objetivo inicial: `US$0/mes` mientras el proyecto sea un prototipo no comercial y permanezca dentro de las cuotas gratuitas.

| Servicio | Cuota/no-cost observada | Costo inicial estimado | Limite o alerta |
|---|---|---:|---|
| Neon Free | 0.5 GB/proyecto, 100 CU-horas, 5 GB egress | US$0 | Revisar cuotas; el plan Free no ofrece spending limit de pago |
| Firebase Auth Spark | Hasta 50.000 MAU para auth no telefonica | US$0 | Phone Auth cobra por SMS; revisar cuotas y billing antes de activar Blaze |
| Cloudflare R2 Standard | 10 GB-month, 1M Class A, 10M Class B; egress sin cargo | US$0 | Configurar alertas de cuenta; sobrecuota pasa a cobro |
| Upstash Redis | Free tier para bajo volumen de staging | US$0 inicial | Verificar limites y configurar alerta antes de usar plan de pago |
| Vercel Hobby | Cuotas gratuitas de requests, funciones y transferencia | US$0 | Solo prototipo/no comercial; revisar limites y suspension antes de publicar |
| Google Document AI Invoice Parser | Invoice Parser: US$0.10 por conteo de hasta 10 paginas; costo final depende del volumen | US$0.10 por conteo de hasta 10 paginas | billing alert: required/not verified; configurar antes de activar produccion |

Las cuotas y precios cambian. Antes de crear cuentas o activar billing se debe volver a verificar la pagina oficial del proveedor y obtener confirmacion del operador.

## Datos y persistencia

La aplicacion dispone del selector reversible `PERSISTENCE_MODE=memory|postgres`, con `memory` como valor por defecto. `memory` conserva los repositorios in-memory y es el rollback operativo inmediato. `postgres` requiere `DATABASE_URL` en runtime, falla cerrado si falta y usa adaptadores Drizzle; en pruebas puede recibir una base PGlite inyectada.

El estado local verificado cubre selección de modo, fail-closed sin fallback, cache del contexto runtime, aislamiento tenant-aware y wiring explícito de las rutas API. La evidencia usa PGlite y la migración SQL versionada; no se usó Neon, PostgreSQL remoto ni se aplicaron migraciones productivas.

El esquema relacional versionado en `src/db/schema` y `src/db/migrations` es la fuente de persistencia. `0001_initial.sql` crea el dominio existente y `0002_platform_control_plane.sql` agrega `platform_members` y `platform_audit_events`; el runner exige aplicar la inicial antes de la segunda.

El bootstrap de administradores globales vive en `scripts/db/bootstrap-platform-admins.ts`. Solo acepta una lista explícita mediante `--emails` en producción; el fallback por `PLATFORM_ADMIN_EMAILS` requiere `PLATFORM_ADMIN_BOOTSTRAP=true` y un `NODE_ENV` controlado (`development`, `test` o `staging`), y no se permite en producción. Las direcciones se normalizan y se guardan sin allowlist de autorización en código; el enlace a `users` queda nullable para el primer login verificado.

`platform_audit_events` es append-only mediante trigger y privilegios revocados. Solo conserva actor, acción, target, estados, motivo y timestamp; nunca secretos, tokens ni bytes de documentos. El rollback manual está en `src/db/migrations/rollback/0002_platform_control_plane_down.sql` y no se ejecutó contra producción.

El storage de documentos dispone de `STORAGE_MODE=local|r2`. `local` es el valor por defecto para desarrollo; `r2` requiere las cuatro variables privadas del proveedor y usa un bucket privado. Las claves de objetos permanecen privadas y nunca forman parte de DTOs publicos. Ver `docs/r2-private-storage.md`.

## Seguridad y produccion

- Firebase reemplaza el provider de desarrollo mediante `AUTH_MODE=firebase`; requiere probar el boundary de identidad y configurar Email/Password + Google en el proyecto.
- Rate limiting sigue siendo obligatorio antes de exposicion publica; activar `RATE_LIMIT_MODE=upstash` en staging.
- Las migraciones productivas requieren backup verificado, rollback probado y confirmacion explicita.
- R2/Firebase/Upstash estan activados en produccion: el login Google conserva sesion, el rate limiter responde y R2 confirmo subida/descarga privada; OCR real requiere configuracion runtime y alerta de billing.
- `corepack pnpm audit --json` queda en cero vulnerabilidades conocidas tras fijar `sharp@0.35.0` y `postcss@8.5.23` bajo Next; debe repetirse en cada release.
- Este documento no autoriza despliegue ni gasto.

## Decisiones de arquitectura

- Monolito modular: ver ADR-001.
- PostgreSQL gestionado: ver ADR-002.
- Firebase Auth: ver ADR-003.
- R2: ver ADR-004.
- Vercel Hobby: ver ADR-005.
- Fake OCR inicial: ver ADR-006.
