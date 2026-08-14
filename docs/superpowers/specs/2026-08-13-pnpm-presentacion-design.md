# pnpm y entrada presentable de LedgerHarbour

## Objetivo

Dejar un flujo local reproducible con `pnpm` y convertir la ruta `/`, que hoy es
un bootstrap temporal, en una entrada que permita presentar el producto sin
ocultar las rutas funcionales existentes.

## Alcance

- Declarar `pnpm` como gestor oficial en `package.json`.
- Generar un unico lockfile de pnpm y retirar el lockfile de npm.
- Actualizar comandos de desarrollo, pruebas, build y documentacion para usar
  `pnpm`.
- Reemplazar `src/app/page.tsx` por una landing publica responsive con enlaces
  a `/login` y `/register`.
- Usar solo datos y texto sinteticos en la landing; no requiere base de datos ni
  credenciales externas.

## Diseno visual

- Paleta: azul noche para confianza financiera, blanco humo para superficies,
  verde teal para acciones y estados positivos, y amarillo suave para destacar
  OCR y automatizacion.
- Tipografia: conservar la tipografia ya configurada por el proyecto para no
  introducir una dependencia externa durante esta tarea.
- Layout: hero compacto con una accion principal, seguido por tres capacidades
  concretas y una franja final de llamada a la accion.
- Firma: una vista de "flujo de control" que conecta factura, OCR y reporte en
  una sola linea visual, en lugar de una grilla generica de marketing.

## Flujo

1. El visitante abre `/` y entiende en una pantalla que controla facturas,
   negocios y reportes.
2. El CTA principal lleva a `/login`, donde se conserva el proveedor de
   desarrollo existente.
3. El CTA secundario lleva a `/register`.
4. Las rutas de onboarding y portfolio permanecen sin cambios funcionales.

## Errores y seguridad

- La landing no procesa entradas ni muestra datos sensibles.
- Los enlaces usan rutas internas estables y no dependen de JavaScript para
  navegar.
- El copy no presenta el modo de desarrollo como autenticacion de produccion.
- No se agregan secretos, APIs de pago ni persistencia nueva.

## Verificacion

- `pnpm install --frozen-lockfile` despues de generar el lockfile.
- `pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit` y `pnpm build`.
- `pnpm test:e2e` con la configuracion de desarrollo existente.
- Comprobacion manual de `/`, `/login` y `/register` con foco de teclado y
  viewport movil.
