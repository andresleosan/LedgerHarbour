# Staging Privada y Gates de Produccion

## Objetivo

Preparar una primera instalacion de staging privada, reproducible y reversible
para LedgerHarbour. El entorno debe reemplazar los dobles locales de
persistencia y autenticacion sin habilitar aun produccion publica ni billing
sin confirmacion explicita del operador.

## Alcance aprobado

- Neon PostgreSQL como persistencia durable de staging.
- Firebase Authentication como identidad productiva de staging.
- Cloudflare R2 como storage privado de documentos.
- Upstash Redis como store durable para rate limiting serverless.
- Google Document AI Invoice Parser como proveedor OCR real.
- Vercel como hosting de staging, separado de cualquier entorno productivo.
- GitHub Actions con comandos `corepack pnpm` como gate obligatorio.

Fuera de alcance: despliegue a produccion, migracion destructiva, dominio
publico, billing no aprobado, SMS auth, facturacion del producto y borrado de
objetos locales durante la primera migracion.

## Arquitectura

LedgerHarbour conserva el monolito modular Next.js. Los servicios de negocio
siguen consumiendo `AuthProvider`, `StorageAdapter`, `OcrProvider` y los
repositorios, sin importar SDKs de proveedores directamente.

El modo de ejecucion queda separado por entorno:

| Entorno | Persistencia | Auth | Storage | OCR |
|---|---|---|---|---|
| Local | `memory` | development HMAC | local privado | Fake OCR |
| Staging | `postgres` | Firebase ID token | R2 privado | Document AI |
| Produccion futura | `postgres` | Firebase ID token | R2 privado | Document AI |

No existe fallback silencioso entre modos. Si falta una variable obligatoria de
staging, el proceso falla cerrado durante el arranque o la operacion concreta.

## Secuencia de entrega

1. Resolver `pnpm audit`, fijando versiones parcheadas sin aceptar una
   actualizacion mayor sin pruebas completas.
2. Validar el SQL contra PostgreSQL nativo y crear un comando de migracion
   versionado para una base descartable.
3. Ejecutar una migracion inicial no destructiva en Neon staging con snapshot
   previo y prueba de restauracion.
4. Implementar Firebase Admin en servidor y un provider cliente para el login;
   resolver cada `provider_uid` a un usuario local.
5. Implementar R2 con bucket privado y object keys generadas en servidor.
6. Implementar rate limiting Redis con ventanas y limites por operacion.
7. Implementar Document AI con timeout, un retry acotado con backoff y estado
   visible `failed` cuando el proveedor no responde.
8. Ejecutar contratos, seguridad, E2E, smoke de staging y prueba de rollback.

Cada paso debe mantener el entorno local funcionando con sus dobles actuales.

## Contratos de integracion

### PostgreSQL

- `DATABASE_URL` es obligatorio cuando `PERSISTENCE_MODE=postgres`.
- Las migraciones se ejecutan desde un comando explícito, nunca desde el
  render de una página o una petición HTTP.
- Se conservan foreign keys, constraints de tenant y transacciones de
  aprobación de facturas y membresías.
- El rollback inicial es volver a la imagen anterior y restaurar el snapshot;
  no se usan `DROP`, `TRUNCATE` ni conversiones destructivas.

### Firebase Auth

- El cliente obtiene un ID token; el servidor valida firma, issuer, audience,
  expiración y `uid` mediante Firebase Admin.
- El dominio recibe `AuthIdentity`, no un objeto Firebase.
- La cookie HMAC de desarrollo solo se acepta con `AUTH_MODE=development`.
- Un token inválido recibe `401`; no se crea un usuario local parcialmente.
- Los logs nunca incluyen tokens, cookies ni claims completos.

### R2

- El bucket de staging es privado.
- La object key la genera el servidor y no se acepta una ruta enviada por el
  cliente.
- Las descargas repiten autorización tenant-aware antes de leer el objeto.
- Un fallo de R2 no confirma una subida ni deja un documento con estado
  ambiguo; se devuelve un error estable y se registra un identificador de
  correlación.

### Rate limiting

- Redis es el store compartido; no se usa memoria de proceso como protección de
  staging.
- Límites iniciales: login por IP y cuenta, upload por identidad y negocio,
  OCR por identidad y documento, y APIs públicas por IP.
- La respuesta limitada es `429` con `Retry-After` y no revela si una cuenta
  existe.
- Si Redis está caído, las rutas sensibles fallan cerrado; las páginas públicas
  pueden continuar sin operaciones mutables.

### Google Document AI

- El cliente recibe bytes del documento validado y devuelve el contrato interno
  de OCR; no decide permisos, estados financieros ni aprobación.
- Timeout por petición, un retry máximo con backoff y tamaño/páginas limitados.
- Respuesta malformada o confianza ausente se trata como fallo controlado.
- El documento original permanece privado; los logs contienen solo ids,
  tamaños, duración y estado, nunca el contenido ni texto extraído completo.
- Fake OCR queda disponible solo para local y fixtures de prueba.

## Seguridad y datos

- Las credenciales se inyectan como secretos de Vercel/GitHub, nunca en Git,
  `.env.example`, fixtures o logs.
- Cada proveedor tendrá credenciales de staging separadas y mínimo privilegio.
- Los datos de staging serán sintéticos o explícitamente autorizados; no se
  cargarán facturas reales hasta definir retención y borrado.
- Se conservan las matrices de upload, tenant isolation, permisos y descarga
  no autorizada.
- El acceso a staging queda protegido por Vercel Preview Protection o una
  barrera equivalente antes de aceptar usuarios externos.

## Costos y gates del operador

- Neon, Firebase, R2 y Vercel se mantienen dentro de sus free tiers mientras
  sea posible, pero sus cuotas no equivalen a un límite de gasto.
- Upstash y Document AI pueden generar cargos por uso; se requiere verificar
  precio vigente, alerta y límite antes de activar sus credenciales.
- No se crea una cuenta, activa billing ni añade una tarjeta desde este plan.
- Antes de cada integración externa el operador debe confirmar que acepta el
  proveedor, el tratamiento de datos y el límite mensual.

## Pruebas y aceptación

- Unitarias e integración: contrato de cada adapter y errores de proveedor.
- PostgreSQL real: migración desde cero, constraints, transacciones y restore
  de snapshot en base descartable.
- Contratos: Firebase token valido/invalido, R2 key privada, Redis `429`, OCR
  timeout/malformed response y reintento único.
- Seguridad: aislamiento tenant, autorización por capability, upload firmado
  por contenido, no exposición de secretos y no logs de documentos.
- E2E staging: login Firebase, creación de negocio, upload R2, OCR Document AI,
  revisión, aprobación, descarga autorizada y bloqueo cross-tenant.
- Rendimiento: latencia p95 de login, upload, revisión y OCR; concurrencia
  mínima definida antes de abrir la staging.
- Operación: smoke post-deploy, health check, logs con correlation id, alerta
  de errores y rollback ensayado.

## Criterio de salida

Staging se considera lista para validación interna solo cuando todas las pruebas
anteriores pasan, `pnpm audit` no deja vulnerabilidades altas sin excepción
aprobada, existe snapshot restaurable y el operador confirmó los límites de
costo. Esto no autoriza producción.
