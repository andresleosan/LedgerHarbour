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

Antes de ejecutar la consulta, la console debe validar que el valor enlazado en `$1` es exactamente el email aprobado para esta prueba, no es `NULL`, no queda vacio despues de quitar espacios y tiene un formato de email valido. Si la console no puede validar esas cuatro condiciones antes de ejecutar, detenerse. No usar un literal, interpolacion de texto ni un valor distinto al aprobado; mantener `$1` parametrizado:

```sql
SELECT
  normalized_email,
  user_id IS NOT NULL AS is_linked,
  role,
  is_active
FROM platform_members
WHERE $1 IS NOT NULL
  AND btrim($1) <> ''
  AND btrim($1) ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  AND normalized_email = lower(btrim($1));
```

Si la console no admite esta validacion del bind o no permite comprobar que corresponde a la identidad aprobada, detenerse aunque el resultado sea cero filas. No registrar el email ni el valor del bind en la evidencia.

Interpretar el resultado exactamente de esta forma:

- Cero filas: es el unico resultado que permite continuar, siempre que la identidad ya este aprobada para la prueba.
- Una o mas filas, sin importar los valores de `is_linked`, `role` o `is_active`: detenerse; no cambiar datos durante esta tarea.
- Como inconsistencia adicional, cualquier fila cuyo `role` no sea exactamente `platform_admin` tambien detiene la prueba; no tratar otros valores como equivalentes.
- Error de conexion, permisos o resultado ambiguo: detenerse.

La consulta solo comprueba `platform_members` y no debe imprimir otros datos de usuario. Estan prohibidos `INSERT`, `UPDATE`, `DELETE`, bootstrap, migraciones y cualquier consulta de escritura o que imprima otros datos de usuario. No se deben copiar valores sensibles a tickets, logs, chat o reportes.

## Flujo Manual De Navegador

Usar un perfil/contexto efimero nuevo, sin importar cookies ni `storageState` de otro entorno:

1. Abrir el dominio de produccion confirmado en el perfil/contexto efimero nuevo.
2. Iniciar sesion manualmente con la identidad dedicada aprobada.
3. Confirmar, solo mediante un resultado booleano, que la identidad visible coincide con la identidad aprobada; no escribir el email en la evidencia. Si no puede confirmarse, detenerse.
4. Confirmar que el flujo termina en `/onboarding`.
5. Navegar directamente a `/admin`.
6. Confirmar que no aparece el panel global y que la respuesta es una redireccion/denegacion generica.
7. No copiar el contenido completo de la pagina, headers, cookies, tokens, valores de storage ni respuestas.
8. Cerrar sesion. En el mismo perfil efimero, navegar a `/auth/continue` y registrar unicamente el booleano `same_profile_redirects_to_login: true/false` segun termine o no en `/login`; no inspeccionar, leer ni guardar cookies, tokens, storage state ni otros valores de sesion.
9. Cerrar el perfil efimero. Abrir otro perfil efimero nuevo sin importar ningun estado y navegar a `/auth/continue`; registrar unicamente el booleano `new_profile_redirects_to_login: true/false` segun termine o no en `/login`. No inspeccionar, leer ni guardar cookies, tokens, storage state ni otros valores de sesion.
10. Cerrar el segundo perfil efimero.

La comprobacion de `/admin` debe registrar solo la ruta, el resultado observable y el estado de denegacion. Nunca registrar detalles internos de autorizacion, HTML, headers, cuerpos de respuesta, cookies, tokens, valores de storage ni datos personales. La limpieza solo es observable por los dos booleanos anteriores: `Session cleanup: confirmed` es valido unicamente si ambos son `true`; cualquier `false` o resultado no confirmable detiene la prueba. No reutilizar una sesion ni almacenar credenciales, cookies o `storageState`.

## Detencion Inmediata

Detener la prueba inmediatamente si ocurre cualquiera de estos casos:

- La identidad no coincide con la aprobada.
- No puede confirmarse con resultado booleano que la identidad visible despues del login coincide con la identidad aprobada.
- La consulta read-only devuelve una o mas filas; solo cero filas permite continuar.
- El parametro `$1` es nulo, vacio, no tiene formato de email valido, no es el email aprobado o la console no puede validar cualquiera de esas condiciones.
- La identidad obtiene acceso a `/admin` o aparece el panel global.
- La respuesta o interfaz expone detalles internos de autorizacion.
- Aparecen secretos, cookies, tokens, headers, HTML, datos personales u otros datos sensibles en la evidencia.
- Cualquiera de las dos comprobaciones booleanas de limpieza es `false` o no puede confirmarse.
- Hay un error, resultado ambiguo o cualquier desviacion no prevista del procedimiento.

Ante una detencion, no corregir en caliente, no cambiar permisos, no modificar membresias y no repetir la prueba con otra identidad. Escalar el resultado al operador responsable y conservar solo una nota redactada.

## Plantilla De Reporte Redactado

Usar solamente estos campos:

```markdown
# LH-003 Production Verification

- UTC timestamp: YYYY-MM-DDTHH:MM:SSZ
- Environment/deployment: [redacted identifier]
- Test identity: [redacted identifier]
- Execution: not executed / blocked / executed
- Operator checkpoint: confirmed / not confirmed
- Read-only platform membership: absent / stopped / ambiguous
- Identity match: confirmed / failed / not confirmed
- Login destination: `/onboarding` / failed
- Direct `/admin` check: denied / unexpected access / ambiguous
- Session cleanup same profile: true / false / not confirmed
- Session cleanup new profile: true / false / not confirmed
- Session cleanup: confirmed / failed / not confirmed
- Cleanup policy: controlled reuse / manual deactivation / not selected
- Result: pass / stopped / blocked
- Notes: [no secrets, cookies, tokens, headers, bodies, HTML or personal data]
```

Los campos `Execution` y `Operator checkpoint` son obligatorios. `Execution: executed` solo puede marcarse despues de ejecutar la consulta read-only y todos los pasos del navegador, incluidas las dos comprobaciones booleanas de `/auth/continue` en perfiles efimeros separados y el cierre de ambos perfiles. `Execution: blocked` indica que la prueba comenzo pero se detuvo; `Execution: not executed` indica que no comenzo o que solo se reviso el documento. `Operator checkpoint: confirmed` solo puede marcarse cuando el operador confirmo explicitamente la ejecucion real antes de abrir produccion.

`Result: pass` solo es valido cuando `Execution: executed`, `Operator checkpoint: confirmed`, `Read-only platform membership: absent`, `Identity match: confirmed`, `Login destination: /onboarding`, `Direct /admin check: denied`, `Session cleanup same profile: true`, `Session cleanup new profile: true`, `Session cleanup: confirmed` y una `Cleanup policy` distinta de `not selected` aparecen juntos en la misma evidencia redactada. Elegir una politica no autoriza ejecutar cambios ni reemplaza el checkpoint operativo. Cualquier otra combinacion debe usar `Result: stopped` o `Result: blocked`, nunca `pass`.

Una revision documental debe registrar `Execution: not executed`, `Operator checkpoint: not confirmed` y `Result: blocked`; revisar este documento nunca demuestra que la prueba haya sido ejecutada. Los valores entre corchetes son datos que el operador completa fuera del repositorio o en una evidencia segura. No son valores para commitear.

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
- Las dos comprobaciones booleanas de `/auth/continue` terminaron en `/login` en perfiles efimeros separados, sin inspeccionar ni guardar valores de cookies, tokens o storage.
- La politica de reutilizacion controlada o desactivacion manual quedo registrada sin ejecutar cambios no aprobados.
- Cualquier resultado distinto de `pass` fue escalado sin correccion en caliente.
