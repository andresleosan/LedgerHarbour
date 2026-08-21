# LH-008: Baseline de expiracion de servicio

## Estado

Discovery documental completado. Este documento no aprueba LH-008, no autoriza
implementacion y no cambia el comportamiento de produccion.

## Current State

### Dato persistido y estados

- `businesses.serviceExpiresAt` es un `timestamp` PostgreSQL con zona horaria:
  `src/db/schema/businesses.ts:34-41`, en particular la linea 37.
- La restriccion de estado permite exactamente `pending`, `active`, `suspended`
  y `rejected`: `src/db/schema/businesses.ts:43-46`.
- El contrato de dominio expone `serviceExpiresAt`, `activatedAt`, `suspendedAt`
  y `suspensionReason`: `src/modules/tenancy/business-service.ts:63-78`.
- Las transiciones actuales son `pending -> active|rejected`,
  `active -> suspended`, `suspended -> active` y ninguna desde `rejected`:
  `src/modules/tenancy/business-service.ts:25-35`.

### Aprobacion y fecha

- El servicio acepta una fecha obligatoria y una razon en
  `ApproveBusinessInput`: `src/modules/platform/platform-service.ts:74-77`.
- Valida que la fecha sea texto no vacio, que pueda convertirse a `Date` y que
  sea posterior al instante actual; luego la normaliza con `toISOString()`:
  `src/modules/platform/platform-service.ts:121-126`.
- La aprobacion solo procede si el negocio esta en `pending`, crea la membresia
  `owner_admin`, calcula `activatedAt` con la hora actual y actualiza
  `status`, `activatedAt`, `serviceExpiresAt`, `suspendedAt` y
  `suspensionReason`: `src/modules/platform/platform-service.ts:397-445`.
- La ruta exige identidad, aplica rate limit, valida `serviceExpiresAt` y
  `reason`, y delega en `approveBusiness`:
  `src/app/api/platform/businesses/[businessId]/approve/route.ts:10-35`.
- La UI usa un input HTML de tipo fecha solo cuando la accion es aprobar y
  exige tambien una razon: `src/ui/platform/PlatformAdminPanel.tsx:47-58` y
  `src/ui/platform/ActionDialog.tsx:91-106`.
- Al enviar la aprobacion, la UI transforma la fecha de calendario a
  `${fecha}T23:59:59.000Z` y la serializa como ISO:
  `src/ui/platform/PlatformAdminPanel.tsx:77-88`.

### Lectura y acciones actuales de plataforma

- El DTO de plataforma devuelve `serviceExpiresAt` junto con el estado y las
  fechas de ciclo de vida: `src/modules/platform/platform-service.ts:63-72` y
  `166-176`.
- El panel muestra la fecha de activacion y de expiracion, pero sus acciones de
  negocio solo son aprobar/rechazar para `pending`, suspender para `active` y
  reactivar para `suspended`: `src/ui/platform/PlatformAdminPanel.tsx:101-106`
  y `247-255`.
- No hay en los archivos revisados un evaluador de expiracion, una accion de
  notificacion, un scheduler, ni una accion automatica basada en
  `serviceExpiresAt`.

### Autorizacion, transiciones y auditoria

- El servicio exige un miembro activo de plataforma con rol
  `platform_admin`, identidad resuelta y el mismo `userId` del actor antes de
  permitir operaciones de plataforma: `src/modules/platform/platform-service.ts:179-195`.
- Las transiciones de negocio se ejecutan dentro de la transaccion de tenancy
  y, cuando existe, de plataforma; verifican el estado esperado y agregan un
  evento de auditoria con actor, accion, objetivo, estados anterior/posterior y
  razon: `src/modules/platform/platform-service.ts:279-312`.
- La aprobacion usa el mismo patron transaccional y registra
  `business_approved` desde `pending` a `active`: `src/modules/platform/platform-service.ts:401-445`.
- El contrato de repositorio expone `updateBusinessLifecycle`, listado de
  negocios y `appendAuditEvent`: `src/modules/tenancy/business-service.ts:152-180`.
- El repositorio en memoria valida transiciones y exige un `owner_admin` activo
  al pasar a `active`: `src/modules/tenancy/business-service.ts:411-424`.
- El repositorio PostgreSQL convierte el timestamp almacenado a ISO al mapearlo
  y vuelve a convertir el ISO a `Date` al actualizarlo; tambien aplica el estado
  esperado en el `UPDATE`: `src/modules/tenancy/postgres-tenancy-repository.ts:114-132`
  y `398-430`.

## Semantica temporal comprobada

- El almacenamiento y el mapeo son timezone-aware.
- La ruta de aprobacion acepta una cadena y el servicio la interpreta con el
  parser de `Date` del runtime antes de normalizarla a UTC.
- El flujo de UI agrega explicitamente `23:59:59.000Z` a la fecha de calendario.
- Esta evidencia no permite inferir una zona horaria comercial. UTC es el
  comportamiento tecnico observado de la conversion de UI, no una politica de
  zona horaria del negocio.
- Sigue sin decidirse si `serviceExpiresAt` representa el inicio o el final
  inclusivo del ultimo dia de servicio. La decision debe preceder cualquier
  automatizacion.

## Baseline de elegibilidad

El sistema tiene cuatro estados y las transiciones indicadas arriba, pero no
tiene un contrato actual que clasifique negocios como proximos a expirar, en
gracia o expirados. Antes de implementar notificaciones hay que decidir la zona
horaria/canonica, las ventanas de aviso, la gracia y los estados elegibles. El
 diseño aprobado identifica como exclusiones propuestas `pending`, `rejected`,
 `already suspended` y registros sin fecha, pero las deja sujetas a decision de
 producto: `docs/superpowers/specs/2026-08-20-lh-008-service-expiration-automation-design.md:90-103`.

## Recomendacion y reglas aun abiertas

La recomendacion aprobada es notificaciones antes que suspension, empezando por
un contrato de observacion/dry-run que no cambie datos:
`docs/superpowers/specs/2026-08-20-lh-008-service-expiration-automation-design.md:73-88`.

Antes de cualquier implementacion siguen abiertas estas decisiones del diseño:

- zona horaria canonica o zona horaria del negocio;
- interpretacion del ultimo dia y momento exacto de expiracion;
- ventanas antes de expirar y periodo de gracia;
- efecto de renovaciones o correcciones sobre alertas pendientes;
- destinatarios y canal aprobado, sin seleccionar proveedor en discovery;
- clave de deduplicacion, limites, reintentos, backoff y visibilidad de fallos;
- eventos de evaluacion, intento, entrega y accion operativa;
- permisos para reconocer, reenviar, suprimir u overridear alertas;
- baseline de horas manuales y metricas de falsos positivos, entrega y
  remediacion.

La suspension automatica queda fuera de LH-008 y requiere una tarea separada,
aprobacion explicita del operador y evidencia de que las reglas de fechas y
destinatarios son confiables: `docs/superpowers/specs/2026-08-20-lh-008-service-expiration-automation-design.md:75-79`.
