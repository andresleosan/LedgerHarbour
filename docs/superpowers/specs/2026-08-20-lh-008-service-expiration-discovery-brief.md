# LH-008: Baseline de expiracion de servicio

## Estado

Tasks 1-4 del discovery documental completadas. Task 3 agrega los gates
operativos y de seguridad para la fase recomendada de notificaciones, y Task 4
cierra el checklist documental. La propuesta queda en revision para la
siguiente fase, pero este documento no aprueba LH-008, no autoriza
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

## Task 3: gates operativos y de seguridad

### Gate temporal y de elegibilidad

Antes de implementar cualquier evaluador o notificacion, el operador debe
decidir y registrar estos campos, sin inferirlos del comportamiento tecnico
actual:

- `canonicalTimezone`: zona horaria canonica del producto o zona horaria por
  negocio. La conversion observada a UTC no constituye una politica comercial.
- `finalDayInterpretation`: si `serviceExpiresAt` es el inicio de un instante de
  expiracion o el final inclusivo del ultimo dia de servicio.
- `preExpirationWindows`: lista ordenada de ventanas con identificador,
  desplazamiento, limites inclusivos/exclusivos y regla de activacion. Las
  ventanas deben ser deterministas y no solaparse sin una decision explicita.
- `postExpirationGracePeriod`: duracion de gracia y su interpretacion temporal.
  No se define un valor por defecto en este discovery.
- `eligibleStatuses`: estados elegibles, incluyendo si se exige `active` con
  `isActive = true`. Como baseline seguro se propone excluir `pending`,
  `rejected`, `suspended` y registros sin fecha valida, sujeto a decision de
  producto.

La evaluacion debe capturar el valor actual de `serviceExpiresAt`, el estado,
`isActive`, la ventana y el instante de evaluacion. Una fecha renovada o
editada invalida cualquier alerta pendiente basada en el valor anterior: el
job debe volver a leer el registro, suprimir el resultado stale y generar una
nueva clave solo para el valor vigente. Una ejecucion duplicada, clock skew o
fecha invalida debe producir un resultado visible de no elegible o error, nunca
una mutacion del ciclo de vida.

### Gate de notificaciones

- **Destinatarios:** definir y aprobar las clases exactas antes de implementar;
  los candidatos son administradores de plataforma y administradores activos
  del negocio. Los destinatarios deben resolverse desde identidades autorizadas,
  no desde datos libres del cliente.
- **Contenido y locale:** definir plantilla versionada, locale/fallback,
  asunto, datos minimos y enlace de accion. No incluir secretos, tokens ni
  informacion innecesaria. El contenido debe escaparse segun el canal futuro.
- **Frontera de entrega:** usar una interfaz provider-neutral que reciba un
  mensaje ya validado y devuelva estados normalizados. El dry-run solo
  clasifica y observa; no entrega mensajes ni selecciona proveedor.
- **Rate limits:** definir limites independientes por negocio, destinatario,
  ventana, job y total del proceso. `auth-rate-limit.ts` solo cubre scopes de
  autenticacion `email` y `google`; no es un limite suficiente para este flujo.
- **Retries:** definir un maximo finito de intentos, backoff con jitter y
  errores reintentables/no reintentables. No se permiten reintentos infinitos ni
  reintentos que ignoren la invalidacion por renovacion o edicion de fecha.
- **Visibilidad de fallos:** registrar estado normalizado, contador de intento,
  ultima causa tecnica sanitizada y correlation ID; exponer conteos agregados y
  una cola de trabajo manual autorizada sin guardar contenido completo del
  mensaje en logs.
- **Deduplicacion:** la clave estable debe componerse exactamente de negocio,
  evento de expiracion, ventana y valor actual de expiracion normalizado:
  `businessId|expirationEvent|windowId|serviceExpiresAt`. La fanout por clase de
  destinatario se registra aparte sin cambiar esa clave. La reserva y el
  resultado deben ser idempotentes ante jobs concurrentes.

### Gate de auditoria y recuperacion

Toda implementacion futura debe producir eventos auditables para evaluacion,
intento de notificacion, resultado de entrega y accion del operador. La tabla
`audit_events` ya modela `actorType = system`, `actorId`, `action`, `entityType`,
`entityId`, `metadata` y `createdAt`, pero el `appendAuditEvent` observado en el
repositorio PostgreSQL siempre escribe actor de tipo usuario y no acepta
metadata. Antes de usarla para jobs se debe ampliar el contrato de auditoria o
crear una frontera operacional equivalente, con soporte explicito para
identidad de job y metadata minima. No se debe simular un job como usuario.

Cada evento debe incluir, cuando aplique, el valor de expiracion, `correlationId`,
clave de deduplicacion, ventana, resultado y referencia interna minima. Los
logs no deben copiar el mensaje ni datos de contacto completos.

La fase dry-run puede generar observabilidad append-only si se aprueba ese
registro, pero no puede cambiar estado de negocio, membresias, `isActive`,
`serviceExpiresAt`, ni campos de suspension. Un outage del proveedor, una
entrega duplicada o un job repetido tampoco puede mutar el ciclo de vida.

Si una tarea futura propone mutar el ciclo de vida, debe exigir antes/despues,
razon, actor o identidad de job, valor de expiracion, `correlationId` y una
guarda compare-and-set que cubra al menos el estado esperado y el valor de
expiracion esperado. El `expectedStatus` existente es necesario pero no
suficiente para proteger una renovacion concurrente. La operacion debe ser
transaccional, auditable y contar con una recuperacion manual autorizada que
registre su propio evento; el fallo de entrega nunca debe disparar rollback de
estado por si solo. La suspension automatica sigue fuera de alcance y requiere
una tarea, aprobacion y plan de recuperacion separados.

### Gate de seguridad y no-goals

- Los datos de expiracion, destinatarios, estado de entrega y correlation IDs
  son datos operativos sensibles. Aplicar minimizacion, acceso por rol y
  retencion definida; en logs usar IDs internos y conteos agregados.
- Las acciones manuales de reconocer, reenviar, suprimir u overridear alertas
  deben pasar por identidad, membresia activa de plataforma, capacidad autorizada,
  razon obligatoria y auditoria. La autorizacion existente de plataforma sigue
  siendo obligatoria; un job no obtiene permisos por ser interno.
- Validar y normalizar entradas de ventana, locale, destinatario, razon y
  referencias antes de procesarlas. No aceptar contenido ni destinatarios
  arbitrarios desde el frontend o un cliente externo.
- No agregar proveedor, cliente externo, credencial, servicio de pago ni
  produccion en esta fase. No seleccionar canal irreversible hasta el checkpoint
  del operador.
- No implementar suspension automatica, revocacion de acceso, renovacion
  automatica, migracion de esquema ni rollback automatico por fallo de entrega.

### Criterio de salida de la fase

La fase solo puede pasar de discovery a implementacion cuando el operador haya
decidido los campos temporales, estados elegibles, destinatarios, canal,
limites, retries, deduplicacion, eventos de auditoria y permisos de recovery;
existan pruebas de concurrencia, stale-date, duplicate-job, provider-outage y
clock-skew; y el dry-run demuestre cero mutaciones del ciclo de vida. La
suspension automatica no forma parte de este criterio ni queda autorizada.

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

## Task 4: acceptance checklist

- [x] Usuarios afectados: platform operators y business administrators.
- [x] Resultado medible: reducir las horas de seguimiento manual de expiraciones.
- [x] Alternativas comparadas: fecha informativa, notificaciones y suspension
  automatica.
- [x] Recomendacion: notificaciones precedidas por dry-run/observation.
- [x] Suspension automatica: diferida y fuera de alcance de LH-008.
- [x] Reglas temporales: timezone canonica, semantica del ultimo dia, ventanas
  de aviso y periodo de gracia.
- [x] Elegibilidad y destinatarios: estados, fecha valida, renovaciones e
  identidades autorizadas.
- [x] Entrega: canal provider-neutral, limites, retries finitos, backoff,
  deduplicacion e invalidacion de alertas stale.
- [x] Idempotencia: clave estable por negocio, evento, ventana y expiracion
  vigente, con reserva segura ante jobs concurrentes.
- [x] Auditoria: evaluacion, intento, resultado y accion operativa con identidad
  de job, metadata minima y correlation ID.
- [x] Rollback y recovery: solo operacion manual autorizada y auditada; no
  rollback automatico por fallo de entrega.
- [x] Provider failure: outage, entrega duplicada, job repetido y clock skew no
  mutan el ciclo de vida y dejan visibilidad operativa.
- [x] Medicion: baseline de horas manuales y medidas secundarias de elegibilidad,
  entrega, duplicados, stale alerts, resolucion e incidentes.
- [x] RICE propuesto: `3.50` para notificaciones precedidas por dry-run.
- [x] Gates de aprobacion: decisiones temporales, destinatarios, canal, limites,
  retries, deduplicacion, auditoria, recovery y pruebas de borde deben ser
  aprobadas antes de implementar.

El brief queda cerrado como evidencia documental y el ledger canonico queda en
`revision`. No se interpreta este documento como aprobacion de implementacion,
despliegue, migracion, billing o accion productiva.
