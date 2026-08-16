# Firebase Authentication

Cuando `AUTH_MODE=firebase`, el cliente usa Firebase Web SDK para email/password y Google popup. El servidor nunca confia en la identidad enviada por el navegador: verifica el ID token con Firebase Admin y crea una cookie de sesión HttpOnly independiente de `ledgerharbour_dev_session`.

## Variables

- Servidor: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
- Cliente público: `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`.

Las credenciales Admin solo se cargan en Vercel como variables privadas. Las variables `NEXT_PUBLIC_*` no son secretos y deben corresponder al mismo proyecto Firebase.

## Operación y fallas

- Email/password y Google usan `verifyIdToken(..., true)` y una cookie de sesión de cinco días.
- `signOut` elimina la cookie; una cookie inválida o revocada se descarta y devuelve identidad nula.
- Una configuración incompleta o un token inválido falla de forma genérica, sin exponer detalles del proveedor.
- No hay reintentos automáticos para autenticación; el usuario puede reintentar la operación desde la UI.

Antes de activar staging se deben habilitar Email/Password y Google en Firebase Authentication, registrar el dominio de Vercel como autorizado y cargar las variables privadas en Vercel.
