# Rate limiting

Las acciones de login y registro usan `enforceAuthRateLimit` con una ventana fija de 10 intentos por 5 minutos por IP y, en email, por IP + correo normalizado.

## Modos

- `RATE_LIMIT_MODE=memory`: desarrollo y pruebas. No ofrece protección distribuida entre instancias serverless.
- `RATE_LIMIT_MODE=upstash`: staging/produccion. Requiere `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`; usa Redis compartido con `@upstash/ratelimit`.
- Un modo invalido o Upstash sin credenciales falla cerrado y devuelve un error generico de autenticacion.

## Endpoints autenticados

- Upload usa un bucket separado de `10` solicitudes por `5 minutos`, con clave `AuthIdentity.providerUserId`.
- OCR process usa un bucket separado de `5` solicitudes por `5 minutos`, con la misma clave de identidad y sin incluir IDs de ruta ni body.
- En `NODE_ENV=production`, cualquier modo distinto de `RATE_LIMIT_MODE=upstash` falla cerrado. `memory` queda limitado a test/desarrollo.
- Cuando se excede el límite, las rutas devuelven `429` con un mensaje genérico antes de leer multipart o JSON.

## Operacion y costo

Upstash Redis tiene un free tier suficiente para una prueba de bajo volumen, pero sus limites y precios pueden cambiar. Antes de activarlo se deben configurar alertas de billing y verificar el plan. No se reintentan indefinidamente los limites ni se registran IPs, tokens o contraseñas en logs.
