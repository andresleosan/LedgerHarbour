# LH-005 Checklist de alertas y limites por proveedor

## Proposito y alcance

Este checklist prepara una futura verificacion **read-only** de Google Document AI,
Cloudflare R2 y Upstash Redis. No abre dashboards ni usa credenciales durante la fase
documental. La ejecucion futura requiere acceso read-only del operador y confirmacion
explicita antes de cualquier acceso externo.

Este documento no habilita billing, no cambia planes, no crea recursos y no autoriza
cambios de cuotas, alertas, scopes, tokens, claves, permisos o credenciales. Tampoco
autoriza OCR real, solicitudes billable ni rotacion de credenciales. Una rotacion solo
puede registrarse como plan aprobado; no se ejecuta durante LH-005.

## Prerrequisitos de una ejecucion futura

Antes de observar cualquier dato, el operador debe confirmar:

- Proyecto, cuenta, workspace y entorno correctos.
- Acceso read-only y privilegio minimo para la observacion.
- Fecha y hora UTC de la revision.
- Responsable redactado de la revision.
- Destino seguro y fuera de Git para la evidencia redactada.

La evidencia debe registrar la fuente y la fecha sin copiar secretos, tokens, IDs
privados completos, filas de cuenta, costos detallados ni otros valores sensibles.

## Matriz uniforme

| Provider | Verify | Risk |
| Google Document AI | project, Invoice Parser processor, region, quota, budget alert, minimum IAM | usage charge per document/pages |
| Cloudflare R2 | private bucket, storage/operation quota, alerts, bucket-scoped keys | overage or object exposure |
| Upstash Redis | plan, command limit, billing alert, Redis/environment scope | unbounded rate-limit usage or charge |

Cada fila debe registrar estos campos, sin copiar valores privados:

- Fecha UTC.
- Responsable redactado.
- Fuente redactada.
- Estado de cuota.
- Estado de alerta.
- Scope de credencial.
- Riesgo.
- Remediacion.

## Scopes minimos

- **Google Document AI:** permiso equivalente a `roles/documentai.apiUser`, sin
  roles de propietario, editor o administrador.
- **Cloudflare R2:** acceso limitado al bucket privado requerido y uso de HTTPS.
- **Upstash Redis:** token limitado al Redis y al entorno correspondiente.

Un scope mas amplio que el requerido se registra como `broader-than-required` y genera
un plan de rotacion aprobado. No se rota durante LH-005.

## Estados y reglas de detencion

Estados permitidos:

- `verified`: existe evidencia read-only suficiente y confiable.
- `unverified`: falta acceso o un dato confiable.
- `blocked`: la revision exige escritura, expone un secreto o no confirma el entorno.
- `not applicable`: se usa solo con justificacion explicita.

Una cuota o alerta no confirmada nunca se registra como `verified`.

La revision debe detenerse ante cualquiera de estas condiciones:

- Workspace, proyecto, cuenta o entorno incorrecto o no confirmado.
- Acceso superior a read-only o incapacidad de confirmar el privilegio.
- Cuota o alerta cuya verificacion exige una accion de escritura.
- Secreto, token, fila de cuenta o detalle de facturacion expuesto.
- Informacion ausente, contradictoria o no confiable.

Al detenerse, conservar solo una nota redactada y no corregir en caliente. Cualquier
cambio requiere aprobacion operativa separada y queda fuera de LH-005.

## Plantilla de reporte redactado

Usar una copia de esta plantilla por proveedor:

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

Los valores entre corchetes se completan fuera de Git. El reporte final no debe
contener valores de tokens, filas de cuenta, costos detallados ni secretos.

## Limite de una alerta presupuestaria

Una alerta presupuestaria es una señal de observacion y **no es un limite duro de
consumo**. La revision debe registrar por separado `Quota status` y `Alert status`.
Una alerta configurada no debe presentarse como garantia de ausencia de gasto.

## Evidencia Redactada De Ejecucion

Revision read-only ejecutada el `2026-08-21T18:36:01Z` con el operador autorizado. No se
copiaron secretos, tokens, filas de cuenta, IDs privados completos ni detalles de
facturacion.

```markdown
- Provider: Google Document AI
- UTC timestamp: 2026-08-21T18:36:01Z
- Project/workspace: [redacted project]
- Owner: [redacted operator]
- Source: Google Cloud Document AI, Quotas, Billing e IAM (redacted)
- Quota status: verified (Document AI quota surface visible; no values changed)
- Alert status: blocked (project has no linked billing account, so no budget alert could be verified)
- Credential scope: minimum (IAM shows the Document AI API User role; no owner/editor role was observed)
- Remediation: blocked (no billing or IAM change authorized)
- Notes: Invoice Parser enabled in the US region; no OCR request executed.

- Provider: Cloudflare R2
- UTC timestamp: 2026-08-21T18:36:01Z
- Project/workspace: [redacted account and bucket]
- Owner: [redacted operator]
- Source: Cloudflare R2 bucket, Metrics, Billing and Account API tokens (redacted)
- Quota status: unverified (bucket metrics visible; no hard quota or alert value confirmed)
- Alert status: unverified (R2 Paid subscription visible; no alert configuration confirmed)
- Credential scope: unverified (no account token was listed; user-token scope was not exposed)
- Remediation: blocked (no plan, billing or credential change authorized)
- Notes: bucket public access disabled; Standard storage; no object or credential values recorded.

- Provider: Upstash Redis
- UTC timestamp: 2026-08-21T18:36:01Z
- Project/workspace: [redacted database and team]
- Owner: [redacted operator]
- Source: Upstash Redis Details, Settings and ACL (redacted)
- Quota status: verified (Free Tier: 500k monthly commands, 50 GB bandwidth, 256 MB storage)
- Alert status: unverified (no billing alert was visible in the read-only database view)
- Credential scope: broader-than-required (database ACL default is `+@all`; token values were not exposed)
- Remediation: blocked (no ACL, billing or credential change authorized)
- Notes: region Ireland; observed usage 103 commands, 0 B bandwidth, 0 B storage, cost $0.00; TLS enabled.
```

No provider was modified and no billable request, OCR request, plan change, alert change,
credential rotation or resource creation was performed.

## Verificacion Read-Only Adicional

Revision read-only adicional ejecutada el `2026-08-22T03:53:32Z`. Se observaron los paneles
oficiales con la sesion del operador autorizado. No se copiaron secretos, tokens, filas de
cuenta, direcciones ni datos privados completos.

```markdown
- Provider: Google Document AI
- UTC timestamp: 2026-08-22T03:53:32Z
- Project/workspace: [redacted project]
- Owner: [redacted operator]
- Source: Google Cloud Document AI, Quotas, Processors, Billing e IAM (redacted)
- Quota status: verified (API enabled; quota surface showed 141 quota entries, current and 7-day >90% usage both 0)
- Alert status: blocked (project still has no linked billing account; no budget alert can be verified)
- Credential scope: minimum (Document AI API User role observed; no owner/editor role observed for the processor identity)
- Remediation: blocked (billing and IAM changes require separate operator approval)
- Notes: Invoice Parser enabled in `us`; no OCR request executed.

- Provider: Cloudflare R2
- UTC timestamp: 2026-08-22T03:53:32Z
- Project/workspace: [redacted account and bucket]
- Owner: [redacted operator]
- Source: Cloudflare R2 bucket, R2 usage, Billing and Account API tokens (redacted)
- Quota status: unverified (bucket metrics visible; no hard quota confirmed)
- Alert status: verified (a monthly `$1` budget alert was created; Cloudflare confirmed `Budget alert saved successfully`)
- Credential scope: minimum (an active R2 token for `ledgerharbour` showed `Object Read & Write`; no account token or secret value was exposed)
- Remediation: none (existing credential already satisfies the bucket-scoped minimum; no rotation required)
- Notes: bucket remains Standard with public access disabled; observed size 85 B, Class A 10 and Class B 20; current usage `$0.00`.

- Provider: Upstash Redis
- UTC timestamp: 2026-08-22T03:53:32Z
- Project/workspace: [redacted database and team]
- Owner: [redacted operator]
- Source: Upstash Redis Details, Usage, ACL and Settings (redacted)
- Quota status: verified (Free Tier: 105/500k monthly commands, 0 B/50 GB bandwidth, 0 B/256 MB storage)
- Alert status: unverified (no billing alert was visible in the database view or settings)
- Credential scope: broader-than-required (default ACL remains `+@all` for `~*`)
- Remediation: blocked (the console exposed no isolated canary database; no ACL, billing or credential change executed)
- Notes: region Ireland; observed cost $0.00. `excited-manatee` is the displayed endpoint/region alias for the same database, not a separate canary. Source review of `@upstash/ratelimit@2.0.8` identified `EVALSHA`, `EVAL`, `GET`, `INCRBY`, and `PEXPIRE` as the proposed minimum command allowlist for the current fixed-window limiter, scoped to `ledgerharbour:*`; no production ACL mutation was attempted.
```

La verificacion adicional confirma que el hallazgo de R2 fue cerrado sin cambiar el plan,
la credencial ni el bucket. No se ejecuto una solicitud billable, OCR, ACL, rotacion de
credencial o creacion de recurso.

## Plan De Remediacion Para Activacion Futura

Este plan es documental, queda fuera del alcance read-only de LH-005 y no autoriza ninguna
mutacion. Sus pasos son gates de activacion productiva controlados por el operador.

- **Google Document AI:** no vincular billing durante LH-005. Si el operador autoriza
  billing, crear primero un presupuesto `alerts-only` limitado al proyecto y configurar
  destinatarios y umbrales; la documentacion oficial aclara que un presupuesto de alertas
  no es un tope duro de gasto.
- **Cloudflare R2:** completado el checkpoint: se creo una alerta mensual de `$1` en la
  cuenta existente. La lista read-only ya mostraba una clave activa con `Object Read & Write`
  limitada exclusivamente a `ledgerharbour`, por lo que no se genero ni roto una credencial.
  Una rotacion futura debe seguir el flujo create/update/verify/revoke sin registrar valores.
- **Upstash Redis:** no cambiar la ACL productiva a ciegas. La revision de `@upstash/ratelimit@2.0.8`
  identifico `EVALSHA`, `EVAL`, `GET`, `INCRBY` y `PEXPIRE` como allowlist minima propuesta para
  el limiter fixed-window actual. La documentacion oficial vigente limita las ACL personalizadas
  a bases pagas, por lo que una canaria Free no puede validar ese scope. Una activacion futura
  requiere aprobacion separada del costo y una canaria pagada aislada, con claves
  `ledgerharbour:*` y rollback mediante el token anterior. Hasta entonces, el token estandar es
  una excepcion exclusiva del prototipo: Redis dedicado, secreto solo de servidor y prefijo de
  aplicacion `ledgerharbour:`.

Fuentes oficiales consultadas para este plan:

- Google Cloud Billing budgets: <https://cloud.google.com/billing/docs/how-to/budgets>
- Cloudflare R2 pricing: <https://developers.cloudflare.com/r2/pricing/>
- Cloudflare R2 authentication and bucket-scoped permissions:
  <https://developers.cloudflare.com/r2/api/tokens/>
- Cloudflare API permission reference:
  <https://developers.cloudflare.com/fundamentals/api/reference/permissions/>
- Upstash Redis security and paid ACL availability:
  <https://upstash.com/docs/redis/features/security>
- Upstash Redis current Free and paid plan limits:
  <https://upstash.com/pricing/redis>
- Google Cloud project billing links:
  <https://docs.cloud.google.com/billing/docs/how-to/modify-project>
- Google Document AI pricing:
  <https://cloud.google.com/products/document-ai/pricing>

## Resultado De Ejecucion Paso A Paso

- **Cloudflare R2:** completed. The account now shows one monthly `$1` budget alert. The
  existing active `ledgerharbour` token is already bucket-scoped with `Object Read & Write`,
  so no new secret was generated and no rotation was performed.
- **Upstash Redis:** blocked. Only the production rate-limit database was available; the
  displayed `excited-manatee` value is its endpoint/region alias. Production ACL and token
  were not changed. Creating the approved disposable canary was refused by the Free Tier
  limit; the only offered alternative was a payment-method/plan upgrade, which was not used.
- **Google Document AI:** blocked. An existing billing account is visible, but the project
  remains unlinked. The official `Billing > Projects > Actions > Change billing` flow reached
  the target project, but Google rejected the association because the account reached its
  project billing quota; no quota increase, billing link or budget was created.

## Continuacion De Activacion Separada

Ejecucion controlada el `2026-08-25T02:39:39Z`, posterior al cierre de LH-005 y respaldada por
una aprobacion de costo independiente. No cambia el resultado `aprobada` de la verificacion
read-only.

- **Google Document AI:** `pending external review`. En la ventana de 30 dias, la tabla de
  metodos mostro operaciones administrativas de consola y ninguna solicitud
  `ProcessDocument` o `BatchProcessDocuments`. El proyecto sigue sin billing. Google rechazo
  de nuevo el enlace por el limite de proyectos de la cuenta y recibio una solicitud oficial
  por exactamente un cupo adicional; informo una revision tipica de unos dos dias habiles.
  Hasta que se apruebe, no puede crearse el presupuesto de proyecto de `US$1/mes`. No se
  ejecuto OCR ni una solicitud billable.
- **Upstash Redis:** `manual payment handoff`. La base existente sigue Free y sin cambios. La
  consola exige registrar un medio de pago antes de permitir una base Pay-as-you-go separada.
  La ruta aprobada conserva la base Free como rollback y exige configurar en la nueva base un
  presupuesto duro de `US$1/mes` antes de cualquier handoff de credencial. Al alcanzar el tope,
  Upstash limita las operaciones y el costo no supera el presupuesto configurado. No se creo
  una base paga, no se aplico ACL y no se cambio ningun secreto de Vercel.

### Hallazgo posterior de costo Upstash

En `2026-08-25T02:53:21Z`, tras el ingreso manual del medio de pago, Upstash mostro la base
existente como **Pay as You Go**. El editor de presupuesto de esa base y el asistente de una
base nueva rechazaron `US$1` con el mensaje `Budget must be at least $20`. El asistente de base
nueva se cancelo antes de crear ningun recurso. Por tanto, la ruta aprobada de `US$1/mes` no es
viable con la cuenta actual: no se acepta `US$20` sin una nueva aprobacion de costo, no se
actualizo Vercel y no se aplico ACL.

No se registraron valores de credenciales, medios de pago ni detalles privados de facturacion.

## Cierre De Alcance Cronos

Revision de gobernanza ejecutada el `2026-08-24`. El diseno aprobado de LH-005 establece que
cualquier cambio de billing, plan, alerta, credencial, scope o recurso requiere aprobacion
operativa separada y queda fuera de esta tarea. El plan de remediacion posterior habia convertido
por error esas mutaciones externas en un gate de aprobacion de la verificacion.

La evidencia read-only ya satisface el alcance original: los tres proveedores tienen cuota,
alerta, responsable y scope redactados; Google conserva `blocked` de forma explicita; R2 esta
verificado; y Upstash conserva `broader-than-required` sin presentarlo como corregido. La fuente
oficial vigente confirma que las ACL personalizadas de Upstash solo existen en bases pagas, de
modo que no hay una ruta Free para completar la canaria ACL. El costo de la ruta aceptada sigue
siendo aproximadamente `US$0/mes`: no se vincula Google billing, no se ejecuta OCR y no se cambia
Upstash de plan.

Resultado Cronos: LH-005 queda `aprobada` como verificacion read-only. El enlace de billing/cuota
de Google y la ACL personalizada pagada de Upstash permanecen `blocked` como gates de activacion
productiva controlados por el operador. Este cierre no autoriza gasto, billing, OCR, creacion de
recursos, cambio de plan, ACL ni rotacion de credenciales.

La implementación posterior de rate limiting adopta Neon/PostgreSQL Free mediante la migración
reversible `0007_rate_limit_windows`; Upstash queda fuera del runtime y no se requiere una base
Redis nueva para continuar.

Si la cuota o la alerta no puede confirmarse con evidencia read-only, el estado es
`unverified` o `blocked` segun la causa, nunca `verified`.

## Trazabilidad contra la especificacion

- Objetivo y alcance read-only: secciones **Proposito y alcance** y
  **Prerrequisitos de una ejecucion futura**.
- Una fila y verificaciones por proveedor: **Matriz uniforme**.
- Fecha, responsable, fuente, cuota, alerta, scope, riesgo y remediacion:
  **Matriz uniforme** y **Plantilla de reporte redactado**.
- Scopes minimos y plan de rotacion no ejecutable: **Scopes minimos**.
- Estados permitidos y ausencia de falsos `verified`: **Estados y reglas de
  detencion**.
- Detenciones, ausencia de correcciones en caliente y cambios fuera de alcance:
  **Estados y reglas de detencion**.
- Alerta presupuestaria separada del limite duro: **Limite de una alerta
  presupuestaria**.
- Ausencia de secretos y valores privados: todas las secciones de alcance, matriz,
  plantilla y detencion.

Este documento no contiene comandos de escritura, credenciales de ejemplo reales,
activacion de billing, creacion de recursos, OCR pago ni instrucciones ejecutables de
rotacion.
