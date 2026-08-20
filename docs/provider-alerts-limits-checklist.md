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
