# Gate de activacion de produccion

La aplicacion no debe tratarse como produccion hasta completar todos los pasos de esta lista. El middleware devuelve `503` generico cuando el contrato esta incompleto. No hay fallback silencioso a auth de desarrollo, fake OCR, memoria, storage local o rate limiting local.

Este archivo es un runbook de acciones requeridas para el operador; no constituye evidencia de que la activacion externa se haya completado ni permite inferir el estado actual de ningun proveedor.

## Activacion unica

### Contrato obligatorio

Configura en el gestor de secretos del entorno, nunca en Git:

- Modos exactos: `AUTH_MODE=firebase`, `OCR_PROVIDER=google-document-ai`, `PERSISTENCE_MODE=postgres`, `STORAGE_MODE=r2`, `RATE_LIMIT_MODE=upstash`.
- Base: `DATABASE_URL`.
- Firebase privado: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
- Firebase publico: `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`.
- R2: `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- Upstash: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- Document AI: `GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`.

El gate valida estructura, formatos, hosts permitidos, consistencia y campos obligatorios sin imprimir valores de entorno. No puede probar offline que una credencial real sea autentica, que tenga IAM efectivo, que el processor exista o que el token tenga cuota: esas comprobaciones se realizan manualmente durante la activacion controlada del entorno.

## Procedimiento del operador

1. Revisa `docs/STACK.md`, el plan de costo vigente de cada proveedor y la aprobacion explicita del operador responsable. No actives billing por este documento.
2. Crea o selecciona el proyecto Firebase y verifica Email/Password, Google, dominios autorizados y email verificado del administrador.
3. Configura el processor Invoice Parser en Google Document AI, la region `us` o `eu`, la cuenta de servicio con `roles/documentai.apiUser` y una alerta de presupuesto. Confirma que IAM y billing alert estan verificados antes de considerar OCR listo.
4. Crea el bucket R2 privado, limita las claves al bucket, verifica HTTPS y no habilites acceso publico.
5. Crea el Redis Upstash del entorno, configura la alerta de billing y guarda solo URL/token en el gestor de secretos.
6. Verifica que el PostgreSQL objetivo tiene backup reciente y que la secuencia de migraciones esta completa. No ejecutes una migracion destructiva sin backup verificado y confirmacion explicita.
7. Carga las variables del contrato y ejecuta la suite local con providers de test. El harness de Playwright fuerza `AUTH_MODE=firebase`, `OCR_PROVIDER=fake`, `PERSISTENCE_MODE=memory`, `STORAGE_MODE=local` y `RATE_LIMIT_MODE=memory`; nunca carga credenciales de produccion ni hace OCR pago.
8. Ejecuta el bootstrap de administradores globales con `--emails` y verifica el vinculo Firebase del primer login. Sigue `docs/platform-administration.md`.
9. Valida el gate en el entorno destino mediante un health check protegido del proveedor de hosting. Si falta algo, espera `503` y un mensaje generico; no corrijas poniendo secretos en el repositorio.
10. Solo despues de la aprobacion explicita del operador realiza el despliegue o cambia los secretos del entorno. Este repositorio no ejecuta ese paso.
11. Tras la activacion, el administrador aprueba manualmente el primer negocio y proyecto, define la fecha de servicio y prueba suspension/reactivacion con cuentas de prueba dedicadas.

### Migraciones y rollback

- Antes de migrar, genera y verifica un backup restaurable del PostgreSQL correcto.
- Revisa la migracion y su rollback correspondiente en `src/db/migrations/rollback/`.
- En staging, el runner requiere `ALLOW_STAGING_MIGRATION=true`; la ejecucion de produccion debe seguir el procedimiento aprobado por operaciones.
- Aplica migraciones en orden y verifica `ledgerharbour_schema_migrations`, tablas requeridas y conteos esperados.
- Si una verificacion falla, detiene la activacion, conserva los logs sin secretos y ejecuta el rollback aprobado solo despues de confirmar el impacto y el backup.
- La migracion de plataforma es `0002_platform_control_plane`; los cambios posteriores de ciclo, membresias y proyectos deben respetar sus rollback versionados.
- No uses `DROP`, `TRUNCATE` ni cambios destructivos como rollback improvisado. Una migracion destructiva requiere confirmacion explicita adicional.

## Controles recurrentes

Las comprobaciones de esta seccion son controles de seguimiento y no ejecutan cambios por si mismas. Una revision recurrente debe dejar un registro redactado antes de etiquetar un control externo como `verified`; si no existe evidencia read-only suficiente, conserva el estado `unverified`. Ninguna revision autoriza cambios de credenciales, billing, solicitudes OCR ni remediacion; cada uno requiere aprobacion explicita del operador.

- **Cuotas y alertas de proveedores:** revisa por separado cuota, alerta de billing/presupuesto y riesgo de gasto para Google Document AI, Cloudflare R2 y Upstash Redis siguiendo [LH-005](provider-alerts-limits-checklist.md). Esta tarea no abre dashboards ni confirma valores actuales.
- **Scopes de credenciales:** comprueba el alcance minimo requerido para Document AI, R2 y Upstash mediante [LH-005](provider-alerts-limits-checklist.md). Un alcance no confirmado permanece `unverified`; cualquier cambio o rotacion requiere aprobacion explicita del operador.
- **PostgreSQL:** registra la existencia de un backup reciente y el estado de la secuencia de migraciones. No ejecutes migraciones ni rollback como parte de una revision recurrente; si se requiere una accion, aplica [Migraciones y rollback](#migraciones-y-rollback) con backup verificado y aprobacion explicita.
- **Health checks protegidos:** revisa el estado del production gate solo mediante el procedimiento aprobado por el operador y sin exponer secretos, headers, tokens ni detalles internos. La configuracion o correccion del entorno sigue siendo `operator-controlled`.
- **Suspension y recuperacion:** revisa periodicamente la necesidad de suspension manual, la evidencia de auditoria y la recuperacion controlada. Las acciones siguen los gates de [Suspension y recuperacion](#suspension-y-recuperacion) y requieren aprobacion operativa separada.

### Suspension y recuperacion

1. Desde el panel, un `platform_admin` confirma el motivo y suspende manualmente el negocio.
2. Comprueba que las rutas de negocio, proyectos, miembros y APIs devuelven denegacion generica sin borrar datos.
3. Revisa el evento de auditoria y conserva la fecha/motivo del servicio.
4. Tras resolver la causa, reactiva manualmente, confirma la fecha de servicio y repite una operacion no destructiva con una cuenta autorizada.

La fecha `serviceExpiresAt` es informativa en esta version; no dispara suspension automatica ni sustituye una decision del administrador.

## No hacer

- No despliegues ni ejecutes migraciones productivas desde esta tarea.
- No escribas secretos reales en `.env.example`, tests, reportes, issues o logs.
- No actives billing ni ejecutes una solicitud real de Document AI como parte de la verificacion local.
- No uses cuentas de produccion en Playwright.
