# LH-003 Safe Production Ordinary User Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear un runbook documental, ejecutable por un operador, para verificar que una identidad ordinaria de produccion llega a `/onboarding` y no accede a `/admin`, sin almacenar secretos ni ejecutar cambios de produccion.

**Architecture:** La entrega sera solo documental. `docs/production-ordinary-user-verification.md` contendra prerrequisitos, consulta read-only parametrizada, flujo manual de navegador, criterios de detencion, plantilla de evidencia y politica de reutilizacion/limpieza. No se agregaran fixtures, storage state, scripts con credenciales ni cambios en `src`.

**Tech Stack:** Markdown, PostgreSQL read-only console, Firebase Authentication manual, navegador aislado y evidencia redactada.

## Global Constraints

- Esta fase no crea, edita, promueve ni elimina identidades de produccion.
- Esta fase no cambia secretos, permisos, membresias, hosting ni configuracion de produccion.
- Esta fase no ejecuta migraciones, acciones de escritura ni solicitudes pagas.
- No se escriben contrasenas, cookies, tokens, `storageState`, HTML, screenshots con datos personales, headers ni bodies completos en Git, logs o reportes.
- La identidad debe ser dedicada a pruebas y aprobada explicitamente por el operador.
- La consulta de `platform_members` debe ejecutarse read-only y usar el email como parametro, no concatenarlo en SQL.
- La ejecucion real requiere un checkpoint separado y confirmacion explicita del operador.
- La politica de reutilizacion controlada o desactivacion se elige antes de cualquier ejecucion real, pero este cambio documental no ejecuta ninguna.
- No se modifican `src`, API, configuracion productiva, migraciones ni `tests/integration/postgres/native-schema.test.ts`.

---

### Task 1: Crear el runbook operativo seguro

**Files:**
- Create: `docs/production-ordinary-user-verification.md`
- Reference: `docs/superpowers/specs/2026-08-20-lh-003-safe-production-ordinary-user-verification-design.md`
- Reference: `docs/platform-administration.md`
- Reference: `docs/production-activation.md`
- Reference: `src/db/schema/platform-members.ts`
- Reference: `src/db/migrations/0002_platform_control_plane.sql`

**Interfaces:**
- Consumes: una identidad de prueba dedicada aprobada por el operador, una ventana de prueba, un console read-only de PostgreSQL y una sesion de navegador aislada.
- Produces: un procedimiento manual que devuelve evidencia redactada y no modifica estado de produccion.

- [ ] **Step 1: Escribir la seccion de prerrequisitos y checkpoint**

Documentar que el operador debe confirmar, antes de abrir produccion:

```markdown
## Prerrequisitos

- Identidad dedicada aprobada; no usar una cuenta personal.
- Entorno, deployment y ventana de prueba confirmados.
- Console PostgreSQL read-only disponible.
- Destino seguro para una nota redactada; no guardar cookies ni storage state.
- Politica elegida: reutilizacion controlada o desactivacion manual.
- Confirmacion explicita del operador para ejecutar la verificacion real.
```

Indicar que cualquier prerrequisito ausente detiene el procedimiento y que este documento no crea ni cambia la identidad.

- [ ] **Step 2: Documentar la consulta read-only parametrizada**

Incluir esta consulta para una console que soporte binds, ejecutada con el email aprobado como parametro `$1`:

```sql
SELECT
  normalized_email,
  user_id IS NOT NULL AS is_linked,
  role,
  is_active
FROM platform_members
WHERE normalized_email = lower(btrim($1));
```

Documentar la interpretacion exacta:

- Cero filas: continuar solo si la identidad ya fue aprobada para la prueba.
- Una fila con `is_active = false`: detenerse; no cambiarla durante esta tarea.
- Una fila con `is_active = true`: detenerse; la identidad no es ordinaria para esta prueba.
- `role` distinto de `platform_admin`: tratar como inconsistencia y detenerse.
- Error de conexion, permisos o resultado ambiguo: detenerse.

Prohibir `INSERT`, `UPDATE`, `DELETE`, bootstrap, migraciones y consultas que impriman otros datos de usuario.

- [ ] **Step 3: Documentar el flujo manual de navegador**

Especificar navegador aislado, sin importar cookies ni `storageState` de otro entorno:

```markdown
1. Abrir el dominio de produccion confirmado.
2. Iniciar sesion manualmente con la identidad dedicada aprobada.
3. Confirmar que el flujo termina en `/onboarding`.
4. Navegar directamente a `/admin`.
5. Confirmar que no aparece el panel global y que la respuesta es una redireccion/denegacion generica.
6. No copiar el contenido completo de la pagina, headers, cookies ni respuestas.
7. Cerrar sesion y cerrar la ventana aislada.
```

La comprobacion de `/admin` debe registrar solo ruta, resultado observable y estado de denegacion; nunca detalles internos de autorizacion.

- [ ] **Step 4: Añadir criterios de detencion inmediata**

Incluir detencion obligatoria ante identidad incorrecta, membresia activa, acceso a `/admin`, detalles internos expuestos, datos sensibles en evidencia, sesion que no se limpia o cualquier resultado ambiguo. Indicar: no corregir en caliente, no cambiar permisos y escalar al operador responsable.

- [ ] **Step 5: Añadir plantilla de reporte redactado**

Incluir una plantilla que solo permita estos campos:

```markdown
# LH-003 Production Verification

- UTC timestamp: YYYY-MM-DDTHH:MM:SSZ
- Environment/deployment: [redacted identifier]
- Test identity: [redacted identifier]
- Read-only platform membership: absent / stopped / ambiguous
- Login destination: `/onboarding` / failed
- Direct `/admin` check: denied / unexpected access / ambiguous
- Session cleanup: confirmed / failed
- Result: pass / stopped / blocked
- Notes: [no secrets, cookies, tokens, headers, bodies, HTML or personal data]
```

Documentar que los bracketed values son datos que el operador completa fuera del repositorio o en una evidencia segura; no son valores para commitear.

- [ ] **Step 6: Documentar reutilizacion y limpieza**

Explicar las dos opciones sin ejecutar ninguna:

- Reutilizacion controlada: registrar propietario, proposito y fecha de revision, sin guardar credenciales ni sesiones.
- Desactivacion manual: el operador desactiva la identidad y verifica que no conserve acceso; solo registra resultado redactado.

Establecer que ambas acciones cambian produccion y requieren aprobacion operativa separada.

- [ ] **Step 7: Revisar el runbook contra el diseño**

Comprobar que cada criterio de `docs/superpowers/specs/2026-08-20-lh-003-safe-production-ordinary-user-verification-design.md` tiene una seccion correspondiente y que el runbook no contiene comandos de escritura, secretos, credenciales de ejemplo reales o instrucciones ambiguas.

### Task 2: Ejecutar QA documental y actualizar el estado

**Files:**
- Modify: `tasks.md`
- Test: `docs/production-ordinary-user-verification.md`

**Interfaces:**
- Consumes: el runbook terminado de Task 1.
- Produces: evidencia de revision documental y estado `revision` para LH-003; la tarea no pasa a `aprobada` sin la revision de seguridad y evidencia requeridas.

- [ ] **Step 1: Ejecutar escaneos de seguridad documental**

Ejecutar:

```powershell
rg -n -- "-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_live_[A-Za-z0-9]{10,}|(DATABASE_URL|FIREBASE_PRIVATE_KEY)=.{8,}" docs/production-ordinary-user-verification.md
```

Resultado esperado: cero coincidencias de secretos o valores de credenciales. Las menciones normativas a cookies/tokens no cuentan como secretos porque el escaneo busca formatos de valores, no nombres de controles.

- [ ] **Step 2: Verificar placeholders seguros y estructura**

Revisar que los únicos corchetes de la plantilla sean campos redactados (`[redacted identifier]`, `[no secrets...]`) y que el SQL use `$1`, nunca interpolacion de email. Ejecutar:

```powershell
rg -n "TODO|TBD|FIXME|<email real>|password real|token real" docs/production-ordinary-user-verification.md
```

Resultado esperado: cero coincidencias.

- [ ] **Step 3: Ejecutar controles de formato y alcance**

Ejecutar:

```powershell
git diff --check
git status --short
```

Confirmar que solo aparecen el runbook y `tasks.md` como cambios intencionales, y que `tests/integration/postgres/native-schema.test.ts` permanece fuera del diff.

- [ ] **Step 4: Registrar evidencia sin afirmar ejecucion productiva**

Añadir a `tasks.md` el estado `revision` y comandos de QA documental. No registrar una identidad, email, resultado de login real, URL privada, cuenta, token o body. Indicar expresamente que la ejecucion real queda bloqueada hasta el checkpoint operativo.

- [ ] **Step 5: Commit documental**

```powershell
git add docs/production-ordinary-user-verification.md tasks.md
git diff --cached --check
git commit -m "docs: add ordinary user production verification runbook"
```

No incluir archivos de secretos, estado del navegador, reportes crudos ni el test de esquema no relacionado.

## Verificacion final del plan

- Objetivo de identidad dedicada: Task 1 Steps 1-2.
- Ausencia de `platform_members` activa: Task 1 Step 2.
- Redireccion a `/onboarding`: Task 1 Step 3.
- Denegacion de `/admin`: Task 1 Step 3.
- No almacenamiento de secretos o sesiones: Task 1 Steps 3, 5-6 y Task 2 Steps 1-4.
- Reutilizacion o limpieza controlada: Task 1 Step 6.
- Confirmacion operativa antes de ejecucion real: Task 1 Step 1 y Task 2 Step 4.
- Reversion: no hay cambios de datos ni produccion; si la documentacion resulta incorrecta, revertir el commit documental.
