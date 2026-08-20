# LH-005 Verificacion de alertas y limites de proveedores

**Fecha:** 2026-08-20
**Estado:** Aprobada para planificacion documental

## Objetivo

Definir un checklist read-only para registrar el estado actual de cuotas, alertas, responsables y scopes de credenciales de Google Document AI, Cloudflare R2 y Upstash Redis, sin activar billing, cambiar planes, modificar credenciales ni generar solicitudes pagas.

## Alcance aprobado

La futura ejecucion revisara cada proveedor en el workspace/proyecto correcto y producira una fila redactada con fecha UTC, responsable, fuente, estado, cuota, alerta, alcance de credencial y accion recomendada.

La fase documental no abre dashboards ni consume credenciales. La ejecucion real requiere acceso read-only del operador y confirmacion explicita antes de cualquier acceso externo.

Queda fuera de alcance:

- Activar billing o cambiar de plan.
- Crear recursos, buckets, processors o bases Redis.
- Ejecutar OCR real o solicitudes que generen costo.
- Modificar alertas, cuotas, scopes, tokens, claves o permisos.
- Rotar credenciales; solo se puede documentar un plan de rotacion aprobado.
- Registrar valores de tokens, IDs privados completos, filas de cuenta o detalles de facturacion.

## Matriz de proveedores

| Proveedor | Verificar | Riesgo especifico |
|---|---|---|
| Google Document AI | Proyecto, processor Invoice Parser, region, cuota, alerta presupuestaria e IAM minimo | Consumo facturable por documento/paginas |
| Cloudflare R2 | Bucket privado, cuota de almacenamiento/operaciones, alertas y claves limitadas al bucket | Sobrecuota y exposicion de objetos |
| Upstash Redis | Plan, limite de comandos, alerta de billing, token y entorno correcto | Rate limiting sin limite o cobro por uso |

Estados permitidos:

- `verified`: evidencia read-only suficiente.
- `unverified`: falta acceso o dato confiable.
- `blocked`: la revision exige una accion no autorizada o expone secretos.
- `not applicable`: solo con una justificacion explicita.

Una cuota o alerta no confirmada no puede registrarse como `verified`.

## Controles de seguridad

- Confirmar el proyecto, cuenta, workspace y entorno antes de observar datos.
- Usar acceso read-only y minimo privilegio.
- Evaluar scopes por alcance, nunca copiando el valor de una credencial.
- Document AI debe usar solo el permiso equivalente a `roles/documentai.apiUser`.
- R2 debe limitarse al bucket privado requerido.
- Upstash debe limitarse al Redis y entorno correspondiente.
- Si una credencial es demasiado amplia, registrar el riesgo y un plan de rotacion aprobado sin ejecutar la rotacion.
- Si aparece un secreto, token, fila de cuenta o detalle de facturacion, detenerse y conservar solo una nota redactada.

## Reporte redactado

El checklist debe producir un reporte con:

- Fecha UTC y responsable redactado.
- Entorno/proyecto identificado de forma segura.
- Una fila por proveedor.
- Cuota y alerta: verificadas o `unverified`.
- Estado de scopes minimos.
- Riesgos y plan de remediacion aprobado, sin secretos.
- Confirmacion de que no hubo cambios de billing, plan, credenciales ni recursos.

Campos minimos por proveedor:

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

Los valores entre corchetes se completan fuera de Git y no son valores para commitear.

## Detencion y remediacion

Detener la revision si no puede confirmarse el workspace correcto, el acceso es superior a read-only, la cuota/alerta requiere una accion de escritura, aparece un secreto o la informacion no es suficientemente confiable.

No corregir en caliente. Cualquier cambio de billing, plan, alerta, credencial, scope o recurso requiere aprobacion operativa separada y queda fuera de LH-005.

## Criterios de aceptacion

- Document AI, R2 y Upstash tienen una fila redactada con cuota, alerta, responsable y scopes.
- La alerta presupuestaria de Google Document AI tiene estado explicito.
- Las credenciales se evaluan por alcance minimo sin exponer valores.
- Ningun estado `unverified` se presenta como verificado.
- No se activa billing, plan, recurso, OCR pago ni solicitud billable.
- Una credencial amplia tiene plan de rotacion aprobado o queda `blocked`; no se reemplaza durante esta tarea.
- El reporte no contiene secretos, tokens, filas de cuenta ni detalles de facturacion.
- LH-005 permanece `revision` hasta completar la ejecucion read-only y la revision de seguridad.

## Dependencias y riesgos

- Requiere acceso read-only del operador a Google Cloud, Cloudflare y Upstash.
- Los precios, cuotas y nombres de planes pueden cambiar; la evidencia debe incluir la fuente y fecha sin copiar datos sensibles.
- Una alerta presupuestaria no es un limite duro de consumo; el reporte debe conservar esa distincion.
- Si la verificacion sera recurrente, una automatizacion posterior requiere un diseño separado de secretos temporales, scopes, retencion y revocacion.
