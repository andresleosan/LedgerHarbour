# Comprobar el acceso del propietario desde el escritorio

Abre este repositorio en GPT de escritorio con acceso a la terminal local. Puedes darle esta instrucción:

> Ejecuta la prueba local de este documento. Después, abre el login de producción en una ventana privada y pulsa el botón de Google. Déjame elegir la cuenta y completar el acceso. Retoma la prueba cuando vuelva a LedgerHarbour y dime si llegué automáticamente a la cartera y si se ve el negocio.

## 1. Prueba local que GPT puede ejecutar

Desde la raíz de una copia limpia, usa Node 26.12.1 y Corepack. Ejecuta:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e tests/e2e/platform/business-approval.spec.ts --project=chromium --reporter=line
```

Playwright arranca la app en el puerto local 3100 y usa cuentas sintéticas. El test crea un negocio, comprueba que está pendiente y lo aprueba con el administrador de prueba. Luego inicia una sesión nueva del propietario, abre `/auth/continue` y comprueba la redirección a `/portfolio` y el nombre del negocio en pantalla. El resultado esperado es `1 passed`. El adaptador local simula la identidad por correo. La comprobación de Google se hace en el paso 2.

## 2. Acceso real con Google desde el navegador local

1. GPT abre el [login de producción](https://ledgerharbour.pages.dev/login) en una ventana privada y pulsa el botón de Google.
2. El propietario toma el control del navegador, elige su cuenta de Google y completa allí la autenticación. Usa una cuenta que ya tenga un negocio aprobado y carezca del rol de administrador de plataforma. Una cuenta con ambos roles llega a `/admin` por diseño.
3. Al volver a la aplicación, GPT comprueba la ruta a la que llegó automáticamente, sin escribir `/portfolio` en la barra. Confirma que se ve el negocio esperado. Si el escritorio carece de control del navegador, el propietario puede compartir la ventana de LedgerHarbour después del acceso para que GPT verifique el resultado.
4. Informa por separado del resultado local y del acceso con Google. El acceso real pasa si la ruta es `/portfolio` y aparece el negocio. Si acaba en otra pantalla, registra solo la ruta sin parámetros. Si falta la cuenta o la interacción con Google, deja ese resultado como pendiente. Omite correos, nombres de negocios, credenciales y capturas en el informe.
