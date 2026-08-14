# Selector Reversible De Persistencia

Fecha: 2026-08-13
Estado: aprobado para planificación; pendiente de implementación

## Objetivo

Cablear la selección entre repositorios in-memory y PostgreSQL mediante
`PERSISTENCE_MODE`, validando el modo PostgreSQL con PGlite y sin conectar
Neon, crear cuentas externas, desplegar ni aplicar migraciones remotas.

## Alcance

- `PERSISTENCE_MODE=memory` conserva el comportamiento actual del prototipo.
- `PERSISTENCE_MODE=postgres` exige `DATABASE_URL` y construye repositorios
  PostgreSQL para tenancy (incluidas categorías), documentos, invoices y jobs;
  además incorpora el adaptador PostgreSQL faltante para monedas antes de
  activar el modo completo.
- La falta de `DATABASE_URL` en modo `postgres` produce un error explícito de
  configuración. No existe fallback silencioso a memoria.
- Las pruebas pueden inyectar un `Database` creado sobre PGlite para evitar
  conexiones externas.
- El esquema y la migración SQL existentes no se modifican en esta tarea.

## Fuera De Alcance

- Conexión a Neon o a cualquier PostgreSQL remoto.
- Migraciones productivas, backups, despliegue o cambios destructivos.
- Firebase Auth, Cloudflare R2, OCR real y rate limiting.
- Reestructuración de los servicios de dominio.

## Arquitectura

Se añade un factory en `src/modules/persistence/repository-factory.ts`.
El factory recibe configuración explícita y, para PostgreSQL, un cliente
Drizzle opcional inyectado por las pruebas. Devuelve un contexto con las
implementaciones de repositorio que consumen los servicios actuales.

Los defaults globales existentes siguen siendo in-memory para no cambiar el
rollback del prototipo. El wiring de rutas y servicios se cambia únicamente
para resolver el contexto según `PERSISTENCE_MODE`; no se mezclan repositorios
entre modos dentro de una misma operación.

## Contrato De Configuración

```text
PERSISTENCE_MODE=memory|postgres
DATABASE_URL=<obligatoria solo en postgres>
```

Valores ausentes o distintos de `memory`/`postgres` se rechazan con un error
de configuración estable. En `memory`, `DATABASE_URL` no es necesaria.

## Flujo De Datos

1. La capa de composición lee `PERSISTENCE_MODE`.
2. El factory valida el valor y, si es `postgres`, valida `DATABASE_URL`.
3. El modo `memory` devuelve los repositorios globales existentes.
4. El modo `postgres` crea un cliente `pg`, un cliente Drizzle y los
   adaptadores PostgreSQL sobre la misma instancia.
5. Las transacciones de los servicios se mantienen dentro del repositorio y
   respetan las foreign keys, índices tenant-aware y auditoría append-only.
6. Las pruebas PGlite cierran el cliente en `finally` y no dejan estado
   persistente.

## Errores Y Seguridad

- Nunca se imprime `DATABASE_URL`, credenciales ni SQL en respuestas o logs de
  aplicación.
- La configuración incompleta produce un error de arranque/operación que
  identifica el parámetro faltante sin revelar su valor.
- La autorización tenant-aware sigue en los servicios; PostgreSQL no la
  sustituye.
- Los DTOs continúan excluyendo `privateObjectKey` y otros datos privados.
- El factory no permite usar el estado global in-memory cuando el modo es
  `postgres`.

## Pruebas

- Factory en modo `memory` devuelve repositorios funcionales actuales.
- Factory en modo `postgres` con PGlite migrado devuelve adapters PostgreSQL.
- `postgres` sin `DATABASE_URL` falla cerrado.
- La creación de negocio, membresía, join request y aislamiento tenant
  funcionan con el contexto PostgreSQL inyectado.
- Los contratos existentes de documentos, invoices, jobs, categorías y
  monedas conservan sus resultados con el adapter PostgreSQL.
- Se ejecutan unitarias, integración, lint, TypeScript, build y E2E local con
  evidencia fresca.

## Rollback

El rollback de aplicación consiste en volver a `PERSISTENCE_MODE=memory`.
No se eliminan tablas, no se borran datos y no se ejecutan sentencias
destructivas. La migración existente conserva su procedimiento de reversión
documentado en `docs/verification/ledgerharbour-postgresql-migration.md`.

## Decisiones Y Alternativas

### Factory explícito

Se elige un factory central para evitar que cada módulo interprete variables
de entorno de forma distinta y para poder probar la selección con dependencias
inyectadas.

### Monolito modular

No se separan servicios: no hay equipos, ciclos de despliegue ni necesidades
de escala independientes que justifiquen la complejidad adicional.

### PGlite como validación

PGlite permite ejecutar la migración y contratos localmente sin secretos,
cuentas externas ni costo. La validación contra un servidor PostgreSQL nativo
continúa siendo un gate posterior antes de Neon.
