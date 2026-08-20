# LH-002 E2E Console Error Gate

**Fecha:** 2026-08-20
**Estado:** Aprobada

## Objetivo

Hacer que toda la suite Playwright falle cuando una pagina produzca `console.error` o `pageerror`. El objetivo es impedir que un flujo E2E aparezca verde mientras React, el runtime del navegador o una pagina generan errores visibles.

## Alcance

El gate se aplica a toda la suite bajo `tests/e2e`, incluyendo login, onboarding, shell autenticado, documentos, invoices, tenancy, plataforma, branding y smoke tests.

No cambia la aplicacion, sus APIs, el servidor de pruebas ni el comportamiento de negocio. No corrige el warning de `allowedDevOrigins`; ese trabajo pertenece a `LH-006`.

## Causa actual

Los specs importan `test` directamente desde `@playwright/test` y crean paginas de varias formas:

- `browser.newPage()`.
- `browser.newContext()` seguido de `context.newPage()`.
- Contextos creados en helpers.

`playwright.config.ts` no define listeners de consola y no existe un fixture compartido. Un listener agregado solo al fixture `page` no cubriria los contextos y paginas creados directamente por los specs.

## Arquitectura

Crear `tests/e2e/fixtures.ts` como frontera unica de pruebas:

- Reexportar `expect` desde Playwright.
- Exportar un `test` custom con un fixture de browser diagnostico.
- Envolver `browser.newPage()` y `browser.newContext()`.
- Registrar listeners en cada `BrowserContext` y cada `Page` creada.
- Al finalizar cada test, convertir cualquier diagnostico en un fallo con ruta y mensaje seguro.

Los specs migran su import de `@playwright/test` al fixture local. Los helpers que tipan `Page` pueden importar el tipo desde `@playwright/test`, pero cualquier test que use el fixture `test` debe usar el export local.

El tracker sera una unidad separada y pura para poder probarlo sin browser real:

```ts
export interface BrowserDiagnostic {
  kind: "console.error" | "pageerror";
  url: string;
  message: string;
}

export function createBrowserDiagnostics(): {
  recordConsoleError(url: string, message: string): void;
  recordPageError(url: string, message: string): void;
  assertClean(): void;
}
```

La implementacion debe conservar diagnosticos en memoria de un test y fallar con un mensaje agregado. El mensaje solo incluira URL, tipo y texto del error; no serializara cookies, headers, localStorage, HTML completo, tokens ni cuerpos de requests.

## Flujo de datos

1. Un spec obtiene el fixture `browser` del `test` local.
2. El wrapper crea un contexto o pagina real.
3. Cada pagina registra `console` y `pageerror`.
4. Los errores se agregan al tracker del test actual.
5. El teardown del fixture llama `assertClean()` despues del cuerpo del test.
6. Si hay diagnosticos, Playwright marca el test como fallido y muestra ruta, tipo y mensaje.

La captura no intercepta `console.log`, `console.info`, `console.warn`, requests HTTP ni eventos de red. No hay excepciones iniciales: cualquier `console.error` o `pageerror` es un fallo hasta que un cambio aprobado documente una excepción concreta.

## Pruebas

Crear pruebas unitarias del tracker antes del codigo productivo:

- Un tracker limpio no lanza.
- Un `console.error` sintetico hace fallar `assertClean()`.
- Un `pageerror` sintetico hace fallar `assertClean()`.
- El mensaje incluye tipo, URL y texto, pero no recibe ni serializa datos sensibles.

Agregar una prueba E2E o de fixture que demuestre que el wrapper realmente conecta listeners a paginas creadas con `browser.newPage()` y contextos creados con `browser.newContext()`.

La suite completa debe correr despues de migrar todos los imports. La prueba debe producir un fallo controlado ante un diagnostico sintetico; la inyeccion sintetica no debe quedar en los tests normales de produccion.

Verificacion requerida:

```text
corepack pnpm vitest run tests/unit/e2e/browser-diagnostics.test.ts
corepack pnpm test
corepack pnpm lint
corepack pnpm exec tsc --noEmit
corepack pnpm build
corepack pnpm test:e2e
```

El resultado esperado es cero errores de consola y cero `pageerror` en la suite real. El warning `allowedDevOrigins` se mantiene como pendiente separado de `LH-006` y no debe convertirse en una excepcion silenciosa de este gate.

## Seguridad y privacidad

- No se guardan cookies, tokens, storage state ni cuerpos de respuesta en el diagnostico.
- Los errores se truncan a una longitud segura definida por el tracker antes de agregarse al mensaje del test.
- No se imprimen variables de entorno ni secretos.
- Los reportes HTML y traces siguen las reglas existentes de `.gitignore`.
- Si una biblioteca externa emite un error benigno, primero debe documentarse su origen y contenido; no se agrega una excepcion generica.

## Estado de tarea

Al iniciar implementacion, `LH-002` cambia de `pendiente` a `en progreso` en `tasks.md`. Despues del cambio de imports y pruebas focalizadas pasa a `revision`. Solo pasa a `aprobada` con seguridad, suite completa, lint, typecheck, build y E2E limpios. `desplegada` requiere commit, deployment y verificacion autorizados.

## Rollback

Revertir el commit de LH-002 y restaurar imports desde `@playwright/test` elimina el gate sin tocar codigo de aplicacion, datos o configuracion productiva.

## Fuera de alcance

- Corregir errores de consola encontrados por el nuevo gate.
- Resolver `allowedDevOrigins`.
- Capturar warnings o logs informativos.
- Agregar excepciones antes de conocer un error concreto.
- Cambiar `playwright.config.ts` salvo que el fixture necesite una integracion minima y justificada.
