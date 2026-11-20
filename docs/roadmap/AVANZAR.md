# /avanzar en LedgerHarbour

Perfil del proyecto para la skill `/avanzar`. Es la única regla del bucle en este repositorio. El gobierno general sigue en [tasks.md](../../tasks.md).

## Meta

El dueño de un negocio fotografía sus facturas con el móvil y la app le devuelve el libro de cuentas anuales de su contable (una plantilla de Excel) relleno: cada movimiento en la hoja de su cuenta, con fecha, concepto, código e importe con signo, sin tocar las fórmulas. La app muestra además un resumen del ejercicio.

«Terminado» significa todas las tareas aplicables de `docs/roadmap/tasks/` hechas. Fuente: encargo del operador del 19-nov-2026. La redacción exacta de la meta es una lectura de ese encargo y está **por confirmar**.

## Copia de avance

- Carpeta `/root/LedgerHarbour-avanzar`, rama `avanzar`, que sigue a `origin/main`.
- `/root/LedgerHarbour` sirve la vista previa en vivo: allí no se edita, no se compila y no se corren pruebas.
- Ponerse al día: `git fetch origin && git merge --ff-only origin/main`. Si hay commits propios y `main` avanzó: `git merge origin/main`.
- Runtime: el Node de `engines` en `package.json` (hoy 26.12.1). En la VPS, cada comando empieza con `export PATH="$HOME/.nvm/versions/node/v26.12.1/bin:$PATH"`.

## Vista previa

Desde el 20-nov-2026 (LH-030) la vista previa del tailnet (`https://optimyze-vps-de-prod.tail29c816.ts.net:9470`) sirve la rama `avanzar` desde el worktree `/root/LedgerHarbour-preview`, en el contenedor `ledgerharbour-app` con Node 26 y el entorno de pruebas (datos en memoria, lector de facturas falso, acceso con cualquier correo; administrador `admin@ledgerharbour.test`). Su configuración está en `/root/LedgerHarbour/deploy/compose.yaml`, fuera del repositorio. Actualizarla a un commit nuevo o reiniciarla sigue sin estar autorizado al bucle: va a la cola.

## Producción

Desde el 20-nov-2026 el destino de LH-029 es Cloudflare Pages en `ledgerharbour.pages.dev` con un túnel privado a la app en la VPS. Tesseract sigue en la imagen y Firebase sigue gestionando el acceso. Consulta el [plan de activación](work/LH-029/cloudflare.md). Revisa la integración Git de Vercel antes de fusionar a `main`.

## Comandos

Todos desde la copia de avance.

| Para | Comando |
| --- | --- |
| Instalar, si falta `node_modules` o cambió el lockfile | `corepack pnpm install --frozen-lockfile` |
| Prueba focal | `corepack pnpm exec vitest run <archivo>` |
| Verificación de lote | `corepack pnpm lint && corepack pnpm exec tsc --noEmit && corepack pnpm exec vitest run --no-file-parallelism && corepack pnpm build` |
| Interfaz, a 390 px y 1280 px | `corepack pnpm test:e2e <spec>`; la primera vez, `corepack pnpm exec playwright install chromium` |
| Dependencia nueva | `corepack pnpm audit --audit-level high` |

Las pruebas van de un archivo en uno: en paralelo, las de PostgreSQL en memoria agotan su tiempo cuando la VPS está cargada y fallan sin que haya un error real.

Las pruebas de navegador arrancan `next dev` en el puerto 3100 y no arrancan si `.next` contiene un build de producción: córrelas antes de `pnpm build`, o borra `.next` antes (es salida generada). Solo cabe una ejecución a la vez en la máquina: con subagentes, `flock /tmp/lh-e2e.lock corepack pnpm test:e2e <spec>`.

Con la máquina cargada, la suite de navegador entera pierde pruebas por tiempo y por caídas de Chromium: córrela por carpetas y repite sola la que falle antes de culpar al cambio. Si `next dev` no arranca por falta de vigilantes de archivos (ENOSPC), el servidor de pruebas necesita `WATCHPACK_POLLING=true`.

Línea de partida del 19-nov-2026, sobre `0311fc8` con Node 26.12.1: lint, tipos y build correctos; 73 archivos de prueba pasados y 2 omitidos; 602 pruebas pasadas y 7 omitidas. Las pruebas de navegador no se han corrido aún en esta copia.

Una tabla o migración nueva obliga a actualizar las pruebas que fijan la lista de tablas y el orden de migraciones, el ejecutor de migraciones y el cargador de PGlite: búscalos por el nombre de la última migración.

## Qué cuenta como hecho aquí

Un commit en la rama `avanzar` con la verificación de lote pasada y la evidencia en la ficha. Publicar no forma parte de cada tarea: va junto en [LH-029](tasks/LH-029.json).

## Autorizado sin preguntar

| Qué | Desde | Condiciones |
| --- | --- | --- |
| Editar, probar y compilar en la copia de avance | 19-nov-2026 | Nunca en `/root/LedgerHarbour`. |
| Commits locales en la rama `avanzar` | 19-nov-2026, por confirmar | Solo archivos propios, pruebas del lote pasadas, mensajes como los del historial: Conventional Commits en inglés y minúsculas. |
| Trabajar sin parar entre tareas y lotes | 19-nov-2026, por confirmar | Decidir con este perfil, los specs y la opción más simple y reversible. Fuente anotada en la ficha. |
| Escribir migraciones y probarlas en PGlite | 19-nov-2026, por confirmar | Solo aditivas. No se aplican en ninguna base real. |
| Añadir una dependencia | 19-nov-2026, por confirmar | Versión actual, `pnpm audit` limpio y motivo en la ficha. |
| Instalar el Chromium de Playwright para las pruebas | 19-nov-2026, por confirmar | Solo esa herramienta. |

«Por confirmar» significa que vale mientras el operador no diga otra cosa: es la opción prudente que se tomó al adoptar el proyecto sin su respuesta.

Los archivos de la adopción (`docs/roadmap/` y la nota final de `tasks.md`) son del bucle y entran en el commit del primer lote.

## No autorizado: va a la cola

- `git push` de cualquier rama, pull requests y cambios en `main`. Mientras la integración Git de Vercel siga activa, un push a `main` puede iniciar un despliegue allí.
- Migraciones en la base de datos real, y cualquier cambio operativo en Cloudflare, Vercel, Neon, Firebase o Google Cloud.
- Facturación y cualquier gasto nuevo.
- Tocar `/root/LedgerHarbour`, los contenedores de la vista previa o la red de la VPS.
- Enviar facturas reales, la plantilla del contable o datos de un cliente a un servicio externo, incluida la lectura real de facturas.
- Borrar datos, cambiar credenciales o la configuración de Git.

Lo que no esté en ninguna de las dos listas y sea difícil de revertir o salga de la máquina se trata como no autorizado.

## Privado

El repositorio es público. No entran en commits, fichas ni mensajes: el nombre de ningún cliente, su libro, sus cifras, sus facturas ni sus proveedores, ni nada copiado de la plantilla real. Las pruebas usan una plantilla sintética generada por código. Las rutas de los archivos privados están en `.claude/avanzar-privado.md`, que Git ignora. Nunca se imprimen los valores de `.env*`.

## Fuentes para decidir

1. Este perfil.
2. La ficha y `docs/roadmap/work/<ID>/`.
3. `docs/superpowers/specs/` y `docs/superpowers/plans/`, `docs/adr/`, `docs/STACK.md` y [tasks.md](../../tasks.md).
4. El análisis de partida, privado.

## Dónde está cada cosa

| Qué | Dónde |
| --- | --- |
| Qué toca ahora | `node ~/.claude/skills/avanzar/scripts/ruta.mjs` |
| Ficha y evidencia de cada tarea | `docs/roadmap/tasks/<ID>.json` y `docs/roadmap/work/<ID>/` |
| Lo que espera a una persona | [COLA.md](COLA.md), generada desde las fichas |
| Mejoras que no bloquean | [MEJORAS.md](MEJORAS.md) |
| Registro de cierres | [ESTADO.md](ESTADO.md) |
