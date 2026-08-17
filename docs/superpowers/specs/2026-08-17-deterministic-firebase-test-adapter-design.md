# Adaptador Firebase determinista para pruebas

## Objetivo

Cerrar el boundary de autenticación y administración de plataforma para que una
identidad de desarrollo nunca pueda reclamar un administrador global, mientras
Playwright conserva un flujo determinista sin Firebase real ni un endpoint de
claim público.

El alcance excluye paneles y proyectos.

## Diseño

### Identidad discriminada

`AuthIdentity` incorpora `provider: "firebase" | "development"`. El
`FirebaseAuthProvider` emite `firebase` y `DevAuthProvider` emite `development`.
Las construcciones de prueba y fixtures existentes se actualizan explícitamente
para conservar el boundary tipado sin cambiar la forma pública de los demás
campos.

### Firebase de prueba

Se agrega un adapter compatible con `FirebaseAdminAuth` y sesiones, determinista
por email, que sólo puede construirse cuando `NODE_ENV=test` o cuando el harness
de Playwright ejecuta el servidor bajo ese entorno. La factory de producción
seguirá usando Firebase Admin real y fallará cerrado si faltan credenciales.

El adapter no agrega ruta HTTP, allowlist, rango de IDs, cookie de desarrollo ni
texto de demo. Playwright usará `AUTH_MODE=firebase` y la configuración pública
de Firebase de prueba; la selección del adapter será una dependencia interna del
harness, no una capacidad expuesta por la aplicación.

### Claim y autorización

El claim seguirá siendo una operación interna one-time. Sólo acepta una
identidad cuyo `provider` sea `firebase` y `emailVerified` sea `true`. Busca el
bootstrap por email normalizado y enlaza mediante un `UPDATE` condicional que
requiere miembro activo y `user_id IS NULL`; la carrera pierde de forma segura.

`requirePlatformMember` resolverá primero el usuario local y autorizará sólo un
`platform_member` activo cuyo `user_id` corresponda a ese usuario. No autoriza
por email, provider ID, allowlist ni IDs preconfigurados. La primera solicitud
válida puede ejecutar el claim interno; las solicitudes posteriores usan sólo el
enlace persistido.

### Unicidad de email

PostgreSQL mantiene un índice único sobre `users.normalized_email` y el adapter
en memoria conservará índices por provider ID y por email normalizado. Un email
normalizado no podrá materializar dos usuarios locales. Las pruebas cubrirán
normalización, estabilidad por provider y conflicto entre providers.

## Flujo de datos

1. El login determinista produce una identidad `provider: "firebase"`.
2. La frontera de tenancy crea o resuelve el usuario local respetando provider y
   email normalizado.
3. La primera operación de plataforma intenta el claim interno sólo si la
   identidad es Firebase verificada.
4. El repositorio enlaza el registro bootstrap con un `UPDATE` atómico.
5. La autorización consulta únicamente el `user_id` enlazado.

## Errores y seguridad

- DevAuthProvider siempre produce `provider: "development"` y queda excluido del
  claim incluso con email verificado.
- `LEDGERHARBOUR_TEST_MODE` no habilita autenticación ni claim.
- Firebase de producción no acepta el adapter determinista.
- No se crea endpoint de claim ni se envían tokens, secretos o IDs de prueba en
  DTOs.
- Las carreras de claim devuelven denegación/conflicto sin sobreescribir el
  enlace existente.

## Verificación

TDD en rondas: pruebas RED focalizadas para discriminante, adapter, rechazo de
DevAuthProvider y `LEDGERHARBOUR_TEST_MODE`, claim Firebase verificado,
unicidad de email y ausencia de endpoint/allowlist; implementación GREEN;
regresión completa; E2E Playwright con Firebase determinista; `tsc`, lint, build
y audit. El informe final se agrega como `Fix Round 3` con comandos y resultados
reales.
