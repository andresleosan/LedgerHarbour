# LH-005 Provider Alerts And Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear un checklist documental read-only para verificar cuotas, alertas, propietarios y scopes mínimos de Google Document AI, Cloudflare R2 y Upstash Redis sin generar gasto ni modificar proveedores.

**Architecture:** La entrega será solo documental. `docs/provider-alerts-limits-checklist.md` tendrá una matriz uniforme por proveedor, estados verificables, controles de acceso, criterios de detención y una plantilla de reporte redactado. No se crearán integraciones, tokens, scripts de dashboard ni cambios de configuración.

**Tech Stack:** Markdown, dashboards de proveedor en modo read-only durante una futura ejecución y evidencia redactada.

## Global Constraints

- Esta fase no activa billing ni cambia de plan.
- Esta fase no crea recursos, buckets, processors o bases Redis.
- Esta fase no ejecuta OCR real ni solicitudes que generen costo.
- Esta fase no modifica alertas, cuotas, scopes, tokens, claves o permisos.
- Las credenciales se evalúan por alcance sin copiar sus valores.
- No se registran secretos, tokens, IDs privados completos, filas de cuenta ni detalles de facturación.
- Cualquier remediación de billing, credenciales o permisos requiere aprobación operativa separada.
- LH-005 permanece en `revision` hasta completar una futura revisión read-only y su revisión de seguridad.
- No se modifican `src`, API, configuración productiva, migraciones ni `tests/integration/postgres/native-schema.test.ts`.

---

### Task 1: Crear checklist operativo por proveedor

**Files:**
- Create: `docs/provider-alerts-limits-checklist.md`
- Reference: `docs/superpowers/specs/2026-08-20-lh-005-provider-alerts-limits-design.md`
- Reference: `docs/google-document-ai.md`
- Reference: `docs/r2-private-storage.md`
- Reference: `docs/rate-limiting.md`
- Reference: `docs/production-activation.md`
- Reference: `docs/STACK.md`

**Interfaces:**
- Consumes: acceso read-only futuro del operador a Google Cloud, Cloudflare y Upstash; no consume secretos en esta fase.
- Produces: checklist con una fila independiente para cada proveedor y estados `verified`, `unverified`, `blocked` o `not applicable`.

- [ ] **Step 1: Escribir prerrequisitos y prohibiciones**

Documentar que antes de una ejecución futura el operador debe confirmar el proyecto/workspace correcto, acceso read-only, fecha UTC, responsable redactado y destino seguro de evidencia. Declarar que el documento no habilita billing ni autoriza cambios.

- [ ] **Step 2: Escribir la matriz uniforme**

Incluir estas tres filas y verificaciones exactas:

```markdown
| Provider | Verify | Risk |
| Google Document AI | project, Invoice Parser processor, region, quota, budget alert, minimum IAM | usage charge per document/pages |
| Cloudflare R2 | private bucket, storage/operation quota, alerts, bucket-scoped keys | overage or object exposure |
| Upstash Redis | plan, command limit, billing alert, Redis/environment scope | unbounded rate-limit usage or charge |
```

Cada proveedor debe registrar fecha, responsable, fuente, estado de cuota, estado de alerta, scope de credencial, riesgo y remediación, sin copiar valores privados.

- [ ] **Step 3: Añadir controles de scopes mínimos**

Documentar estos criterios exactos:

- Document AI: permiso equivalente a `roles/documentai.apiUser`, sin roles de propietario/editor/admin.
- R2: acceso limitado al bucket privado requerido y HTTPS.
- Upstash: token limitado al Redis y entorno correspondiente.

Un scope más amplio se marca como `broader-than-required` y produce un plan de rotación aprobado; no se rota durante LH-005.

- [ ] **Step 4: Añadir estados y reglas de detención**

Definir:

- `verified`: evidencia read-only suficiente.
- `unverified`: falta acceso o dato confiable.
- `blocked`: la revisión exige escritura, expone secreto o no confirma el entorno.
- `not applicable`: solo con justificación explícita.

Detenerse ante workspace incorrecto, acceso no read-only, alerta/cuota que requiera escritura, secreto expuesto o información no confiable. No corregir en caliente.

- [ ] **Step 5: Añadir plantilla de reporte redactado**

Incluir una plantilla con exactamente estos campos:

```markdown
- Provider: Google Document AI / Cloudflare R2 / Upstash Redis
- UTC timestamp: YYYY-MM-DDTHH:MM:SSZ
- Project/workspace: [redacted identifier]
- Owner: [redacted owner]
- Source: [redacted dashboard or policy reference]
- Quota status: verified / unverified / blocked / not applicable
- Alert status: verified / unverified / blocked / not applicable
- Credential scope: minimum / broader-than-required / unverified
- Remediation: none / approved rotation plan / blocked
- Notes: [no secrets, tokens, account rows or billing details]
```

Indicar que los corchetes se completan fuera de Git y que el reporte no contiene valores de tokens, filas de cuenta, costos detallados ni secretos.

- [ ] **Step 6: Documentar el límite de una alerta presupuestaria**

Explicar que una alerta de presupuesto no es un límite duro de consumo. La verificación debe registrar ambos estados por separado y nunca presentar una alerta configurada como garantía de ausencia de gasto.

- [ ] **Step 7: Revisar el checklist contra la especificación**

Comparar cada requisito de la especificación aprobada con una sección concreta del checklist. Confirmar que el documento no contiene comandos de escritura, credenciales de ejemplo reales, activación de billing ni instrucciones de rotación ejecutable.

### Task 2: Ejecutar QA documental y actualizar el backlog

**Files:**
- Modify: `tasks.md`
- Test: `docs/provider-alerts-limits-checklist.md`

**Interfaces:**
- Consumes: checklist terminado de Task 1.
- Produces: evidencia de QA documental y estado `revision` para LH-005; no declara cuotas ni alertas verificadas sin acceso real del operador.

- [ ] **Step 1: Ejecutar escaneo de secretos documentales**

Intentar el comando principal:

```powershell
rg -n -- "-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_live_[A-Za-z0-9]{10,}|(R2_SECRET_ACCESS_KEY|UPSTASH_REDIS_REST_TOKEN|GOOGLE_SERVICE_ACCOUNT_JSON)=.{8,}" docs/provider-alerts-limits-checklist.md
```

Si `rg` no está disponible, registrar el fallo y ejecutar un escaneo PowerShell `.NET` con el mismo patrón, esperando `secret_scan_matches=0`.

- [ ] **Step 2: Ejecutar escaneo de placeholders inseguros**

Ejecutar:

```powershell
rg -n "TODO|TBD|FIXME|<real token>|<private account row>|billing card" docs/provider-alerts-limits-checklist.md
```

Si `rg` no está disponible, usar `[regex]::Matches` con el mismo patrón y registrar `placeholder_scan_matches=0`.

- [ ] **Step 3: Verificar estructura y alcance**

Ejecutar:

```powershell
git diff --check
git status --short
```

Confirmar que solo aparecen el checklist y `tasks.md` como cambios intencionales, y que `tests/integration/postgres/native-schema.test.ts` queda fuera.

- [ ] **Step 4: Actualizar `tasks.md` sin afirmar verificación externa**

Cambiar LH-005 a `revision` y registrar solo QA documental. Indicar que ninguna cuota, alerta o scope fue verificado externamente en esta fase, que no se abrió un dashboard y que no hubo cambios de billing, planes, credenciales o recursos.

- [ ] **Step 5: Commit documental**

```powershell
git add docs/provider-alerts-limits-checklist.md tasks.md
git diff --cached --check
git commit -m "docs: add provider alerts and limits checklist"
```

No incluir secretos, reportes crudos de dashboards, tokens, screenshots ni el test de esquema no relacionado.

## Verificación final del plan

- Matriz de Document AI, R2 y Upstash: Task 1 Step 2.
- Scopes mínimos: Task 1 Step 3.
- Estados y detención: Task 1 Step 4.
- Reporte redactado: Task 1 Step 5.
- Distinción alerta versus límite duro: Task 1 Step 6.
- No-spend y no-remediación: Global Constraints, Task 1 Steps 1, 4 y 7.
- QA y evidencia honesta: Task 2 Steps 1-4.
- Reversión: revertir el commit documental; no hay cambios de proveedor, datos ni producción.
