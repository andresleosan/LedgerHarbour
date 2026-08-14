# Selector Reversible De Persistencia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cablear `PERSISTENCE_MODE=memory|postgres` con fail-closed y validar el modo PostgreSQL completo usando PGlite, sin conexiones remotas.

**Architecture:** Se mantiene el monolito modular. Un factory central construye un `PersistenceContext` con todos los repositorios requeridos por las rutas; el modo `memory` reutiliza los defaults globales actuales y el modo `postgres` recibe un `Database` Drizzle inyectable para pruebas o crea un pool desde `DATABASE_URL` en runtime. Las rutas pasan dependencias explícitas a los servicios, evitando que módulos distintos mezclen memoria y PostgreSQL.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM, `pg`, PGlite, Vitest, Playwright y PowerShell 5.1.

## Global Constraints

- No usar Neon remoto ni crear cuentas durante esta fase.
- No desplegar ni aplicar migraciones productivas.
- No ejecutar `DROP`, `TRUNCATE` ni conversiones destructivas.
- `PERSISTENCE_MODE=memory` debe seguir disponible como rollback inmediato.
- `PERSISTENCE_MODE=postgres` sin `DATABASE_URL` debe fallar cerrado, sin fallback a memoria.
- Las pruebas PostgreSQL usarán una base PGlite migrada y la cerrarán en `finally`.
- La autorización tenant-aware seguirá en los servicios server-side.
- No se imprimirán `DATABASE_URL`, credenciales, SQL ni `privateObjectKey`.
- Categorías ya forman parte de `OnboardingRepository` y de su adapter PostgreSQL; no se creará un adapter duplicado.
- No modificar Firebase Auth, R2, OCR real ni rate limiting.
- No hacer commit ni push sin confirmación explícita del operador; si se solicita push, el remoto será `https://github.com/andresleosan/LedgerHarbour`.

## File Map

- Create: `src/modules/accounting/postgres-currency-repository.ts` - adapter Drizzle para `CurrencyRepository`.
- Create: `src/modules/persistence/repository-factory.ts` - validación de modo y construcción del contexto.
- Modify: `src/modules/accounting/currency-service.ts` - exportar un resolver singleton del repositorio in-memory sin romper inyección existente.
- Modify: `src/modules/jobs/job-service.ts` - exportar un resolver singleton del repositorio in-memory sin romper inyección existente.
- Modify: `src/app/api/**/*.ts` - pasar dependencias explícitas al servicio correcto.
- Modify: `.env.example` - declarar `PERSISTENCE_MODE=memory` y el contrato de configuración.
- Create: `tests/integration/postgres/currency-repository.test.ts` - contrato del adapter de moneda con PGlite.
- Create: `tests/integration/postgres/persistence-mode.test.ts` - selección, fail-closed y no fallback.
- Modify: `docs/verification/ledgerharbour-postgresql-migration.md` - nueva evidencia y límites.
- Modify: `docs/STACK.md` - estado real del selector y rollback.

---

### Task 1: Adaptador PostgreSQL De Monedas

**Files:**
- Create: `src/modules/accounting/postgres-currency-repository.ts`
- Test: `tests/integration/postgres/currency-repository.test.ts`

**Interfaces:**
- Consume: `CurrencyRepository` de `src/modules/accounting/currency-service.ts`, `currencies` de `src/db/schema`, `Database` de `src/db/client.ts` y `transactionWithDatabase` de `src/db/transaction-scope.ts`.
- Produce: `createPostgresCurrencyRepository(database: Database): CurrencyRepository`.

- [x] **Step 1: Escribir el contrato en rojo.** Crear un test que aplique `0001_initial.sql` a PGlite, cree un negocio mediante el repositorio de tenancy, construya `createPostgresCurrencyRepository(db)` y verifique `create`, `findById`, `listByBusinessId`, `update`, `delete` y `transaction`.

```ts
const currencyRepository = createPostgresCurrencyRepository(db);
const created = await currencyRepository.create(currency);
expect(await currencyRepository.findById(created.id)).toEqual(created);
expect(await currencyRepository.listByBusinessId(businessId)).toEqual([created]);
await currencyRepository.update({ ...created, name: "Euro Updated" });
await currencyRepository.delete(created.id);
expect(await currencyRepository.findById(created.id)).toBeNull();
```

- [x] **Step 2: Ejecutar el test para confirmar RED.** Ejecutar `npm test -- tests/integration/postgres/currency-repository.test.ts`.

Expected: falla porque `src/modules/accounting/postgres-currency-repository.ts` no existe.

- [x] **Step 3: Implementar el adapter mínimo.** Usar Drizzle sobre `currencies`; mapear `createdAt` y `updatedAt` a ISO strings; usar `databaseForOperation` dentro de cada operación; envolver `transaction` con `transactionWithDatabase`; traducir `23503`, `23505`, `23514` y errores desconocidos a `CurrencyError(CURRENCY_REPOSITORY_CONFLICT)` sin incluir detalles del driver.

- [x] **Step 4: Ejecutar el contrato en verde.** Ejecutar `npm test -- tests/integration/postgres/currency-repository.test.ts`.

Expected: todas las pruebas del adapter pasan y no aparecen SQL, URLs ni secretos en las aserciones o errores.

- [x] **Step 5: Ejecutar las pruebas existentes de moneda.** Ejecutar `npm test -- tests/unit/accounting/currency-service.test.ts tests/integration/postgres/currency-repository.test.ts`.

Expected: pruebas unitarias y de integración verdes.

---

### Task 2: Factory Y Contrato De Configuración

**Files:**
- Create: `src/modules/persistence/repository-factory.ts`
- Test: `tests/integration/postgres/persistence-mode.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consume: adapters existentes `createPostgresOnboardingRepository`, `createPostgresDocumentRepository`, `createPostgresInvoiceRepository`, `createPostgresJobRepository`, el nuevo `createPostgresCurrencyRepository`, y defaults in-memory de cada módulo.
- Produce:

```ts
type PersistenceMode = "memory" | "postgres";
type PersistenceContext = {
  mode: PersistenceMode;
  tenancyRepository: OnboardingRepository;
  documentRepository: DocumentRepository;
  invoiceRepository: InvoiceRepository;
  jobRepository: JobRepository;
  currencyRepository: CurrencyRepository;
  storage: StorageAdapter;
  database?: Database;
  close(): Promise<void>;
};

function createPersistenceContext(input?: {
  mode?: string;
  databaseUrl?: string;
  database?: Database;
}): PersistenceContext;
function getPersistenceContext(): PersistenceContext;
function resetPersistenceContextForTests(): Promise<void>;
class PersistenceConfigurationError extends Error;
```

- [x] **Step 1: Escribir tests RED para la selección.** Cubrir `memory`, `postgres` con `database` PGlite inyectado, modo desconocido y `postgres` sin `databaseUrl`; verificar que el último lanza `PersistenceConfigurationError` y que el contexto no contiene repositorios in-memory.

```ts
expect(createPersistenceContext({ mode: "memory" }).mode).toBe("memory");
expect(createPersistenceContext({ mode: "postgres", database: db }).tenancyRepository).not.toBe(defaultOnboardingRepository);
expect(() => createPersistenceContext({ mode: "postgres", database: db })).not.toThrow();
expect(() => createPersistenceContext({ mode: "postgres" })).toThrow(PersistenceConfigurationError);
expect(() => createPersistenceContext({ mode: "invalid" })).toThrow(PersistenceConfigurationError);
```

- [x] **Step 2: Ejecutar RED.** Ejecutar `npm test -- tests/integration/postgres/persistence-mode.test.ts`.

Expected: falla porque el factory y el error de configuración aún no existen.

- [x] **Step 3: Implementar validación y contexto memory.** Normalizar el modo explícito; si no se proporciona, leer `process.env.PERSISTENCE_MODE || "memory"`; devolver `defaultOnboardingRepository`, `resolveDefaultDocumentRepository()`, `resolveDefaultInvoiceRepository()`, `resolveDefaultJobRepository()`, `resolveDefaultCurrencyRepository()` y un `LocalPrivateStorage` singleton únicamente en `memory`; no leer ni mostrar el contenido de `DATABASE_URL` en errores. `close()` debe resolver sin destruir los singletons in-memory.

- [x] **Step 4: Implementar contexto postgres inyectable.** Requerir `database` o una `databaseUrl` no vacía; para pruebas usar el `database` recibido; para runtime crear un `Pool` y `createDbClient(pool)`, y hacer que `close()` cierre únicamente el pool creado por el factory. En el contexto PGlite inyectado, `close()` no debe cerrar el cliente recibido. `getPersistenceContext()` debe cachear el contexto runtime por `mode + databaseUrl` para no crear un pool por request; `resetPersistenceContextForTests()` debe cerrar y limpiar ese contexto cacheado sin cerrar una base inyectada.

- [x] **Step 5: Ejecutar selección en verde.** Ejecutar `npm test -- tests/integration/postgres/persistence-mode.test.ts` y comprobar que dos llamadas consecutivas a `getPersistenceContext()` reutilizan el mismo contexto.

Expected: selección memory, selección postgres, modo inválido y fail-closed pasan.

- [x] **Step 6: Actualizar `.env.example`.** Añadir:

```text
PERSISTENCE_MODE=memory
DATABASE_URL=postgresql://localhost:5432/ledgerharbour
```

Mantener `DATABASE_URL` como ejemplo no secreto y aclarar que solo es obligatoria en modo `postgres`.

---

### Task 3: Wiring Explícito De Rutas Y Servicios

**Files:**
- Modify: `src/modules/accounting/currency-service.ts`
- Modify: `src/app/api/businesses/route.ts`
- Modify: `src/app/api/businesses/search/route.ts`
- Modify: `src/app/api/businesses/[businessId]/join-requests/route.ts`
- Modify: `src/app/api/businesses/[businessId]/lifecycle/route.ts`
- Modify: `src/app/api/businesses/[businessId]/members/[membershipId]/route.ts`
- Modify: `src/app/api/businesses/[businessId]/ownership/transfer/route.ts`
- Modify: `src/app/api/businesses/[businessId]/categories/route.ts`
- Modify: `src/app/api/businesses/[businessId]/currencies/route.ts`
- Modify: `src/app/api/businesses/[businessId]/documents/route.ts`
- Modify: `src/app/api/documents/[documentId]/download/route.ts`
- Modify: `src/app/api/documents/[documentId]/process/route.ts`
- Modify: `src/app/api/invoices/[invoiceId]/route.ts`
- Modify: `src/app/api/invoices/[invoiceId]/review/route.ts`
- Modify: `src/app/api/test/ocr/[jobId]/route.ts`

**Interfaces:**
- Consume: `getPersistenceContext()` y las firmas de dependencia existentes en los servicios.
- Produce: cada request usa un único `PersistenceContext`; ningún servicio de una ruta cae a un default global incompatible con el modo activo.

- [x] **Step 1: Añadir una prueba de wiring RED.** En `persistence-mode.test.ts`, construir un contexto PGlite, crear un negocio con `createBusiness(input, identity, context.tenancyRepository)` y verificar que el negocio solo aparece en `context.tenancyRepository`; repetir una operación de moneda con `currencies: context.currencyRepository`.

- [x] **Step 2: Ejecutar RED.** Ejecutar `npm test -- tests/integration/postgres/persistence-mode.test.ts` y confirmar que las rutas/servicios todavía usan defaults globales cuando no reciben dependencias.

- [x] **Step 3: Pasar dependencias explícitas.** En cada route handler obtener `const persistence = getPersistenceContext()` y usar:

```ts
 createBusiness({ name }, identity, persistence.tenancyRepository);
 searchBusinesses(query, identity, persistence.tenancyRepository);
 createBusinessLifecycleService(persistence.tenancyRepository);
 createMembershipService(persistence.tenancyRepository);
 createCategory({ businessId, name }, identity, { tenancyRepository: persistence.tenancyRepository });
 setCurrency({ businessId, name, symbol, decimalCount, isoCode }, identity, { tenancyRepository: persistence.tenancyRepository, currencies: persistence.currencyRepository, invoices: persistence.invoiceRepository });
 createDocument({ businessId, upload }, identity, { tenancyRepository: persistence.tenancyRepository, documentRepository: persistence.documentRepository, storage: persistence.storage });
 getDocumentForDownload(documentId, identity, { tenancyRepository: persistence.tenancyRepository, documentRepository: persistence.documentRepository, storage: persistence.storage });
 queueOcr(documentId, identity, { tenancyRepository: persistence.tenancyRepository, documentRepository: persistence.documentRepository, jobs: persistence.jobRepository });
 getInvoice(invoiceId, identity, { tenancyRepository: persistence.tenancyRepository, documentRepository: persistence.documentRepository, invoices: persistence.invoiceRepository });
 updateInvoiceDraft(input, identity, { tenancyRepository: persistence.tenancyRepository, documentRepository: persistence.documentRepository, invoices: persistence.invoiceRepository });
 approveInvoice(invoiceId, identity, { tenancyRepository: persistence.tenancyRepository, documentRepository: persistence.documentRepository, invoices: persistence.invoiceRepository });
```

Use the existing function signatures exactly; if a route currently calls a wrapper service, extend only that dependency object rather than changing public DTOs.

- [x] **Step 4: Add storage to the context without pretending it is PostgreSQL.** Keep `LocalPrivateStorage` in both modes for this phase and expose it as `storage`; document that R2 remains out of scope. This prevents document services from accidentally constructing a second storage adapter while testing persistence.

- [x] **Step 5: Ejecutar wiring en verde.** Ejecutar `npm test -- tests/integration/postgres/persistence-mode.test.ts tests/integration/postgres/tenancy-repository.test.ts tests/integration/postgres/finance-repositories.test.ts`.

Expected: todas las operaciones usan el mismo contexto PGlite y no cambian los contratos públicos.

---

### Task 4: Verificación Completa Y Documentación

**Files:**
- Modify: `docs/verification/ledgerharbour-postgresql-migration.md`
- Modify: `docs/STACK.md`
- Test: `tests/integration/postgres/persistence-mode.test.ts`

**Interfaces:**
- Consume: factory, adapters PostgreSQL, migración SQL versionada y pruebas existentes.
- Produce: evidencia reproducible del selector, límites explícitos y rollback operativo a `memory`.

- [x] **Step 1: Añadir pruebas de aislamiento y fail-closed.** Verificar dos negocios en PGlite, que cada usuario solo ve sus memberships, que `PERSISTENCE_MODE=postgres` sin URL no crea contexto y que el error no contiene la URL ni SQL.

- [x] **Step 2: Ejecutar la integración completa.** Ejecutar:

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Expected: todas las unitarias/integración pasan, lint no reporta errores, TypeScript no imprime errores y el build termina correctamente.

- [x] **Step 3: Ejecutar E2E en memory.** Ejecutar:

```powershell
$env:AUTH_MODE='development'; $env:PERSISTENCE_MODE='memory'; npm run test:e2e
```

Expected: los 19 E2E locales pasan y el rollback memory conserva el comportamiento actual.

- [x] **Step 4: Actualizar documentación.** Registrar que PGlite valida el selector y los adapters, que no se usó PostgreSQL nativo/Neon, que `PERSISTENCE_MODE=memory` es rollback y que producción sigue bloqueada por auth, rate limiting, storage, OCR, dependencias y operación.

- [x] **Step 5: Ejecutar revisión final.** Ejecutar `git diff --check`, revisar `git status`, confirmar que no se modificaron migraciones productivas ni secretos y conservar cualquier artefacto no versionado fuera del commit.

## Handoff

Plan completo y guardado en `docs/superpowers/plans/2026-08-13-persistence-mode-wiring.md`.

Opciones de ejecución:

1. **Subagent-Driven:** un subagente por tarea, con revisión entre tareas.
2. **Inline Execution:** ejecutar el plan en esta sesión con checkpoints.
