# Gate de activacion de produccion

La aplicacion no debe tratarse como produccion hasta completar todos los pasos de esta lista. El middleware devuelve `503` generico cuando el contrato esta incompleto. No hay fallback silencioso a auth de desarrollo, fake OCR, memoria, storage local o rate limiting local.

## Contrato obligatorio

Configura en el gestor de secretos del entorno, nunca en Git:

- Modos exactos: `AUTH_MODE=firebase`, `OCR_PROVIDER=google-document-ai`, `PERSISTENCE_MODE=postgres`, `STORAGE_MODE=r2`, `RATE_LIMIT_MODE=upstash`.
- Base: `DATABASE_URL`.
- Firebase privado: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
- Firebase publico: `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`.
- R2: `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- Upstash: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- Document AI: `GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`.

El gate solo comprueba presencia no vacia y los modos. Cada adapter agrega sus validaciones de formato, HTTPS, IAM y credenciales. Ningun error debe imprimir valores de entorno.

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

## Migraciones y rollback

- Antes de migrar, genera y verifica un backup restaurable del PostgreSQL correcto.
- Revisa la migracion y su rollback correspondiente en `src/db/migrations/rollback/`.
- En staging, el runner requiere `ALLOW_STAGING_MIGRATION=true`; la ejecucion de produccion debe seguir el procedimiento aprobado por operaciones.
- Aplica migraciones en orden y verifica `ledgerharbour_schema_migrations`, tablas requeridas y conteos esperados.
- Si una verificacion falla, detiene la activacion, conserva los logs sin secretos y ejecuta el rollback aprobado solo despues de confirmar el impacto y el backup.
- La migracion de plataforma es `0002_platform_control_plane`; los cambios posteriores de ciclo, membresias y proyectos deben respetar sus rollback versionados.
- No uses `DROP`, `TRUNCATE` ni cambios destructivos como rollback improvisado. Una migracion destructiva requiere confirmacion explicita adicional.

## Suspension y recuperacion

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
