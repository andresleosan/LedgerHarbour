# Administracion de plataforma

Este documento describe el bootstrap controlado de los administradores globales y la operacion manual del control plane. No agrega una allowlist de emails al codigo, no contiene secretos y no autoriza una migracion productiva por si solo.

## Bootstrap inicial

El registro `platform_members` es la fuente de autorizacion global. La identidad Firebase verificada se vincula al registro por email normalizado en el primer acceso; el frontend nunca puede crear un administrador global.

1. Confirma que la base apunta al entorno correcto y que el backup verificable de ese entorno existe.
2. Confirma que la migracion `0002_platform_control_plane` esta aplicada y que `platform_members` y `platform_audit_events` existen.
3. Ejecuta el bootstrap con una lista explicita de emails del operador. En produccion el argumento `--emails` es obligatorio:

   ```text
   corepack pnpm exec tsx scripts/db/bootstrap-platform-admins.ts --emails "admin-uno@example.com,admin-dos@example.com"
   ```

4. Comprueba el resultado idempotente y verifica los registros en la base sin copiar datos sensibles a tickets o logs.
5. Cada administrador inicia sesion con Firebase y confirma que su email esta verificado. La entrada queda activa solo si el registro global esta activo.

No uses `PLATFORM_ADMIN_EMAILS` como fallback en produccion. Ese camino solo existe para `development`, `test` o `staging` cuando `PLATFORM_ADMIN_BOOTSTRAP=true`.

## Verificacion de identidad Firebase

- Habilita Email/Password y Google solo en el proyecto Firebase del entorno.
- Registra los dominios autorizados del entorno y comprueba que las cuatro variables `NEXT_PUBLIC_FIREBASE_*` apunten al mismo proyecto que `FIREBASE_PROJECT_ID`.
- Comprueba en Firebase que la cuenta operadora tiene email verificado.
- Verifica que el servidor usa `FIREBASE_CLIENT_EMAIL` y `FIREBASE_PRIVATE_KEY` privados; no los expongas al cliente.
- Confirma que logout elimina la sesion Firebase y la cookie de servidor antes de probar una segunda cuenta.

## Operacion manual

La version actual no tiene gateway de pagos ni suspension automatica por fecha. El administrador global debe:

- aprobar o rechazar negocios y proyectos pendientes;
- definir `serviceExpiresAt` al activar un negocio;
- suspender manualmente un negocio si el servicio no debe seguir activo;
- reactivar manualmente despues de verificar la condicion operativa;
- registrar un motivo en cada accion que lo requiera y revisar el audit trail.

Suspender conserva datos historicos, pero deniega el acceso efectivo del negocio, sus miembros, proyectos y APIs. Reactivar no borra la auditoria ni cambia permisos fuera del alcance de la accion.

## Seguridad operativa

- Las mutaciones globales siempre pasan por autorizacion server-side y rate limiting Upstash en produccion.
- Las respuestas de listados no contienen claves privadas de R2, tokens, service-account JSON ni bytes de documentos.
- No desactives el registro append-only de `platform_audit_events`.
- Si se sospecha una credencial expuesta, rota la credencial en el proveedor antes de volver a activar el entorno; editar `.env.example` no revoca una clave.
