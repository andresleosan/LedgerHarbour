# LH-008: Baseline de expiracion de servicio

## Estado

Task 2 del discovery documental completada. La propuesta queda en revision para
la siguiente fase, pero este documento no aprueba LH-008, no autoriza
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

## Alternativas y decision

| Alternative | Manual-work effect | Customer risk | Reversibility | Decision |
|---|---|---|---|---|
| Informational date | Low improvement | Lowest | Immediate | Keep only as fallback |
| Notifications | Direct improvement | Low if read-only | High | Recommend |
| Automatic suspension | Highest potential improvement | Highest | Requires recovery | Defer |

Las notificaciones son la siguiente fase recomendada porque atacan directamente
el trabajo manual de seguimiento sin revocar acceso ni mutar el ciclo de vida.
El primer paso debe ser un dry-run/observation que clasifique registros y haga
visible el resultado sin entregar mensajes ni cambiar datos; despues se podra
medir si la fase reduce horas manuales y si las reglas temporales son confiables.

La suspension automatica no esta autorizada por esta tarea. Aunque podria
reducir mas trabajo, puede suspender clientes validos por errores de zona
horaria, renovaciones concurrentes, fechas obsoletas, jobs duplicados o fallas
de entrega. Requiere recuperacion, guardas transaccionales, auditoria y una
aprobacion explicita en una tarea separada.

## Plan de medicion

### Resultado primario

Medir las horas de operador y administradores de negocio dedicadas al
seguimiento manual de expiraciones por periodo de medicion. El baseline se
establece antes del dry-run y se compara con el mismo metodo durante la
observacion y, posteriormente, durante las notificaciones. La decision se
vincula a esta reduccion de trabajo manual, no a mejoras de apariencia o
polish visual.

### Medidas secundarias

- Registros elegibles identificados antes de la ventana de aviso.
- Exito de entrega y de reintentos.
- Alertas duplicadas.
- Alertas obsoletas despues de una renovacion o correccion de fecha.
- Tiempo desde la alerta hasta la resolucion del operador.
- Overrides manuales e incidentes de soporte.

### Baseline de bajo costo

Sin exportar datos de clientes ni conectar un servicio de analitica externo, el
operador puede registrar por periodo solo conteos agregados de registros
elegibles, registros identificados, avisos resueltos y horas empleadas. Si los
conteos no estan disponibles en una vista autorizada, se usa un operator log
con fecha, periodo, conteos y horas; no se guardan nombres, mensajes, tokens ni
datos de contacto. El dry-run debe producir como maximo esos agregados y
referencias internas minimas necesarias para auditar el resultado.

## RICE recalculado

El repositorio usa RICE simplificado con valores del 1 al 5 y esfuerzo inverso:
5 significa poco trabajo. La formula es:

`RICE = (Alcance + Impacto + Confianza + Esfuerzo) / 4`

Para la fase propuesta de notificaciones precedida por dry-run:

| Componente | Valor | Razon |
|---|---:|---|
| Alcance | 3 | Afecta al operador y a administradores de negocios con expiraciones elegibles, no a todos los usuarios. |
| Impacto | 4 | Reduce directamente el seguimiento manual y conserva el ciclo de vida sin suspension automatica. |
| Confianza | 4 | El baseline y la direccion aprobada estan claros, pero zona horaria, canal y reglas de elegibilidad siguen abiertos. |
| Esfuerzo | 3 | La fase requiere dry-run, ventanas, deduplicacion, reintentos, auditoria y observabilidad; no incluye suspension, migracion ni proveedor elegido. |

`RICE = (3 + 4 + 4 + 3) / 4 = 14 / 4 = 3.50`

El `2.75` original de `tasks.md` (`3/3/3/2`) debe cambiar a `3.50` para la
fase de notificaciones propuesta, porque el discovery confirma un beneficio
operativo directo, una confianza mayor y un alcance concreto, aunque mantiene
esfuerzo moderado por las reglas de seguridad pendientes. Este ajuste es una
revaluacion de la propuesta; Task 2 no modifica `tasks.md` ni el estado
canonico del ledger.

## Consistencia y concerns

- La recomendacion es notificacion dry-run/observation antes de cualquier
  entrega, con lectura y clasificacion sin mutaciones.
- La suspension automatica no se recomienda ni se implementa en LH-008; queda
  diferida a una decision y tarea separadas.
- La medida de exito es la reduccion de horas de seguimiento manual, no el
  polish visual del panel.
- Siguen bloqueando una implementacion las decisiones sobre zona horaria,
  semantica del ultimo dia, ventanas y gracia, estados elegibles, renovaciones,
  destinatarios, canal, reintentos, deduplicacion, auditoria y recuperacion.
- Un provider outage, job duplicado, clock skew o alerta stale no puede cambiar
  el ciclo de vida; durante discovery no se selecciona proveedor ni se conecta
  ningun servicio externo.

El brief queda listo para revision documental. El ledger canonico aun muestra
LH-008 como `pendiente` porque la actualizacion de `tasks.md` pertenece a Task
4; no se interpreta este documento como aprobacion de implementacion.
