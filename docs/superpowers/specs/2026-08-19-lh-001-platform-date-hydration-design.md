# LH-001 Platform Date Hydration

**Fecha:** 2026-08-19
**Estado:** Diseno aprobado; pendiente de implementacion

## Objetivo

Eliminar el error de hidratacion React `#418` del panel global haciendo que las fechas de plataforma se rendericen con una zona horaria determinista. El panel usara UTC porque representa datos globales y no debe cambiar segun la ubicacion del operador.

## Causa raiz

`PlatformAdminPanel` ejecuta `Intl.DateTimeFormat` sin `timeZone`. El componente cliente tambien se renderiza en el servidor, por lo que Vercel usa su zona UTC y el navegador vuelve a calcular el texto con su zona local.

La reproduccion confirmada usa `2026-08-16T01:53:13.139Z`:

- UTC: `16 Aug 2026`.
- `America/Bogota`: `15 Aug 2026`.

El HTML del servidor y el primer render del navegador contienen dias distintos. React detecta la diferencia de texto durante hidratacion y emite `#418`.

## Arquitectura

Crear `src/ui/platform/platform-date.ts` con una unica funcion pura:

```ts
export function formatPlatformDate(
  value: string | null,
  locale: SupportedLocale,
): string
```

La funcion:

- devuelve `"\u2014"` para `null`;
- usa `en-GB` cuando `locale` es `en`;
- usa `es-ES` cuando `locale` es `es`;
- configura `dateStyle: "medium"` y `timeZone: "UTC"`;
- conserva el `RangeError` actual si recibe una fecha invalida.

`PlatformAdminPanel` elimina su helper local `dateFor` e importa `formatPlatformDate`. No cambia la forma de los DTOs, no preformatea datos en el servidor y no agrega estado React.

## Flujo de datos

1. Los repositorios y servicios siguen entregando timestamps ISO sin cambios.
2. El Server Component entrega los DTOs al panel global.
3. El render de servidor llama `formatPlatformDate` con UTC.
4. La hidratacion del navegador llama la misma funcion con UTC.
5. Ambos renders producen exactamente el mismo texto para el mismo valor y locale.

## Manejo de errores

- `null` conserva el estado visual sin fecha.
- Una cadena invalida no se convierte silenciosamente en un valor alternativo; mantiene el fallo actual de `Intl.DateTimeFormat`.
- No se registran timestamps, identidades ni datos de negocio adicionales.
- No hay llamadas externas, reintentos ni cambios de persistencia.

## Pruebas

Crear `tests/unit/platform/platform-date.test.ts` antes del modulo productivo.

Casos obligatorios, ejecutados con `process.env.TZ` temporalmente fijado en `America/Bogota` y restaurado al terminar:

- El timestamp limite `2026-08-16T01:53:13.139Z` produce el dia 16 en ingles.
- El mismo timestamp produce el dia 16 en espanol.
- `null` devuelve `"\u2014"`.
- Una fecha invalida conserva el error en lugar de ocultarlo.

La prueba debe fallar primero por ausencia del modulo. Luego debe pasar con el formateador UTC. La mutacion mental minima es quitar `timeZone: "UTC"`; como el test fija `America/Bogota`, el caso limite debe volver a producir el dia 15 incluso cuando CI se ejecute en UTC.

Verificacion requerida:

```text
corepack pnpm vitest run tests/unit/platform/platform-date.test.ts
corepack pnpm vitest run tests/unit/platform tests/unit/auth
corepack pnpm test
corepack pnpm lint
corepack pnpm exec tsc --noEmit
corepack pnpm build
corepack pnpm exec playwright test tests/e2e/platform/admin-panel.spec.ts
```

La verificacion de navegador debe observar `/admin` sin `console.error` ni `pageerror`. La comprobacion productiva se realiza solo despues de autorizacion explicita para publicar.

## Estado de tarea

Al iniciar implementacion, `LH-001` cambia de `pendiente` a `en progreso` en el resumen y detalle de `tasks.md`. Despues de implementar pasa a `revision`; solo cambia a `aprobada` con autocritica, pruebas y revision limpias. `desplegada` requiere commit, deployment y verificacion productiva autorizados.

## Rollback

Revertir el import del modulo y restaurar el helper local elimina el cambio de presentacion. No hay rollback de datos, esquema, providers o configuracion.

## Fuera de alcance

- Elegir una zona horaria por usuario o negocio.
- Cambiar timestamps almacenados.
- Cambiar `serviceExpiresAt` o reglas de ciclo de vida.
- Agregar el gate global de consola de `LH-002`.
- Corregir otros formatos de fecha fuera del panel global.
