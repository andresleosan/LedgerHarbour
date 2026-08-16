# Rate limiting

Las acciones de login y registro usan `enforceAuthRateLimit` con una ventana fija de 10 intentos por 5 minutos por IP y, en email, por IP + correo normalizado.

## Modos

- `RATE_LIMIT_MODE=memory`: desarrollo y pruebas. No ofrece protección distribuida entre instancias serverless.
- `RATE_LIMIT_MODE=upstash`: staging/produccion. Requiere `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`; usa Redis compartido con `@upstash/ratelimit`.
- Un modo invalido o Upstash sin credenciales falla cerrado y devuelve un error generico de autenticacion.

## Operacion y costo

Upstash Redis tiene un free tier suficiente para una prueba de bajo volumen, pero sus limites y precios pueden cambiar. Antes de activarlo se deben configurar alertas de billing y verificar el plan. No se reintentan indefinidamente los limites ni se registran IPs, tokens o contraseñas en logs.
