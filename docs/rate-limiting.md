# Rate limiting

Las acciones de login y registro usan `enforceAuthRateLimit` con una ventana fija de 10 intentos por 5 minutos por IP y, en email, por IP + correo normalizado.

## Modos

- `RATE_LIMIT_MODE=memory`: desarrollo y pruebas. No ofrece protección distribuida entre instancias serverless y no es aceptable para producción.
- `RATE_LIMIT_MODE=postgres`: staging/producción. Requiere `DATABASE_URL`, `RATE_LIMIT_KEY_SECRET` y la migración `0007_rate_limit_windows`; usa un `UPSERT` atómico en Neon/PostgreSQL.
- Un modo inválido, una tabla ausente o un error de PostgreSQL falla cerrado y devuelve un error genérico de protección.

Las claves se almacenan como HMAC-SHA-256 usando `RATE_LIMIT_KEY_SECRET`; nunca se persisten IPs, correos, tokens ni contraseñas en texto claro.

## Endpoints autenticados

- Upload usa un bucket individual de `10` solicitudes por `5 minutos` y un bucket agregado por dirección de `20` solicitudes por `5 minutos`.
- OCR process usa un bucket individual de `5` solicitudes por `5 minutos` y un bucket agregado por dirección de `10` solicitudes por `5 minutos`.
- Ambos buckets deben permitir la request: la clave individual combina `AuthIdentity.providerUserId` y dirección; la agregada combina sólo scope y dirección, sin identidad, IDs de ruta ni body.
- En test/desarrollo se usa la primera dirección disponible en `x-vercel-forwarded-for`, `x-forwarded-for` o `x-real-ip`. En production sólo se acepta `x-vercel-forwarded-for`; si falta se usa `edge-unknown`. Vercel/edge debe sobrescribir ese header antes de entregar la request.
- En `NODE_ENV=production`, cualquier modo distinto de `RATE_LIMIT_MODE=postgres` falla cerrado. El production gate exige `DATABASE_URL` y `RATE_LIMIT_KEY_SECRET` antes de atender requests.
- Cuando se excede el límite, las rutas devuelven `429` con un mensaje genérico antes de leer multipart o JSON. Si la configuración o PostgreSQL no están disponibles, devuelven `503` genérico y también fallan cerrado.

## Operación y costo

Neon Free no requiere tarjeta y ofrece cuota gratuita por proyecto. El limitador reutiliza la base PostgreSQL existente, por lo que no crea un servicio ni una factura nueva; sí consume consultas y cómputo dentro de la cuota del proyecto. [Neon Pricing](https://neon.com/pricing)

La tabla conserva como máximo la ventana actual por cada clave cuando esa clave vuelve a usarse. La limpieza global de ventanas antiguas debe ejecutarse como mantenimiento controlado antes de acercarse al límite de almacenamiento. No se reintentan indefinidamente los límites ni se escriben claves sin anonimizar en logs.

La base Upstash queda fuera del runtime y no debe activarse como ruta de producción.
