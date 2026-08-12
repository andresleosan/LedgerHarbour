# Migracion PostgreSQL Local Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar progresivamente los repositorios in-memory de LedgerHarbour por adaptadores PostgreSQL verificables localmente, conservando rollback al modo memory y sin tocar producción.

**Architecture:** La aplicación mantiene el monolito modular y los servicios de dominio. Cada módulo recibe una implementación de repositorio PostgreSQL compatible con un contrato estable; la selección se controla por `PERSISTENCE_MODE=memory|postgres`. Las pruebas ejecutan la migración SQL y los contratos contra una base PostgreSQL efímera/local antes de conectar Neon.

**Tech Stack:** PostgreSQL, Drizzle ORM, `pg`, `@electric-sql/pglite` para pruebas efímeras, TypeScript, Vitest y PowerShell 5.1.

## Global Constraints

- No usar Neon remoto ni crear cuentas durante esta fase.
- No desplegar ni aplicar migraciones productivas.
- No ejecutar `DROP`, `TRUNCATE` ni conversiones destructivas en una base productiva.
- Toda migración tendrá `up`, rollback documentado y prueba en una base descartable.
- El tenant seguirá siendo validado por los servicios server-side; PostgreSQL no reemplaza autorización de aplicación.
- Se conservarán foreign keys compuestas, unicidad tenant-aware y auditoría append-only del esquema existente.
- `privateObjectKey` seguirá fuera de DTOs públicos; el adapter de documentos solo persiste la clave privada.
- `PERSISTENCE_MODE=memory` seguirá disponible como rollback inmediato del prototipo.
- Cada cambio de producción debe tener una prueba escrita antes de la implementación y observar RED correcto.
- No se migrará storage local a R2 ni auth de desarrollo a Firebase en este plan.

---

## Mapa De Archivos

- `src/db/client.ts`: conexión PostgreSQL y cliente Drizzle.
- `src/db/migrations/`: SQL versionado y rollback documentado.
- `src/modules/persistence/`: selección de modo y construcción de repositorios.
- `src/modules/tenancy/*-repository.ts`: persistencia de users, businesses, memberships, join requests.
- `src/modules/documents/document-repository.ts`: persistencia de documentos sin leer bytes privados.
- `src/modules/invoices/invoice-repository.ts`: persistencia de invoices y conflictos de estado.
- `src/modules/jobs/job-repository.ts`: deduplicación y claim atómico de OCR jobs.
- `src/modules/accounting/*-repository.ts`: categorías y monedas.
- `src/modules/audit/audit-repository.ts`: append-only audit events.
- `tests/integration/postgres/`: harness efímero y pruebas contractuales.
- `docs/verification/ledgerharbour-postgresql-migration.md`: resultados, rollback y límites.

### Task 1: PostgreSQL Test Harness y Validación del Esquema

**Files:**
- Modify: `package.json`
- Modify: `src/db/client.ts`
- Create: `src/db/test-database.ts`
- Create: `tests/integration/postgres/schema-execution.test.ts`
- Create: `tests/integration/postgres/fixtures.ts`

**Interfaces:**
- Produce `createTestDatabase(): Promise<{ db: Database; close(): Promise<void> }>` usando PGlite y `createDbClient`/Drizzle.
- Produce una función de aplicación de migraciones que ejecute `src/db/migrations/0001_initial.sql` en una base descartable.

- [ ] **Step 1: Añadir dependencias mínimas de persistencia.** Añadir `pg` como dependencia de runtime, `@types/pg` y `@electric-sql/pglite` como dependencias de desarrollo; mantener Drizzle como contrato ORM.
- [ ] **Step 2: Escribir la prueba de ejecución del esquema.** Aplicar la migración a PGlite y consultar que existan las tablas, enums, foreign keys, índices tenant-aware, trigger append-only de auditoría y constraint de Owner Admin.
- [ ] **Step 3: Ejecutar la prueba en rojo.** Ejecutar `npm test -- tests/integration/postgres/schema-execution.test.ts`; confirmar que falla por harness/driver ausente o por una incompatibilidad real del SQL, no por un assertion trivial.
- [ ] **Step 4: Implementar el harness mínimo.** Crear la base efímera, ejecutar el SQL en una transacción controlada y cerrar la instancia en `finally`.
- [ ] **Step 5: Ejecutar en verde y documentar.** Confirmar que la migración completa corre, que el cleanup funciona y que cualquier limitación de PGlite queda registrada.

### Task 2: Contratos y Repositorios PostgreSQL de Tenancy

**Files:**
- Create: `src/modules/tenancy/postgres-tenancy-repository.ts`
- Modify: `src/modules/tenancy/business-service.ts`
- Modify: `src/modules/tenancy/join-request-service.ts`
- Create: `tests/integration/postgres/tenancy-repository.test.ts`

**Interfaces:**
- El adapter debe implementar las operaciones usadas por `OnboardingRepository`: users, businesses, memberships, categories seed, join requests, audit append y `transaction`.
- Cada método debe devolver los mismos tipos de dominio que el repositorio in-memory y traducir unique/FK conflicts a errores de dominio estables.

- [ ] **Step 1: Escribir pruebas contractuales compartidas.** Repetir creación de negocio, Owner Admin único, membresía activa, búsqueda normalizada, join request, aprobación/rechazo y aislamiento con PGlite.
- [ ] **Step 2: Ejecutar pruebas en rojo.** Ejecutar `npm test -- tests/integration/postgres/tenancy-repository.test.ts` y confirmar ausencia del adapter.
- [ ] **Step 3: Implementar consultas tenant-aware.** Usar Drizzle y transacciones PostgreSQL; no aceptar `businessId` de UI como autorización y no devolver columnas no requeridas.
- [ ] **Step 4: Implementar conflictos y rollback transaccional.** Mapear unique/FK/constraint errors y verificar que una operación de negocio fallida no deja membership, business o audit event parcial.
- [ ] **Step 5: Ejecutar contrato e aislamiento.** Confirmar que las pruebas de tenancy existentes y nuevas pasan contra memory y PostgreSQL.

### Task 3: Documentos, Invoices y OCR Jobs Persistentes

**Files:**
- Create: `src/modules/documents/postgres-document-repository.ts`
- Create: `src/modules/invoices/postgres-invoice-repository.ts`
- Create: `src/modules/jobs/postgres-job-repository.ts`
- Modify: `src/modules/documents/document-service.ts`
- Modify: `src/modules/invoices/invoice-service.ts`
- Modify: `src/modules/jobs/job-service.ts`
- Create: `tests/integration/postgres/finance-repositories.test.ts`

**Interfaces:**
- Document repository: create, findById, listByBusinessId y transacción; no expone bytes ni altera `privateObjectKey`.
- Invoice repository: create, findById, findByDocumentId, update, updateIfUnchanged y transacción.
- Job repository: createOrReuse, claim atómico, find/update y transacción.

- [ ] **Step 1: Escribir pruebas de contrato.** Cubrir documento duplicado por checksum, invoice-document tenant FK, edición aprobada rechazada, update conflict concurrente, job dedupe y dos claims concurrentes con solo un ganador.
- [ ] **Step 2: Ejecutar en rojo.** Ejecutar `npm test -- tests/integration/postgres/finance-repositories.test.ts` y verificar que la implementación PostgreSQL falta.
- [ ] **Step 3: Implementar adapters con constraints reales.** Usar `SELECT ... FOR UPDATE` o actualización condicional para estado/versionado; delegar unicidad y FK al motor.
- [ ] **Step 4: Probar rollback y errores públicos.** Confirmar que errores de driver no filtran SQL, claves privadas ni rutas; el servicio mantiene códigos de dominio existentes.
- [ ] **Step 5: Repetir pruebas de invoices/OCR.** Ejecutar los tests existentes de workflow/review junto con el contrato PostgreSQL.

### Task 4: Contabilidad y Auditoría Persistentes

**Files:**
- Create: `src/modules/accounting/postgres-category-repository.ts`
- Create: `src/modules/accounting/postgres-currency-repository.ts`
- Create: `src/modules/audit/postgres-audit-repository.ts`
- Modify: `src/modules/accounting/category-service.ts`
- Modify: `src/modules/accounting/currency-service.ts`
- Create: `tests/integration/postgres/accounting-audit.test.ts`

**Interfaces:**
- Categorías y monedas deben conservar unicidad tenant-aware, desactivación histórica y conflictos `409`.
- Auditoría debe permitir append y lectura autorizada, pero rechazar update/delete.

- [ ] **Step 1: Escribir pruebas contractuales.** Cubrir dos escrituras concurrentes de moneda/nombre, moneda estándar/custom, referencias históricas, categoría desactivada y append-only audit event.
- [ ] **Step 2: Ejecutar en rojo.** Ejecutar `npm test -- tests/integration/postgres/accounting-audit.test.ts` y confirmar falta del adapter.
- [ ] **Step 3: Implementar consultas e índices.** Aplicar constraints existentes y traducir unique conflicts a errores de dominio.
- [ ] **Step 4: Verificar tenant y append-only.** Intentar modificar datos de otro negocio y actualizar/borrar auditoría; ambos deben fallar sin filtrar SQL.
- [ ] **Step 5: Ejecutar tests unitarios e integración.** Confirmar parity entre memory y PostgreSQL.

### Task 5: Selector de Persistencia y Wiring Reversible

**Files:**
- Create: `src/modules/persistence/repository-factory.ts`
- Modify: `src/modules/tenancy/business-service.ts`
- Modify: `src/modules/documents/document-service.ts`
- Modify: `src/modules/invoices/invoice-service.ts`
- Modify: `src/modules/jobs/job-service.ts`
- Modify: `src/modules/accounting/category-service.ts`
- Modify: `src/modules/accounting/currency-service.ts`
- Modify: `.env.example`
- Create: `tests/integration/postgres/persistence-mode.test.ts`

**Interfaces:**
- `PERSISTENCE_MODE=memory` conserva comportamiento actual.
- `PERSISTENCE_MODE=postgres` requiere `DATABASE_URL` y construye adapters PostgreSQL; si falta la URL debe fallar cerrado con error de configuración, nunca caer silenciosamente a memory.

- [ ] **Step 1: Escribir pruebas de selección.** Probar memory, postgres con database test y postgres sin `DATABASE_URL`; la última debe rechazar el arranque/operación.
- [ ] **Step 2: Ejecutar en rojo.** Ejecutar `npm test -- tests/integration/postgres/persistence-mode.test.ts` y confirmar que el factory no existe.
- [ ] **Step 3: Implementar factory explícito.** No mezclar repositorios entre modos ni usar estado global in-memory cuando el modo sea postgres.
- [ ] **Step 4: Probar rutas reales con ambos modos.** Ejecutar aislamiento, review, upload, portfolio y E2E con memory; ejecutar integration contract tests con postgres.
- [ ] **Step 5: Documentar rollback operativo.** Cambiar `PERSISTENCE_MODE` a memory para rollback del prototipo; no borrar tablas ni datos.

### Task 6: Migración, Rollback y Verificación

**Files:**
- Create: `docs/verification/ledgerharbour-postgresql-migration.md`
- Create: `docs/runbooks/postgresql-rollback.md`
- Modify: `docs/STACK.md`
- Modify: `.superpowers/sdd/2026-08-11-ledgerharbour-mvp/progress.md`

- [ ] **Step 1: Documentar el procedimiento local.** Incluir instalación/start de PGlite, comandos de migración, seed y cleanup sin secretos.
- [ ] **Step 2: Documentar rollback.** Definir rollback de adapter a memory, rollback SQL por migración y criterios de abortar ante fallo parcial.
- [ ] **Step 3: Ejecutar la verificación completa.** Ejecutar `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` y suites de seguridad/E2E secuencialmente.
- [ ] **Step 4: Registrar límites.** Confirmar que no se usó Neon remoto, que backup productivo no aplica todavía y que R2/Firebase siguen diferidos.
- [ ] **Step 5: Emitir decisión.** Solo marcar la etapa como `PostgreSQL local verificado`; no declarar producción lista ni autorizar despliegue.
