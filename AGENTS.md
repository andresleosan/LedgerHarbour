# LedgerHarbour — instrucciones para agentes (Codex incluido)

Este repositorio avanza por una ruta de tareas. Cualquier agente que siga el trabajo empieza aquí.

## Antes de tocar nada

1. Trabaja en la copia de avance `/root/LedgerHarbour-avanzar`, rama `avanzar`. No edites, compiles ni pruebes en `/root/LedgerHarbour`: es la carpeta de `main` y guarda la configuración de la vista previa.
2. Lee, en este orden:
   - `docs/roadmap/AVANZAR.md`: el perfil del proyecto. Manda sobre todo lo demás: meta, comandos, qué cuenta como hecho, qué está autorizado y qué es privado.
   - `.claude/relevo-avanzar.md`: el estado exacto y el siguiente paso. Git lo ignora y no está en el repositorio.
   - `.claude/avanzar-privado.md`: las rutas privadas. Git lo ignora; nada de lo que señala entra en commits, fichas ni mensajes.
3. Mira la ruta: `node /root/.claude/skills/avanzar/scripts/ruta.mjs` (con el Node del perfil en el `PATH`). `--cola` genera `docs/roadmap/COLA.md`.

Las reglas completas del bucle están en `/root/.claude/skills/avanzar/SKILL.md`. Es un archivo de la máquina: léelo como texto aunque no puedas cargarlo como skill.

## Reglas que no se negocian

- Lo autorizado sin preguntar es solo lo que dice la tabla de `AVANZAR.md`: editar y probar en la copia de avance y hacer commits locales en `avanzar`. `git push`, PR, cambios en `main`, migraciones en una base real, gastos, credenciales y tocar contenedores o la red van a la cola, para el operador.
- El repositorio es público. Nunca entran el nombre del cliente, su libro, sus cifras ni nada copiado de la plantilla real. Las pruebas usan la plantilla sintética de `tests/fixtures/workbook/`.
- Nunca se imprimen valores de archivos `.env*`.
- Cada tarea es una ficha en `docs/roadmap/tasks/<ID>.json`. Al cerrar un lote: actualiza la ficha (estado, hecho, falta, evidencia con comando y resultado), añade una línea arriba de `docs/roadmap/ESTADO.md`, regenera `COLA.md` y sobrescribe el relevo.
- Mensajes de commit: Conventional Commits en inglés y minúsculas, como el historial.

## Trampas de esta máquina

- Usa el Node 26.12.1 de nvm: `export PATH="$HOME/.nvm/versions/node/v26.12.1/bin:$PATH"`, y después `corepack pnpm …`.
- Vitest: corre la suite con `--no-file-parallelism` y los archivos sueltos de uno en uno. Bajo carga, las pruebas de PGlite agotan sus 30 s; repite el archivo solo antes de culpar al cambio.
- Pruebas de navegador: borra `.next` antes si hubo un `pnpm build`. Córrelas por carpetas y repite sola la que falle; con la máquina saturada, Chromium cae con «Page crashed».
- La máquina se queda sin vigilantes de archivos, así que `next dev` necesita `WATCHPACK_POLLING=true`. Para eso hay dos auxiliares sin versionar en la raíz de la copia, `.playwright-alt.config.ts` y `.playwright-alt-server.ts`:
  `rm -rf .next; PLAYWRIGHT_HTML_OPEN=never LH_E2E_PORT=3101 flock /tmp/lh-e2e-3101.lock corepack pnpm exec playwright test --config .playwright-alt.config.ts tests/e2e/<carpeta> --reporter=line`
  En zsh, escribe las carpetas una a una: una variable con varias rutas no se parte.
