# Storage privado R2

El adapter `R2PrivateStorage` usa la API S3-compatible de Cloudflare R2 detrás del contrato interno `StorageAdapter`.

## Configuración

Staging requiere estas variables no versionadas:

- `STORAGE_MODE=r2`
- `R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`
- `R2_BUCKET_NAME=ledgerharbour`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Las credenciales deben tener solo permisos sobre el bucket privado de LedgerHarbour. Nunca se generan URLs públicas ni se registran credenciales o claves de objeto en logs.

## Comportamiento ante fallas

- Una subida solo devuelve éxito después de que R2 confirma `PutObject`.
- Un error de R2 se propaga al servicio de documentos, que conserva el documento sin confirmar la operación.
- No hay reintentos automáticos en el adapter: las subidas son operaciones de request y los reintentos deben pertenecer al job que las invoque, con límite explícito.
- `STORAGE_MODE=local` mantiene el fallback local únicamente para desarrollo y pruebas. R2 falla cerrado si faltan variables requeridas.
- El cliente S3 usa `maxAttempts=1`; no reintenta automáticamente una subida o descarga. Los reintentos de una operación de negocio deben pertenecer al job que la invoque, con límite explícito.

## Seguridad

Las claves de objeto son generadas por el servidor y se rechazan rutas absolutas, separadores Windows y segmentos `.` o `..`. El bucket debe permanecer privado y las descargas deben seguir pasando por autorización de tenant.
El endpoint R2 debe usar HTTPS; una configuración insegura falla antes de crear el cliente.
