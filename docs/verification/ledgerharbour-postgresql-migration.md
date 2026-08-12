# LedgerHarbour PostgreSQL Migration Verification

## Alcance

Task 1 valida localmente la ejecución de `src/db/migrations/0001_initial.sql` en una instancia PGlite efímera. No se usó Neon, una base remota ni una base productiva.

## Harness

- `src/db/test-database.ts` crea una instancia PGlite nueva por prueba.
- La migración se lee desde el archivo SQL versionado.
- Los marcadores `BEGIN`/`COMMIT` del archivo se retiran antes de ejecutar el contenido dentro de `client.transaction`, evitando una transacción anidada en PGlite.
- La instancia se cierra en `finally`; si la migración falla durante la creación, el helper cierra el cliente antes de propagar el error.
- El harness usa `drizzle-orm/pglite` con el mismo esquema Drizzle del proyecto.

## Cobertura

`tests/integration/postgres/schema-execution.test.ts` verifica:

- Las 10 tablas públicas y los valores de los 9 enums.
- Foreign keys de documentos, invoices y jobs.
- Índices tenant-aware, unicidad de clave privada por negocio y único Owner Admin activo.
- Triggers de Owner Admin único y auditoría append-only.
- Rechazo de desactivar el último Owner Admin y de activar un segundo.
- Rechazo de una referencia de uploader cruzada entre negocios.
- Rechazo de `UPDATE` y `DELETE` sobre auditoría.

## Verificación ejecutada

| Comando | Resultado |
|---|---|
| `npm test -- tests/integration/postgres/schema-execution.test.ts` | 3/3 pruebas verdes |
| `npm test` | 235/235 pruebas verdes |
| `npm run lint` | Verde, 0 errores |
| `npx tsc --noEmit` | Verde, sin salida |
| `npm run build` | Build Next.js completado |
| `npm audit` | 3 vulnerabilidades altas preexistentes en `postcss`/`sharp` vía Next.js; la corrección propuesta requiere `next@16` y no se aplicó automáticamente |

## Rollback y límites

- Esta tarea no aplica migraciones productivas y no necesita backup productivo.
- Para eliminar el estado local, se cierra y descarta la instancia PGlite; no se ejecutan `DROP` ni `TRUNCATE` en la migración.
- El rollback operativo de la aplicación sigue siendo `PERSISTENCE_MODE=memory`, pendiente de Task 5.
- PGlite valida compatibilidad PostgreSQL local, pero la verificación final contra un servidor PostgreSQL nativo queda pendiente antes de conectar Neon.
- `pg` queda instalado como dependencia runtime para el cliente PostgreSQL real de las siguientes tareas; todavía no se conecta ninguna base remota.

## Decisión

**Task 1: aprobada para revisión local**, con harness y ejecución local verificables. La auditoría de dependencias altas permanece como seguimiento de release y no se resuelve mediante un upgrade mayor automático.

## Task 2: Tenancy PostgreSQL

### Implementación

- `AuthIdentity` es el boundary de onboarding; PostgreSQL hace upsert por `provider_id` y mantiene un `users.id` local independiente.
- Businesses, memberships, categorías seed, join requests y auditoría usan consultas Drizzle tenant-aware y transacciones reales sobre el tipo común `Database`.
- `membershipId` es obligatorio en el contrato y se usa para mutaciones y `audit_events.entity_id`.
- Las páginas server-side y rutas API pasan `AuthIdentity`; no convierten `providerUserId` en una FK local.
- Portfolio, documentos, invoices, monedas y jobs exponen contratos async sin exigir colecciones `Map` a adapters persistentes.
- Revisión concurrente de join requests usa actualización condicional sobre `status = 'pending'`.
- Errores de dominio se preservan; errores SQL se traducen a códigos públicos estables.

### Verificación Task 2

| Comando | Resultado |
|---|---|
| `npm test` | 24 archivos, 256/256 pruebas verdes |
| `npm run lint` | Verde, 0 errores |
| `npx tsc --noEmit` | Verde, sin salida |
| `npm run build` | Build Next.js completado |
| `npm audit --audit-level=high` | 3 vulnerabilidades altas transitivas en `postcss`/`sharp`; corrección requiere Next.js 16 y queda diferida |

### Límites

- El adapter se verificó contra PGlite, no contra un servidor PostgreSQL nativo; `psql`/`pg_isready` no están disponibles en este entorno.
- La verificación nativa y el migration runner quedan como gate antes de release o conexión a Neon.
- `PERSISTENCE_MODE=memory|postgres` todavía no está cableado; corresponde a Task 5.
- No se modificó `src/db/migrations/0001_initial.sql`, no se usó Neon y no se aplicaron migraciones productivas.

**Task 2: aprobada para revisión local**, no aprobada para producción.

## Task 3: Finance repositories

### Esquema local y rollback manual

Task 3 añade localmente `jobs.requested_by`, el índice único tenant-aware
`documents_business_checksum_unique` y el índice único tenant-aware
`jobs_business_document_type_unique`. Estos cambios están versionados en
`src/db/migrations/0001_initial.sql` y no se aplicaron a ninguna base remota.

Para descartar el estado local, cerrar el `PGlite` del test y eliminar el directorio efímero
usado por ese proceso. El harness actual usa una instancia en memoria, por lo que no deja datos
persistentes.

Rollback manual para una base local descartable, solo después de verificar que no se necesitan
los datos de prueba:

```sql
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_requested_by_business_fk;
DROP INDEX IF EXISTS documents_business_checksum_unique;
DROP INDEX IF EXISTS jobs_business_document_type_unique;
ALTER TABLE jobs DROP COLUMN IF EXISTS requested_by;
```

El rollback no debe ejecutarse en producción ni sobre una base compartida sin backup y aprobación
operativa. Para volver la aplicación al prototipo memory, usar `PERSISTENCE_MODE=memory` cuando
Task 5 cablee el selector; esa configuración todavía no está implementada en Task 3.

### Verificación Task 3

La verificación debe ejecutarse localmente contra PGlite. No se usó Neon, secretos, migración
remota ni despliegue.

| Comando | Resultado |
|---|---|
| `npm test -- tests/integration/postgres/database-client.test.ts tests/integration/postgres/schema-execution.test.ts tests/integration/postgres/finance-repositories.test.ts` | 16/16 pruebas verdes |
| `npm test -- tests/integration/documents/private-storage.test.ts tests/integration/invoices/ocr-workflow.test.ts tests/integration/invoices/review.test.ts tests/unit/invoices/invoice-parser.test.ts` | 48/48 pruebas verdes |
| `npm test` | 269/269 pruebas verdes |
| `npm run lint` | Verde, 0 errores |
| `npx tsc --noEmit` | Verde, sin salida |
| `npm run build` | Build Next.js completado |
| `npm audit --audit-level=high` | 3 vulnerabilidades altas transitivas preexistentes en `postcss`/`sharp`; corregir requiere `next@16` y no se aplicó automáticamente |

### Implementación

- `src/db/client.ts` usa `drizzle-orm/node-postgres` con `Pool`, `Client` o `PoolClient`; el tipo común `Database` conserva el contrato `PgDatabase` y `transaction`, compatible con `PgliteDatabase` sin casts `unknown`.
- `documents_business_checksum_unique` impide duplicados de checksum por negocio incluso bajo carreras concurrentes.
- `jobs_business_document_type_unique` hace atómico el dedupe de jobs por negocio, documento y tipo.
- `jobs_requested_by_business_fk` valida `requestedBy` junto con `businessId` contra `memberships`, evitando referencias cruzadas entre negocios.
- `documents.uploaderId` conserva solo la FK compuesta tenant-aware `documents_uploader_business_fk`; no existe FK directa a `users`.
- `jobs.requested_by` se persiste y se mapea a `Job.requestedBy` mediante la FK compuesta de membresía.
- `claim` usa `UPDATE` condicional por estado y retry count; solo una llamada concurrente obtiene el job.
- Los errores SQL se traducen a errores de dominio públicos; no se exponen SQL, rutas privadas, secretos ni `privateObjectKey` en DTOs.

**Task 3: aprobada para validación local**, no aprobada para release PostgreSQL.
