# LedgerHarbour Task 2 Fix Implementation Plan

> **For agentic workers:** Execute inline with TDD RED-GREEN. Do not commit.

**Goal:** Cerrar los bloqueos abiertos de Task 2 manteniendo identidad local, IDs persistentes portables y contratos async sin dependencias en colecciones de adapters memory.

**Architecture:** `AuthIdentity.providerUserId` se resolverá una sola vez en cada boundary a un `UserId` local estable. `Membership.membershipId` será obligatorio en entidades persistentes y las mutaciones/auditorías usarán exclusivamente ese ID. Documentos, facturas y monedas expondrán operaciones async portables; los servicios no exigirán ni leerán `Map` internos de adapters memory. La UI enviará el ID de membership que ya devuelve la API.

**Tech Stack:** TypeScript, Drizzle ORM 0.45, PGlite, PostgreSQL, Vitest.

## Global Constraints

- No modificar `src/db/migrations/0001_initial.sql`.
- No usar Neon, secretos, Git, despliegues, migraciones productivas ni subdelegación.
- Mantener `AuthIdentity` como boundary sin inventar email o nombre.
- Cada cambio de producción debe tener una prueba RED observada antes de su implementación.
- Preservar errores de dominio; mapear únicamente errores SQL a códigos públicos estables.
- `npm test` estándar debe pasar sin flags de timeout global.
- El timeout de PGlite, si se necesita, debe ser explícito y limitado a sus pruebas de integración.

## Archivos objetivo

- `src/db/client.ts`: tipo común Drizzle para PGlite y pg-proxy.
- `src/modules/tenancy/business-service.ts`: contrato async, memory repository, identidad local y creación persistente de memberships con ID previo.
- `src/modules/tenancy/postgres-tenancy-repository.ts`: consultas tenant-aware, transacciones y errores SQL.
- `src/modules/tenancy/membership-service.ts`: mutaciones mediante contrato async.
- `src/modules/tenancy/business-lifecycle-service.ts`: actualización persistente de estado.
- `src/modules/tenancy/portfolio-service.ts`: lectura mediante métodos async.
- `src/modules/tenancy/join-request-service.ts`: claim condicional y auditoría atómica.
- `src/app/(app)/business/[businessId]/settings/members/page.tsx`: DTO y URLs de mutación con `membershipId`.
- `src/modules/accounting/category-service.ts`: dejar de consumir colecciones de tenancy.
- `src/modules/documents/document-service.ts`: operaciones async de estado por `documentId`.
- `src/modules/invoices/invoice-service.ts`: aprobación mediante contrato de documentos sin casts ni colecciones.
- `src/modules/accounting/currency-service.ts`: referencias, listado y borrado mediante contrato async.
- `tests/integration/postgres/tenancy-repository.test.ts`: regresiones PostgreSQL.
- `tests/integration/tenancy/*.test.ts`, `tests/unit/tenancy/*.test.ts`: parity memory y callers.
- `tests/integration/invoices/ocr-workflow.test.ts`: contrato de auditoría actualizado.
- `tests/integration/tenancy/lifecycle.test.ts`: regresión de rutas que distingue membership ID de user ID.
- `tests/integration/tenancy/portfolio.test.ts`, `tests/integration/invoices/review.test.ts`, `tests/integration/invoices/ocr-workflow.test.ts`, `tests/unit/accounting/currency-service.test.ts`: fixtures memory mediante APIs async o tipos concretos.

## Secuencia TDD

1. Añadir una prueba RED que compile/ejecute `createBusiness` y aprobación de join request con membership ID generado, y una prueba RED PostgreSQL que verifique el ID insertado; cambiar el contrato a `Membership` completo, generar IDs antes de insertar y actualizar fixtures.
2. Añadir una prueba RED de UI que inspeccione el código renderizado/handler y rechace URLs construidas con `member.userId`; cambiar DTO, PATCH y transferencia a `member.membershipId`.
3. Añadir pruebas RED de adapters async sin propiedades `Map`; quitar `documents`, `invoices` y `currencies` de contratos base, mantenerlos en tipos concretos memory, reemplazar guards y adaptar fixtures/usos.
4. Ejecutar pruebas focalizadas después de cada ciclo RED-GREEN; no tocar timeouts ni `0001_initial.sql`.
5. Ejecutar `npm test`, `npm run lint`, `npx tsc --noEmit` y `npm run build`.
6. Revisar seguridad, aislamiento tenant, contratos portables, errores públicos estables y ausencia de acceso de servicios a `Map` internos; reportar el gate conocido de PostgreSQL nativo/runner sin intentar resolverlo.
