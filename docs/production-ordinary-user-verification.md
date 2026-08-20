# LH-003 Verificacion segura de usuario ordinario en produccion

Este runbook documenta una verificacion manual y no destructiva de que una identidad ordinaria autenticada no obtiene privilegios globales en produccion. No crea ni cambia identidades, membresias, permisos, secretos, configuracion de hosting ni datos de produccion. La ejecucion real requiere la confirmacion explicita y separada del operador.

## Prerrequisitos

- Identidad dedicada aprobada; no usar una cuenta personal.
- Entorno, deployment y ventana de prueba confirmados.
- Console PostgreSQL read-only disponible.
- Destino seguro para una nota redactada; no guardar cookies ni storage state.
- Politica elegida: reutilizacion controlada o desactivacion manual.
- Confirmacion explicita del operador para ejecutar la verificacion real.

El operador debe confirmar todos los prerrequisitos antes de abrir produccion. Si falta cualquiera, detener el procedimiento. Este documento no crea ni cambia la identidad, sus credenciales, sus permisos ni sus membresias.

La contrasena, si es necesaria, se introduce manualmente o mediante un gestor temporal. Nunca se escribe en chat, Git, logs ni reportes. La sesion del navegador debe ser aislada y no debe importar cookies ni `storageState` de otro entorno.

## Consulta Read-Only

En una console PostgreSQL que soporte binds, ejecutar solamente la siguiente consulta con el email aprobado como parametro `$1`:

```sql
SELECT
  normalized_email,
  user_id IS NOT NULL AS is_linked,
  role,
  is_active
FROM platform_members
WHERE normalized_email = lower(btrim($1));
```

Interpretar el resultado exactamente de esta forma:

- Cero filas: continuar solo si la identidad ya fue aprobada para la prueba.
- Una fila con `is_active = false`: detenerse; no cambiarla durante esta tarea.
- Una fila con `is_active = true`: detenerse; la identidad no es ordinaria para esta prueba.
- `role` distinto de `platform_admin`: tratar como inconsistencia y detenerse.
- Error de conexion, permisos o resultado ambiguo: detenerse.

La consulta solo comprueba `platform_members` y no debe imprimir otros datos de usuario. Estan prohibidos `INSERT`, `UPDATE`, `DELETE`, bootstrap, migraciones y cualquier consulta de escritura o que imprima otros datos de usuario. No se deben copiar valores sensibles a tickets, logs, chat o reportes.

## Flujo Manual De Navegador

Usar una ventana de navegador aislada, sin importar cookies ni `storageState` de otro entorno:

1. Abrir el dominio de produccion confirmado.
2. Iniciar sesion manualmente con la identidad dedicada aprobada.
3. Confirmar que el flujo termina en `/onboarding`.
4. Navegar directamente a `/admin`.
5. Confirmar que no aparece el panel global y que la respuesta es una redireccion/denegacion generica.
6. No copiar el contenido completo de la pagina, headers, cookies ni respuestas.
7. Cerrar sesion y cerrar la ventana aislada.

La comprobacion de `/admin` debe registrar solo la ruta, el resultado observable y el estado de denegacion. Nunca registrar detalles internos de autorizacion, HTML, headers, cuerpos de respuesta, cookies, tokens ni datos personales. No reutilizar una sesion ni almacenar credenciales, cookies o `storageState`.

## Detencion Inmediata

Detener la prueba inmediatamente si ocurre cualquiera de estos casos:

- La identidad no coincide con la aprobada.
- La consulta read-only no confirma la ausencia de membresia requerida.
- Existe una membresia activa.
- La identidad obtiene acceso a `/admin` o aparece el panel global.
- La respuesta o interfaz expone detalles internos de autorizacion.
- Aparecen secretos, cookies, tokens, headers, HTML, datos personales u otros datos sensibles en la evidencia.
- La sesion no se limpia o no puede confirmarse la limpieza.
- Hay un error, resultado ambiguo o cualquier desviacion no prevista del procedimiento.

Ante una detencion, no corregir en caliente, no cambiar permisos, no modificar membresias y no repetir la prueba con otra identidad. Escalar el resultado al operador responsable y conservar solo una nota redactada.

## Plantilla De Reporte Redactado

Usar solamente estos campos:

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

Los valores entre corchetes son datos que el operador completa fuera del repositorio o en una evidencia segura. No son valores para commitear. El reporte debe describir un procedimiento realmente ejecutado solo cuando exista la confirmacion operativa correspondiente; revisar este documento no demuestra que la prueba haya sido ejecutada.

## Reutilizacion Y Limpieza

Antes de ejecutar la verificacion, elegir una de estas politicas. Este runbook describe ambas opciones, pero no ejecuta ninguna:

- **Reutilizacion controlada:** registrar propietario, proposito y fecha de revision. No guardar credenciales, cookies, tokens ni sesiones.
- **Desactivacion manual:** el operador desactiva la identidad y verifica que no conserve acceso. Registrar solamente el resultado redactado.

Ambas acciones cambian produccion y requieren aprobacion operativa separada. La politica elegida no autoriza por si misma la ejecucion de la verificacion ni permite hacer cambios durante una detencion.

## Checklist De Cierre

Antes de cerrar la evidencia, confirmar que:

- Solo se registro la evidencia redactada permitida.
- No se guardaron contrasenas, cookies, tokens, `storageState`, headers, cuerpos, HTML ni datos personales.
- La sesion fue cerrada y la ventana aislada fue cerrada.
- La politica de reutilizacion controlada o desactivacion manual quedo registrada sin ejecutar cambios no aprobados.
- Cualquier resultado distinto de `pass` fue escalado sin correccion en caliente.
